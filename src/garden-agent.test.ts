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
      autopilotPolicy: "0x6666666666666666666666666666666666666666",
    },
  },
};

const market: YieldOpportunity[] = [
  {
    id: "agni-usdc-safe-swap",
    strategyId: "agni-usdc-safe-swap",
    protocol: "Agni Stablecoin Route",
    protocolAddress: "0x9999999999999999999999999999999999999999",
    asset: "USDC",
    actionType: "swap",
    executionKind: "swap",
    pair: "USDT/USDC",
    expectedApyBps: 520,
    riskLevel: 1,
    liquidityUsd: 1_400_000,
    gasCostUsd: 0.05,
    confidence: 0.92,
    marketCondition: "stablecoin lane looks calm",
    consumerTheme: "Rice / Safe Harvest",
    shareLabel: "Safe harvest powered by USDC",
  },
  {
    id: "agni-wmnt-growth-swap",
    strategyId: "agni-wmnt-growth-swap",
    protocol: "Agni WMNT Growth Route",
    protocolAddress: "0x9999999999999999999999999999999999999999",
    asset: "WMNT",
    actionType: "swap",
    executionKind: "swap",
    pair: "USDT/WMNT",
    expectedApyBps: 960,
    riskLevel: 2,
    liquidityUsd: 950_000,
    gasCostUsd: 0.08,
    confidence: 0.86,
    marketCondition: "WMNT growth lane improving",
    consumerTheme: "Corn / Growth Field",
    shareLabel: "Growth field compounding with WMNT",
  },
  {
    id: "agni-usdc-wmnt-liquidity",
    strategyId: "agni-usdc-wmnt-liquidity",
    protocol: "Agni Dynamic LP Route",
    protocolAddress: "0x9999999999999999999999999999999999999999",
    asset: "USDC/WMNT",
    actionType: "addLiquidity",
    executionKind: "liquidity",
    pair: "USDC/WMNT",
    expectedApyBps: 1_760,
    riskLevel: 3,
    liquidityUsd: 420_000,
    gasCostUsd: 0.12,
    confidence: 0.72,
    marketCondition: "dynamic stablecoin and WMNT spread opportunity",
    consumerTheme: "Chili / Boost Farm",
    shareLabel: "Boost farm caught a spicy stablecoin and WMNT spread",
  },
];

describe("Gardena beginner garden agent", () => {
  it("routes natural language safe investing into a steady stablecoin garden intent", async () => {
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
    assert.equal(decision.selectedOpportunity.strategyId, "agni-usdc-safe-swap");
    assert.equal(decision.aiAdvisor.recommendedStrategyId, "agni-usdc-safe-swap");
    assert.equal(decision.gardenSimulation.crop, "Rice / Safe Harvest");
    assert.match(decision.beginnerExplanation, /beginner|safe|USDC|stable/i);
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
          recommendedStrategyId: "agni-usdc-wmnt-liquidity",
          suggestedMaxRiskLevel: 3,
          suggestedMinImprovementBps: 10,
        },
      },
      { ...context, yieldOpportunities: market },
    );

    assert.equal(decision.effectivePolicy.maxRiskLevel, 1);
    assert.equal(decision.selectedOpportunity.strategyId, "agni-usdc-wmnt-liquidity");
    assert.equal(decision.policy.status, "blocked");
    assert.match(decision.policy.reason, /risk/i);
  });
});
