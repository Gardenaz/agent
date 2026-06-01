export type RiskLevel = 1 | 2 | 3

export type AgentIntent = {
  user: `0x${string}`
  crop: "rice" | "corn" | "chili"
  amount: bigint
}

export type AgentPlan = {
  strategyId: string
  riskLevel: RiskLevel
  protocol: string
  action: string
  asset: string
}

export type PolicyDecision = {
  allow: boolean
  reason: string
}

export type ContractAddresses = {
  agentIdentity: `0x${string}`
  decisionLog: `0x${string}`
  riskPolicy: `0x${string}`
}

export type DeploymentConfig = {
  chainId: number
  network: string
  contracts: ContractAddresses
}

export type AgentContext = {
  deployment?: DeploymentConfig
}
