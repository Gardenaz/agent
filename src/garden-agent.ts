import { runAutopilotTick } from "./autopilot";
import type { AgentContext, AiAdvisorSignal, AutopilotDecision, AutopilotIntent, CropId, RiskLevel, ScoredYieldOpportunity } from "./types";

type MockAdvisor = {
  recommendedStrategyId?: string;
  suggestedMaxRiskLevel?: RiskLevel;
  suggestedMinImprovementBps?: number;
};

export type GardenRequest = {
  message: string;
  user: `0x${string}`;
  amount: string;
  execute: boolean;
  userMaxRiskLevel?: RiskLevel;
  mockAdvisor?: MockAdvisor;
};

export type MarketMood = {
  mood: "bullish" | "neutral" | "bearish";
  weather: "sunny" | "cloudy" | "rainy";
  reason: string;
};

export type GardenSimulation = {
  crop: string;
  background: "bright-sky" | "soft-clouds" | "rainy-garden";
  potSlots: Array<{ id: string; label: string; health: number; apy: string; active: boolean }>;
  actionLabel: string;
};

export type GardenAgentDecision = AutopilotDecision & {
  parsedIntent: { crop: CropId; riskPreference: RiskLevel; message: string };
  marketMood: MarketMood;
  effectivePolicy: AutopilotIntent["policy"];
  gardenSimulation: GardenSimulation;
  beginnerExplanation: string;
};

const ALLOWED_PROTOCOLS = ["Mantle RWA USDY Route", "Mantle mETH Yield Route", "Mantle Dynamic RWA Route"];

function clampRisk(level: number): RiskLevel {
  if (level <= 1) return 1;
  if (level >= 3) return 3;
  return 2;
}

function parseIntent(message: string, userMaxRiskLevel?: RiskLevel): GardenAgentDecision["parsedIntent"] {
  const text = message.toLowerCase();
  const wantsSafe = /safe|beginner|protect|stable|low|real world|rwa|usdy/.test(text);
  const wantsBoost = /aggressive|spicy|boost|high|max|degen/.test(text);
  const wantsGrowth = /grow|growth|good|bull|market looks good|compound|meth/.test(text);

  const crop: CropId = wantsSafe ? "steady" : wantsBoost ? "boost" : wantsGrowth ? "growth" : "steady";
  const inferredRisk = crop === "steady" ? 1 : crop === "growth" ? 2 : 3;
  const riskPreference = clampRisk(Math.min(inferredRisk, userMaxRiskLevel ?? inferredRisk));

  return { crop, riskPreference, message };
}

function inferMarketMood(opportunities: ScoredYieldOpportunity[]): MarketMood {
  const best = opportunities[0];
  const avgConfidence = opportunities.reduce((sum, item) => sum + item.confidence, 0) / opportunities.length;
  const bestApy = best?.expectedApyBps ?? 0;
  const lowLiquidity = best ? best.liquidityUsd < 300_000 : true;

  if (bestApy >= 700 && avgConfidence >= 0.7 && !lowLiquidity) {
    return { mood: "bullish", weather: "sunny", reason: "Yield, confidence, liquidity healthy." };
  }
  if (bestApy <= 250 || avgConfidence < 0.55 || lowLiquidity) {
    return { mood: "bearish", weather: "rainy", reason: "Yield or confidence weak; protect garden." };
  }
  return { mood: "neutral", weather: "cloudy", reason: "Market mixed; grow carefully." };
}

function cropLabel(strategyId: string, fallback?: string): string {
  if (fallback) return fallback;
  if (strategyId.includes("steady")) return "Rice / Safe Harvest";
  if (strategyId.includes("growth")) return "Corn / Growth Field";
  return "Chili / Boost Farm";
}

function backgroundFor(weather: MarketMood["weather"]): GardenSimulation["background"] {
  if (weather === "sunny") return "bright-sky";
  if (weather === "rainy") return "rainy-garden";
  return "soft-clouds";
}

function buildGardenSimulation(decision: AutopilotDecision, marketMood: MarketMood): GardenSimulation {
  return {
    crop: cropLabel(decision.selectedOpportunity.strategyId, decision.selectedOpportunity.consumerTheme),
    background: backgroundFor(marketMood.weather),
    actionLabel: decision.action.kind === "rebalance" ? "Plant now" : "Keep seed safe",
    potSlots: decision.rankedOpportunities.slice(0, 3).map((item) => ({
      id: item.strategyId,
      label: cropLabel(item.strategyId, item.consumerTheme),
      health: Math.round(item.confidence * 100),
      apy: `${(item.expectedApyBps / 100).toFixed(2)}%`,
      active: item.strategyId === decision.selectedOpportunity.strategyId,
    })),
  };
}

function beginnerCopy(decision: AutopilotDecision, parsedIntent: GardenAgentDecision["parsedIntent"], mood: MarketMood): string {
  if (parsedIntent.crop === "steady") {
    return `Beginner safe mode: agent picked ${decision.selectedOpportunity.asset} via ${decision.selectedOpportunity.protocol}. ${mood.reason}`;
  }
  if (decision.action.kind === "hold") {
    return `Agent keeps funds safe for now. ${mood.reason}`;
  }
  return `Agent grows garden through ${decision.selectedOpportunity.asset}. Policy gate checks risk before move.`;
}

