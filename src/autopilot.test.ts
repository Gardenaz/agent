import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createAutopilotGraph, runAutopilotTick } from "./autopilot";
import type { AgentContext, AutopilotIntent, YieldOpportunity } from "./types";

const vaultAddress = "0x9999999999999999999999999999999999999999";

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

const baseIntent: AutopilotIntent = {
  user: "0x7777777777777777777777777777777777777777",
  agentId: "1",
  amount: "1000",
  riskPreference: 2,
  mode: "autopilot",
  currentStrategyId: "steady-lend-usdc",
  minImprovementBps: 50,
  policy: {
    enabled: true,
    paused: false,
    maxTxAmount: 5_000,
    maxRiskLevel: 2,
    rebalanceIntervalSeconds: 3600,
    oracleHeartbeatSeconds: 900,
    allowedProtocols: [vaultAddress],
    allowedExecutors: ["0x7777777777777777777777777777777777777777"],
    allowedStrategies: [],
    executionAuthority: "wallet",
  },
};

const opportunities: YieldOpportunity[] = [
  {
    id: "steady-lend-usdc",
    strategyId: "steady-lend-usdc",
    protocol: "Mantle Lending Route",
    protocolAddress: vaultAddress,
    asset: "USDC",
    actionType: "swap",
    executionKind: "swap",
    pair: "USDC/USDY",
    expectedApyBps: 420,
    riskLevel: 1,
    liquidityUsd: 1_000_000,
    gasCostUsd: 0.05,
    confidence: 0.92,
    marketCondition: "stable lending demand",
  },
  {
    id: "growth-lp-usdc-meth",
    strategyId: "growth-lp-usdc-meth",
    protocol: "Mantle Liquidity Route",
    protocolAddress: vaultAddress,
    asset: "USDC/mETH",
    actionType: "addLiquidity",
    executionKind: "liquidity",
    pair: "USDC/mETH",
    expectedApyBps: 980,
    riskLevel: 2,
    liquidityUsd: 800_000,
    gasCostUsd: 0.08,
    confidence: 0.86,
    marketCondition: "LP fees improving",
  },
  {
    id: "boost-vault-usdc",
    strategyId: "boost-vault-usdc",
    protocol: "Mantle Yield Vault Route",
    protocolAddress: vaultAddress,
    asset: "USDC",
    actionType: "addLiquidity",
    executionKind: "liquidity",
    pair: "USDC/mETH",
    expectedApyBps: 2_100,
    riskLevel: 3,
    liquidityUsd: 250_000,
    gasCostUsd: 0.12,
    confidence: 0.7,
    marketCondition: "volatile incentives",
  },
];

