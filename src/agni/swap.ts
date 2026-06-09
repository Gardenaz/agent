import { createPublicClient, encodeFunctionData, http, parseUnits } from "viem";
import type { Address, DecisionExecutionMeta, TokenRef } from "../types";
import { AGNI_QUOTER_V2_ABI, AGNI_SWAP_ROUTER_ABI, ERC20_ABI } from "./abi";

export type SwapPreview = {
  pair: string;
  tokenIn: TokenRef;
  tokenOut: TokenRef;
  quotedInputAmount: string;
  quotedOutputAmount: string;
  minimumOutputAmount: string;
  feeTier: number;
  slippageBps: number;
  deadline: number;
};

export type SwapPreparationResult =
  | { status: "disabled"; note: string }
  | { status: "blocked"; note: string; target: Address; calldata: `0x${string}`; approval: { token: Address; spender: Address; amount: string; calldata: `0x${string}` }; preview?: SwapPreview }
  | { status: "prepared"; note: string; target: Address; calldata: `0x${string}`; preview: SwapPreview };

function hasAddress(token: TokenRef | undefined): token is TokenRef & { address: Address } {
  return Boolean(token?.address);
}

function minimumAmountOut(amountOut: bigint, slippageBps: number) {
  return amountOut - (amountOut * BigInt(slippageBps)) / 10_000n;
}

function previewFrom(meta: DecisionExecutionMeta, amountIn: bigint, amountOut: bigint, minOut: bigint, deadline: number): SwapPreview {
  if (!meta.pair || !meta.tokenIn || !meta.tokenOut || !meta.feeTier || meta.slippageBps == null) {
    throw new Error("swap preview metadata incomplete");
  }
  return {
    pair: meta.pair,
    tokenIn: meta.tokenIn,
    tokenOut: meta.tokenOut,
    quotedInputAmount: amountIn.toString(),
    quotedOutputAmount: amountOut.toString(),
    minimumOutputAmount: minOut.toString(),
    feeTier: meta.feeTier,
    slippageBps: meta.slippageBps,
    deadline,
  };
}

export async function prepareSwapExecution(params: {
  meta: DecisionExecutionMeta;
  userAddr: Address;
  amount: string;
  swapRouter: Address;
  quoterV2: Address;
  rpcUrl?: string;
}): Promise<SwapPreparationResult> {
  const { meta, userAddr, amount, swapRouter, quoterV2, rpcUrl } = params;
  if (!hasAddress(meta.tokenIn) || !hasAddress(meta.tokenOut)) {
    return {
      status: "disabled",
      note: "Swap route is missing live token addresses. Configure the token env for this lane before executing it.",
    };
  }
  if (!meta.feeTier || meta.slippageBps == null) {
    return {
      status: "disabled",
      note: "Swap route is missing fee tier or slippage guard metadata.",
    };
  }
  if (!rpcUrl) {
    return {
      status: "disabled",
      note: "Mantle RPC URL is required for a live Agni quote before preparing swap calldata.",
    };
  }

  const amountIn = parseUnits(amount, meta.tokenIn.decimals);
  const deadline = Math.floor(Date.now() / 1000) + (meta.deadlineSeconds ?? 900);
  const client = createPublicClient({ transport: http(rpcUrl) });

  const quoteResult = await client.readContract({
    address: quoterV2,
    abi: AGNI_QUOTER_V2_ABI,
    functionName: "quoteExactInputSingle",
    args: [{
      tokenIn: meta.tokenIn.address,
      tokenOut: meta.tokenOut.address,
      amountIn,
      fee: meta.feeTier,
      sqrtPriceLimitX96: 0n,
    }],
  });

  const amountOut = Array.isArray(quoteResult) ? quoteResult[0] : quoteResult;
  const minimumOutputAmount = minimumAmountOut(amountOut, meta.slippageBps);

  const calldata = encodeFunctionData({
    abi: AGNI_SWAP_ROUTER_ABI,
    functionName: "exactInputSingle",
    args: [{
      tokenIn: meta.tokenIn.address,
      tokenOut: meta.tokenOut.address,
      fee: meta.feeTier,
      recipient: userAddr,
      deadline: BigInt(deadline),
      amountIn,
      amountOutMinimum: minimumOutputAmount,
      sqrtPriceLimitX96: 0n,
    }],
  });

  const allowance = await client.readContract({
    address: meta.tokenIn.address,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: [userAddr, swapRouter],
  });

  const preview = previewFrom(meta, amountIn, amountOut, minimumOutputAmount, deadline);

  if (allowance < amountIn) {
    const approvalCalldata = encodeFunctionData({
      abi: ERC20_ABI,
      functionName: "approve",
      args: [swapRouter, amountIn],
    });

    return {
      status: "blocked",
      note: `Approval required before Agni can swap ${meta.tokenIn.symbol} into ${meta.tokenOut.symbol}.`,
      target: swapRouter,
      calldata,
      approval: {
        token: meta.tokenIn.address,
        spender: swapRouter,
        amount: amountIn.toString(),
        calldata: approvalCalldata,
      },
      preview,
    };
  }

  return {
    status: "prepared",
    note: `Agni swap calldata prepared for ${meta.tokenIn.symbol} -> ${meta.tokenOut.symbol}.`,
    target: swapRouter,
    calldata,
    preview,
  };
}
