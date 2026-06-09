import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { loadDeploymentConfig } from "./config/contracts";
import { hashDecision } from "./nodes/log";
import { planStrategy } from "./nodes/plan";
import { policyCheck } from "./nodes/policy";
import type { AgentContext, AgentDecision, AgentIntent, AgentPlan, DeploymentConfig, PolicyDecision } from "./types";

export const AgentStateAnnotation = Annotation.Root({
  intent: Annotation<AgentIntent>,
  deployment: Annotation<DeploymentConfig | undefined>,
  plan: Annotation<AgentPlan | undefined>,
  policy: Annotation<PolicyDecision | undefined>,
  summary: Annotation<string | undefined>,
  createdAt: Annotation<string | undefined>,
  decisionHash: Annotation<`0x${string}` | undefined>,
  decision: Annotation<AgentDecision | undefined>,
});

export type AgentGraphState = typeof AgentStateAnnotation.State;
export type AgentGraphUpdate = typeof AgentStateAnnotation.Update;

function planNode(state: AgentGraphState): AgentGraphUpdate {
  return { plan: planStrategy(state.intent) };
}

function policyNode(state: AgentGraphState): AgentGraphUpdate {
  if (!state.plan) {
    throw new Error("Agent graph policy node requires a strategy plan");
  }

  const policy = policyCheck({ intent: state.intent, plan: state.plan });
  const summary = policy.allow
    ? `${state.plan.title} approved for ${state.intent.amount} ${state.plan.asset}. ${state.plan.explanation}`
    : `${state.plan.title} blocked. ${policy.reason}`;

  return { policy, summary, createdAt: new Date().toISOString() };
}

function logNode(state: AgentGraphState): AgentGraphUpdate {
  if (!state.plan || !state.policy || !state.summary || !state.createdAt) {
    throw new Error("Agent graph log node requires plan, policy, summary, and createdAt state");
  }

  const erc8004 = {
    agentId: "1",
    registries: {
      agentIdentity: state.deployment?.contracts.agentIdentity,
      autopilotPolicy: state.deployment?.contracts.autopilotPolicy,
    },
  } as const;

  const benchmark = {
    decisionLog: state.deployment?.contracts.decisionLog,
    status: "required",
    anchorState: "pending",
    outcomeState: "pending",
    transparency: "live",
  } as const;

  const decisionHash = hashDecision(
    JSON.stringify({
      intent: state.intent,
      plan: state.plan,
      policy: state.policy,
      erc8004,
      benchmark,
      deployment: state.deployment,
      createdAt: state.createdAt,
    }),
  );

  const decision: AgentDecision = {
    intent: state.intent,
    plan: state.plan,
    policy: state.policy,
    decisionHash,
    summary: state.summary,
    createdAt: state.createdAt,
    execution: {
      actionType: state.plan.actionType ?? "hold",
      executionKind: state.plan.executionKind,
      pair: state.plan.pair,
      tokenIn: state.plan.tokenIn,
      tokenOut: state.plan.tokenOut,
      feeTier: state.plan.feeTier,
      slippageBps: state.plan.slippageBps,
      deadlineSeconds: state.plan.deadlineSeconds,
      quotedInputAmount: state.intent.amount,
    },
    deployment: state.deployment,
    erc8004,
    benchmark,
    track: {
      primary: "AI x RWA",
      secondary: "Consumer & Viral DApps",
      support: "Agentic Wallets & Economy",
    },
  };

  return { decisionHash, decision };
}

export function createAgentGraph() {
  return new StateGraph(AgentStateAnnotation)
    .addNode("plan_step", planNode)
    .addNode("policy_step", policyNode)
    .addNode("log_step", logNode)
    .addEdge(START, "plan_step")
    .addEdge("plan_step", "policy_step")
    .addEdge("policy_step", "log_step")
    .addEdge("log_step", END)
    .compile();
}

export const agentGraph = createAgentGraph();

export async function runAgent(
  intent: AgentIntent,
  context: AgentContext = { deployment: loadDeploymentConfig() },
): Promise<AgentDecision> {
  const state = await agentGraph.invoke({ intent, deployment: context.deployment });

  if (!state.decision) {
    throw new Error("Agent graph completed without producing a decision");
  }

  return state.decision;
}

export type { AgentDecision, AgentIntent } from "./types";
