import { keccak256, stringToHex } from "viem";

export function hashDecision(payload: string): `0x${string}` {
  return keccak256(stringToHex(payload));
}
