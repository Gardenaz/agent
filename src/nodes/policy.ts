import type { AgentIntent, AgentPlan, PolicyDecision } from "../types"

export function policyCheck(input: { intent: AgentIntent; plan: AgentPlan; maxTxAmount: bigint; maxRiskLevel: 1|2|3 }): PolicyDecision {
  if (input.intent.amount > input.maxTxAmount) return { allow: false, reason: "amount exceeds maxTxAmount" }
  if (input.plan.riskLevel > input.maxRiskLevel) return { allow: false, reason: "risk exceeds maxRiskLevel" }
  return { allow: true, reason: "ok" }
}
