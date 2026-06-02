import mantleSepolia from "./mantle-sepolia.json" with { type: "json" };
import type { DeploymentConfig } from "../types";

export const mantleSepoliaDeployment = mantleSepolia.deployment as DeploymentConfig;
export const mantleSepoliaAbis = mantleSepolia.abis;
