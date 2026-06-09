import type { Address, DecisionExecutionMeta } from "../types";

export type LiquidityPreparationResult = {
  status: "disabled";
  note: string;
  operation: "addLiquidity" | "removeLiquidity" | "rebalanceLiquidity";
  target: Address;
};

export async function prepareLiquidityExecution(params: {
  meta: DecisionExecutionMeta;
  operation: "addLiquidity" | "removeLiquidity" | "rebalanceLiquidity";
  positionManager: Address;
}): Promise<LiquidityPreparationResult> {
  const pair = params.meta.pair ?? "selected Agni pool";
  return {
    status: "disabled",
    note: `${params.operation} for ${pair} still needs live LP range inputs, ticks, and NFT position state. This lane remains preview-only until the app collects those values.`,
    operation: params.operation,
    target: params.positionManager,
  };
}
