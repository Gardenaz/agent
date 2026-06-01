export type CropId = "steady" | "growth" | "boost";
export type RiskLevel = 1 | 2 | 3;
export type DecisionStatus = "approved" | "blocked";

export type AgentIntent = {
  user: `0x${string}`;
  crop: CropId;
  amount: string;
  riskPreference: RiskLevel;
};

export type AgentPlan = {
  strategyId: string;
  title: string;
  riskLevel: RiskLevel;
  protocol: string;
  action: string;
  asset: string;
  expectedApy: string;
  steps: string[];
  explanation: string;
};

export type PolicyDecision = {
  allow: boolean;
  status: DecisionStatus;
  reason: string;
  checks: Array<{ label: string; pass: boolean; detail: string }>;
};

export type AgentDecision = {
  intent: AgentIntent;
  plan: AgentPlan;
  policy: PolicyDecision;
  decisionHash: `0x${string}`;
  summary: string;
  createdAt: string;
  deployment?: DeploymentConfig;
};

export type ContractAddresses = {
  agentIdentity: `0x${string}`;
  decisionLog: `0x${string}`;
  riskPolicy: `0x${string}`;
};

export type DeploymentConfig = {
  chainId: number;
  network: string;
  contracts: ContractAddresses;
};

export type AgentContext = {
  deployment?: DeploymentConfig;
};