function chooseCurrentStrategy(crop: CropId): string {
  if (crop === "steady") return "steady-rwa-usdy";
  if (crop === "growth") return "steady-rwa-usdy";
  return "growth-meth-yield";
}

function buildPolicy(request: GardenRequest, parsed: GardenAgentDecision["parsedIntent"]): AutopilotIntent["policy"] {
  const advisorRisk = request.mockAdvisor?.suggestedMaxRiskLevel ?? parsed.riskPreference;
  const userMax = request.userMaxRiskLevel ?? parsed.riskPreference;
  const maxRiskLevel = clampRisk(Math.min(userMax, advisorRisk, parsed.riskPreference));

  return {
    enabled: true,
    paused: false,
    maxTxAmount: 5_000,
    maxRiskLevel,
    rebalanceIntervalSeconds: 3600,
    allowedProtocols: ALLOWED_PROTOCOLS,
  };
}

function applyMockAdvisor(decision: AutopilotDecision, mock?: MockAdvisor): AutopilotDecision {
  if (!mock?.recommendedStrategyId) return decision;
  const recommended = decision.rankedOpportunities.find((item) => item.strategyId === mock.recommendedStrategyId);
  if (!recommended) return decision;

  const aiAdvisor: AiAdvisorSignal = {
    ...decision.aiAdvisor,
    provider: "llm",
    model: "mock-gardena-advisor",
    recommendedStrategyId: recommended.strategyId,
    marketSummary: `${recommended.asset} recommended by advisory layer; deterministic policy still decides execution.`,
    confidenceReason: "Mock LLM recommendation accepted as advice only; policy gate cannot be loosened.",
  };

  const checks = decision.policy.checks.map((check) => {
    if (check.label === "Autopilot enabled") return { ...check, pass: true, detail: "Autopilot advisory preview allowed" };
    if (check.label === "Risk limit") {
      return {
        ...check,
        pass: recommended.riskLevel <= decision.intent.policy.maxRiskLevel,
        detail: `Opportunity risk ${recommended.riskLevel} <= policy risk ${decision.intent.policy.maxRiskLevel}`,
      };
    }
    return check;
  });
  const failed = checks.find((check) => !check.pass);
  const policy = failed
    ? { allow: false, status: "blocked" as const, reason: failed.detail, checks }
    : { allow: true, status: "approved" as const, reason: "Autopilot opportunity passes deterministic policy checks.", checks };
  const action = policy.allow
    ? decision.action
    : { kind: "hold" as const, reason: `Autopilot blocked: ${policy.reason}`, currentStrategyId: decision.intent.currentStrategyId, improvementBps: 0 };

  return {
    ...decision,
    selectedOpportunity: recommended,
    aiAdvisor,
    policy,
    action,
    summary: policy.allow ? decision.summary : `Autopilot hold: ${action.reason}`,
  };
}

export async function plantGarden(request: GardenRequest, context: AgentContext = {}): Promise<GardenAgentDecision> {
  const parsedIntent = parseIntent(request.message, request.userMaxRiskLevel);
  const effectivePolicy = buildPolicy(request, parsedIntent);
  const allowedProtocols =
    parsedIntent.crop === "steady" && !request.mockAdvisor
      ? ["Mantle RWA USDY Route"]
      : parsedIntent.crop === "growth" && !request.mockAdvisor
        ? ["Mantle RWA USDY Route", "Mantle mETH Yield Route"]
        : effectivePolicy.allowedProtocols;
  const intent: AutopilotIntent = {
    user: request.user,
    agentId: "1",
    amount: request.amount,
    riskPreference: parsedIntent.riskPreference,
    mode: "autopilot",
    currentStrategyId: chooseCurrentStrategy(parsedIntent.crop),
    minImprovementBps: request.mockAdvisor?.suggestedMinImprovementBps ?? (parsedIntent.crop === "steady" ? 0 : 50),
    policy: { ...effectivePolicy, allowedProtocols },
  };

  const rawDecision = await runAutopilotTick(intent, context);
  const decision = applyMockAdvisor(rawDecision, request.mockAdvisor);
  const marketMood = inferMarketMood(decision.rankedOpportunities);
  const weakMarket = marketMood.mood === "bearish";
  const finalDecision = weakMarket
    ? {
        ...decision,
        action: {
          kind: "hold" as const,
          reason: "Rainy market: agent protects garden until yield/confidence recovers.",
          currentStrategyId: intent.currentStrategyId,
          improvementBps: 0,
        },
        summary: "Autopilot hold: Rainy market protection active.",
      }
    : decision;

  return {
    ...finalDecision,
    parsedIntent,
    marketMood,
    effectivePolicy,
    gardenSimulation: buildGardenSimulation(finalDecision, marketMood),
    beginnerExplanation: beginnerCopy(finalDecision, parsedIntent, marketMood),
  };
}
