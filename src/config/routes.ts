import mantleSepoliaDeployment from "./mantle-sepolia.json";
import type { Address, AgentPlan, CropId, DeploymentConfig, YieldOpportunity } from "../types";

type ContractKey =
  | "gardenRwaMockVault"
  | "steadyAdapter"
  | "growthAdapter"
  | "boostAdapter"
  | "steadyOracle"
  | "growthOracle"
  | "boostOracle";

type RouteDefinition = {
  crop: CropId;
  strategyId: string;
  title: string;
  riskLevel: 1 | 2 | 3;
  protocol: string;
  action: string;
  asset: string;
  expectedApy: string;
  steps: string[];
  explanation: string;
  adapterKey: ContractKey;
  oracleKey: ContractKey;
  consumerTheme: string;
  shareLabel: string;
  expectedApyBps: number;
  liquidityUsd: number;
  gasCostUsd: number;
  confidence: number;
  marketCondition: string;
};

const DEFAULT_DEPLOYMENT = mantleSepoliaDeployment.deployment as DeploymentConfig;

const ROUTES: Record<CropId, RouteDefinition> = {
  steady: {
    crop: "steady",
    strategyId: "steady-rwa-usdy",
    title: "Rice / Safe Harvest",
    riskLevel: 1,
    protocol: "Mantle RWA USDY Route",
    action: "Allocate into policy-safe RWA strategy parking",
    asset: "USDY",
    expectedApy: "4-6%",
    steps: ["Check USDY exposure", "Validate user risk policy", "Prepare RWA strategy allocation", "Log benchmark decision on Mantle"],
    explanation: "Low-volatility RWA route for conservative users who want stable allocation and transparent on-chain benchmarks.",
    adapterKey: "steadyAdapter",
    oracleKey: "steadyOracle",
    consumerTheme: "Rice / Safe Harvest",
    shareLabel: "Stable moat lane powered by USDY",
    expectedApyBps: 520,
    liquidityUsd: 1_400_000,
    gasCostUsd: 0.05,
    confidence: 0.92,
    marketCondition: "USDY RWA strategy stable",
  },
  growth: {
    crop: "growth",
    strategyId: "growth-meth-yield",
    title: "Corn / Growth Field",
    riskLevel: 2,
    protocol: "Mantle mETH Yield Route",
    action: "Allocate into mETH strategy route",
    asset: "mETH",
    expectedApy: "7-11%",
    steps: ["Estimate mETH exposure", "Check volatility boundary", "Validate policy risk tier", "Prepare growth allocation for approval"],
    explanation: "Balanced Mantle-native route for users who accept moderate volatility for stronger compounding.",
    adapterKey: "growthAdapter",
    oracleKey: "growthOracle",
    consumerTheme: "Corn / Growth Field",
    shareLabel: "Growth lane compounding with mETH",
    expectedApyBps: 960,
    liquidityUsd: 950_000,
    gasCostUsd: 0.08,
    confidence: 0.86,
    marketCondition: "mETH compounding improving",
  },
  boost: {
    crop: "boost",
    strategyId: "boost-rwa-meth-dynamic",
    title: "Chili / Boost Farm",
    riskLevel: 3,
    protocol: "Mantle Dynamic RWA Route",
    action: "Rebalance between USDY and mETH opportunities",
    asset: "USDY/mETH",
    expectedApy: "13-21%",
    steps: ["Check volatility tier", "Require explicit high-risk approval", "Prepare dynamic allocation draft", "Monitor exit conditions"],
    explanation: "Higher-return AI x RWA strategy with stricter policy checks, outcome benchmarks, and consumer-friendly moat framing.",
    adapterKey: "boostAdapter",
    oracleKey: "boostOracle",
    consumerTheme: "Chili / Boost Farm",
    shareLabel: "Dynamic moat lane caught a spicy RWA spread",
    expectedApyBps: 1_760,
    liquidityUsd: 420_000,
    gasCostUsd: 0.12,
    confidence: 0.72,
    marketCondition: "dynamic RWA and mETH spread opportunity",
  },
};

function resolveDeployment(deployment?: DeploymentConfig) {
  return deployment ?? DEFAULT_DEPLOYMENT;
}

function resolveProtocolAddress(deployment?: DeploymentConfig): Address {
  const value = resolveDeployment(deployment).contracts.gardenRwaMockVault;
  return value as Address;
}

export function resolveCropDefinition(crop: CropId, deployment?: DeploymentConfig) {
  const route = ROUTES[crop];
  const contracts = resolveDeployment(deployment).contracts;

  return {
    ...route,
    protocolAddress: resolveProtocolAddress(deployment),
    adapterAddress: contracts[route.adapterKey] as Address,
    oracleAddress: contracts[route.oracleKey] as Address,
  };
}

export function resolveCropPlan(crop: CropId, deployment?: DeploymentConfig): AgentPlan {
  const route = resolveCropDefinition(crop, deployment);
  return {
    strategyId: route.strategyId,
    title: route.title,
    riskLevel: route.riskLevel,
    protocol: route.protocol,
    protocolAddress: route.protocolAddress,
    action: route.action,
    asset: route.asset,
    adapterAddress: route.adapterAddress,
    oracleAddress: route.oracleAddress,
    expectedApy: route.expectedApy,
    steps: route.steps,
    explanation: route.explanation,
  };
}

export function resolveMarketOpportunities(deployment?: DeploymentConfig): YieldOpportunity[] {
  return (Object.values(ROUTES) as RouteDefinition[]).map((route) => {
    const resolved = resolveCropDefinition(route.crop, deployment);
    return {
      id: resolved.strategyId,
      strategyId: resolved.strategyId,
      protocol: resolved.protocol,
      protocolAddress: resolved.protocolAddress,
      asset: resolved.asset,
      adapterAddress: resolved.adapterAddress,
      oracleAddress: resolved.oracleAddress,
      expectedApyBps: resolved.expectedApyBps,
      riskLevel: resolved.riskLevel,
      liquidityUsd: resolved.liquidityUsd,
      gasCostUsd: resolved.gasCostUsd,
      confidence: resolved.confidence,
      marketCondition: resolved.marketCondition,
      consumerTheme: resolved.consumerTheme,
      trackFit: resolved.crop === "boost" ? "Consumer & Viral DApps" : "AI x RWA",
      shareLabel: resolved.shareLabel,
    };
  });
}

export function resolveAllowedProtocols(deployment?: DeploymentConfig): Address[] {
  return [resolveProtocolAddress(deployment)];
}
