import mantleSepoliaDeployment from "./mantle-sepolia.json"
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
  const baseDeployment = mantleSepoliaDeployment.deployment as DeploymentConfig
  const agentIdentity = readAddress("AGENT_IDENTITY_ADDRESS", env.AGENT_IDENTITY_ADDRESS)
  const decisionLog = readAddress("DECISION_LOG_ADDRESS", env.DECISION_LOG_ADDRESS)
  const autopilotPolicy = readAddress("AUTOPILOT_POLICY_ADDRESS", env.AUTOPILOT_POLICY_ADDRESS)

  const configured = [agentIdentity, decisionLog, autopilotPolicy].filter(Boolean).length
  if (!agentIdentity || !decisionLog || !autopilotPolicy) {
    if (configured > 0) {
      throw new Error("AGENT_IDENTITY_ADDRESS, DECISION_LOG_ADDRESS, and AUTOPILOT_POLICY_ADDRESS must be configured together")
    }
    return baseDeployment
  }

  return {
    chainId: Number(env.MANTLE_CHAIN_ID ?? baseDeployment.chainId),
    network: env.MANTLE_NETWORK ?? baseDeployment.network,
    contracts: {
      agentIdentity: agentIdentity ?? baseDeployment.contracts.agentIdentity,
      decisionLog: decisionLog ?? baseDeployment.contracts.decisionLog,
      autopilotPolicy: autopilotPolicy ?? baseDeployment.contracts.autopilotPolicy,
    },
  }
}
