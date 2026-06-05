import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { runAutopilotTick } from "./autopilot";
import { plantGarden, type GardenRequest } from "./garden-agent";
import { loadDeploymentConfig } from "./config/contracts";
import { resolveAllowedProtocols } from "./config/routes";
import { anchorDecision } from "./relayer";
import { executeRealRoute } from "./execution";
import { logger } from "./logger";
import { createPublicClient, http, keccak256, stringToHex, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { AutopilotIntent, AutopilotPolicyInput, RiskLevel } from "./types";

type AutopilotDecision = Awaited<ReturnType<typeof runAutopilotTick>>;

type AutopilotWorkerConfig = {
  enabled: boolean;
  crop: "steady" | "growth" | "boost";
  amount: string;
  riskPreference: RiskLevel;
  intervalMs: number;
  execute: boolean;
};

let autopilotWorkerTimer: NodeJS.Timeout | null = null;
let autopilotWorkerBusy = false;

function loadLocalEnvFile(path: URL) {
  if (!existsSync(path)) return;
  const contents = readFileSync(path, "utf8");
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index <= 0) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim();
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

loadLocalEnvFile(new URL("../.env", import.meta.url));

function resolveOpenAiChatEndpoint() {
  const raw = process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1";
  const normalized = raw.replace(/\/$/, "");
  if (normalized.endsWith("/chat/completions")) return normalized;
  if (normalized.endsWith("/v1")) return `${normalized}/chat/completions`;
  return `${normalized}/chat/completions`;
}

type PlanRequest = {
  user: `0x${string}`;
  amount: string;
  riskPreference: RiskLevel;
  crop?: "steady" | "growth" | "boost";
  agentId?: string;
  currentStrategyId?: string;
  currentPositionId?: number;
  minImprovementBps?: number;
  policy?: Partial<AutopilotPolicyInput>;
  anchor?: boolean;
  execute?: boolean;
  inputAsset?: string;
  outputAsset?: string;
  inputAmount?: string;
  slippageBps?: number;
};

type GardenPlanRequest = PlanRequest & {
  message?: string;
  userMaxRiskLevel?: RiskLevel;
};

type GardenChatRequest = {
  message: string;
  context?: unknown;
  view?: "canvas" | "shop" | "audit";
  user?: `0x${string}`;
  mode?: "guided" | "autopilot";
};

type AssistantRequestMeta = {
  requestId: string;
  route: "/garden/chat" | "ask_garden_assistant";
  messageLength: number;
  view?: "canvas" | "shop" | "audit";
  contextKeys?: string[];
};

function summarizeAssistantRequest(route: AssistantRequestMeta["route"], body: GardenChatRequest, requestId: string): AssistantRequestMeta {
  return {
    requestId,
    route,
    messageLength: body.message.length,
    view: body.view,
    contextKeys: body.context && typeof body.context === "object" ? Object.keys(body.context as Record<string, unknown>).slice(0, 12) : undefined,
  };
}

function buildAssistantMessages(request: GardenChatRequest) {
  const modeInstruction = request.mode === "autopilot"
    ? "Autopilot mode: do not present the user with options. Report the current action, why it moved, the proof state, and the next review step. Keep it short and operational."
    : "Guided mode: always start with the best option, explain why it is best, give at most one alternative, then state the risk and the next action. Keep it concise and decision-focused.";
  return [
    {
      role: "system" as const,
      content:
        `You are Pak Tani, an English-only autonomous assistant for the Gardenaz AI x RWA moat engine on Mantle. Answer clearly and concisely using the provided context. Focus on dynamic yield strategies, automated risk management, execution readiness, and on-chain proof for USDY and mETH. Do not invent onchain facts. If the user asks about actions, explain the next step and mention the relevant tab or action. If data is missing, say what is missing. Keep the answer short and helpful. ${modeInstruction}`,
    },
    {
      role: "user" as const,
      content: JSON.stringify({
        message: request.message,
        view: request.view,
        context: request.context,
      }),
    },
  ];
}

const GARDEN_RWA_VAULT_ABI = [
  {
    type: "event",
    name: "CashDeposited",
    inputs: [
      { name: "caller", type: "address", indexed: true },
      { name: "user", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "PositionPlanted",
    inputs: [
      { name: "positionId", type: "uint256", indexed: true },
      { name: "owner", type: "address", indexed: true },
      { name: "cropKeyHash", type: "bytes32", indexed: true },
      { name: "principal", type: "uint256", indexed: false },
      { name: "assetAmount", type: "uint256", indexed: false },
      { name: "plantedPrice", type: "uint256", indexed: false },
    ],
    anonymous: false,
  },
  {
    type: "function",
    name: "positionCount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "positions",
    stateMutability: "view",
    inputs: [{ name: "", type: "uint256" }],
    outputs: [
      { name: "owner", type: "address" },
      { name: "cropKeyHash", type: "bytes32" },
      { name: "principal", type: "uint256" },
      { name: "assetAmount", type: "uint256" },
      { name: "plantedPrice", type: "uint256" },
      { name: "harvestedValue", type: "uint256" },
      { name: "plantedAt", type: "uint256" },
      { name: "lastRebalancedAt", type: "uint256" },
      { name: "harvestedAt", type: "uint256" },
      { name: "harvested", type: "bool" },
    ],
  },
  {
    type: "function",
    name: "activePositionIdsOf",
    stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [{ name: "", type: "uint256[]" }],
  },
  {
    type: "function",
    name: "cashBalance",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "currentValue",
    stateMutability: "view",
    inputs: [{ name: "positionId", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

const AUTOPILOT_POLICY_ABI = [
  {
    type: "function",
    name: "canExecute",
    stateMutability: "view",
    inputs: [
      { name: "user", type: "address" },
      { name: "executor", type: "address" },
      { name: "protocol", type: "address" },
      { name: "strategyId", type: "bytes32" },
      { name: "amount", type: "uint256" },
      { name: "riskLevel", type: "uint8" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

export function parseAutopilotWorkerConfig(env: NodeJS.ProcessEnv = process.env): AutopilotWorkerConfig | null {
  if (env.AUTOPILOT_WORKER_ENABLED !== "true") return null;

  const crop = (env.AUTOPILOT_WORKER_CROP ?? "steady") as "steady" | "growth" | "boost";
  const amount = String(env.AUTOPILOT_WORKER_AMOUNT ?? "1000");
  const riskPreference = Number(env.AUTOPILOT_WORKER_RISK_LEVEL ?? "1") as RiskLevel;
  const intervalSeconds = Number(env.AUTOPILOT_WORKER_INTERVAL_SECONDS ?? "300");

  return {
    enabled: true,
    crop,
    amount,
    riskPreference: Number.isFinite(riskPreference) ? riskPreference : 1,
    intervalMs: Math.max(30_000, Math.floor(intervalSeconds * 1000)),
    execute: env.AUTOPILOT_WORKER_EXECUTE !== "false",
  };
}

function resolveWorkerRpcUrl(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return env.MANTLE_RPC_URL ?? env.RPC_URL ?? env.NEXT_PUBLIC_MANTLE_RPC_URL;
}

function resolveWorkerProtocolAddress(
  deployment: NonNullable<ReturnType<typeof loadDeploymentConfig>>,
): Address | undefined {
  return deployment.contracts.gardenRwaMockVault;
}

function strategyIdFromCrop(crop: "steady" | "growth" | "boost"): string {
  if (crop === "growth") return "growth-meth-yield";
  if (crop === "boost") return "boost-rwa-meth-dynamic";
  return "steady-rwa-usdy";
}

function strategyIdToBytes32(strategyId: string): `0x${string}` {
  const bytes = Buffer.from(strategyId, "utf8").subarray(0, 32);
  return `0x${bytes.toString("hex").padEnd(64, "0")}` as `0x${string}`;
}

function cropFromHash(hash: `0x${string}`): "steady" | "growth" | "boost" {
  if (hash === keccak256(stringToHex("growth"))) return "growth";
  if (hash === keccak256(stringToHex("boost"))) return "boost";
  return "steady";
}

function resolveExecutorAddress(): Address | undefined {
  const privateKey = process.env.RELAYER_PRIVATE_KEY;
  if (!privateKey || !/^0x[0-9a-fA-F]{64}$/.test(privateKey)) return undefined;
  return privateKeyToAccount(privateKey as `0x${string}`).address;
}

type VaultPositionSnapshot = {
  positionId: number;
  owner: Address;
  cropKeyHash: `0x${string}`;
  cropKey: "steady" | "growth" | "boost";
  principal: bigint;
  currentValue: bigint;
  harvested: boolean;
};

type VaultUserSnapshot = {
  user: Address;
  cashBalance: bigint;
  activePositions: VaultPositionSnapshot[];
};

async function passesOnchainPolicy(
  deployment: NonNullable<ReturnType<typeof loadDeploymentConfig>>,
  user: Address,
  strategyId: string,
  amount: string,
  riskLevel: RiskLevel,
): Promise<boolean> {
  const policyAddress = deployment.contracts.autopilotPolicy;
  if (!policyAddress) return true;

  const rpcUrl = resolveWorkerRpcUrl();
  if (!rpcUrl) {
    throw new Error("MANTLE_RPC_URL or RPC_URL required to read autopilot policy");
  }

  const protocol = resolveWorkerProtocolAddress(deployment);
  if (!protocol) {
    logger.warn({ user }, "autopilot worker policy skipped: protocol address missing");
    return false;
  }

  const executor = resolveExecutorAddress();
  if (!executor) {
    logger.warn({ user }, "autopilot worker policy skipped: executor address missing");
    return false;
  }

  const client = createPublicClient({
    transport: http(rpcUrl),
  });

  return client.readContract({
    address: policyAddress,
    abi: AUTOPILOT_POLICY_ABI,
    functionName: "canExecute",
    args: [user, executor, protocol, strategyIdToBytes32(strategyId), BigInt(amount || "0"), riskLevel],
  }) as Promise<boolean>;
}

async function discoverAutopilotWorkerUsers(deployment: NonNullable<ReturnType<typeof loadDeploymentConfig>>): Promise<Array<Address>> {
  const vaultAddress = deployment.contracts.gardenRwaMockVault;
  if (!vaultAddress) return [];

  const rpcUrl = resolveWorkerRpcUrl();
  if (!rpcUrl) {
    throw new Error("MANTLE_RPC_URL or RPC_URL required to discover autopilot vault users");
  }

  const client = createPublicClient({
    transport: http(rpcUrl),
  });

  const seen = new Set<string>();
  const users: Array<Address> = [];

  const [cashLogs, plantedLogs] = await Promise.all([
    client.getContractEvents({
      address: vaultAddress,
      abi: GARDEN_RWA_VAULT_ABI,
      eventName: "CashDeposited",
      fromBlock: 0n,
      toBlock: "latest",
    }),
    client.getContractEvents({
      address: vaultAddress,
      abi: GARDEN_RWA_VAULT_ABI,
      eventName: "PositionPlanted",
      fromBlock: 0n,
      toBlock: "latest",
    }),
  ]);

  for (const log of cashLogs) {
    const user = log.args.user;
    if (!user) continue;
    const key = user.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    users.push(user);
  }

  for (const log of plantedLogs) {
    const owner = log.args.owner;
    if (!owner) continue;
    const key = owner.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    users.push(owner);
  }

  return users;
}

async function readVaultUserSnapshot(
  deployment: NonNullable<ReturnType<typeof loadDeploymentConfig>>,
  user: Address,
): Promise<VaultUserSnapshot> {
  const vaultAddress = deployment.contracts.gardenRwaMockVault;
  if (!vaultAddress) {
    return { user, cashBalance: 0n, activePositions: [] };
  }

  const rpcUrl = resolveWorkerRpcUrl();
  if (!rpcUrl) {
    throw new Error("MANTLE_RPC_URL or RPC_URL required to read autopilot vault state");
  }

  const client = createPublicClient({ transport: http(rpcUrl) });
  const [cashBalance, activePositionIds] = await Promise.all([
    client.readContract({
      address: vaultAddress,
      abi: GARDEN_RWA_VAULT_ABI,
      functionName: "cashBalance",
      args: [user],
    }) as Promise<bigint>,
    client.readContract({
      address: vaultAddress,
      abi: GARDEN_RWA_VAULT_ABI,
      functionName: "activePositionIdsOf",
      args: [user],
    }) as Promise<bigint[]>,
  ]);

  const activePositions = await Promise.all(
    activePositionIds.map(async (positionIdValue) => {
      const positionId = Number(positionIdValue);
      const position = await client.readContract({
        address: vaultAddress,
        abi: GARDEN_RWA_VAULT_ABI,
        functionName: "positions",
        args: [positionIdValue],
      }) as readonly [Address, `0x${string}`, bigint, bigint, bigint, bigint, bigint, bigint, bigint, boolean];
      const currentValue = await client.readContract({
        address: vaultAddress,
        abi: GARDEN_RWA_VAULT_ABI,
        functionName: "currentValue",
        args: [positionIdValue],
      }) as bigint;

      return {
        positionId,
        owner: position[0],
        cropKeyHash: position[1],
        cropKey: cropFromHash(position[1]),
        principal: position[2],
        currentValue,
        harvested: position[9],
      } satisfies VaultPositionSnapshot;
    }),
  );

  return {
    user,
    cashBalance,
    activePositions: activePositions.filter((position) => !position.harvested),
  };
}

async function runAutopilotWorkerTick(config: AutopilotWorkerConfig) {
  if (autopilotWorkerBusy) return;
  autopilotWorkerBusy = true;
  const startedAt = Date.now();
  try {
    const deployment = loadDeploymentConfig();
    if (!deployment) {
      logger.warn("autopilot worker skipped: deployment config missing");
      return;
    }

    const users = await discoverAutopilotWorkerUsers(deployment);
    if (users.length === 0) {
      logger.info("autopilot worker skipped: no active vault users found");
      return;
    }

    for (const user of users) {
      try {
        const snapshot = await readVaultUserSnapshot(deployment, user);
        const executionCandidates = [
          ...snapshot.activePositions.map((position) => ({
            user,
            amount: position.currentValue.toString(),
            currentStrategyId: strategyIdFromCrop(position.cropKey),
            currentPositionId: position.positionId,
            riskPreference: config.riskPreference,
          })),
          ...(snapshot.cashBalance > 0n ? [{
            user,
            amount: snapshot.cashBalance.toString(),
            currentStrategyId: undefined,
            currentPositionId: undefined,
            riskPreference: config.riskPreference,
          }] : []),
        ];

        if (executionCandidates.length === 0) {
          logger.info({ user }, "autopilot worker skipped: no active positions or idle cash");
          continue;
        }

        for (const candidate of executionCandidates) {
          const decision = await runAutopilotTick(buildIntent({
            user,
            crop: config.crop,
            amount: candidate.amount,
            riskPreference: candidate.riskPreference,
            currentStrategyId: candidate.currentStrategyId,
            currentPositionId: candidate.currentPositionId,
          }), { deployment });

          const policyAllowed = await passesOnchainPolicy(
            deployment,
            user,
            decision.selectedOpportunity.strategyId,
            candidate.amount,
            decision.selectedOpportunity.riskLevel,
          );
          if (!policyAllowed) {
            logger.info(
              {
                user,
                amount: candidate.amount,
                currentPositionId: candidate.currentPositionId ?? null,
                riskPreference: candidate.riskPreference,
                selectedStrategyId: decision.selectedOpportunity.strategyId,
              },
              "autopilot worker skipped by on-chain policy",
            );
            continue;
          }

          const anchor = await anchorDecision(decision);
          const shouldExecute = config.execute && (decision.action.kind === "open" || decision.action.kind === "rebalance" || decision.action.kind === "close");
          const execution = shouldExecute
            ? await executeRealRoute({
              decision,
              userAddr: user,
              amount: candidate.amount,
              currentPositionId: candidate.currentPositionId,
            })
            : ({ enabled: false, mode: "disabled", note: "autopilot worker held route or execute=false", operation: null } as const);

          const anchorMode = "mode" in anchor ? anchor.mode : "disabled";
          logger.info(
            {
              user,
              decisionHash: decision.decisionHash,
              currentPositionId: candidate.currentPositionId ?? null,
              anchorMode,
              executionMode: execution.mode,
              executionOperation: execution.operation,
              durationMs: Date.now() - startedAt,
            },
            "autopilot worker user tick complete",
          );
        }
      } catch (error) {
        logger.error({ error, user }, "autopilot worker user tick failed");
      }
    }
  } catch (error) {
    logger.error({ error, durationMs: Date.now() - startedAt }, "autopilot worker tick failed");
  } finally {
    autopilotWorkerBusy = false;
  }
}

function startAutopilotWorker() {
  if (autopilotWorkerTimer) return;
  const config = parseAutopilotWorkerConfig();
  if (!config) {
    logger.info("autopilot worker disabled");
    return;
  }

  logger.info({ intervalMs: config.intervalMs, crop: config.crop, execute: config.execute }, "autopilot worker enabled");
  void runAutopilotWorkerTick(config);
  autopilotWorkerTimer = setInterval(() => {
    void runAutopilotWorkerTick(config);
  }, config.intervalMs);
}

async function callOpenAiAssistant(request: GardenChatRequest): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY missing");

  const model = process.env.OPENAI_MODEL ?? "glm-5";
  const endpoint = resolveOpenAiChatEndpoint();
  const start = Date.now();
  logger.info(
    {
      model,
      endpoint,
      view: request.view ?? "unknown",
      messageLength: request.message.length,
      hasContext: Boolean(request.context),
    },
    "assistant request upstream start",
  );
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0.3,
      stream: false,
      messages: buildAssistantMessages(request),
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    logger.warn(
      {
        model,
        endpoint,
        status: response.status,
        durationMs: Date.now() - start,
        errorText: errorText.slice(0, 500),
      },
      "assistant request upstream rejected",
    );
    throw new Error(`assistant upstream HTTP ${response.status}: ${errorText.slice(0, 200)}`);
  }

  const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) {
    logger.warn(
      {
        model,
        endpoint,
        durationMs: Date.now() - start,
      },
      "assistant request returned empty content",
    );
    throw new Error("assistant returned empty content");
  }

  logger.info(
    {
      model,
      endpoint,
      durationMs: Date.now() - start,
      contentLength: content.length,
    },
    "assistant request upstream success",
  );
  return content;
}

async function streamOpenAiAssistant(request: GardenChatRequest): Promise<ReadableStream<Uint8Array>> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY missing");

  const model = process.env.OPENAI_MODEL ?? "glm-5";
  const endpoint = resolveOpenAiChatEndpoint();
  const start = Date.now();
  logger.info(
    {
      model,
      endpoint,
      view: request.view ?? "unknown",
      messageLength: request.message.length,
      hasContext: Boolean(request.context),
    },
    "assistant stream upstream start",
  );

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0.3,
      stream: true,
      messages: buildAssistantMessages(request),
    }),
  });

  if (!response.ok || !response.body) {
    const errorText = await response.text().catch(() => "");
    logger.warn(
      {
        model,
        endpoint,
        status: response.status,
        durationMs: Date.now() - start,
        errorText: errorText.slice(0, 500),
      },
      "assistant stream upstream rejected",
    );
    throw new Error(`assistant upstream HTTP ${response.status}: ${errorText.slice(0, 200)}`);
  }

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const reader = response.body.getReader();
  let buffer = "";

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          let boundary = buffer.indexOf("\n\n");
          while (boundary !== -1) {
            const event = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            for (const line of event.split("\n")) {
              if (!line.startsWith("data:")) continue;
              const data = line.slice(5).trim();
              if (!data || data === "[DONE]") {
                logger.info(
                  {
                    model,
                    endpoint,
                    durationMs: Date.now() - start,
                  },
                  "assistant stream upstream done",
                );
                controller.close();
                return;
              }
              try {
                const parsed = JSON.parse(data) as {
                  choices?: Array<{ delta?: { content?: string } }>;
                };
                const delta = parsed.choices?.[0]?.delta?.content ?? "";
                if (delta) controller.enqueue(encoder.encode(delta));
              } catch (error) {
                logger.debug({ error, data: data.slice(0, 200) }, "assistant stream chunk parse skipped");
              }
            }
            boundary = buffer.indexOf("\n\n");
          }
        }

        if (buffer.trim()) {
          for (const line of buffer.split("\n")) {
            if (!line.startsWith("data:")) continue;
            const data = line.slice(5).trim();
            if (!data || data === "[DONE]") break;
            try {
              const parsed = JSON.parse(data) as {
                choices?: Array<{ delta?: { content?: string } }>;
              };
              const delta = parsed.choices?.[0]?.delta?.content ?? "";
              if (delta) controller.enqueue(encoder.encode(delta));
            } catch (error) {
              logger.debug({ error, data: data.slice(0, 200) }, "assistant stream trailing chunk parse skipped");
            }
          }
        }

        logger.info(
          {
            model,
            endpoint,
            durationMs: Date.now() - start,
          },
          "assistant stream upstream complete",
        );
        controller.close();
      } catch (error) {
        logger.error({ error }, "assistant stream upstream failed");
        controller.error(error);
      }
    },
  });
}

