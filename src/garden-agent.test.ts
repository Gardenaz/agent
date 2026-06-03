import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { plantGarden } from "./garden-agent";
import type { AgentContext, YieldOpportunity } from "./types";

const context: AgentContext = {
  deployment: {
    chainId: 5000,
    network: "mantle",
    contracts: {
      agentIdentity: "0x1111111111111111111111111111111111111111",
      decisionLog: "0x2222222222222222222222222222222222222222",
      riskPolicy: "0x3333333333333333333333333333333333333333",
    },
  },
};

const market: YieldOpportunity[] = [
  {
    id: "steady-rwa-usdy",
    strategyId: "steady-rwa-usdy",
    protocol: "Mantle RWA USDY Route",
    asset: "USDY",
    expectedApyBps: 520,
    riskLevel: 1,
    liquidityUsd: 1_400_000,
    gasCostUsd: 0.05,
    confidence: 0.92,
    marketCondition: "USDY RWA yield stable",
    consumerTheme: "Rice / Safe Harvest",
    shareLabel: "Safe harvest powered by USDY",
  },
  {
    id: "growth-meth-yield",
    strategyId: "growth-meth-yield",
    protocol: "Mantle mETH Yield Route",
    asset: "mETH",
    expectedApyBps: 960,
    riskLevel: 2,
    liquidityUsd: 950_000,
    gasCostUsd: 0.08,
    confidence: 0.86,
    marketCondition: "mETH staking yield improving",
    consumerTheme: "Corn / Growth Field",
    shareLabel: "Growth field compounding with mETH",
  },
  {
    id: "boost-rwa-meth-dynamic",
    strategyId: "boost-rwa-meth-dynamic",
    protocol: "Mantle Dynamic RWA Route",
    asset: "USDY/mETH",
    expectedApyBps: 1_760,
    riskLevel: 3,
    liquidityUsd: 420_000,
    gasCostUsd: 0.12,
    confidence: 0.72,
    marketCondition: "dynamic RWA and mETH spread opportunity",
    consumerTheme: "Chili / Boost Farm",
    shareLabel: "Boost farm caught a spicy RWA spread",
  },
];

describe("Gardena beginner garden agent", () => {
  it("routes natural language safe investing into Rice USDY garden intent", async () => {
    const decision = await plantGarden(
      {
        message: "I am a beginner. Invest safely in real world yield.",
        user: "0x7777777777777777777777777777777777777777",
        amount: "1000",
        execute: false,
      },
      { ...context, yieldOpportunities: market },
    );

    assert.equal(decision.parsedIntent.crop, "steady");
    assert.equal(decision.selectedOpportunity.strategyId, "steady-rwa-usdy");
    assert.equal(decision.aiAdvisor.recommendedStrategyId, "steady-rwa-usdy");
    assert.equal(decision.gardenSimulation.crop, "Rice / Safe Harvest");
    assert.match(decision.beginnerExplanation, /beginner|safe|USDY/i);
  });

  it("maps bull market to sunny garden weather", async () => {
    const decision = await plantGarden(
      {
        message: "Grow my yield if market looks good",
        user: "0x7777777777777777777777777777777777777777",
        amount: "1000",
        execute: false,
      },
      { ...context, yieldOpportunities: market },
    );

    assert.equal(decision.marketMood.mood, "bullish");
    assert.equal(decision.marketMood.weather, "sunny");
    assert.equal(decision.gardenSimulation.background, "bright-sky");
  });

  it("maps weak or volatile market to rainy weather and hold behavior", async () => {
    const weakMarket = market.map((item) => ({ ...item, expectedApyBps: 140, confidence: 0.42, liquidityUsd: 180_000 }));
    const decision = await plantGarden(
      {
        message: "I want growth but protect me if market is bad",
        user: "0x7777777777777777777777777777777777777777",
        amount: "1000",
        execute: false,
      },
      { ...context, yieldOpportunities: weakMarket },
    );

    assert.equal(decision.marketMood.mood, "bearish");
    assert.equal(decision.marketMood.weather, "rainy");
    assert.equal(decision.gardenSimulation.background, "rainy-garden");
    assert.equal(decision.action.kind, "hold");
  });

  it("clamps LLM suggested risk so AI cannot loosen user safety policy", async () => {
    const decision = await plantGarden(
      {
        message: "I am safe investor but AI may suggest aggressive risk",
        user: "0x7777777777777777777777777777777777777777",
        amount: "1000",
        execute: false,
        userMaxRiskLevel: 1,
        mockAdvisor: {
          recommendedStrategyId: "boost-rwa-meth-dynamic",
          suggestedMaxRiskLevel: 3,
          suggestedMinImprovementBps: 10,
        },
      },
      { ...context, yieldOpportunities: market },
    );

    assert.equal(decision.effectivePolicy.maxRiskLevel, 1);
    assert.equal(decision.selectedOpportunity.strategyId, "boost-rwa-meth-dynamic");
    assert.equal(decision.policy.status, "blocked");
    assert.match(decision.policy.reason, /risk/i);
  });
});
