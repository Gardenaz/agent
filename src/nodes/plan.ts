import { CROP_STRATEGIES } from "../config/crops"
import type { AgentIntent, AgentPlan } from "../types"

export function planStrategy(intent: AgentIntent): AgentPlan {
  return CROP_STRATEGIES[intent.crop]
}
