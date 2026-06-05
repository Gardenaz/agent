import type { CropId } from "../types";
import { resolveCropPlan } from "./routes";

export const CROP_STRATEGIES = {
  steady: resolveCropPlan("steady"),
  growth: resolveCropPlan("growth"),
  boost: resolveCropPlan("boost"),
} satisfies Record<CropId, ReturnType<typeof resolveCropPlan>>;
