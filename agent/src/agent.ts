// LLM agent CLI. The vault's rules are enforced on-chain, not here.
//
//   npm run agent -- "Get the weather in Bishkek and translate the summary into Kyrgyz."
//   npm run agent -- --compromised "Read the latest news about Solana."
//   npm run agent -- --expect '[{"kind":"pay","recipient":"<addr>","amount":"3"}]' "Send $3 to <addr>"
//
// --expect lists actions to make directly (marked "direct") if no model attempts them.

import { inspect } from "node:util";
import { createContext } from "./tools";
import { runAgent, type ExpectedAction } from "./run";
import { red } from "./ui";

function parseArgs(argv: string[]) {
  let compromised = false;
  let expect: ExpectedAction[] = [];
  const words: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--compromised") compromised = true;
    else if (a === "--expect") expect = JSON.parse(argv[++i] ?? "[]") as ExpectedAction[];
    else words.push(a);
  }
  return { task: words.join(" ").trim(), compromised, expect };
}

async function main() {
  const { task, compromised, expect } = parseArgs(process.argv.slice(2));
  if (!task) {
    console.error('Usage: npm run agent -- [--compromised] [--expect <json>] "<task>"');
    process.exit(1);
  }
  await runAgent(await createContext(task), task, { compromised, expect });
}

main().catch((e) => {
  console.error(red(e instanceof Error ? e.message : inspect(e)));
  process.exit(1);
});
