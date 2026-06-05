import { createPublicClient, createWalletClient, encodeFunctionData, http, parseEther, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { mantle } from "viem/chains";
import type { AutopilotDecision, CropId } from "../types";

const VAULT_EXECUTION_ABI = [
  {
    type: "function",
    name: "openPositionFor",
    stateMutability: "nonpayable",
    inputs: [
      { name: "user", type: "address" },
      { name: "cropKey", type: "string" },
      { name: "principal", type: "uint256" },
      { name: "decisionHash", type: "bytes32" },
    ],
    outputs: [{ name: "positionId", type: "uint256" }],
  },
  {
    type: "function",
    name: "rebalancePosition",
    stateMutability: "nonpayable",
    inputs: [
      { name: "positionId", type: "uint256" },
      { name: "newCropKey", type: "string" },
      { name: "decisionHash", type: "bytes32" },
    ],
    outputs: [{ name: "nextAssetAmount", type: "uint256" }],
  },
  {
    type: "function",
    name: "closePosition",
    stateMutability: "nonpayable",
    inputs: [
      { name: "positionId", type: "uint256" },
      { name: "decisionHash", type: "bytes32" },
    ],
    outputs: [{ name: "harvestedValue", type: "uint256" }],
  },
  {
    type: "function",
    name: "isVaultOperator",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "operator", type: "address" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "cashBalance",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

export type RealExecutionRequest = {
  decision: AutopilotDecision;
  userAddr: `0x${string}`;
  amount?: string;
  currentPositionId?: number;
};

type Operation = "open" | "rebalance" | "close";

type ExecutionPreview = {
  operation: Operation;
  functionName: "openPositionFor" | "rebalancePosition" | "closePosition";
  args: readonly unknown[];
};

export type RealExecutionResult =
  | { enabled: false; mode: "disabled" | "blocked"; note: string; operation: null }
  | {
    enabled: true;
    mode: "prepared";
    operation: Operation;
    note: string;
    calldata: `0x${string}`;
    target: `0x${string}`;
    preview: ExecutionPreview;
  }
  | {
    enabled: true;
    mode: "sent";
    operation: Operation;
    note: string;
    executionTxHash: `0x${string}`;
    preview: ExecutionPreview;
  };

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

function strategyIdToCropKey(strategyId: string): CropId {
  if (strategyId.includes("boost")) return "boost";
  if (strategyId.includes("growth")) return "growth";
  return "steady";
}

function resolveRpcUrl() {
  return process.env.MANTLE_RPC_URL ?? process.env.RPC_URL ?? process.env.NEXT_PUBLIC_MANTLE_RPC_URL;
}

function resolveExecutorAddress(): Address | undefined {
  const privateKey = process.env.RELAYER_PRIVATE_KEY as `0x${string}` | undefined;
  if (!privateKey) return undefined;
  return privateKeyToAccount(privateKey).address;
}

async function ensureOperatorAuthorized(vaultAddress: Address, user: Address, executor: Address): Promise<boolean> {
  const rpcUrl = resolveRpcUrl();
  if (!rpcUrl) throw new Error("MANTLE_RPC_URL or RPC_URL required for vault execution");
  const client = createPublicClient({ transport: http(rpcUrl) });
  return client.readContract({
    address: vaultAddress,
    abi: VAULT_EXECUTION_ABI,
    functionName: "isVaultOperator",
    args: [user, executor],
  }) as Promise<boolean>;
}

async function readCashBalance(vaultAddress: Address, user: Address): Promise<bigint> {
  const rpcUrl = resolveRpcUrl();
  if (!rpcUrl) throw new Error("MANTLE_RPC_URL or RPC_URL required for vault execution");
  const client = createPublicClient({ transport: http(rpcUrl) });
  return client.readContract({
    address: vaultAddress,
    abi: VAULT_EXECUTION_ABI,
    functionName: "cashBalance",
    args: [user],
  }) as Promise<bigint>;
}

function buildExecutionPreview(request: RealExecutionRequest): ExecutionPreview | null {
  const { decision, currentPositionId } = request;
  const amount = parseEther(request.amount ?? decision.intent.amount ?? "0");

  if (decision.action.kind === "open") {
    return {
      operation: "open",
      functionName: "openPositionFor",
      args: [request.userAddr, strategyIdToCropKey(decision.action.toStrategyId), amount, decision.decisionHash],
    };
  }

  if (decision.action.kind === "rebalance") {
    if (!currentPositionId) {
      throw new Error("currentPositionId required for rebalance execution");
    }
    return {
      operation: "rebalance",
      functionName: "rebalancePosition",
      args: [BigInt(currentPositionId), strategyIdToCropKey(decision.action.toStrategyId), decision.decisionHash],
    };
  }

  if (decision.action.kind === "close") {
    if (!currentPositionId) {
      throw new Error("currentPositionId required for close execution");
    }
    return {
      operation: "close",
      functionName: "closePosition",
      args: [BigInt(currentPositionId), decision.decisionHash],
    };
  }

  return null;
}

export async function executeRealRoute(request: RealExecutionRequest): Promise<RealExecutionResult> {
  const enabled = process.env.EXECUTION_ENABLED === "true";
  if (!enabled) return { enabled: false, mode: "disabled", note: "EXECUTION_ENABLED disabled", operation: null };

  const vaultAddress = request.decision.deployment?.contracts.gardenRwaMockVault;
  if (!vaultAddress) {
    return { enabled: false, mode: "blocked", note: "GardenRwaMockVault address missing", operation: null };
  }

  const preview = buildExecutionPreview(request);
  if (!preview) {
    return { enabled: false, mode: "disabled", note: "decision action does not require execution", operation: null };
  }

  const executor = resolveExecutorAddress();
  if (executor) {
    const authorized = await ensureOperatorAuthorized(vaultAddress, request.userAddr, executor);
    if (!authorized) {
      return {
        enabled: false,
        mode: "blocked",
        note: `executor ${executor} is not approved as vault operator for ${request.userAddr}`,
        operation: null,
      };
    }
  }

  if (preview.operation === "open") {
    const requestedAmount = parseEther(request.amount ?? request.decision.intent.amount ?? "0");
    const cashBalance = await readCashBalance(vaultAddress, request.userAddr);
    if (cashBalance < requestedAmount) {
      return {
        enabled: false,
        mode: "blocked",
        note: `vault cash balance ${cashBalance.toString()} is below requested amount ${requestedAmount.toString()}`,
        operation: null,
      };
    }
  }

  const calldata = encodeFunctionData({
    abi: VAULT_EXECUTION_ABI,
    functionName: preview.functionName,
    args: preview.args as never,
  });

  const privateKey = process.env.RELAYER_PRIVATE_KEY as `0x${string}` | undefined;
  if (!privateKey) {
    return {
      enabled: true,
      mode: "prepared",
      operation: preview.operation,
      note: "Prepared vault calldata; RELAYER_PRIVATE_KEY missing",
      calldata,
      target: vaultAddress,
      preview,
    };
  }

  const chain = chainFor(request.decision.deployment?.chainId ?? mantleSepolia.id);
  const rpcUrl = resolveRpcUrl();
  if (!rpcUrl) throw new Error("MANTLE_RPC_URL or RPC_URL required for vault execution");
  const account = privateKeyToAccount(privateKey);
  const wallet = createWalletClient({ account, chain, transport: http(rpcUrl) });
  const executionTxHash = await wallet.sendTransaction({
    to: vaultAddress,
    data: calldata,
    value: 0n,
    chain,
    account,
  });

  return {
    enabled: true,
    mode: "sent",
    operation: preview.operation,
    note: "Vault-native autopilot transaction sent by backend relayer",
    executionTxHash,
    preview,
  };
}
