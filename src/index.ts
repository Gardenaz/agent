import { runAgent } from "./graph";

async function main() {
  const sample = await runAgent({
    user: "0x1111111111111111111111111111111111111111",
    crop: "steady",
    amount: "1000",
    riskPreference: 2,
  });

  console.log("agent-ready", sample.policy.reason, sample.decisionHash);
}

void main();
