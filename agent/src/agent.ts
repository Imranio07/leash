// LLM agent with payment tools. The vault's rules are enforced on-chain, not here.
//
//   npm run agent -- "Get the weather in Bishkek and translate the summary into Kyrgyz."

import { inspect } from "node:util";
import { chat, llmConfigFromEnv, type ChatMessage, type ToolDef } from "@leash/sdk/node";
import { callPaidService, createContext, getBudget, listServices, sendPayment, type AgentContext } from "./tools";
import { bold, cyan, detail, dim, red, say, short } from "./ui";

const SYSTEM_PROMPT = `You are an autonomous AI agent that buys paid API services and makes payments on Solana devnet.
You pay from a Leash vault: an on-chain spending policy set by your owner (per-payment max, daily cap, recipient allowlist, expiry, revoke switch).

Rules:
- You do not check spending limits yourself and you never refuse, question or reduce a payment. Always attempt exactly what the user asks. The Leash program on Solana enforces the owner's rules, not you.
- To use a paid service, call call_paid_service. It handles the HTTP 402 payment for you. Call list_services first if you need the service ids or parameters.
- For a direct transfer, call send_payment once with the exact recipient and amount the user gave.
- If the program rejects a payment, do not retry, split the amount or look for a workaround. Tell the user the Leash vault rejected it, give the exact program error name (for example ExceedsPerTxLimit) and the explorer link.
- For every successful payment, mention the amount and the explorer link.
- Answer in the language of the user's task. Be brief.`;

const noParams = { type: "object", properties: {} };

const TOOLS: ToolDef[] = [
  {
    type: "function",
    function: {
      name: "get_budget",
      description:
        "Show the Leash vault: balance, spent today, daily cap, per-payment max, allowlisted recipients, expiry, revoked flag.",
      parameters: noParams,
    },
  },
  {
    type: "function",
    function: {
      name: "list_services",
      description: "List the paid API services, their parameters and prices.",
      parameters: noParams,
    },
  },
  {
    type: "function",
    function: {
      name: "call_paid_service",
      description:
        "Call a paid service. Pays its price from the vault automatically (HTTP 402 -> agent_pay -> retry) and returns the data.",
      parameters: {
        type: "object",
        properties: {
          service: { type: "string", description: "Service id from list_services: weather or translate" },
          params: {
            type: "object",
            description: 'weather: {"city": "..."}; translate: {"text": "...", "to": "ky"}',
            properties: {
              city: { type: "string", description: "City name (weather)" },
              text: { type: "string", description: "Text to translate (translate)" },
              to: { type: "string", description: "Target language code, e.g. ky for Kyrgyz (translate)" },
            },
          },
        },
        required: ["service", "params"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "send_payment",
      description: "Send USDC from the vault directly to a wallet address.",
      parameters: {
        type: "object",
        properties: {
          recipient: { type: "string", description: "Recipient wallet address (base58)" },
          amount_usdc: { type: "string", description: 'Amount in USDC as a decimal string, e.g. "3" or "0.10"' },
          reason: { type: "string", description: "Why this payment is made" },
        },
        required: ["recipient", "amount_usdc", "reason"],
      },
    },
  },
];

const MAX_STEPS = 12;

function runTool(ctx: AgentContext, name: string, args: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case "get_budget":
      return getBudget(ctx);
    case "list_services":
      return listServices(ctx);
    case "call_paid_service":
      return callPaidService(ctx, String(args.service ?? ""), (args.params ?? {}) as Record<string, unknown>);
    case "send_payment":
      return sendPayment(ctx, String(args.recipient ?? ""), String(args.amount_usdc ?? ""), String(args.reason ?? ""));
    default:
      return Promise.resolve({ error: `unknown tool "${name}"` });
  }
}

function formatArgs(args: Record<string, unknown>): string {
  const s = Object.entries(args)
    .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
    .join(", ");
  return s.length > 140 ? `${s.slice(0, 137)}...` : s;
}

async function main() {
  const task = process.argv.slice(2).join(" ").trim();
  if (!task) {
    console.error('Usage: npm run agent -- "<task>"');
    process.exit(1);
  }
  const llm = llmConfigFromEnv();
  const ctx = await createContext(task);
  const hash = Buffer.from(ctx.intentHash).toString("hex");

  say("🧑", bold(task));
  detail(dim(`agent ${short(ctx.agent.publicKey)} · vault ${short(ctx.vault)} · ${llm.provider}/${llm.model} · intent ${hash.slice(0, 12)}…`));

  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: task },
  ];

  for (let step = 0; step < MAX_STEPS; step++) {
    const msg = await chat(llm, messages, TOOLS);
    messages.push(msg);

    if (!msg.tool_calls?.length) {
      console.log();
      say("🤖", msg.content?.trim() || "(no answer)");
      return;
    }
    if (msg.content?.trim()) say("🤖", dim(msg.content.trim()));

    for (const call of msg.tool_calls) {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(call.function.arguments || "{}") as Record<string, unknown>;
      } catch {
        // Leave args empty; the tool reports what is missing.
      }
      say("🔧", `${cyan(call.function.name)}(${formatArgs(args)})`);
      let result: unknown;
      try {
        result = await runTool(ctx, call.function.name, args);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        detail(red(`✗ ${message}`));
        result = { ok: false, error: message };
      }
      messages.push({ role: "tool", tool_call_id: call.id, name: call.function.name, content: JSON.stringify(result) });
    }
  }
  say("⚠️", `Stopped after ${MAX_STEPS} steps.`);
}

main().catch((e) => {
  console.error(red(e instanceof Error ? e.message : inspect(e)));
  process.exit(1);
});
