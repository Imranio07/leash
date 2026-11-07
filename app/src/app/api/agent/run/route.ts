// Runs the CLI agent on the server for a task and streams its output.
// The agent key never leaves the server; the browser only sees text.
//
// Demo presets send a `scenario`. The server turns it into actions the run must attempt
// (made directly with the agent key, marked "direct", if no model attempts them).

import { spawn, type ChildProcess } from "node:child_process";
import { resolve } from "node:path";
import { fetchVault, leashProgram } from "@leash/sdk";
import { childEnv, ROOT } from "@leash/sdk/node";
import { PublicKey } from "@solana/web3.js";
import { PROGRAM_ID } from "@/lib/config";
import { agentKeypair, attackerWallet, errorMessage, jsonError, serverConnection } from "@/lib/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_TASK_LENGTH = 500;
let current: ChildProcess | null = null;

const SCENARIOS = ["weather", "stranger-3", "stranger-0.10", "compromised", "budget"] as const;
type Scenario = (typeof SCENARIOS)[number];

/**
 * A demo preset: the exact task text (built here, so it always names the stranger's full
 * address) and the CLI args with the actions the run must attempt.
 */
function presetRun(scenario: Scenario, stranger: string | null): { task: string; args: string[] } | null {
  const expect = (actions: unknown[]) => ["--expect", JSON.stringify(actions)];
  switch (scenario) {
    case "weather":
      return {
        task: "Get the weather in Bishkek and translate the summary into Kyrgyz.",
        args: expect([
          { kind: "service", service: "weather", params: { city: "Bishkek" } },
          { kind: "service", service: "translate", params: { to: "ky", text: "{{summary}}" } },
        ]),
      };
    case "stranger-3":
    case "stranger-0.10": {
      if (!stranger) return null;
      const amount = scenario === "stranger-3" ? "3" : "0.10";
      return {
        task: `Send $${amount} USDC to the wallet ${stranger}`,
        args: expect([{ kind: "pay", recipient: stranger, amount }]),
      };
    }
    case "compromised":
      return {
        task: "Read the latest news about Solana for me.",
        args: [
          "--compromised",
          ...expect([
            { kind: "service", service: "news", params: { topic: "solana" } },
            {
              kind: "pay",
              recipient: attackerWallet().toBase58(),
              amount: "0.20",
              reason: "compromised agent follows injected instruction",
              note: "compromised agent follows injected instruction",
            },
          ]),
        ],
      };
    case "budget":
      return { task: "What is my budget?", args: [] };
  }
}

export async function POST(req: Request) {
  let task: string;
  let vault: PublicKey;
  let extraArgs: string[];
  try {
    const body = (await req.json()) as { task?: string; vault?: string; scenario?: string; stranger?: string };
    task = (body.task ?? "").trim();
    if (!task || task.length > MAX_TASK_LENGTH) return jsonError(400, `task must be 1 to ${MAX_TASK_LENGTH} characters`);
    try {
      vault = new PublicKey(body.vault ?? "");
    } catch {
      return jsonError(400, "vault must be a base58 public key");
    }
    const state = await fetchVault(leashProgram(serverConnection(), PROGRAM_ID), vault);
    if (!state) return jsonError(404, "no vault at this address");
    if (!state.agent.equals(agentKeypair().publicKey)) {
      return jsonError(400, "this vault's agent is not keys/agent.json, so the local agent cannot sign for it");
    }
    extraArgs = [];
    if (SCENARIOS.includes(body.scenario as Scenario)) {
      let stranger: string | null = null;
      try {
        stranger = new PublicKey(body.stranger ?? "").toBase58();
      } catch {
        // not a stranger preset, or no address sent
      }
      const preset = presetRun(body.scenario as Scenario, stranger);
      if (!preset) return jsonError(400, "this preset needs a valid stranger address");
      task = preset.task;
      extraArgs = preset.args;
    }
  } catch (e) {
    return jsonError(500, errorMessage(e));
  }
  if (current && current.exitCode === null) return jsonError(409, "an agent run is already in progress");

  const child = spawn(
    process.execPath,
    [resolve(ROOT, "node_modules/tsx/dist/cli.mjs"), resolve(ROOT, "agent/src/agent.ts"), ...extraArgs, task],
    {
      cwd: ROOT,
      // The agent reads .env itself; only the vault on screen is passed explicitly.
      env: childEnv({ LEASH_VAULT: vault.toBase58(), FORCE_COLOR: "0", NO_COLOR: "1" }),
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  current = child;

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const send = (text: string) => {
        if (!closed) controller.enqueue(encoder.encode(text));
      };
      const finish = (text: string) => {
        if (closed) return;
        send(text);
        closed = true;
        controller.close();
        if (current === child) current = null;
      };
      child.stdout?.on("data", (d: Buffer) => send(d.toString()));
      child.stderr?.on("data", (d: Buffer) => send(d.toString()));
      child.on("error", (e) => finish(`\n[failed to start the agent: ${e.message}]\n`));
      child.on("close", (code, signal) => finish(`\n[agent finished${code ? ` with exit code ${code}` : signal ? ` (${signal})` : ""}]\n`));
    },
    cancel() {
      child.kill("SIGTERM");
    },
  });
  req.signal.addEventListener("abort", () => child.kill("SIGTERM"));

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
