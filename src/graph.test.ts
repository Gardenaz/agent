import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createAgentGraph, runAgent } from "./graph";
import type { AgentContext, AgentIntent } from "./types";

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

const baseIntent: AgentIntent = {
  user: "0x4444444444444444444444444444444444444444",
  crop: "steady",
  amount: "1000",
  riskPreference: 2,
};

describe("Gardena LangGraph agent", () => {
  it("exposes a compiled LangGraph that can invoke the full decision pipeline", async () => {
    const graph = createAgentGraph();

    assert.equal(typeof graph.invoke, "function");

    const state = await graph.invoke({ intent: baseIntent, deployment: context.deployment });

    assert.equal(state.plan?.strategyId, "steady-lend-usdc");
    assert.equal(state.policy?.status, "approved");
    assert.match(state.decisionHash ?? "", /^0x[0-9a-f]{64}$/);
    assert.equal(state.decision?.summary, state.summary);
    assert.deepEqual(state.decision?.deployment, context.deployment);
  });

  it("runAgent returns an AgentDecision produced through LangGraph", async () => {
    const decision = await runAgent(baseIntent, context);

    assert.equal(decision.intent.crop, "steady");
    assert.equal(decision.policy.status, "approved");
    assert.match(decision.decisionHash, /^0x[0-9a-f]{64}$/);
    assert.ok(decision.summary.includes("approved"));
  });

  it("blocks a strategy when graph policy node sees risk above preference", async () => {
    const decision = await runAgent({ ...baseIntent, crop: "boost", riskPreference: 1 }, context);

    assert.equal(decision.policy.status, "blocked");
    assert.equal(decision.policy.allow, false);
    assert.ok(decision.summary.includes("blocked"));
  });
});
