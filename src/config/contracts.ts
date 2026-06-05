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
  const riskPolicy = readAddress("RISK_POLICY_ADDRESS", env.RISK_POLICY_ADDRESS)
  const reputationRegistry = readAddress("REPUTATION_REGISTRY_ADDRESS", env.REPUTATION_REGISTRY_ADDRESS)
  const validationRegistry = readAddress("VALIDATION_REGISTRY_ADDRESS", env.VALIDATION_REGISTRY_ADDRESS)
  const autopilotPolicy = readAddress("AUTOPILOT_POLICY_ADDRESS", env.AUTOPILOT_POLICY_ADDRESS)
  const gardenUsdMock = readAddress("GARDEN_USD_MOCK_ADDRESS", env.GARDEN_USD_MOCK_ADDRESS)
  const gardenRwaMockVault = readAddress("GARDEN_RWA_MOCK_VAULT_ADDRESS", env.GARDEN_RWA_MOCK_VAULT_ADDRESS)
  const steadyAdapter = readAddress("STEADY_ADAPTER_ADDRESS", env.STEADY_ADAPTER_ADDRESS)
  const growthAdapter = readAddress("GROWTH_ADAPTER_ADDRESS", env.GROWTH_ADAPTER_ADDRESS)
  const boostAdapter = readAddress("BOOST_ADAPTER_ADDRESS", env.BOOST_ADAPTER_ADDRESS)
  const steadyAsset = readAddress("STEADY_ASSET_ADDRESS", env.STEADY_ASSET_ADDRESS)
  const growthAsset = readAddress("GROWTH_ASSET_ADDRESS", env.GROWTH_ASSET_ADDRESS)
  const boostAsset = readAddress("BOOST_ASSET_ADDRESS", env.BOOST_ASSET_ADDRESS)
  const steadyOracle = readAddress("STEADY_ORACLE_ADDRESS", env.STEADY_ORACLE_ADDRESS)
  const growthOracle = readAddress("GROWTH_ORACLE_ADDRESS", env.GROWTH_ORACLE_ADDRESS)
  const boostOracle = readAddress("BOOST_ORACLE_ADDRESS", env.BOOST_ORACLE_ADDRESS)

  const configured = [agentIdentity, decisionLog, riskPolicy, reputationRegistry, validationRegistry, autopilotPolicy].filter(Boolean).length
  if (!agentIdentity || !decisionLog || !riskPolicy) {
    if (configured > 0) {
      throw new Error("AGENT_IDENTITY_ADDRESS, DECISION_LOG_ADDRESS, and RISK_POLICY_ADDRESS must be configured together")
    }
    return baseDeployment
  }

  return {
    chainId: Number(env.MANTLE_CHAIN_ID ?? baseDeployment.chainId),
    network: env.MANTLE_NETWORK ?? baseDeployment.network,
    contracts: {
      agentIdentity: agentIdentity ?? baseDeployment.contracts.agentIdentity,
      decisionLog: decisionLog ?? baseDeployment.contracts.decisionLog,
      riskPolicy: riskPolicy ?? baseDeployment.contracts.riskPolicy,
      reputationRegistry: reputationRegistry ?? baseDeployment.contracts.reputationRegistry,
      validationRegistry: validationRegistry ?? baseDeployment.contracts.validationRegistry,
      autopilotPolicy: autopilotPolicy ?? baseDeployment.contracts.autopilotPolicy,
      gardenUsdMock: gardenUsdMock ?? baseDeployment.contracts.gardenUsdMock,
      gardenRwaMockVault: gardenRwaMockVault ?? baseDeployment.contracts.gardenRwaMockVault,
      steadyAdapter: steadyAdapter ?? baseDeployment.contracts.steadyAdapter,
      growthAdapter: growthAdapter ?? baseDeployment.contracts.growthAdapter,
      boostAdapter: boostAdapter ?? baseDeployment.contracts.boostAdapter,
      steadyAsset: steadyAsset ?? baseDeployment.contracts.steadyAsset,
      growthAsset: growthAsset ?? baseDeployment.contracts.growthAsset,
      boostAsset: boostAsset ?? baseDeployment.contracts.boostAsset,
      steadyOracle: steadyOracle ?? baseDeployment.contracts.steadyOracle,
      growthOracle: growthOracle ?? baseDeployment.contracts.growthOracle,
      boostOracle: boostOracle ?? baseDeployment.contracts.boostOracle,
    },
  }
}
