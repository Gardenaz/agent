import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildGardenRequest, buildIntent, createAgentService } from "./server";

const user = "0x7777777777777777777777777777777777777777" as const;

describe("Gardena agent HTTP service", () => {
  it("builds an autopilot intent from app request payload", () => {
    const intent = buildIntent({ user, crop: "growth", amount: "250", riskPreference: 2 });

    assert.equal(intent.mode, "autopilot");
    assert.equal(intent.currentStrategyId, "growth-meth-yield");
    assert.equal(intent.policy.maxRiskLevel, 2);
    assert.ok(intent.policy.allowedProtocols.includes("Mantle mETH Yield Route"));
  });

  it("builds a beginner garden request from app request payload", () => {
    const request = buildGardenRequest({
      user,
      message: "pemula mau aman dulu 1000 USDY",
      amount: "1000",
      riskPreference: 3,
      execute: true,
    });

    assert.equal(request.user, user);
    assert.equal(request.message, "pemula mau aman dulu 1000 USDY");
    assert.equal(request.amount, "1000");
    assert.equal(request.userMaxRiskLevel, 3);
    assert.equal(request.execute, true);
  });

  it("serves /autopilot/plan with agent-service source and optional relayer anchor", async () => {
    const service = createAgentService();
    await new Promise<void>((resolve) => service.listen(0, resolve));
    const address = service.address();
    assert.equal(typeof address, "object");
    if (!address || typeof address !== "object") throw new Error("missing server address");

    try {
      const res = await fetch(`http://127.0.0.1:${address.port}/autopilot/plan`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ user, crop: "steady", amount: "1000", riskPreference: 1, anchor: false }),
      });
      const json = await res.json() as { ok: boolean; source: string; decision: { decisionHash: string }; anchor: { enabled: boolean } };

      assert.equal(res.status, 200);
      assert.equal(json.ok, true);
      assert.equal(json.source, "agent-service");
      assert.match(json.decision.decisionHash, /^0x[0-9a-f]{64}$/);
      assert.equal(json.anchor.enabled, false);
    } finally {
      service.close();
    }
  });

  it("serves /garden/plan as beginner game-ready agent response", async () => {
    const service = createAgentService();
    await new Promise<void>((resolve) => service.listen(0, resolve));
    const address = service.address();
    assert.equal(typeof address, "object");
    if (!address || typeof address !== "object") throw new Error("missing server address");

    try {
      const res = await fetch(`http://127.0.0.1:${address.port}/garden/plan`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ user, message: "pemula mau aman tanam 1000", amount: "1000", riskPreference: 1, execute: false }),
      });
      const json = await res.json() as {
        ok: boolean;
        source: string;
        error?: string;
        result: {
          simulation: { weather: string; crop: string; potSlots: Array<{ strategyId: string }> };
          beginnerExplanation: string;
          decision: { decisionHash: string };
        };
      };

      assert.equal(res.status, 200, json.error);
      assert.equal(json.ok, true, json.error);
      assert.equal(json.source, "garden-agent");
      assert.equal(json.result.simulation.crop, "Rice / Safe Harvest");
      assert.ok(json.result.simulation.potSlots.length > 0);
      assert.match(json.result.decision.decisionHash, /^0x[0-9a-f]{64}$/);
      assert.match(json.result.beginnerExplanation, /beginner|safe|USDY/i);
    } finally {
      service.close();
    }
  });

  it("exposes plan_garden_agent through MCP tool call", async () => {
    const service = createAgentService();
    await new Promise<void>((resolve) => service.listen(0, resolve));
    const address = service.address();
    assert.equal(typeof address, "object");
    if (!address || typeof address !== "object") throw new Error("missing server address");

    try {
      const listRes = await fetch(`http://127.0.0.1:${address.port}/mcp/tools/list`);
      const listJson = await listRes.json() as { tools: Array<{ name: string }> };
      assert.ok(listJson.tools.some((tool) => tool.name === "plan_garden_agent"));

      const callRes = await fetch(`http://127.0.0.1:${address.port}/mcp/tools/call`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "plan_garden_agent",
          arguments: { user, message: "growth tapi tetap aman", amount: "500", riskPreference: 2, execute: false },
        }),
      });
      const callJson = await callRes.json() as { ok: boolean; error?: string; result: { simulation: { actionLabel: string } } };

      assert.equal(callRes.status, 200, callJson.error);
      assert.equal(callJson.ok, true, callJson.error);
      assert.ok(callJson.result.simulation.actionLabel.length > 0);
    } finally {
      service.close();
    }
  });
});