describe("Gardena autopilot LangGraph", () => {
  it("emits Agni-first addLiquidity when no current strategy is set", async () => {
    const decision = await runAutopilotTick(
      {
        ...baseIntent,
        currentStrategyId: undefined,
      },
      { ...context, yieldOpportunities: opportunities },
    );

    assert.equal(decision.action.kind, "addLiquidity");
    assert.match(decision.summary, /new agni position/i);
  });

  it("observes live yield opportunities, ranks them, and approves Agni-first rebalanceLiquidity", async () => {
    const decision = await runAutopilotTick(baseIntent, { ...context, yieldOpportunities: opportunities });

    assert.equal(decision.intent.mode, "autopilot");
    assert.equal(decision.policy.status, "approved");
    assert.equal(decision.selectedOpportunity.strategyId, "growth-lp-usdc-meth");
    assert.equal(decision.action.kind, "rebalanceLiquidity");
    assert.ok(decision.action.reason.includes("risk-adjusted return"));
    assert.match(decision.decisionHash, /^0x[0-9a-f]{64}$/);
    assert.equal(decision.erc8004.agentId, "1");
    assert.deepEqual(decision.erc8004.registries, {
      agentIdentity: "0x1111111111111111111111111111111111111111",
      autopilotPolicy: "0x6666666666666666666666666666666666666666",
    });
  });

  it("blocks unsafe higher-yield strategy when risk exceeds user policy", async () => {
    const decision = await runAutopilotTick(
      { ...baseIntent, policy: { ...baseIntent.policy, allowedProtocols: [vaultAddress], maxRiskLevel: 2 } },
      { ...context, yieldOpportunities: [opportunities[2]] },
    );

    assert.equal(decision.policy.status, "blocked");
    assert.equal(decision.action.kind, "hold");
    assert.ok(decision.summary.includes("blocked"));
  });

  it("closes when the current strategy is no longer allowed by policy", async () => {
    const decision = await runAutopilotTick(
      {
        ...baseIntent,
        currentStrategyId: "steady-lend-usdc",
        policy: {
          ...baseIntent.policy,
          maxRiskLevel: 1,
          allowedProtocols: [],
        },
      },
      {
        ...context,
        yieldOpportunities: [opportunities[0]],
      },
    );

    assert.equal(decision.policy.status, "blocked");
    assert.equal(decision.action.kind, "hold");
    assert.match(decision.summary, /blocked/i);
  });

  it("holds current strategy when improvement is below threshold", async () => {
    const decision = await runAutopilotTick(
      { ...baseIntent, minImprovementBps: 1_000 },
      { ...context, yieldOpportunities: opportunities },
    );

    assert.equal(decision.policy.status, "approved");
    assert.equal(decision.action.kind, "hold");
    assert.ok(decision.action.reason.includes("below threshold"));
  });

  it("exposes a compiled autopilot graph", async () => {
    const graph = createAutopilotGraph();
    const state = await graph.invoke({ intent: baseIntent, deployment: context.deployment, market: { opportunities } });

    assert.equal(typeof graph.invoke, "function");
    assert.equal(state.selectedOpportunity?.strategyId, "growth-lp-usdc-meth");
    assert.equal(state.decision?.action.kind, "rebalanceLiquidity");
  });

  it("defaults to AI x RWA opportunities with USDY and mETH consumer garden metadata", async () => {
    const decision = await runAutopilotTick({
      ...baseIntent,
      currentStrategyId: "steady-rwa-usdy",
      policy: {
        ...baseIntent.policy,
        allowedProtocols: [vaultAddress],
      },
    });

    const assets = decision.market.opportunities.map((opportunity) => opportunity.asset);
    const protocols = decision.market.opportunities.map((opportunity) => opportunity.protocol);
    const themes = decision.market.opportunities.map((opportunity) => opportunity.consumerTheme);

    assert.ok(assets.includes("USDY"));
    assert.ok(assets.includes("mETH"));
    assert.ok(protocols.includes("Agni Swap Router"));
    assert.ok(protocols.includes("Agni Position Manager"));
    assert.ok(themes.includes("Rice / Safe Harvest"));
    assert.ok(themes.includes("Corn / Growth Field"));
    assert.equal(decision.track.primary, "AI x RWA");
    assert.equal(decision.track.secondary, "Consumer & Viral DApps");
  });

  it("includes an AI advisor signal before deterministic policy enforcement", async () => {
    const decision = await runAutopilotTick({
      ...baseIntent,
      currentStrategyId: "steady-rwa-usdy",
      policy: {
        ...baseIntent.policy,
        allowedProtocols: [vaultAddress],
      },
    });

    assert.ok(decision.aiAdvisor.marketSummary.includes(decision.selectedOpportunity.asset));
    assert.ok(decision.aiAdvisor.riskNotes.length > 0);
    assert.equal(decision.aiAdvisor.recommendedStrategyId, decision.selectedOpportunity.strategyId);
    assert.match(decision.aiAdvisor.confidenceReason, /policy/i);
  });

  it("blocks managed execution when the selected executor wallet does not match the user wallet", async () => {
    const originalExecutor = process.env.RELAYER_EXECUTOR_ADDRESS;
    try {
      process.env.RELAYER_EXECUTOR_ADDRESS = "0x8888888888888888888888888888888888888888";

      const decision = await runAutopilotTick({
        ...baseIntent,
        policy: {
          ...baseIntent.policy,
          executionAuthority: "managed",
          allowedExecutors: ["0x8888888888888888888888888888888888888888"],
        },
      }, { ...context, yieldOpportunities: opportunities });

      assert.equal(decision.policy.status, "blocked");
      assert.equal(decision.action.kind, "hold");
      assert.match(decision.policy.reason, /managed executor wallet/i);
    } finally {
      process.env.RELAYER_EXECUTOR_ADDRESS = originalExecutor;
    }
  });
});
