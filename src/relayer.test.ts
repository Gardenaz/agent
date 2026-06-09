import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildOutcomeRecordCalldata, buildPolicyExecutionCalldata, recordDecisionOutcome, recordPolicyExecution } from "./relayer";

const params = {
  decisionLog: "0x2222222222222222222222222222222222222222" as const,
  decisionHash: "0x1111111111111111111111111111111111111111111111111111111111111111" as const,
  executionTxHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const,
  inputAmount: 1000n,
  outputAmount: 1025n,
  pnlBps: 250n,
  realizedApyBps: 650n,
  success: true,
  metadataURI: "  ipfs://gardenaz/outcome-1  ",
  chainId: 5003,
};

const policyParams = {
  autopilotPolicy: "0x3333333333333333333333333333333333333333" as const,
  user: "0x4444444444444444444444444444444444444444" as const,
  executor: "0x5555555555555555555555555555555555555555" as const,
  protocol: "0x6666666666666666666666666666666666666666" as const,
  strategyId: "agni-usdy-safe-swap",
  amount: 1000n,
  riskLevel: 1 as const,
  lossAmount: 0n,
  chainId: 5003,
};

describe("Decision relayer outcome logging", () => {
  it("encodes outcome calldata with trimmed metadata", () => {
    const calldata = buildOutcomeRecordCalldata(params);

    assert.match(calldata, /^0x[0-9a-f]+$/);
    assert.ok(calldata.includes("697066733a2f2f67617264656e617a2f6f7574636f6d652d31"));
  });

  it("returns disabled result when relayer is off", async () => {
    const originalEnabled = process.env.RELAYER_ENABLED;
    const originalKey = process.env.RELAYER_PRIVATE_KEY;

    try {
      process.env.RELAYER_ENABLED = "false";
      delete process.env.RELAYER_PRIVATE_KEY;

      const result = await recordDecisionOutcome(params);

      assert.equal(result.enabled, false);
      assert.equal(result.mode, "disabled");
      assert.equal(result.txHash, null);
    } finally {
      process.env.RELAYER_ENABLED = originalEnabled;
      process.env.RELAYER_PRIVATE_KEY = originalKey;
    }
  });

  it("returns prepared calldata when relayer key is missing", async () => {
    const originalEnabled = process.env.RELAYER_ENABLED;
    const originalKey = process.env.RELAYER_PRIVATE_KEY;

    try {
      process.env.RELAYER_ENABLED = "true";
      delete process.env.RELAYER_PRIVATE_KEY;

      const result = await recordDecisionOutcome(params);

      assert.equal(result.enabled, true);
      assert.equal(result.mode, "prepared");
      assert.equal(result.txHash, null);
      assert.equal(result.calldata, buildOutcomeRecordCalldata(params));
      assert.match(result.note, /prepared outcome calldata/i);
    } finally {
      process.env.RELAYER_ENABLED = originalEnabled;
      process.env.RELAYER_PRIVATE_KEY = originalKey;
    }
  });

  it("rejects malformed bytes32 hashes before relay", () => {
    assert.throws(
      () =>
        buildOutcomeRecordCalldata({
          ...params,
          executionTxHash: "0x1234" as const,
        }),
      /executionTxHash must be bytes32/i,
    );
  });

  it("encodes policy execution calldata with bytes32 strategy id", () => {
    const calldata = buildPolicyExecutionCalldata(policyParams);

    assert.match(calldata, /^0x[0-9a-f]+$/);
    assert.ok(calldata.includes("61676e692d757364792d736166652d73776170"));
  });

  it("returns prepared policy execution calldata when relayer key is missing", async () => {
    const originalEnabled = process.env.RELAYER_ENABLED;
    const originalKey = process.env.RELAYER_PRIVATE_KEY;

    try {
      process.env.RELAYER_ENABLED = "true";
      delete process.env.RELAYER_PRIVATE_KEY;

      const result = await recordPolicyExecution(policyParams);

      assert.equal(result.enabled, true);
      assert.equal(result.mode, "prepared");
      assert.equal(result.txHash, null);
      assert.equal(result.calldata, buildPolicyExecutionCalldata(policyParams));
      assert.match(result.note, /prepared policy execution calldata/i);
    } finally {
      process.env.RELAYER_ENABLED = originalEnabled;
      process.env.RELAYER_PRIVATE_KEY = originalKey;
    }
  });
});
