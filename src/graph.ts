import { planStrategy } from "./nodes/plan"
import { policyCheck } from "./nodes/policy"
import { hashDecision } from "./nodes/log"
import { loadDeploymentConfig } from "./config/contracts"
import type { AgentContext, AgentIntent } from "./types"

export function runAgent(intent: AgentIntent, context: AgentContext = { deployment: loadDeploymentConfig() }) {
  const plan = planStrategy(intent)
  const policy = policyCheck({
    intent,
    plan,
    maxTxAmount: 10_000n * 10n ** 6n,
    maxRiskLevel: 2,
  })
  const decisionHash = hashDecision(
    JSON.stringify({ intent: { ...intent, amount: intent.amount.toString() }, plan, policy, deployment: context.deployment }),
  )
  return { intent, plan, policy, decisionHash, deployment: context.deployment }
}
