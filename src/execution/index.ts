import { createPublicClient, http } from "viem";
import { resolveAgniContracts } from "../agni/addresses";
import { prepareLiquidityExecution } from "../agni/liquidity";
import { prepareSwapExecution } from "../agni/swap";
import type { Address, AutopilotDecision } from "../types";
import { relayApproval, relayRawTx } from "../relayer";

export type RealExecutionRequest = {
  decision: AutopilotDecision;
  userAddr: Address;
  amount?: string;
};

type Operation = "swap" | "addLiquidity" | "removeLiquidity" | "rebalanceLiquidity";

type ExecutionApproval = {
  token: Address;
  spender: Address;
  amount: string;
  calldata: `0x${string}`;
};

type ExecutionPreview = {
  strategyId: string;
  pair?: string;
  asset: string;
  amount: string;
  user: Address;
  tokenIn?: string;
  tokenOut?: string;
  quotedInputAmount?: string;
  quotedOutputAmount?: string;
  minimumOutputAmount?: string;
  feeTier?: number;
  slippageBps?: number;
  deadline?: number;
};

export type RealExecutionResult =
  | { enabled: false; mode: "disabled"; note: string; operation: Operation | null; target?: Address }
  | { enabled: false; mode: "blocked"; note: string; operation: Operation; target: Address; calldata: `0x${string}`; approval: ExecutionApproval; preview?: ExecutionPreview }
  | { enabled: true; mode: "prepared"; note: string; operation: Operation; target: Address; calldata: `0x${string}`; preview: ExecutionPreview }
  | { enabled: true; mode: "sent"; note: string; operation: Operation; target: Address; executionTxHash: `0x${string}`; preview: ExecutionPreview };

export type ManagedExecutionSendResult =
  | { enabled: false; mode: "disabled"; note: string }
  | { enabled: true; mode: "sent"; note: string; stage: "approval" | "execution"; txHash: `0x${string}` };

function operationFor(decision: AutopilotDecision): Operation | null {
  switch (decision.action.kind) {
    case "swap":
      return "swap";
    case "addLiquidity":
      return "addLiquidity";
    case "removeLiquidity":
      return "removeLiquidity";
    case "rebalanceLiquidity":
      return "rebalanceLiquidity";
    default:
      return null;
  }
}

function previewBase(request: RealExecutionRequest): Omit<ExecutionPreview, "tokenIn" | "tokenOut" | "quotedInputAmount" | "quotedOutputAmount" | "minimumOutputAmount" | "feeTier" | "slippageBps" | "deadline"> {
  return {
    strategyId: request.decision.selectedOpportunity.strategyId,
    pair: request.decision.execution.pair,
    asset: request.decision.selectedOpportunity.asset,
    amount: request.amount ?? request.decision.intent.amount,
    user: request.userAddr,
  };
}

export async function executeRealRoute(request: RealExecutionRequest): Promise<RealExecutionResult> {
  const operation = operationFor(request.decision);
  if (!operation) {
    return {
      enabled: false,
      mode: "disabled",
      note: "Decision action does not require Agni execution.",
      operation: null,
      target: request.decision.selectedOpportunity.protocolAddress,
    };
  }

  const rpcUrl = process.env.MANTLE_RPC_URL ?? process.env.RPC_URL ?? process.env.MANTLE_MAINNET_RPC_URL;
  const contracts = resolveAgniContracts(request.decision.deployment?.chainId);

  if (operation === "swap") {
    const prepared = await prepareSwapExecution({
      meta: request.decision.execution,
      userAddr: request.userAddr,
      amount: request.amount ?? request.decision.intent.amount,
      swapRouter: contracts.swapRouter,
      quoterV2: contracts.quoterV2,
      rpcUrl,
    });

    if (prepared.status === "disabled") {
      return {
        enabled: false,
        mode: "disabled",
        note: prepared.note,
        operation,
        target: contracts.swapRouter,
      };
    }

    if (prepared.status === "blocked") {
      return {
        enabled: false,
        mode: "blocked",
        note: prepared.note,
        operation,
        target: prepared.target,
        calldata: prepared.calldata,
        approval: prepared.approval,
        preview: prepared.preview
          ? {
            ...previewBase(request),
            tokenIn: prepared.preview.tokenIn.symbol,
            tokenOut: prepared.preview.tokenOut.symbol,
            quotedInputAmount: prepared.preview.quotedInputAmount,
            quotedOutputAmount: prepared.preview.quotedOutputAmount,
            minimumOutputAmount: prepared.preview.minimumOutputAmount,
            feeTier: prepared.preview.feeTier,
            slippageBps: prepared.preview.slippageBps,
            deadline: prepared.preview.deadline,
          }
          : undefined,
      };
    }

    return {
      enabled: true,
      mode: "prepared",
      note: prepared.note,
      operation,
      target: prepared.target,
      calldata: prepared.calldata,
      preview: {
        ...previewBase(request),
        tokenIn: prepared.preview.tokenIn.symbol,
        tokenOut: prepared.preview.tokenOut.symbol,
        quotedInputAmount: prepared.preview.quotedInputAmount,
        quotedOutputAmount: prepared.preview.quotedOutputAmount,
        minimumOutputAmount: prepared.preview.minimumOutputAmount,
        feeTier: prepared.preview.feeTier,
        slippageBps: prepared.preview.slippageBps,
        deadline: prepared.preview.deadline,
      },
    };
  }

  const disabledLiquidity = await prepareLiquidityExecution({
    meta: request.decision.execution,
    operation,
    positionManager: contracts.nonfungiblePositionManager,
  });

  return {
    enabled: false,
    mode: "disabled",
    note: disabledLiquidity.note,
    operation,
    target: disabledLiquidity.target,
  };
}

