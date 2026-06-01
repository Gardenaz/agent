import type { DeploymentConfig } from "../types"

const ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/

function readAddress(name: string, value: string | undefined): `0x${string}` | undefined {
  if (!value) return undefined
  if (!ADDRESS_PATTERN.test(value)) {
    throw new Error(`${name} must be a 20-byte hex address`)
  }
  return value as `0x${string}`
}

export function loadDeploymentConfig(env: NodeJS.ProcessEnv = process.env): DeploymentConfig | undefined {
  const agentIdentity = readAddress("AGENT_IDENTITY_ADDRESS", env.AGENT_IDENTITY_ADDRESS)
  const decisionLog = readAddress("DECISION_LOG_ADDRESS", env.DECISION_LOG_ADDRESS)
  const riskPolicy = readAddress("RISK_POLICY_ADDRESS", env.RISK_POLICY_ADDRESS)

  const configured = [agentIdentity, decisionLog, riskPolicy].filter(Boolean).length
  if (configured === 0) return undefined
  if (!agentIdentity || !decisionLog || !riskPolicy) {
    throw new Error("AGENT_IDENTITY_ADDRESS, DECISION_LOG_ADDRESS, and RISK_POLICY_ADDRESS must be configured together")
  }

  return {
    chainId: Number(env.MANTLE_CHAIN_ID ?? 5000),
    network: env.MANTLE_NETWORK ?? "mantle",
    contracts: {
      agentIdentity,
      decisionLog,
      riskPolicy,
    },
  }
}
