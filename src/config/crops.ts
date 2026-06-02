import type { AgentPlan, CropId } from "../types";

export const CROP_STRATEGIES: Record<CropId, AgentPlan> = {
  steady: {
    strategyId: "steady-rwa-usdy",
    title: "Rice / Safe Harvest",
    riskLevel: 1,
    protocol: "Mantle RWA USDY Route",
    action: "Allocate into policy-safe RWA yield parking",
    asset: "USDY",
    expectedApy: "4-6%",
    steps: ["Check USDY exposure", "Validate user risk policy", "Prepare RWA yield allocation", "Log benchmark decision on Mantle"],
    explanation: "Low-volatility RWA route for beginners who want stable harvests and transparent on-chain benchmarks.",
  },
  growth: {
    strategyId: "growth-meth-yield",
    title: "Corn / Growth Field",
    riskLevel: 2,
    protocol: "Mantle mETH Yield Route",
    action: "Allocate into mETH yield route",
    asset: "mETH",
    expectedApy: "7-11%",
    steps: ["Estimate mETH exposure", "Check volatility boundary", "Validate policy risk tier", "Prepare growth allocation for approval"],
    explanation: "Balanced Mantle-native route for users who accept moderate volatility for stronger yield.",
  },
  boost: {
    strategyId: "boost-rwa-meth-dynamic",
    title: "Chili / Boost Farm",
    riskLevel: 3,
    protocol: "Mantle Dynamic RWA Route",
    action: "Rebalance between USDY and mETH opportunities",
    asset: "USDY/mETH",
    expectedApy: "13-21%",
    steps: ["Check volatility tier", "Require explicit high-risk approval", "Prepare dynamic allocation draft", "Monitor exit conditions"],
    explanation: "Higher-return AI x RWA strategy with stricter policy checks, outcome benchmarks, and consumer-friendly garden framing.",
  },
};
