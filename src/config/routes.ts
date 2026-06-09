import mantleSepoliaDeployment from "./mantle-sepolia.json";
import { resolveAgniContracts, resolveAgniTokens } from "../agni/addresses";
import type { Address, AgentPlan, CropId, DeploymentConfig, YieldOpportunity } from "../types";

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
  protocolAddress: Address;
  consumerTheme: string;
  shareLabel: string;
  expectedApyBps: number;
  liquidityUsd: number;
  gasCostUsd: number;
  confidence: number;
  marketCondition: string;
  actionType: YieldOpportunity["actionType"];
  executionKind: YieldOpportunity["executionKind"];
  pair?: string;
  feeTier?: number;
  slippageBps?: number;
  deadlineSeconds?: number;
  tokenIn?: YieldOpportunity["tokenIn"];
  tokenOut?: YieldOpportunity["tokenOut"];
};

const DEFAULT_DEPLOYMENT = mantleSepoliaDeployment.deployment as DeploymentConfig;

function resolveDeployment(deployment?: DeploymentConfig) {
  return deployment ?? DEFAULT_DEPLOYMENT;
}

function buildRoutes(): Record<CropId, RouteDefinition> {
  const contracts = resolveAgniContracts();
  const tokens = resolveAgniTokens();
  return {
    steady: {
      crop: "steady",
      strategyId: "agni-usdc-safe-swap",
      title: "Rice / Safe Harvest",
      riskLevel: 1,
      protocol: "Agni Swap Router",
      action: "Swap into the calmer USDC lane with policy-first guardrails",
      asset: "USDC",
      expectedApy: "4-6%",
      steps: ["Read wallet intent", "Quote a guarded Agni swap", "Check policy and approval state", "Anchor the decision on Mantle"],
      explanation: "Low-volatility route for conservative users who want a simple stable crop before any higher-risk move.",
      protocolAddress: contracts.swapRouter,
      consumerTheme: "Rice / Safe Harvest",
      shareLabel: "Stable moat lane powered by USDC",
      expectedApyBps: 520,
      liquidityUsd: 1_400_000,
      gasCostUsd: 0.05,
      confidence: 0.92,
      marketCondition: "stablecoin lane looks calm",
      actionType: "swap",
      executionKind: "swap",
      pair: "USDT/USDC",
      feeTier: 500,
      slippageBps: 75,
      deadlineSeconds: 900,
      tokenIn: tokens.USDT,
      tokenOut: tokens.USDC,
    },
    growth: {
      crop: "growth",
      strategyId: "agni-wmnt-growth-swap",
      title: "Corn / Growth Field",
      riskLevel: 2,
      protocol: "Agni Swap Router",
      action: "Rotate into WMNT growth exposure with a quoted swap",
      asset: "WMNT",
      expectedApy: "7-11%",
      steps: ["Read wallet intent", "Quote the WMNT growth route", "Check policy and approval state", "Prepare the move for wallet confirmation"],
      explanation: "Balanced Mantle-native growth route for users who accept moderate volatility for stronger compounding.",
      protocolAddress: contracts.swapRouter,
      consumerTheme: "Corn / Growth Field",
      shareLabel: "Growth lane compounding with WMNT",
      expectedApyBps: 960,
      liquidityUsd: 950_000,
      gasCostUsd: 0.08,
      confidence: 0.86,
      marketCondition: "WMNT growth lane improving",
      actionType: "swap",
      executionKind: "swap",
      pair: "USDT/WMNT",
      feeTier: 3000,
      slippageBps: 100,
      deadlineSeconds: 900,
      tokenIn: tokens.USDT,
      tokenOut: tokens.WMNT,
    },
    boost: {
      crop: "boost",
      strategyId: "agni-usdc-wmnt-liquidity",
      title: "Chili / Boost Farm",
      riskLevel: 3,
      protocol: "Agni Position Manager",
      action: "Add guarded liquidity to the dynamic USDC/WMNT field",
      asset: "USDC/WMNT",
      expectedApy: "13-21%",
      steps: ["Check volatility tier", "Require explicit high-risk approval", "Preview the liquidity lane", "Anchor the decision before any LP action"],
      explanation: "Higher-return Agni liquidity strategy with stricter checks. The agent keeps the UI simple, but this lane still needs real LP range inputs before it can execute.",
      protocolAddress: contracts.nonfungiblePositionManager,
      consumerTheme: "Chili / Boost Farm",
      shareLabel: "Dynamic moat lane caught a spicy stablecoin and WMNT spread",
      expectedApyBps: 1_760,
      liquidityUsd: 420_000,
      gasCostUsd: 0.12,
      confidence: 0.72,
      marketCondition: "dynamic stablecoin and WMNT spread opportunity",
      actionType: "addLiquidity",
      executionKind: "liquidity",
      pair: "USDC/WMNT",
      feeTier: 3000,
      slippageBps: 125,
      deadlineSeconds: 900,
      tokenIn: tokens.USDC,
      tokenOut: tokens.WMNT,
    },
  };
}

export function resolveCropDefinition(crop: CropId, deployment?: DeploymentConfig) {
  const route = buildRoutes()[crop];
  const resolvedDeployment = resolveDeployment(deployment);

  return {
    ...route,
    // Keep the trust layer addresses available for proof while routing strategy previews to Agni.
    deployment: resolvedDeployment,
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
    actionType: route.actionType,
    executionKind: route.executionKind,
    pair: route.pair,
    tokenIn: route.tokenIn,
    tokenOut: route.tokenOut,
    feeTier: route.feeTier,
    slippageBps: route.slippageBps,
    deadlineSeconds: route.deadlineSeconds,
    expectedApy: route.expectedApy,
    steps: route.steps,
    explanation: route.explanation,
  };
}

export function resolveMarketOpportunities(deployment?: DeploymentConfig): YieldOpportunity[] {
  return (Object.values(buildRoutes()) as RouteDefinition[]).map((route) => {
    const resolved = resolveCropDefinition(route.crop, deployment);
    return {
      id: resolved.strategyId,
      strategyId: resolved.strategyId,
      protocol: resolved.protocol,
      protocolAddress: resolved.protocolAddress,
      asset: resolved.asset,
      actionType: resolved.actionType,
      executionKind: resolved.executionKind,
      pair: resolved.pair,
      tokenIn: resolved.tokenIn,
      tokenOut: resolved.tokenOut,
      feeTier: resolved.feeTier,
      slippageBps: resolved.slippageBps,
      deadlineSeconds: resolved.deadlineSeconds,
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
  const routes = Object.values(buildRoutes()).map((route) => route.protocolAddress);
  return Array.from(new Set(routes));
}
