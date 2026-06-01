import { runAgent } from "./graph"

const sample = runAgent({
  user: "0x1111111111111111111111111111111111111111",
  crop: "rice",
  amount: 1000n * 10n ** 6n,
})

console.log("agent-ready", sample.policy.reason, sample.decisionHash)
