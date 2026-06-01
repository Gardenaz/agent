import type { AgentIntent, AgentPlan, PolicyDecision, RiskLevel } from "../types";

const DEFAULT_MAX_AMOUNT = 10_000;

export function policyCheck(input: {
  intent: AgentIntent;
  plan: AgentPlan;
  maxTxAmount?: number;
  maxRiskLevel?: RiskLevel;
  paused?: boolean;
}): PolicyDecision {
  const amount = Number(input.intent.amount);
  const maxTxAmount = input.maxTxAmount ?? DEFAULT_MAX_AMOUNT;
  const maxRiskLevel = input.maxRiskLevel ?? input.intent.riskPreference;

  const checks = [
    { label: "Emergency pause", pass: !input.paused, detail: input.paused ? "Policy is paused" : "Policy active" },
    { label: "Amount limit", pass: Number.isFinite(amount) && amount > 0 && amount <= maxTxAmount, detail: `Amount ${input.intent.amount} <= ${maxTxAmount}` },
    { label: "Risk limit", pass: input.plan.riskLevel <= maxRiskLevel, detail: `Strategy risk ${input.plan.riskLevel} <= policy risk ${maxRiskLevel}` },
  ];

  const failed = checks.find((check) => !check.pass);

  if (failed) {
    return { allow: false, status: "blocked", reason: failed.detail, checks };
  }

  return {
    allow: true,
    status: "approved",
    reason: "All deterministic policy checks passed. User confirmation still required before execution.",
    checks,
  };
}
