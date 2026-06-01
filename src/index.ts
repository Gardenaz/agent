import { runAgent } from "./graph";

const sample = runAgent({
  user: "0x1111111111111111111111111111111111111111",
  crop: "steady",
  amount: "1000",
  riskPreference: 2,
});

console.log("agent-ready", sample.policy.reason, sample.decisionHash);
