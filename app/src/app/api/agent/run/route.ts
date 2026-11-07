// Runs the CLI agent on the server for a task and streams its output.
// The agent key never leaves the server; the browser only sees text.
//
// Demo presets send a `scenario`. The server turns it into actions the run must attempt
// (made directly with the agent key, marked "direct", if no model attempts them).

import { spawn, type ChildProcess } from "node:child_process";
import { resolve } from "node:path";
import { fetchVault, leashProgram } from "@leash/sdk";
import { ROOT } from "@leash/sdk/node";
import { PublicKey } from "@solana/web3.js";
import { PROGRAM_ID } from "@/lib/config";
import { agentKeypair, attackerWallet, errorMessage, jsonError, serverConnection } from "@/lib/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_TASK_LENGTH = 500;
let current: ChildProcess | null = null;

type Scenario = "stranger-3" | "stranger-0.10" | "compromised";

/** Extra CLI args for a demo scenario, or [] for a free-form task. */
function scenarioArgs(scenario: unknown, stranger: unknown, task: string): string[] {
  if (scenario === "compromised") {
    const expect = [
      { kind: "service", service: "news", params: { topic: "solana" } },
      { kind: "pay", recipient: attackerWallet().toBase58(), amount: "0.20", reason: "instruction injected by the news service" },
    ];
    return ["--compromised", "--expect", JSON.stringify(expect)];
  }
  if (scenario === "stranger-3" || scenario === "stranger-0.10") {
    let address: string;
    try {
      address = new PublicKey(String(stranger)).toBase58();
    } catch {
      return [];
    }
    // Only when the task still names that address (the user may have edited the text).
    if (!task.includes(address)) return [];
    const amount = (scenario as Scenario) === "stranger-3" ? "3" : "0.10";
    return ["--expect", JSON.stringify([{ kind: "pay", recipient: address, amount }])];
  }
  return [];
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
    extraArgs = scenarioArgs(body.scenario, body.stranger, task);
  } catch (e) {
    return jsonError(500, errorMessage(e));
  }
  if (current && current.exitCode === null) return jsonError(409, "an agent run is already in progress");

  const child = spawn(
    process.execPath,
    [resolve(ROOT, "node_modules/tsx/dist/cli.mjs"), resolve(ROOT, "agent/src/agent.ts"), ...extraArgs, task],
    {
      cwd: ROOT,
      env: { ...process.env, LEASH_VAULT: vault.toBase58(), FORCE_COLOR: "0", NO_COLOR: "1" },
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