export function canUseManagedExecution(decision: AutopilotDecision) {
  if (decision.intent.policy.executionAuthority !== "managed") {
    return { allow: false, reason: "Managed execution not enabled for this policy." } as const;
  }

  const relayerExecutor = process.env.RELAYER_EXECUTOR_ADDRESS;
  if (!relayerExecutor || !/^0x[a-fA-F0-9]{40}$/.test(relayerExecutor)) {
    return { allow: false, reason: "RELAYER_EXECUTOR_ADDRESS missing for managed execution." } as const;
  }

  if (decision.intent.user.toLowerCase() !== relayerExecutor.toLowerCase()) {
    return {
      allow: false,
      reason: "Managed executor wallet must be the same wallet that owns the funds for this Agni route.",
    } as const;
  }

  return { allow: true, executor: relayerExecutor as Address } as const;
}

export async function executeManagedRoute(request: RealExecutionRequest): Promise<ManagedExecutionSendResult> {
  const authority = canUseManagedExecution(request.decision);
  if (!authority.allow) {
    return { enabled: false, mode: "disabled", note: authority.reason };
  }

  const prepared = await executeRealRoute(request);
  if (prepared.mode === "disabled") {
    return { enabled: false, mode: "disabled", note: prepared.note };
  }

  if (prepared.mode === "blocked") {
    const approval = await relayApproval({
      tokenAddress: prepared.approval.token,
      spender: prepared.approval.spender,
      amount: BigInt(prepared.approval.amount),
      chainId: request.decision.deployment?.chainId,
    });

    const rpcUrl = process.env.MANTLE_MAINNET_RPC_URL ?? process.env.MANTLE_RPC_URL ?? process.env.RPC_URL;
    if (rpcUrl) {
      const chainId = request.decision.deployment?.chainId ?? 5003;
      const publicClient = createPublicClient({
        transport: http(rpcUrl),
        chain: chainId === 5000
          ? { id: 5000, name: "Mantle", nativeCurrency: { name: "MNT", symbol: "MNT", decimals: 18 }, rpcUrls: { default: { http: [rpcUrl] } } }
          : { id: 5003, name: "Mantle Sepolia", nativeCurrency: { name: "MNT", symbol: "MNT", decimals: 18 }, rpcUrls: { default: { http: [rpcUrl] } } },
      });
      await publicClient.waitForTransactionReceipt({ hash: approval.txHash });

      const retried = await executeRealRoute(request);
      if (retried.mode === "prepared") {
        const execution = await relayRawTx({
          to: retried.target,
          data: retried.calldata,
          chainId: request.decision.deployment?.chainId,
        });
        return {
          enabled: true,
          mode: "sent",
          note: "Managed executor approved the token and sent the Agni move.",
          stage: "execution",
          txHash: execution.txHash,
        };
      }
    }

    return {
      enabled: true,
      mode: "sent",
      note: "Managed executor sent token approval. The next managed execution request can continue the Agni move.",
      stage: "approval",
      txHash: approval.txHash,
    };
  }

  if (prepared.mode === "prepared") {
    const execution = await relayRawTx({
      to: prepared.target,
      data: prepared.calldata,
      chainId: request.decision.deployment?.chainId,
    });
    return {
      enabled: true,
      mode: "sent",
      note: "Managed executor sent the Agni move.",
      stage: "execution",
      txHash: execution.txHash,
    };
  }

  return {
    enabled: true,
    mode: "sent",
    note: prepared.note,
    stage: "execution",
    txHash: prepared.executionTxHash,
  };
}
