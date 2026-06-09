import { createPublicClient, decodeFunctionResult, encodeFunctionData, http, isAddress } from "viem";
import type { Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { mantle } from "viem/chains";
import { resolveAgniContracts } from "./agni/addresses";
import { loadDeploymentConfig } from "./config/contracts";

const DECISION_LOG_READ_ABI = [
  {
    type: "function",
    name: "writers",
    stateMutability: "view",
    inputs: [{ name: "writer", type: "address" }],
    outputs: [{ name: "allowed", type: "bool" }],
  },
] as const;

const AUTOPILOT_POLICY_READ_ABI = [
  {
    type: "function",
    name: "authorizedCallers",
    stateMutability: "view",
    inputs: [{ name: "caller", type: "address" }],
    outputs: [{ name: "allowed", type: "bool" }],
  },
] as const;

const mantleSepolia = {
  id: 5003,
  name: "Mantle Sepolia",
  nativeCurrency: { decimals: 18, name: "MNT", symbol: "MNT" },
  rpcUrls: { default: { http: ["https://rpc.sepolia.mantle.xyz"] } },
} as const;

type ReadinessStatus = "ready" | "partial" | "blocked";

export type AgentLiveReadiness = {
  chainId: number;
  network: string;
  relayer: {
    enabled: boolean;
    signerAddress: Address | null;
    executorAddress: Address | null;
    hasPrivateKey: boolean;
    rpcConfigured: boolean;
  };
  contracts: {
    decisionLog: {
      address: Address | null;
      writerAuthorized: boolean | null;
      note: string;
    };
    autopilotPolicy: {
      address: Address | null;
      callerAuthorized: boolean | null;
      note: string;
    };
  };
  agni: {
    swapRouter: Address;
    quoterV2: Address;
    nonfungiblePositionManager: Address;
    usdyTokenConfigured: boolean;
    mEthTokenConfigured: boolean;
  };
  executionModes: {
    wallet: {
      ready: boolean;
      status: ReadinessStatus;
      note: string;
    };
    managed: {
      ready: boolean;
      status: ReadinessStatus;
      note: string;
    };
  };
  benchmarking: {
    ready: boolean;
    status: ReadinessStatus;
    notes: string[];
  };
};

function chainFor(chainId: number) {
  if (chainId === mantle.id) return mantle;
  return mantleSepolia;
}

function readRpcUrl(chainId: number) {
  if (chainId === 5000) {
    return process.env.MANTLE_MAINNET_RPC_URL ?? process.env.RPC_URL ?? process.env.MANTLE_RPC_URL ?? null;
  }
  return process.env.MANTLE_RPC_URL ?? process.env.RPC_URL ?? process.env.MANTLE_MAINNET_RPC_URL ?? null;
}

function readOptionalAddress(value: string | undefined): Address | null {
  return value && isAddress(value) ? value as Address : null;
}

function deriveRelayerSigner(privateKey: string | undefined): Address | null {
  if (!privateKey || !/^0x[0-9a-fA-F]{64}$/.test(privateKey)) return null;
  return privateKeyToAccount(privateKey as `0x${string}`).address;
}

async function readDecisionLogWriter(
  rpcUrl: string | null,
  chainId: number,
  decisionLog: Address | null,
  signer: Address | null,
): Promise<{ authorized: boolean | null; note: string }> {
  if (!decisionLog) return { authorized: null, note: "DecisionLog address missing." };
  if (!signer) return { authorized: null, note: "RELAYER_PRIVATE_KEY missing, so writer identity is unknown." };
  if (!rpcUrl) return { authorized: null, note: "RPC URL missing for on-chain writer check." };

  try {
    const client = createPublicClient({
      chain: chainFor(chainId),
      transport: http(rpcUrl),
    });
    const abi = [
      {
        type: "function",
        name: "writers",
        stateMutability: "view",
        inputs: [{ type: "address" }],
        outputs: [{ type: "bool" }],
      },
    ] as const;
    const { data } = await client.call({
      to: decisionLog,
      data: encodeFunctionData({
        abi,
        functionName: "writers",
        args: [signer],
      }),
    });
    const authorized = decodeFunctionResult({
      abi,
      functionName: "writers",
      data: data ?? "0x",
    });
    return {
      authorized,
      note: authorized ? "Relayer signer is authorized to write DecisionLog." : "Relayer signer is not an authorized DecisionLog writer.",
    };
  } catch (error) {
    return {
      authorized: null,
      note: `DecisionLog writer check failed: ${error instanceof Error ? error.message.split("\n")[0] : "unknown error"}`,
    };
  }
}

async function readPolicyCaller(
  rpcUrl: string | null,
  chainId: number,
  autopilotPolicy: Address | null,
  signer: Address | null,
): Promise<{ authorized: boolean | null; note: string }> {
  if (!autopilotPolicy) return { authorized: null, note: "AutopilotPolicy address missing." };
  if (!signer) return { authorized: null, note: "RELAYER_PRIVATE_KEY missing, so authorized caller identity is unknown." };
  if (!rpcUrl) return { authorized: null, note: "RPC URL missing for AutopilotPolicy caller check." };

  try {
    const client = createPublicClient({
      chain: chainFor(chainId),
      transport: http(rpcUrl),
    });
    const abi = [
      {
        type: "function",
        name: "authorizedCallers",
        stateMutability: "view",
        inputs: [{ type: "address" }],
        outputs: [{ type: "bool" }],
      },
    ] as const;
    const { data } = await client.call({
      to: autopilotPolicy,
      data: encodeFunctionData({
        abi,
        functionName: "authorizedCallers",
        args: [signer],
      }),
    });
    const authorized = decodeFunctionResult({
      abi,
      functionName: "authorizedCallers",
      data: data ?? "0x",
    });
    return {
      authorized,
      note: authorized ? "Relayer signer is authorized to record policy executions." : "Relayer signer is not an authorized AutopilotPolicy caller.",
    };
  } catch (error) {
    return {
      authorized: null,
      note: `AutopilotPolicy caller check failed: ${error instanceof Error ? error.message.split("\n")[0] : "unknown error"}`,
    };
  }
}

export async function getAgentLiveReadiness(): Promise<AgentLiveReadiness> {
  const deployment = loadDeploymentConfig();
  const chainId = deployment?.chainId ?? Number(process.env.MANTLE_CHAIN_ID ?? 5003);
  const network = deployment?.network ?? (chainId === 5000 ? "mantle-mainnet" : "mantle-sepolia");
  const contracts = resolveAgniContracts(chainId);
  const rpcUrl = readRpcUrl(chainId);
  const relayerEnabled = process.env.RELAYER_ENABLED === "true";
  const relayerPrivateKey = process.env.RELAYER_PRIVATE_KEY;
  const signerAddress = deriveRelayerSigner(relayerPrivateKey);
  const executorAddress = readOptionalAddress(process.env.RELAYER_EXECUTOR_ADDRESS);

  const decisionLogAddress = deployment?.contracts.decisionLog ?? null;
  const autopilotPolicyAddress = deployment?.contracts.autopilotPolicy ?? null;

  const [decisionLogWriter, policyCaller] = await Promise.all([
    readDecisionLogWriter(rpcUrl, chainId, decisionLogAddress, signerAddress),
    readPolicyCaller(rpcUrl, chainId, autopilotPolicyAddress, signerAddress),
  ]);

  const benchmarkingNotes: string[] = [];
  if (!relayerEnabled) benchmarkingNotes.push("RELAYER_ENABLED is false.");
  if (!relayerPrivateKey) benchmarkingNotes.push("RELAYER_PRIVATE_KEY is missing.");
  if (!rpcUrl) benchmarkingNotes.push("RPC URL is missing.");
  if (decisionLogWriter.authorized !== true) benchmarkingNotes.push(decisionLogWriter.note);
  if (policyCaller.authorized !== true) benchmarkingNotes.push(policyCaller.note);

  const benchmarkingReady =
    relayerEnabled
    && Boolean(relayerPrivateKey)
    && Boolean(rpcUrl)
    && decisionLogWriter.authorized === true
    && policyCaller.authorized === true;

  const walletReady = benchmarkingReady;
  const managedReady = benchmarkingReady && Boolean(executorAddress);

  return {
    chainId,
    network,
    relayer: {
      enabled: relayerEnabled,
      signerAddress,
      executorAddress,
      hasPrivateKey: Boolean(relayerPrivateKey),
      rpcConfigured: Boolean(rpcUrl),
    },
    contracts: {
      decisionLog: {
        address: decisionLogAddress,
        writerAuthorized: decisionLogWriter.authorized,
        note: decisionLogWriter.note,
      },
      autopilotPolicy: {
        address: autopilotPolicyAddress,
        callerAuthorized: policyCaller.authorized,
        note: policyCaller.note,
      },
    },
    agni: {
      swapRouter: contracts.swapRouter,
      quoterV2: contracts.quoterV2,
      nonfungiblePositionManager: contracts.nonfungiblePositionManager,
      usdyTokenConfigured: isAddress(process.env.AGNI_USDT_TOKEN_ADDRESS ?? "") && isAddress(process.env.AGNI_USDC_TOKEN_ADDRESS ?? ""),
      mEthTokenConfigured: isAddress(process.env.AGNI_WMNT_TOKEN_ADDRESS ?? ""),
    },
    executionModes: {
      wallet: {
        ready: walletReady,
        status: walletReady ? "ready" : benchmarkingNotes.length === 0 ? "partial" : "blocked",
        note: walletReady
          ? "Wallet mode can execute and write benchmark results on-chain."
          : "Wallet mode can preview routes, but live benchmark writing is not fully ready yet.",
      },
      managed: {
        ready: managedReady,
        status: managedReady ? "ready" : executorAddress ? "partial" : "blocked",
        note: managedReady
          ? "Managed mode can relay execution and write benchmark results on-chain."
          : executorAddress
            ? "Managed mode still needs on-chain relayer readiness before it should be treated as live."
            : "RELAYER_EXECUTOR_ADDRESS is missing, so managed mode is not available.",
      },
    },
    benchmarking: {
      ready: benchmarkingReady,
      status: benchmarkingReady ? "ready" : benchmarkingNotes.length < 3 ? "partial" : "blocked",
      notes: benchmarkingNotes,
    },
  };
}
