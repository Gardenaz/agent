import { createWalletClient, encodeFunctionData, http, isAddress, parseEther } from "viem";
import type { Address, Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { mantle } from "viem/chains";
import type { AutopilotDecision } from "./types";

const DECISION_LOG_ABI: any = [
  {
    type: "function",
    name: "logDecision",
    stateMutability: "nonpayable",
    inputs: [
      { name: "agentId", type: "uint256" },
      { name: "decisionHash", type: "bytes32" },
      { name: "strategyId", type: "bytes32" },
      { name: "targetProtocol", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "riskLevel", type: "uint8" },
      { name: "user", type: "address" },
      { name: "positionId", type: "uint256" },
      { name: "policyVersion", type: "uint256" },
      { name: "executor", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "recordOutcomeForHash",
    stateMutability: "nonpayable",
    inputs: [
      { name: "decisionHash", type: "bytes32" },
      { name: "executionTxHash", type: "bytes32" },
      { name: "pnlBps", type: "int256" },
      { name: "realizedApyBps", type: "uint256" },
      { name: "inputAmount", type: "uint256" },
      { name: "outputAmount", type: "uint256" },
      { name: "success", type: "bool" },
      { name: "metadataURI", type: "string" },
    ],
    outputs: [],
  },
] as const;

const AUTOPILOT_POLICY_ABI: any = [
  {
    type: "function",
    name: "recordExecution",
    stateMutability: "nonpayable",
    inputs: [
      { name: "user", type: "address" },
      { name: "executor", type: "address" },
      { name: "protocol", type: "address" },
      { name: "strategyId", type: "bytes32" },
      { name: "amount", type: "uint256" },
      { name: "riskLevel", type: "uint8" },
      { name: "lossAmount", type: "uint256" },
    ],
    outputs: [],
  },
] as const;

export type AnchorResult =
  | { enabled: false; txHash: null; note: string }
  | { enabled: true; txHash: Hex | null; note: string; mode: "prepared" | "sent"; calldata?: Hex };

export type DecisionOutcomeRecordParams = {
  decisionLog: Address;
  decisionHash: Hex;
  executionTxHash: Hex;
  inputAmount: bigint;
  outputAmount: bigint;
  pnlBps?: bigint;
  realizedApyBps?: bigint;
  success: boolean;
  metadataURI?: string | null;
  chainId?: number;
};

export type OutcomeRecordResult =
  | { enabled: false; txHash: null; note: string; mode: "disabled"; calldata?: Hex }
  | { enabled: true; txHash: Hex | null; note: string; mode: "prepared" | "sent"; calldata: Hex };

export type PolicyExecutionRecordParams = {
  autopilotPolicy: Address;
  user: Address;
  executor: Address;
  protocol: Address;
  strategyId: string;
  amount: bigint;
  riskLevel: number;
  lossAmount: bigint;
  chainId?: number;
};

export type PolicyExecutionRecordResult =
  | { enabled: false; txHash: null; note: string; mode: "disabled"; calldata?: Hex }
  | { enabled: true; txHash: Hex | null; note: string; mode: "prepared" | "sent"; calldata: Hex };

const mantleSepolia = {
  id: 5003,
  name: "Mantle Sepolia",
  nativeCurrency: { decimals: 18, name: "MNT", symbol: "MNT" },
  rpcUrls: { default: { http: ["https://rpc.sepolia.mantle.xyz"] } },
} as const;

function chainFor(chainId: number) {
  if (chainId === mantle.id) return mantle;
  return mantleSepolia;
}

function strategyIdToBytes32(strategyId: string): Hex {
  const bytes = Buffer.from(strategyId, "utf8").subarray(0, 32);
  return `0x${bytes.toString("hex").padEnd(64, "0")}` as Hex;
}

function protocolAddress(decision: AutopilotDecision): Address {
  const value = decision.selectedOpportunity.protocolAddress;
  return value && isAddress(value) ? value : "0x0000000000000000000000000000000000000000";
}

function executorAddress(decision: AutopilotDecision): Address {
  const configured = process.env.RELAYER_EXECUTOR_ADDRESS;
  if (configured && isAddress(configured)) return configured as Address;
  return decision.intent.user;
}

function isBytes32Hex(value: string): value is Hex {
  return /^0x[0-9a-fA-F]{64}$/.test(value);
}

function normalizeMetadataURI(metadataURI?: string | null) {
  return metadataURI?.trim() ?? "";
}

function describeWriteError(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message.split("\n")[0]?.trim() ?? "unknown write failure";
  }
  return "unknown write failure";
}

function assertOutcomeRecordParams(params: DecisionOutcomeRecordParams) {
  if (!isAddress(params.decisionLog)) throw new Error("DecisionLog address invalid");
  if (!isBytes32Hex(params.decisionHash)) throw new Error("decisionHash must be bytes32");
  if (!isBytes32Hex(params.executionTxHash)) throw new Error("executionTxHash must be bytes32");
}

function assertPolicyExecutionParams(params: PolicyExecutionRecordParams) {
  if (!isAddress(params.autopilotPolicy)) throw new Error("AutopilotPolicy address invalid");
  if (!isAddress(params.user)) throw new Error("user address invalid");
  if (!isAddress(params.executor)) throw new Error("executor address invalid");
  if (!isAddress(params.protocol)) throw new Error("protocol address invalid");
  if (!params.strategyId) throw new Error("strategyId required");
}

export function buildOutcomeRecordCalldata(params: DecisionOutcomeRecordParams): Hex {
  assertOutcomeRecordParams(params);
  return encodeFunctionData({
    abi: DECISION_LOG_ABI,
    functionName: "recordOutcomeForHash",
    args: [
      params.decisionHash,
      params.executionTxHash,
      params.pnlBps ?? 0n,
      params.realizedApyBps ?? 0n,
      params.inputAmount,
      params.outputAmount,
      params.success,
      normalizeMetadataURI(params.metadataURI),
    ],
  });
}

export function buildPolicyExecutionCalldata(params: PolicyExecutionRecordParams): Hex {
  assertPolicyExecutionParams(params);
  return encodeFunctionData({
    abi: AUTOPILOT_POLICY_ABI,
    functionName: "recordExecution",
    args: [
      params.user,
      params.executor,
      params.protocol,
      strategyIdToBytes32(params.strategyId),
      params.amount,
      params.riskLevel,
      params.lossAmount,
    ],
  });
}

export async function anchorDecision(decision: AutopilotDecision): Promise<AnchorResult> {
  if (process.env.ALLOW_DIRECT_DECISION_LOG_WRITES !== "true") {
    return {
      enabled: false,
      txHash: null,
      note: "Direct decision anchoring skipped; backend must write DecisionLog to preserve Mantle benchmarking",
    };
  }

  const enabled = process.env.RELAYER_ENABLED === "true";
  const decisionLog = decision.deployment?.contracts.decisionLog;
  if (!enabled) return { enabled: false, txHash: null, note: "RELAYER_ENABLED disabled" };
  if (!decisionLog) return { enabled: false, txHash: null, note: "DecisionLog address missing" };

  const agentId = BigInt(decision.intent.agentId || "1");
  const amount = parseEther(decision.intent.amount || "0");
  const executor = executorAddress(decision);
  const calldata = encodeFunctionData({
    abi: DECISION_LOG_ABI,
    functionName: "logDecision",
    args: [
      agentId,
      decision.decisionHash,
      strategyIdToBytes32(decision.selectedOpportunity.strategyId),
      protocolAddress(decision),
      amount,
      decision.selectedOpportunity.riskLevel,
      decision.intent.user,
      BigInt(decision.intent.currentPositionId ?? "0"),
      0n,
      executor,
    ],
  });

  const privateKey = process.env.RELAYER_PRIVATE_KEY as `0x${string}` | undefined;
  if (!privateKey) {
    return { enabled: true, txHash: null, note: "Relayer prepared calldata; RELAYER_PRIVATE_KEY missing", mode: "prepared", calldata };
  }

  const account = privateKeyToAccount(privateKey);
  const chain = chainFor(decision.deployment?.chainId ?? mantleSepolia.id);
  const rpcUrl = process.env.MANTLE_RPC_URL ?? process.env.RPC_URL;
  const wallet = createWalletClient({ account, chain, transport: http(rpcUrl) });
  try {
    const txHash = await wallet.writeContract({
      address: decisionLog,
      abi: DECISION_LOG_ABI,
      functionName: "logDecision",
      args: [
        agentId,
        decision.decisionHash,
        strategyIdToBytes32(decision.selectedOpportunity.strategyId),
        protocolAddress(decision),
        amount,
        decision.selectedOpportunity.riskLevel,
        decision.intent.user,
        BigInt(decision.intent.currentPositionId ?? "0"),
        0n,
        executor,
      ],
    });

    return { enabled: true, txHash, note: "DecisionLog transaction sent by backend relayer", mode: "sent" };
  } catch (error) {
    return {
      enabled: true,
      txHash: null,
      note: `DecisionLog write rejected by chain: ${describeWriteError(error)}`,
      mode: "prepared",
      calldata,
    };
  }
}

export async function recordDecisionOutcome(params: DecisionOutcomeRecordParams): Promise<OutcomeRecordResult> {
  if (process.env.RELAYER_ENABLED !== "true") {
    return {
      enabled: false,
      txHash: null,
      note: "RELAYER_ENABLED disabled",
      mode: "disabled",
    };
  }

  const calldata = buildOutcomeRecordCalldata(params);
  const privateKey = process.env.RELAYER_PRIVATE_KEY as Hex | undefined;
  if (!privateKey) {
    return {
      enabled: true,
      txHash: null,
      note: "Relayer prepared outcome calldata; RELAYER_PRIVATE_KEY missing",
      mode: "prepared",
      calldata,
    };
  }

  const account = privateKeyToAccount(privateKey);
  const chain = chainFor(params.chainId ?? 5003);
  const rpcUrl = process.env.MANTLE_RPC_URL ?? process.env.RPC_URL;
  const wallet = createWalletClient({ account, chain, transport: http(rpcUrl) });
  try {
    const txHash = await wallet.writeContract({
      address: params.decisionLog,
      abi: DECISION_LOG_ABI,
      functionName: "recordOutcomeForHash",
      args: [
        params.decisionHash,
        params.executionTxHash,
        params.pnlBps ?? 0n,
        params.realizedApyBps ?? 0n,
        params.inputAmount,
        params.outputAmount,
        params.success,
        normalizeMetadataURI(params.metadataURI),
      ],
    });
    return {
      enabled: true,
      txHash,
      note: "DecisionLog outcome transaction sent by backend relayer",
      mode: "sent",
      calldata,
    };
  } catch (error) {
    return {
      enabled: true,
      txHash: null,
      note: `DecisionLog outcome rejected by chain: ${describeWriteError(error)}`,
      mode: "prepared",
      calldata,
    };
  }
}

export async function recordPolicyExecution(params: PolicyExecutionRecordParams): Promise<PolicyExecutionRecordResult> {
  if (process.env.RELAYER_ENABLED !== "true") {
    return {
      enabled: false,
      txHash: null,
      note: "RELAYER_ENABLED disabled",
      mode: "disabled",
    };
  }

  const calldata = buildPolicyExecutionCalldata(params);
  const privateKey = process.env.RELAYER_PRIVATE_KEY as Hex | undefined;
  if (!privateKey) {
    return {
      enabled: true,
      txHash: null,
      note: "Relayer prepared policy execution calldata; RELAYER_PRIVATE_KEY missing",
      mode: "prepared",
      calldata,
    };
  }

  const account = privateKeyToAccount(privateKey);
  const chain = chainFor(params.chainId ?? 5003);
  const rpcUrl = process.env.MANTLE_RPC_URL ?? process.env.RPC_URL;
  const wallet = createWalletClient({ account, chain, transport: http(rpcUrl) });
  try {
    const txHash = await wallet.writeContract({
      address: params.autopilotPolicy,
      abi: AUTOPILOT_POLICY_ABI,
      functionName: "recordExecution",
      args: [
        params.user,
        params.executor,
        params.protocol,
        strategyIdToBytes32(params.strategyId),
        params.amount,
        params.riskLevel,
        params.lossAmount,
      ],
    });
    return {
      enabled: true,
      txHash,
      note: "AutopilotPolicy execution transaction sent by backend relayer",
      mode: "sent",
      calldata,
    };
  } catch (error) {
    return {
      enabled: true,
      txHash: null,
      note: `AutopilotPolicy execution rejected by chain: ${describeWriteError(error)}`,
      mode: "prepared",
      calldata,
    };
  }
}

export async function relayRawTx(params: {
  to: `0x${string}`;
  data: `0x${string}`;
  value?: bigint;
  chainId?: number;
}): Promise<{ txHash: `0x${string}` }> {
  const privateKey = process.env.RELAYER_PRIVATE_KEY as `0x${string}` | undefined;
  if (!privateKey) throw new Error("RELAYER_PRIVATE_KEY required for raw tx relay");
  const account = privateKeyToAccount(privateKey);
  const chain = chainFor(params.chainId ?? 5003);
  const rpcUrl = process.env.MANTLE_MAINNET_RPC_URL ?? process.env.MANTLE_RPC_URL ?? process.env.RPC_URL;
  const wallet = createWalletClient({ account, chain, transport: http(rpcUrl) });
  const txHash = await wallet.sendTransaction({
    to: params.to,
    data: params.data,
    value: params.value ?? 0n,
    chain,
    account,
  });
  return { txHash };
}

export async function relayApproval(params: {
  tokenAddress: `0x${string}`;
  spender: `0x${string}`;
  amount: bigint;
  chainId?: number;
}): Promise<{ txHash: `0x${string}` }> {
  const privateKey = process.env.RELAYER_PRIVATE_KEY as `0x${string}` | undefined;
  if (!privateKey) throw new Error("RELAYER_PRIVATE_KEY required for approval");
  const account = privateKeyToAccount(privateKey);
  const chain = chainFor(params.chainId ?? 5003);
  const rpcUrl = process.env.MANTLE_MAINNET_RPC_URL ?? process.env.MANTLE_RPC_URL ?? process.env.RPC_URL;
  const wallet = createWalletClient({ account, chain, transport: http(rpcUrl) });
  const erc20ApproveAbi = [{ type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ name: "", type: "bool" }] }] as const;
  const txHash = await wallet.writeContract({
    address: params.tokenAddress,
    abi: erc20ApproveAbi,
    functionName: "approve",
    args: [params.spender, params.amount],
  });
  return { txHash };
}
