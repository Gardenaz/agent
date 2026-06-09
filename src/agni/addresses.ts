import type { Address, TokenRef } from "../types";

const ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;

function readOptionalAddress(value: string | undefined): Address | undefined {
  if (!value) return undefined;
  if (!ADDRESS_PATTERN.test(value)) {
    throw new Error(`Invalid address: ${value}`);
  }
  return value as Address;
}

function token(symbol: string, address: Address | undefined, decimals: number): TokenRef {
  return { symbol, address, decimals };
}

export const AGNI_TESTNET_CONTRACTS = {
  swapRouter: "0xe38cfa32cCd918d94E2e20230dFaD1A4Fd8aEF16" as Address,
  quoterV2: "0x9Da17239a4170f50A5A2c11813BD0C601b5c9693" as Address,
  nonfungiblePositionManager: "0x71959543c31EC4d68D9D6C492Bf69A1C174bb394" as Address,
} as const;

export const AGNI_MAINNET_CONTRACTS = {
  swapRouter: "0x319B69888b0d11cEC22caA5034e25FfFBDc88421" as Address,
  quoterV2: "0xc4aaDc921E1cdb66c5300Bc158a313292923C0cb" as Address,
  nonfungiblePositionManager: "0x218bf598D1453383e2F4AA7b14fFB9BfB102D637" as Address,
} as const;

export function resolveAgniContracts(chainId = Number(process.env.MANTLE_CHAIN_ID ?? "5003")) {
  return chainId === 5000 ? AGNI_MAINNET_CONTRACTS : AGNI_TESTNET_CONTRACTS;
}

export function resolveAgniTokens(env: NodeJS.ProcessEnv = process.env) {
  const chainId = Number(env.MANTLE_CHAIN_ID ?? "5003");
  if (chainId === 5000) {
    return {
      USDY: token("USDY", readOptionalAddress(env.AGNI_USDY_TOKEN_ADDRESS) ?? "0x5Be26527E817998a7206475496f1C1F0bF4511C9", 18),
      mETH: token("mETH", readOptionalAddress(env.AGNI_METH_TOKEN_ADDRESS) ?? "0xcDA86A272531e8640cD7F1a92c01839911B90bb0", 18),
      USDT: token("USDT", readOptionalAddress(env.AGNI_USDT_TOKEN_ADDRESS) ?? "0x201eba5cc46d216ce6dc03f6a759e8e766e956ae", 6),
      USDC: token("USDC", readOptionalAddress(env.AGNI_USDC_TOKEN_ADDRESS) ?? "0x09bc4e0d864854c6afb6eb9a9cdf58ac190d0df9", 6),
      WMNT: token("WMNT", readOptionalAddress(env.AGNI_WMNT_TOKEN_ADDRESS) ?? "0x78c1b0C915c4FAA5FffA6CAbf0219DA63d7f4cb8", 18),
    } as const;
  }

  return {
    USDY: token("USDY", readOptionalAddress(env.AGNI_USDY_TOKEN_ADDRESS), 18),
    mETH: token("mETH", readOptionalAddress(env.AGNI_METH_TOKEN_ADDRESS), 18),
    USDT: token("USDT", readOptionalAddress(env.AGNI_USDT_TOKEN_ADDRESS) ?? "0x3e163F861826C3f7878bD8fa8117A179d80731Ab", 6),
    USDC: token("USDC", readOptionalAddress(env.AGNI_USDC_TOKEN_ADDRESS) ?? "0x82a2eb46a64e4908bbc403854bc8aa699bf058e9", 6),
    WMNT: token("WMNT", readOptionalAddress(env.AGNI_WMNT_TOKEN_ADDRESS) ?? "0x67A1f4A939b477A6b7c5BF94D97E45dE87E608eF", 18),
  } as const;
}
