import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canUseManagedExecution, executeRealRoute } from "./index";
import type { AutopilotDecision } from "../types";

const baseDecision: AutopilotDecision = {
  intent: {
    user: "0x7777777777777777777777777777777777777777",
    agentId: "1",
    amount: "100",
    riskPreference: 1,
    mode: "autopilot",
    minImprovementBps: 50,
    policy: {
      enabled: true,
      paused: false,
      maxTxAmount: 5_000,
      maxRiskLevel: 2,
      rebalanceIntervalSeconds: 3600,
      oracleHeartbeatSeconds: 900,
      allowedProtocols: ["0xe38cfa32cCd918d94E2e20230dFaD1A4Fd8aEF16"],
      allowedExecutors: ["0x7777777777777777777777777777777777777777"],
      allowedStrategies: [],
      executionAuthority: "wallet",
    },
  },
  market: { opportunities: [] },
  rankedOpportunities: [],
  selectedOpportunity: {
    id: "agni-usdc-safe-swap",
    strategyId: "agni-usdc-safe-swap",
    protocol: "Agni Swap Router",
    protocolAddress: "0xe38cfa32cCd918d94E2e20230dFaD1A4Fd8aEF16",
    asset: "USDC",
    actionType: "swap",
    executionKind: "swap",
    pair: "USDT/USDC",
    tokenIn: { symbol: "USDT", address: "0x3e163F861826C3f7878bD8fa8117A179d80731Ab", decimals: 6 },
    tokenOut: { symbol: "USDC", decimals: 6 },
    feeTier: 500,
    slippageBps: 75,
    deadlineSeconds: 900,
    expectedApyBps: 520,
    riskLevel: 1,
    liquidityUsd: 1_400_000,
    gasCostUsd: 0.05,
    confidence: 0.92,
    marketCondition: "stablecoin lane looks calm",
    score: 1000,
    scoreBreakdown: {
      apy: 520,
      riskPenalty: 180,
      gasPenalty: 1,
      liquidityPenalty: 0,
      confidenceBonus: 92,
    },
  },
  aiAdvisor: {
    provider: "fallback",
    model: "deterministic",
    recommendedStrategyId: "agni-usdc-safe-swap",
    marketSummary: "summary",
    riskNotes: ["note"],
    confidenceReason: "policy",
  },
  policy: {
    allow: true,
    status: "approved",
    reason: "ok",
    checks: [],
  },
  action: {
    kind: "swap",
    reason: "swap into usdc",
    toStrategyId: "agni-usdc-safe-swap",
    improvementBps: 0,
    pair: "USDT/USDC",
  },
  decisionHash: "0x1111111111111111111111111111111111111111111111111111111111111111",
  summary: "summary",
  createdAt: "2026-06-07T00:00:00.000Z",
  execution: {
    actionType: "swap",
    executionKind: "swap",
    pair: "USDT/USDC",
    tokenIn: { symbol: "USDT", address: "0x3e163F861826C3f7878bD8fa8117A179d80731Ab", decimals: 6 },
    tokenOut: { symbol: "USDC", decimals: 6 },
    feeTier: 500,
    slippageBps: 75,
    deadlineSeconds: 900,
    quotedInputAmount: "100",
  },
  deployment: {
    chainId: 5003,
    network: "mantle-sepolia",
    contracts: {
      agentIdentity: "0x1111111111111111111111111111111111111111",
      decisionLog: "0x2222222222222222222222222222222222222222",
      autopilotPolicy: "0x3333333333333333333333333333333333333333",
    },
  },
  erc8004: {
    agentId: "1",
    registries: {
      agentIdentity: "0x1111111111111111111111111111111111111111",
      autopilotPolicy: "0x3333333333333333333333333333333333333333",
    },
  },
  benchmark: {
    decisionLog: "0x2222222222222222222222222222222222222222",
    status: "required",
    anchorState: "pending",
    outcomeState: "pending",
    transparency: "live",
  },
  track: {
    primary: "AI x RWA",
    secondary: "Consumer & Viral DApps",
    support: "Agentic Wallets & Economy",
  },
};

describe("Agni execution adapter", () => {
  it("returns disabled when a live token address is missing", async () => {
    delete process.env.MANTLE_RPC_URL;
    const result = await executeRealRoute({
      decision: baseDecision,
      userAddr: baseDecision.intent.user,
      amount: "100",
    });

    assert.equal(result.enabled, false);
    assert.equal(result.mode, "disabled");
    assert.match(result.note, /token addresses/i);
  });

  it("returns disabled for liquidity routes that still need LP range data", async () => {
    const result = await executeRealRoute({
      decision: {
        ...baseDecision,
        selectedOpportunity: {
          ...baseDecision.selectedOpportunity,
          actionType: "addLiquidity",
          executionKind: "liquidity",
          pair: "USDC/WMNT",
        },
        action: {
          kind: "addLiquidity",
          reason: "add",
          toStrategyId: "agni-usdc-wmnt-liquidity",
          improvementBps: 100,
          pair: "USDC/WMNT",
        },
        execution: {
          actionType: "addLiquidity",
          executionKind: "liquidity",
          pair: "USDC/WMNT",
        },
      },
      userAddr: baseDecision.intent.user,
      amount: "100",
    });

    assert.equal(result.enabled, false);
    assert.equal(result.mode, "disabled");
    assert.match(result.note, /lp range inputs/i);
  });

  it("rejects managed execution when the relayer executor wallet does not own the funds", () => {
    const originalExecutor = process.env.RELAYER_EXECUTOR_ADDRESS;
    try {
      process.env.RELAYER_EXECUTOR_ADDRESS = "0x8888888888888888888888888888888888888888";
      const result = canUseManagedExecution({
        ...baseDecision,
        intent: {
          ...baseDecision.intent,
          policy: {
            ...baseDecision.intent.policy,
            executionAuthority: "managed",
            allowedExecutors: ["0x8888888888888888888888888888888888888888"],
          },
        },
      });

      assert.equal(result.allow, false);
      assert.match(result.reason, /owns the funds/i);
    } finally {
      process.env.RELAYER_EXECUTOR_ADDRESS = originalExecutor;
    }
  });
});
