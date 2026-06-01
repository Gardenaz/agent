export function hashDecision(payload: string): string {
  return `0x${Buffer.from(payload).toString("hex").slice(0, 64).padEnd(64, "0")}`
}