export function buildIntent(body: PlanRequest): AutopilotIntent {
  const deployment = loadDeploymentConfig();
  const allowedProtocols = resolveAllowedProtocols(deployment);
  const riskPreference = Number(body.riskPreference || 1) as RiskLevel;
  return {
    user: body.user,
    agentId: body.agentId ?? "1",
    amount: String(body.amount ?? "0"),
    riskPreference,
    mode: "autopilot",
    currentStrategyId: body.currentStrategyId,
    currentPositionId: body.currentPositionId,
    minImprovementBps: body.minImprovementBps ?? 50,
    policy: {
      enabled: body.policy?.enabled ?? true,
      paused: body.policy?.paused ?? false,
      maxTxAmount: body.policy?.maxTxAmount ?? 5_000,
      maxRiskLevel: body.policy?.maxRiskLevel ?? riskPreference,
      rebalanceIntervalSeconds: body.policy?.rebalanceIntervalSeconds ?? 3600,
      allowedProtocols: body.policy?.allowedProtocols?.length ? body.policy.allowedProtocols : allowedProtocols,
    },
  };
}

export function buildGardenRequest(body: GardenPlanRequest): GardenRequest {
  const riskPreference = Number(body.userMaxRiskLevel ?? body.riskPreference ?? 1) as RiskLevel;
  return {
    user: body.user,
    message: body.message ?? `${body.crop ?? "steady"} ${body.amount ?? "0"}`,
    amount: String(body.amount ?? "0"),
    userMaxRiskLevel: riskPreference,
    execute: body.execute ?? false,
  };
}

