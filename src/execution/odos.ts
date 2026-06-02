import { MANTLE_MAINNET_TOKENS, ALLOWED_EXECUTION_TOKENS, MANTLE_MAINNET_CHAIN_ID } from "./tokens";

const ODOS_QUOTE_URL = "https://api.odos.xyz/sor/quote/v2";
const ODOS_ASSEMBLE_URL = "https://api.odos.xyz/sor/assemble";

export type OdosQuoteRequest = {
  chainId: number;
  inputTokens: Array<{ tokenAddress: string; amount: string }>;
  outputTokens: Array<{ tokenAddress: string; proportion: number }>;
  slippageLimitPercent: number;
  userAddr: string;
  referralCode?: number;
  disableRFQs?: boolean;
  compact?: boolean;
};

export type OdosQuoteResponse = {
  pathId: string;
  inAmounts: Record<string, string>;
  outAmounts: Record<string, string>;
  gasEstimate: number;
  priceImpact?: number;
};

export type OdosAssembleResponse = {
  transaction: {
    to: `0x${string}`;
    data: `0x${string}`;
    value: string;
    gasLimit: string;
  };
  approval?: {
    tokenAddress: string;
    spender: string;
    amount: string;
  };
};

export type ExecutionPlan = {
  chainId: number;
  inputAsset: string;
  outputAsset: string;
  inputAmount: string;
  expectedOutput: string;
  approveTarget?: string;
  approveAmount?: string;
  txTo: `0x${string}`;
  txData: `0x${string}`;
  txValue: string;
  gasEstimate: number;
  priceImpact?: number;
  pathId: string;
};

function resolveAddress(symbolOrAddr: string): string {
  const upper = symbolOrAddr.toUpperCase();
  if (upper.startsWith("0X")) return symbolOrAddr;
  const token = MANTLE_MAINNET_TOKENS[upper as keyof typeof MANTLE_MAINNET_TOKENS];
  if (!token) throw new Error(`unknown token: ${symbolOrAddr}`);
  return token.address;
}

export function validateExecutionParams(params: {
  chainId: number;
  inputAsset: string;
  outputAsset: string;
  inputAmount: string;
  maxSlippageBps: number;
  maxNotionalUsd: number;
}): void {
  if (params.chainId !== MANTLE_MAINNET_CHAIN_ID) throw new Error(`execution only on Mantle mainnet (chainId ${MANTLE_MAINNET_CHAIN_ID})`);
  const inputAddr = resolveAddress(params.inputAsset);
  const outputAddr = resolveAddress(params.outputAsset);
  if (!ALLOWED_EXECUTION_TOKENS.has(inputAddr.toLowerCase())) throw new Error(`input token not allowlisted: ${params.inputAsset}`);
  if (!ALLOWED_EXECUTION_TOKENS.has(outputAddr.toLowerCase())) throw new Error(`output token not allowlisted: ${params.outputAsset}`);
  if (params.maxSlippageBps > 300) throw new Error("slippage over 3% not allowed");
  const amount = Number(params.inputAmount);
  if (isNaN(amount) || amount <= 0) throw new Error("invalid input amount");
  if (params.maxNotionalUsd > 100) throw new Error("max notional exceeds safety cap");
}

export async function fetchOdosQuote(params: {
  chainId: number;
  inputAsset: string;
  outputAsset: string;
  inputAmount: string;
  slippageLimitPercent: number;
  userAddr: string;
}): Promise<OdosQuoteResponse> {
  const inputAddr = resolveAddress(params.inputAsset);
  const outputAddr = resolveAddress(params.outputAsset);

  const body: OdosQuoteRequest = {
    chainId: params.chainId,
    inputTokens: [{ tokenAddress: inputAddr, amount: params.inputAmount }],
    outputTokens: [{ tokenAddress: outputAddr, proportion: 1 }],
    slippageLimitPercent: params.slippageLimitPercent,
    userAddr: params.userAddr,
    disableRFQs: true,
    compact: true,
  };

  const res = await fetch(ODOS_QUOTE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Odos quote failed (${res.status}): ${text}`);
  }

  return res.json() as Promise<OdosQuoteResponse>;
}

export async function assembleOdosTx(params: {
  pathId: string;
  userAddr: string;
  simulate?: boolean;
}): Promise<OdosAssembleResponse> {
  const body = {
    pathId: params.pathId,
    userAddr: params.userAddr,
    simulate: params.simulate ?? false,
  };

  const res = await fetch(ODOS_ASSEMBLE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Odos assemble failed (${res.status}): ${text}`);
  }

  return res.json() as Promise<OdosAssembleResponse>;
}

export async function planExecution(params: {
  inputAsset: string;
  outputAsset: string;
  inputAmount: string;
  slippageBps: number;
  userAddr: string;
  maxNotionalUsd: number;
}): Promise<ExecutionPlan> {
  const chainId = MANTLE_MAINNET_CHAIN_ID;
  const slippagePercent = params.slippageBps / 100;

  validateExecutionParams({
    chainId,
    inputAsset: params.inputAsset,
    outputAsset: params.outputAsset,
    inputAmount: params.inputAmount,
    maxSlippageBps: params.slippageBps,
    maxNotionalUsd: params.maxNotionalUsd,
  });

  const quote = await fetchOdosQuote({
    chainId,
    inputAsset: params.inputAsset,
    outputAsset: params.outputAsset,
    inputAmount: params.inputAmount,
    slippageLimitPercent: slippagePercent,
    userAddr: params.userAddr,
  });

  const assembled = await assembleOdosTx({
    pathId: quote.pathId,
    userAddr: params.userAddr,
    simulate: false,
  });

  const inputAddr = resolveAddress(params.inputAsset);
  const outputAddr = resolveAddress(params.outputAsset);

  return {
    chainId,
    inputAsset: inputAddr,
    outputAsset: outputAddr,
    inputAmount: quote.inAmounts[inputAddr] ?? params.inputAmount,
    expectedOutput: quote.outAmounts[outputAddr] ?? "0",
    approveTarget: assembled.approval?.spender,
    approveAmount: assembled.approval?.amount,
    txTo: assembled.transaction.to,
    txData: assembled.transaction.data,
    txValue: assembled.transaction.value,
    gasEstimate: quote.gasEstimate,
    priceImpact: quote.priceImpact,
    pathId: quote.pathId,
  };
}
