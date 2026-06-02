export const MANTLE_MAINNET_CHAIN_ID = 5000;

export const MANTLE_MAINNET_TOKENS = {
  USDY: {
    symbol: "USDY",
    address: "0x5Be26527E817998a7206475496f1C1F0bF4511C9" as `0x${string}`,
    decimals: 18,
  },
  mETH: {
    symbol: "mETH",
    address: "0xcDA86A272531e8640cD7F1a92c01839911B90bb0" as `0x${string}`,
    decimals: 18,
  },
  MNT: {
    symbol: "MNT",
    address: "0xDeadDeAddeAddEAddeadDEaDDEAdDeaDDeAD0000" as `0x${string}`,
    decimals: 18,
  },
} as const;

export type MantleTokenSymbol = keyof typeof MANTLE_MAINNET_TOKENS;

export const ALLOWED_EXECUTION_TOKENS = new Set<string>(Object.values(MANTLE_MAINNET_TOKENS).map((token) => token.address.toLowerCase()));
