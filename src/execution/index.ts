import { relayApproval, relayRawTx } from "../relayer";
import { planExecution, type ExecutionPlan } from "./odos";

export type RealExecutionRequest = {
  inputAsset: string;
  outputAsset: string;
  inputAmount: string;
  slippageBps?: number;
  userAddr: `0x${string}`;
};

export type RealExecutionResult =
  | { enabled: false; mode: "disabled"; note: string }
  | { enabled: true; mode: "planned"; plan: ExecutionPlan; note: string }
  | { enabled: true; mode: "sent"; plan: ExecutionPlan; approvalTxHash?: `0x${string}`; executionTxHash: `0x${string}`; note: string };

export async function executeRealRoute(request: RealExecutionRequest): Promise<RealExecutionResult> {
  const enabled = process.env.EXECUTION_ENABLED === "true";
  const sendEnabled = process.env.EXECUTION_SEND_TX === "true";
  const maxNotionalUsd = Number(process.env.MAX_EXECUTION_USD ?? "5");
  const slippageBps = request.slippageBps ?? Number(process.env.MAX_SLIPPAGE_BPS ?? "100");

  if (!enabled) return { enabled: false, mode: "disabled", note: "EXECUTION_ENABLED disabled" };

  const plan = await planExecution({
    inputAsset: request.inputAsset,
    outputAsset: request.outputAsset,
    inputAmount: request.inputAmount,
    slippageBps,
    userAddr: request.userAddr,
    maxNotionalUsd,
  });

  if (!sendEnabled) {
    return { enabled: true, mode: "planned", plan, note: "Execution planned only; EXECUTION_SEND_TX disabled" };
  }

  let approvalTxHash: `0x${string}` | undefined;
  if (plan.approveTarget && plan.approveAmount) {
    const approval = await relayApproval({
      tokenAddress: plan.inputAsset as `0x${string}`,
      spender: plan.approveTarget as `0x${string}`,
      amount: BigInt(plan.approveAmount),
      chainId: plan.chainId,
    });
    approvalTxHash = approval.txHash;
  }

  const execution = await relayRawTx({
    to: plan.txTo,
    data: plan.txData,
    value: BigInt(plan.txValue || "0"),
    chainId: plan.chainId,
  });

  return { enabled: true, mode: "sent", plan, approvalTxHash, executionTxHash: execution.txHash, note: "Real Odos route executed by backend relayer" };
}
