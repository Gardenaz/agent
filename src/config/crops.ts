import type { AgentPlan } from "../types"

export const CROP_STRATEGIES: Record<string, AgentPlan> = {
  rice: { strategyId: "rice-lend-usdc", riskLevel: 1, protocol: "MantleLend", action: "supply", asset: "USDC" },
  corn: { strategyId: "corn-lp-usdc-meth", riskLevel: 2, protocol: "MantleSwap", action: "add_liquidity", asset: "USDC/mETH" },
  chili: { strategyId: "chili-vault-usdc", riskLevel: 3, protocol: "MantleVault", action: "deposit", asset: "USDC" },
}