async function buildAutopilotDecisionFromVaultState(
  body: PlanRequest,
  deployment: NonNullable<ReturnType<typeof loadDeploymentConfig>> | undefined,
): Promise<{ decision: AutopilotDecision; amount: string; currentPositionId?: number }> {
  const fallbackAmount = String(body.amount ?? "0");
  const buildFallbackDecision = async () => ({
    decision: await runAutopilotTick(buildIntent({ ...body, amount: fallbackAmount }), { deployment }),
    amount: fallbackAmount,
    currentPositionId: body.currentPositionId,
  });

  const rpcUrl = resolveWorkerRpcUrl();
  if (!deployment || !deployment.contracts.gardenRwaMockVault || !rpcUrl) {
    return buildFallbackDecision();
  }

  try {
    const snapshot = await readVaultUserSnapshot(deployment, body.user);
    const currentPosition =
      body.currentPositionId != null
        ? snapshot.activePositions.find((position) => position.positionId === body.currentPositionId)
        : snapshot.activePositions[0];

    const amount = currentPosition
      ? currentPosition.currentValue.toString()
      : snapshot.cashBalance > 0n
        ? String(body.amount ?? snapshot.cashBalance.toString())
        : fallbackAmount;

    const decision = await runAutopilotTick(buildIntent({
      ...body,
      amount,
      currentStrategyId: body.currentStrategyId ?? (currentPosition ? strategyIdFromCrop(currentPosition.cropKey) : undefined),
      currentPositionId: body.currentPositionId ?? currentPosition?.positionId,
    }), { deployment });

    return {
      decision,
      amount,
      currentPositionId: body.currentPositionId ?? currentPosition?.positionId,
    };
  } catch (error) {
    logger.warn({ error, user: body.user }, "vault state read failed, falling back to stateless autopilot planning");
    return buildFallbackDecision();
  }
}

