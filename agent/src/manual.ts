// Deterministic fallback without the LLM, e.g. for recording the demo.
// Same tools and the same on-chain path as the agent.
//
//   npm run pay -- <amount> <address> [reason]
//   npm run call -- weather <city>
//   npm run call -- translate <lang> <text>
//   npm run budget

import { inspect } from "node:util";
import { callPaidService, createContext, getBudget, sendPayment } from "./tools";
import { bold, red, say } from "./ui";

const USAGE = `Usage:
  npm run pay -- <amount> <address> [reason]
  npm run call -- weather <city>
  npm run call -- translate <lang> <text>
  npm run budget`;

function usage(): never {
  console.error(USAGE);
  process.exit(1);
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);

  if (cmd === "pay") {
    const [amount, address, ...reasonWords] = rest;
    if (!amount || !address) usage();
    const task = reasonWords.join(" ") || `Send ${amount} USDC to ${address}`;
    say("🧑", bold(task));
    await sendPayment(await createContext(task), address, amount, task);
    return;
  }

  if (cmd === "call") {
    const [service, ...args] = rest;
    let params: Record<string, string>;
    if (service === "weather" && args.length) params = { city: args.join(" ") };
    else if (service === "translate" && args.length >= 2) params = { to: args[0]!, text: args.slice(1).join(" ") };
    else usage();
    const task = `Call ${service} with ${JSON.stringify(params)}`;
    say("🧑", bold(task));
    const result = await callPaidService(await createContext(task), service, params);
    if ("data" in result && result.data) console.log(JSON.stringify(result.data, null, 2));
    return;
  }

  if (cmd === "budget") {
    console.log(JSON.stringify(await getBudget(await createContext("budget")), null, 2));
    return;
  }

  usage();
}

// A rejected payment is a normal outcome here (exit 0); only crashes exit 1.
main().catch((e) => {
  console.error(red(e instanceof Error ? e.message : inspect(e)));
  process.exit(1);
});
