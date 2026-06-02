import mantleSepolia from "./mantle-sepolia.json" with { type: "json" };
import type { DeploymentConfig } from "../types";

export const mantleSepoliaDeployment = mantleSepolia as DeploymentConfig;
