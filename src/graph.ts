import { planStrategy } from "./nodes/plan";
import { policyCheck } from "./nodes/policy";
import { hashDecision } from "./nodes/log";
import { loadDeploymentConfig } from "./config/contracts";
import type { AgentContext, AgentDecision, AgentIntent } from "./types";

export function runAgent(intent: AgentIntent, context: AgentContext = { deployment: loadDeploymentConfig() }): AgentDecision {
  const plan = planStrategy(intent);
  const policy = policyCheck({ intent, plan });
  const createdAt = new Date().toISOString();
  const summary = policy.allow
    ? `${plan.title} approved for ${intent.amount} ${plan.asset}. ${plan.explanation}`
    : `${plan.title} blocked. ${policy.reason}`;

  const decisionHash = hashDecision(
    JSON.stringify({ intent, plan, policy, deployment: context.deployment, createdAt }),
  );

  return { intent, plan, policy, decisionHash, summary, createdAt, deployment: context.deployment };
}

export type { AgentDecision, AgentIntent } from "./types";