function toGardenResponse(result: Awaited<ReturnType<typeof plantGarden>>) {
  return {
    intent: {
      user: result.intent.user,
      message: result.parsedIntent.message,
      parsedStrategy: result.parsedIntent.crop,
    },
    marketMood: result.marketMood,
    simulation: {
      crop: result.gardenSimulation.crop,
      weather: result.marketMood.weather,
      background: result.gardenSimulation.background,
      actionLabel: result.gardenSimulation.actionLabel,
      potSlots: result.gardenSimulation.potSlots.map((slot) => ({
        strategyId: slot.id,
        title: slot.label,
        crop: slot.label.split(" /")[0] ?? slot.label,
        apy: Number.parseFloat(slot.apy),
        health: slot.health,
        selected: slot.active,
      })),
    },
    beginnerExplanation: result.beginnerExplanation,
    effectivePolicy: result.effectivePolicy,
    decision: result,
  };
}

async function readJson(req: import("node:http").IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

export function createAgentService() {
  startAutopilotWorker();
  return createServer(async (req, res) => {
    res.setHeader("content-type", "application/json");
    if (req.method === "GET" && req.url === "/health") {
      res.end(JSON.stringify({ ok: true, service: "gardena-agent" }));
      return;
    }
    if (req.method === "GET" && req.url === "/mcp/tools/list") {
      res.end(JSON.stringify({
        ok: true,
        tools: [
          { name: "plan_autopilot_strategy", description: "Run LangGraph AI advisor plus deterministic policy for autonomous AI x RWA execution" },
          { name: "plan_garden_agent", description: "Translate user intent into moat weather, strategy slots, and safe autonomous strategy plan" },
          { name: "ask_garden_assistant", description: "Answer user questions about the Gardenaz moat app, positions, proof, and strategy shop" },
          { name: "quote_rwa_route", description: "Preview vault-native autopilot execution against the delegated RWA vault" },
          { name: "execute_rwa_route", description: "Prepare or send a vault-native delegated autopilot transaction" },
          { name: "log_decision", description: "Decision logging is performed by the vault during delegated execution" },
        ],
      }));
      return;
    }

    if (req.method === "POST" && req.url === "/mcp/tools/call") {
      const body = (await readJson(req)) as { name: string; arguments?: Record<string, unknown> };
      if (body.name === "plan_autopilot_strategy") {
        const deployment = loadDeploymentConfig();
        const { decision } = await buildAutopilotDecisionFromVaultState((body.arguments ?? {}) as PlanRequest, deployment);
        res.end(JSON.stringify({ ok: true, result: decision }));
        return;
      }
      if (body.name === "plan_garden_agent") {
        const result = await plantGarden(buildGardenRequest((body.arguments ?? {}) as GardenPlanRequest), { deployment: loadDeploymentConfig() });
        const garden = toGardenResponse(result);
        res.end(JSON.stringify({ ok: true, result: garden }));
        return;
      }
      if (body.name === "ask_garden_assistant") {
        try {
          const assistantArgs = (body.arguments ?? {}) as {
            message?: string;
            context?: unknown;
            view?: "canvas" | "shop" | "audit";
            user?: `0x${string}`;
          };
          const requestId = randomUUID();
          const request = {
            message: String(assistantArgs.message ?? ""),
            context: assistantArgs.context,
            view: assistantArgs.view,
            user: assistantArgs.user,
          };
          logger.info(summarizeAssistantRequest("ask_garden_assistant", request, requestId), "assistant tool request start");
          const answer = await callOpenAiAssistant({
            ...request,
          });
          logger.info({ requestId, answerLength: answer.length }, "assistant tool request success");
          res.end(JSON.stringify({ ok: true, result: { answer, source: "agent-service" } }));
        } catch (error) {
          logger.error({ error }, "assistant tool request failed");
          res.statusCode = 502;
          res.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : "assistant failed" }));
        }
        return;
      }
      if (body.name === "quote_rwa_route" || body.name === "execute_rwa_route") {
        const args = (body.arguments ?? {}) as PlanRequest;
        const deployment = loadDeploymentConfig();
        const { decision, amount, currentPositionId } = await buildAutopilotDecisionFromVaultState(args, deployment);
        const execution = await executeRealRoute({ decision, amount, currentPositionId, userAddr: args.user });
        res.end(JSON.stringify({ ok: true, result: execution }));
        return;
      }
      res.statusCode = 400;
      res.end(JSON.stringify({ ok: false, error: "unknown tool" }));
      return;
    }

    if (req.method === "POST" && req.url === "/garden/plan") {
      try {
        const body = (await readJson(req)) as GardenPlanRequest;
        logger.info({ user: body.user, amount: body.amount, execute: body.execute ?? false }, "garden plan requested");
        const result = await plantGarden(buildGardenRequest(body), { deployment: loadDeploymentConfig() });
        const garden = toGardenResponse(result);
        const anchor = body.anchor === false ? { enabled: false, txHash: null, note: "anchor disabled by request" } : await anchorDecision(result);
        res.end(JSON.stringify({ ok: true, garden, result: garden, anchor, source: "garden-agent" }));
      } catch (error) {
        res.statusCode = 400;
        res.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : "invalid request" }));
      }
      return;
    }

    if (req.method === "POST" && req.url === "/garden/chat") {
      try {
        const body = (await readJson(req)) as GardenChatRequest;
        const requestId = randomUUID();
        logger.info(summarizeAssistantRequest("/garden/chat", body, requestId), "assistant chat request start");
        if ((body as { stream?: boolean }).stream) {
          const stream = await streamOpenAiAssistant(body);
          res.statusCode = 200;
          res.setHeader("content-type", "text/plain; charset=utf-8");
          res.setHeader("cache-control", "no-cache, no-transform");
          const reader = stream.getReader();
          const encoder = new TextEncoder();
          const pump = async () => {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              res.write(value);
            }
            res.end();
          };
          void pump().catch((error) => {
            logger.error({ error, requestId }, "assistant chat stream response failed");
            if (!res.writableEnded) res.end();
          });
          return;
        }

        const answer = await callOpenAiAssistant(body);
        logger.info({ requestId, answerLength: answer.length }, "assistant chat request success");
        res.end(JSON.stringify({ ok: true, answer, source: "agent-service" }));
      } catch (error) {
        logger.error({ error }, "assistant chat request failed");
        res.statusCode = 502;
        res.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : "assistant failed" }));
      }
      return;
    }

    if (req.method !== "POST" || req.url !== "/autopilot/plan") {
      res.statusCode = 404;
      res.end(JSON.stringify({ ok: false, error: "not found" }));
      return;
    }

    try {
      const body = (await readJson(req)) as PlanRequest;
      logger.info({ user: body.user, amount: body.amount, execute: body.execute ?? false }, "autopilot plan requested");
      const deployment = loadDeploymentConfig();
      const { decision, amount, currentPositionId } = await buildAutopilotDecisionFromVaultState(body, deployment);
      const anchor = body.anchor === false ? { enabled: false, txHash: null, note: "anchor disabled by request" } : await anchorDecision(decision);
      const shouldExecute =
        body.execute && (decision.action.kind === "open" || decision.action.kind === "rebalance" || decision.action.kind === "close");
      const execution = shouldExecute
        ? await executeRealRoute({
          decision,
          amount,
          currentPositionId,
          userAddr: body.user,
        })
        : ({ enabled: false, mode: "disabled", note: "request execute=false", operation: null } as const);
      res.end(JSON.stringify({ ok: true, decision: { ...decision, anchorTxHash: anchor.txHash ?? null }, anchor, execution, outcome: null, source: "agent-service" }));
    } catch (error) {
      res.statusCode = 400;
      res.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : "invalid request" }));
    }
  });
}

const port = Number(process.env.PORT ?? 8787);
const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule) {
  createAgentService().listen(port, () => {
    logger.info({ port }, "Gardena agent service listening");
  });
}
