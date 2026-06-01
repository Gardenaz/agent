import type { AgentPlan, CropId } from "../types";

export const CROP_STRATEGIES: Record<CropId, AgentPlan> = {
  steady: {
    strategyId: "steady-lend-usdc",
    title: "Steady Field",
    riskLevel: 1,
    protocol: "Mantle Lending Route",
    action: "Supply stable asset",
    asset: "USDC",
    expectedApy: "3-5%",
    steps: ["Check wallet balance", "Validate policy limit", "Prepare lending supply action", "Wait for user confirmation"],
    explanation: "Low-volatility path focused on capital care and easy exits.",
  },
  growth: {
    strategyId: "growth-lp-usdc-meth",
    title: "Growth Row",
    riskLevel: 2,
    protocol: "Mantle Liquidity Route",
    action: "Add balanced liquidity",
    asset: "USDC/mETH",
    expectedApy: "8-12%",
    steps: ["Estimate pool exposure", "Check slippage boundary", "Validate policy risk tier", "Prepare LP action for approval"],
    explanation: "Balanced route for users who accept moderate volatility for higher yield.",
  },
  boost: {
    strategyId: "boost-vault-usdc",
    title: "Boost Plot",
    riskLevel: 3,
    protocol: "Mantle Yield Vault Route",
    action: "Deposit into monitored vault",
    asset: "USDC",
    expectedApy: "15-25%",
    steps: ["Check volatility tier", "Require explicit high-risk approval", "Prepare vault deposit draft", "Monitor exit conditions"],
    explanation: "Higher-return route with tighter monitoring and stricter policy requirements.",
  },
};
