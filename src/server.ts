import { createServer } from "node:http";
import { runAutopilotTick } from "./autopilot";
import { plantGarden, type GardenRequest } from "./garden-agent";
import { loadDeploymentConfig } from "./config/contracts";
import { anchorDecision, recordDecisionOutcome } from "./relayer";
import { executeRealRoute } from "./execution";
import { logger } from "./logger";
import type { AutopilotIntent, AutopilotPolicyInput, RiskLevel } from "./types";

const DEFAULT_PROTOCOLS = ["Mantle RWA USDY Route", "Mantle mETH Yield Route", "Mantle Dynamic RWA Route"];

type PlanRequest = {
  user: `0x${string}`;
  amount: string;
  riskPreference: RiskLevel;
  crop?: "steady" | "growth" | "boost";
  agentId?: string;
  currentStrategyId?: string;
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

function currentStrategyFromCrop(crop: PlanRequest["crop"]): string {
  if (crop === "growth") return "growth-meth-yield";
  if (crop === "boost") return "boost-rwa-meth-dynamic";
  return "steady-rwa-usdy";
}

export function buildIntent(body: PlanRequest): AutopilotIntent {
  const riskPreference = Number(body.riskPreference || 1) as RiskLevel;
  return {
    user: body.user,
    agentId: body.agentId ?? "1",
    amount: String(body.amount ?? "0"),
    riskPreference,
    mode: "autopilot",
    currentStrategyId: body.currentStrategyId ?? currentStrategyFromCrop(body.crop),
    minImprovementBps: body.minImprovementBps ?? 50,
    policy: {
      enabled: body.policy?.enabled ?? true,
      paused: body.policy?.paused ?? false,
      maxTxAmount: body.policy?.maxTxAmount ?? 5_000,
      maxRiskLevel: body.policy?.maxRiskLevel ?? riskPreference,
      rebalanceIntervalSeconds: body.policy?.rebalanceIntervalSeconds ?? 3600,
      allowedProtocols: body.policy?.allowedProtocols?.length ? body.policy.allowedProtocols : DEFAULT_PROTOCOLS,
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
          { name: "plan_autopilot_strategy", description: "Run LangGraph AI advisor + deterministic policy planner" },
          { name: "plan_garden_agent", description: "Translate beginner game intent into garden weather, crop slots, and safe agent plan" },
          { name: "quote_rwa_route", description: "Quote a real Mantle mainnet USDY/mETH route through Odos" },
          { name: "execute_rwa_route", description: "Prepare or send a guarded real Odos transaction" },
          { name: "log_decision", description: "Anchor agent decision to DecisionLog" },
        ],
      }));
      return;
    }

    if (req.method === "POST" && req.url === "/mcp/tools/call") {
      const body = (await readJson(req)) as { name: string; arguments?: PlanRequest };
      if (body.name === "plan_autopilot_strategy") {
        const decision = await runAutopilotTick(buildIntent(body.arguments ?? ({} as PlanRequest)), { deployment: loadDeploymentConfig() });
        res.end(JSON.stringify({ ok: true, result: decision }));
        return;
      }
      if (body.name === "plan_garden_agent") {
        const result = await plantGarden(buildGardenRequest(body.arguments ?? ({} as GardenPlanRequest)), { deployment: loadDeploymentConfig() });
        const garden = toGardenResponse(result);
        res.end(JSON.stringify({ ok: true, result: garden }));
        return;
      }
      if (body.name === "quote_rwa_route" || body.name === "execute_rwa_route") {
        const args = body.arguments ?? ({} as PlanRequest);
        const execution = await executeRealRoute({
          inputAsset: args.inputAsset ?? "USDY",
          outputAsset: args.outputAsset ?? "mETH",
          inputAmount: args.inputAmount ?? args.amount ?? "0",
          slippageBps: args.slippageBps,
          userAddr: args.user,
        });
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
        res.end(JSON.stringify({ ok: true, garden, result: garden, source: "garden-agent" }));
      } catch (error) {
        res.statusCode = 400;
        res.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : "invalid request" }));
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
      const decision = await runAutopilotTick(buildIntent(body), { deployment: loadDeploymentConfig() });
      const anchor = body.anchor === false ? { enabled: false, txHash: null, note: "anchor disabled by request" } : await anchorDecision(decision);
      const execution = body.execute
        ? await executeRealRoute({
          inputAsset: body.inputAsset ?? (decision.selectedOpportunity.asset === "mETH" ? "mETH" : "USDY"),
          outputAsset: body.outputAsset ?? (decision.selectedOpportunity.asset === "mETH" ? "USDY" : "mETH"),
          inputAmount: body.inputAmount ?? body.amount,
          slippageBps: body.slippageBps,
          userAddr: body.user,
        })
        : ({ enabled: false, mode: "disabled", note: "request execute=false" } as const);
      const outcome = execution.enabled && execution.mode === "sent" && decision.deployment?.contracts.decisionLog
        ? await recordDecisionOutcome({
          decisionLog: decision.deployment.contracts.decisionLog,
          decisionHash: decision.decisionHash,
          executionTxHash: execution.executionTxHash,
          inputAmount: BigInt(execution.plan.inputAmount || "0"),
          outputAmount: BigInt(execution.plan.expectedOutput || "0"),
          success: true,
          metadataURI: `gardena://outcomes/${decision.decisionHash}`,
          chainId: decision.deployment.chainId,
        })
        : null;
      res.end(JSON.stringify({ ok: true, decision: { ...decision, anchorTxHash: anchor.txHash ?? undefined }, anchor, execution, outcome, source: "agent-service" }));
    } catch (error) {
      res.statusCode = 400;
      res.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : "invalid request" }));
    }
  });
}

const port = Number(process.env.PORT ?? 8787);

createAgentService().listen(port, () => {
  logger.info({ port }, "Gardena agent service listening");
});