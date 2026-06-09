export type Address = `0x${string}`;
export type CropId = "steady" | "growth" | "boost";
export type RiskLevel = 1 | 2 | 3;
export type DecisionStatus = "approved" | "blocked";
export type AgniActionType = "swap" | "addLiquidity" | "removeLiquidity" | "rebalanceLiquidity";
export type AgniExecutionKind = "swap" | "liquidity";
export type ExecutionAuthority = "wallet" | "managed";

export type TokenRef = {
  symbol: string;
  address?: Address;
  decimals: number;
};

export type Erc8004Binding = {
  agentId: string;
  registries: {
    agentIdentity: `0x${string}` | undefined;
    autopilotPolicy: `0x${string}` | undefined;
  };
};

export type BenchmarkProof = {
  decisionLog: `0x${string}` | undefined;
  status: "required";
  anchorState: "pending" | "anchored";
  outcomeState: "pending" | "recorded";
  transparency: "live";
};

export type DecisionExecutionMeta = {
  actionType: AgniActionType | "hold";
  executionKind?: AgniExecutionKind;
  pair?: string;
  tokenIn?: TokenRef;
  tokenOut?: TokenRef;
  feeTier?: number;
  slippageBps?: number;
  deadlineSeconds?: number;
  quotedInputAmount?: string;
  quotedOutputAmount?: string;
  minimumOutputAmount?: string;
  positionTokenId?: string;
};

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
  protocolAddress: Address;
  action: string;
  asset: string;
  actionType?: AgniActionType;
  executionKind?: AgniExecutionKind;
  pair?: string;
  tokenIn?: TokenRef;
  tokenOut?: TokenRef;
  feeTier?: number;
  slippageBps?: number;
  deadlineSeconds?: number;
  adapterAddress?: Address;
  assetTokenAddress?: Address;
  oracleAddress?: Address;
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
  execution: DecisionExecutionMeta;
  deployment?: DeploymentConfig;
  erc8004: Erc8004Binding;
  benchmark: BenchmarkProof;
  track: {
    primary: "AI x RWA";
    secondary: "Consumer & Viral DApps";
    support: "Agentic Wallets & Economy";
  };
};

export type ContractAddresses = {
  agentIdentity: `0x${string}`;
  decisionLog: `0x${string}`;
  autopilotPolicy: `0x${string}`;
};

export type DeploymentConfig = {
  chainId: number;
  network: string;
  contracts: ContractAddresses;
};

export type AgentContext = {
  deployment?: DeploymentConfig;
  yieldOpportunities?: YieldOpportunity[];
};

export type YieldOpportunity = {
  id: string;
  strategyId: string;
  protocol: string;
  protocolAddress: Address;
  asset: string;
  actionType: AgniActionType;
  executionKind: AgniExecutionKind;
  pair?: string;
  tokenIn?: TokenRef;
  tokenOut?: TokenRef;
  feeTier?: number;
  slippageBps?: number;
  deadlineSeconds?: number;
  positionTokenId?: string;
  adapterAddress?: Address;
  assetTokenAddress?: Address;
  oracleAddress?: Address;
  expectedApyBps: number;
  riskLevel: RiskLevel;
  liquidityUsd: number;
  gasCostUsd: number;
  confidence: number;
  marketCondition: string;
  consumerTheme?: string;
  trackFit?: "AI x RWA" | "Consumer & Viral DApps" | "Agentic Wallets & Economy";
  shareLabel?: string;
};

export type ScoredYieldOpportunity = YieldOpportunity & {
  score: number;
  scoreBreakdown: {
    apy: number;
    riskPenalty: number;
    gasPenalty: number;
    liquidityPenalty: number;
    confidenceBonus: number;
  };
};

export type AiAdvisorSignal = {
  provider: "llm" | "fallback";
  model: string;
  recommendedStrategyId: string;
  marketSummary: string;
  riskNotes: string[];
  confidenceReason: string;
};

export type AutopilotPolicyInput = {
  enabled: boolean;
  paused: boolean;
  maxTxAmount: number;
  maxRiskLevel: RiskLevel;
  rebalanceIntervalSeconds: number;
  oracleHeartbeatSeconds: number;
  allowedProtocols: Address[];
  allowedExecutors: Address[];
  allowedStrategies: string[];
  executionAuthority: ExecutionAuthority;
};

export type AutopilotIntent = {
  user: `0x${string}`;
  agentId: string;
  amount: string;
  riskPreference: RiskLevel;
  mode: "autopilot";
  currentStrategyId?: string;
  currentPositionId?: string;
  minImprovementBps: number;
  policy: AutopilotPolicyInput;
};

export type AutopilotAction =
  | { kind: "swap"; reason: string; toStrategyId: string; improvementBps: number; pair?: string }
  | { kind: "addLiquidity"; reason: string; toStrategyId: string; improvementBps: number; pair?: string }
  | { kind: "removeLiquidity"; reason: string; fromStrategyId?: string; improvementBps: number; pair?: string; positionTokenId?: string }
  | { kind: "rebalanceLiquidity"; reason: string; fromStrategyId?: string; toStrategyId: string; improvementBps: number; pair?: string; positionTokenId?: string }
  | { kind: "hold"; reason: string; currentStrategyId?: string; improvementBps: number; pair?: string };

export type AutopilotDecision = {
  intent: AutopilotIntent;
  market: { opportunities: YieldOpportunity[] };
  rankedOpportunities: ScoredYieldOpportunity[];
  selectedOpportunity: ScoredYieldOpportunity;
  aiAdvisor: AiAdvisorSignal;
  policy: PolicyDecision;
  action: AutopilotAction;
  decisionHash: `0x${string}`;
  summary: string;
  createdAt: string;
  execution: DecisionExecutionMeta;
  deployment?: DeploymentConfig;
  erc8004: Erc8004Binding;
  benchmark: BenchmarkProof;
  track: {
    primary: "AI x RWA";
    secondary: "Consumer & Viral DApps";
    support: "Agentic Wallets & Economy";
  };
};
