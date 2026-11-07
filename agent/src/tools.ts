// The agent's tools. Shared by the LLM agent (agent.ts) and the no-LLM fallback (manual.ts).
// None of these check spending limits: the Leash program on-chain decides.

import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  getAccount,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { Connection, PublicKey, type Keypair } from "@solana/web3.js";
import {
  agentPayIx,
  explorerTx,
  fetchVault,
  formatUsdc,
  intentHash,
  isLeashError,
  leashProgram,
  parseUsdc,
  rpcConnection,
  withRpcRetry,
  sendTx,
  spentToday,
  vaultTokenAddress,
  type LeashProgram,
} from "@leash/sdk";
import { env, getConfig, loadKeypair, ROOT } from "@leash/sdk/node";
import { bold, detail, dim, green, red, say, short, yellow } from "./ui";

export interface AgentContext {
  connection: Connection;
  program: LeashProgram;
  agent: Keypair;
  vault: PublicKey;
  mint: PublicKey;
  servicesUrl: string;
  /** sha256 of the user's task, recorded on-chain with every payment. */
  intentHash: Uint8Array;
  /** What the agent tried during this task, used to spot missing attempts. */
  attempts: { payments: PaymentOutcome[]; services: string[]; results: Record<string, Record<string, unknown>> };
}

/**
 * Loads the agent key and its vault (AGENT_KEYPAIR and LEASH_VAULT, unless given).
 * The agent never touches the owner's key.
 */
export async function createContext(task: string, overrides: { agent?: Keypair; vault?: PublicKey } = {}): Promise<AgentContext> {
  const cfg = getConfig();
  const connection = rpcConnection(cfg.rpcUrl);
  const program = leashProgram(connection);
  const agent = overrides.agent ?? loadKeypair(cfg.agentKeypairPath);
  let vault = overrides.vault;
  if (!vault) {
    const vaultEnv = env("LEASH_VAULT");
    if (!vaultEnv) throw new Error('LEASH_VAULT is empty: create a vault in the dashboard or run "npm run setup".');
    vault = new PublicKey(vaultEnv);
  }
  const state = await fetchVault(program, vault);
  if (!state) throw new Error(`No Leash vault at ${vault.toBase58()}. Create one in the dashboard or run "npm run setup".`);
  return {
    connection,
    program,
    agent,
    vault,
    mint: state.mint,
    servicesUrl: cfg.servicesUrl,
    intentHash: await intentHash(task),
    attempts: { payments: [], services: [], results: {} },
  };
}

// ---------- payments ----------

const LOG_PATH = resolve(ROOT, "logs/payments.jsonl");

/** Appends every attempt (paid or rejected) to logs/payments.jsonl for the dashboard. */
function logAttempt(entry: Record<string, unknown>) {
  mkdirSync(dirname(LOG_PATH), { recursive: true });
  appendFileSync(LOG_PATH, `${JSON.stringify({ ts: new Date().toISOString(), ...entry })}\n`);
}

export interface PaymentOutcome {
  ok: boolean;
  amount_usdc: string;
  recipient: string;
  signature?: string;
  explorer?: string;
  /** Error name when rejected, e.g. "ExceedsPerTxLimit". */
  error?: string;
  /** Numeric error code: 6000+ Leash, 100+ Anchor, below 100 SPL Token. */
  code?: number;
  error_message?: string;
}

/**
 * Sends `agent_pay`. Preflight is skipped on purpose: if the program rejects the payment,
 * the failed transaction still lands on-chain and the error is visible in the explorer.
 */
export async function pay(ctx: AgentContext, recipient: PublicKey, amount: bigint, label: string): Promise<PaymentOutcome> {
  say("💸", `agent_pay ${bold(formatUsdc(amount))} → ${short(recipient)} ${dim(`(${label})`)}`);
  const recipientAta = getAssociatedTokenAddressSync(ctx.mint, recipient, true);
  const instructions = [
    // So a wallet without a token account still reaches the program's checks.
    // If the program rejects the payment, this is rolled back too.
    createAssociatedTokenAccountIdempotentInstruction(ctx.agent.publicKey, recipientAta, recipient, ctx.mint),
    await agentPayIx(ctx.program, {
      agent: ctx.agent.publicKey,
      vault: ctx.vault,
      mint: ctx.mint,
      recipientTokenAccount: recipientAta,
      amount,
      intentHash: ctx.intentHash,
    }),
  ];
  let res: Awaited<ReturnType<typeof sendTx>>;
  try {
    res = await sendTx(ctx.connection, instructions, [ctx.agent], { skipPreflight: true });
  } catch (e) {
    // Never reached the chain (RPC down or throttled): record it so the run can retry it.
    const message = e instanceof Error ? e.message : String(e);
    detail(red(`✗ not sent: ${message.split("\n")[0]!.slice(0, 140)}`));
    const out: PaymentOutcome = { ok: false, amount_usdc: formatUsdc(amount), recipient: recipient.toBase58(), error: "RpcError", error_message: message.slice(0, 200) };
    ctx.attempts.payments.push(out);
    return out;
  }

  const out: PaymentOutcome = { ok: res.ok, amount_usdc: formatUsdc(amount), recipient: recipient.toBase58() };
  if (res.signature) {
    out.signature = res.signature;
    out.explorer = explorerTx(res.signature);
  }
  if (res.ok) {
    detail(`${green("✓ paid")}  ${out.explorer}`);
  } else {
    out.error = res.error?.name;
    out.code = res.error?.code;
    out.error_message = res.error?.message;
    const verdict = isLeashError(res.error) ? "rejected by the Leash program" : "failed";
    detail(red(`✗ ${verdict}: ${bold(out.error ?? "unknown error")}`) + (out.error_message ? dim(` (${out.error_message})`) : ""));
    if (out.explorer) detail(out.explorer);
  }
  logAttempt({ vault: ctx.vault.toBase58(), agent: ctx.agent.publicKey.toBase58(), label, ...out });
  ctx.attempts.payments.push(out);
  return out;
}

// ---------- tools ----------

export async function getBudget(ctx: AgentContext) {
  const v = await fetchVault(ctx.program, ctx.vault);
  if (!v) throw new Error("vault not found");
  const balance = (await withRpcRetry(() => getAccount(ctx.connection, vaultTokenAddress(ctx.vault, v.mint)))).amount;
  const budget = {
    vault: ctx.vault.toBase58(),
    balance_usdc: formatUsdc(balance),
    spent_today_usdc: formatUsdc(spentToday(v)),
    daily_cap_usdc: formatUsdc(v.dailyCap),
    per_payment_max_usdc: formatUsdc(v.perTxMax),
    allowlisted_recipients: v.allowlist.map((k) => k.toBase58()),
    expires_at: new Date(v.expiresAt * 1000).toISOString(),
    revoked: v.revoked,
  };
  detail(
    dim(
      `balance ${budget.balance_usdc} · today ${budget.spent_today_usdc} of ${budget.daily_cap_usdc} · ` +
        `max ${budget.per_payment_max_usdc}/payment${v.revoked ? " · REVOKED" : ""}`,
    ),
  );
  return budget;
}

interface ServiceInfo {
  id: string;
  method: "GET" | "POST";
  path: string;
  description: string;
  params: Record<string, string>;
  price: string;
  price_usdc: string;
}

async function fetchServices(ctx: AgentContext): Promise<ServiceInfo[]> {
  try {
    const r = await fetch(`${ctx.servicesUrl}/services`, { signal: AbortSignal.timeout(10_000) });
    return (await r.json()) as ServiceInfo[];
  } catch {
    throw new Error(`paid services are not reachable at ${ctx.servicesUrl} (start them with "npm run services")`);
  }
}

export async function listServices(ctx: AgentContext) {
  const services = await fetchServices(ctx);
  detail(dim(services.map((s) => `${s.id} ${s.price_usdc}`).join(" · ")));
  return services.map(({ id, description, params, price_usdc }) => ({ id, description, params, price_usdc }));
}

/** Calls a paid service: request → 402 → agent_pay → retry with X-Payment-Signature. */
export async function callPaidService(
  ctx: AgentContext,
  serviceId: string,
  params: Record<string, unknown>,
  label = `${serviceId} service`,
) {
  const svc = (await fetchServices(ctx)).find((s) => s.id === serviceId);
  if (!svc) return { ok: false, error: `unknown service "${serviceId}"` };

  const request = (headers: Record<string, string> = {}) => {
    if (svc.method === "GET") {
      const query = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]));
      return fetch(`${ctx.servicesUrl}${svc.path}?${query}`, { headers, signal: AbortSignal.timeout(60_000) });
    }
    return fetch(`${ctx.servicesUrl}${svc.path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(params),
      signal: AbortSignal.timeout(60_000),
    });
  };
  const readBody = async (r: Response) => (await r.json().catch(() => ({}))) as Record<string, unknown>;

  say("🌐", `${svc.method} ${svc.path} ${dim(JSON.stringify(params))}`);
  ctx.attempts.services.push(svc.id);
  let res = await request();
  if (res.status !== 402) {
    const data = await readBody(res);
    if (!res.ok) detail(red(`✗ ${res.status} ${String(data.error ?? "")}`));
    return { ok: res.ok, status: res.status, service: svc.id, data };
  }

  const quote = (await res.json()) as { price: string; recipient: string; mint: string; nonce: string };
  detail(yellow(`402 Payment Required: ${formatUsdc(quote.price)} to ${short(quote.recipient)}`));
  const payment = await pay(ctx, new PublicKey(quote.recipient), BigInt(quote.price), label);
  if (!payment.ok) return { ok: false, service: svc.id, payment };

  detail(dim("retrying with X-Payment-Signature"));
  let data: Record<string, unknown> = {};
  for (let attempt = 0; ; attempt++) {
    res = await request({ "X-Payment-Signature": payment.signature! });
    data = await readBody(res);
    // The payment is on-chain but the service could not verify it yet (RPC lag or throttling):
    // the service releases the signature on failure, so asking again with it is safe.
    if (res.status === 402 && data.error === "payment_invalid" && attempt < 2) {
      detail(dim(`· the service could not verify the payment yet (${String(data.reason ?? "")}), asking again`));
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
      continue;
    }
    break;
  }
  detail(res.ok ? green(`✓ ${res.status} data received`) : red(`✗ ${res.status} ${String(data.error ?? "")} ${String(data.reason ?? "")}`));
  if (res.ok) {
    ctx.attempts.results[svc.id] = data;
    // Make a prompt injection hidden in the response visible to whoever watches the agent.
    const injected = JSON.stringify(data).match(/SYSTEM NOTICE:[^"]*/);
    if (injected) say("⚠", yellow(`injected instruction in the ${svc.id} response: "${injected[0]}"`));
  }
  return { ok: res.ok, status: res.status, service: svc.id, payment, data };
}

/** Direct transfer from the vault. Only the input format is validated here, never the limits. */
export async function sendPayment(ctx: AgentContext, recipient: string, amountUsdc: string, reason: string) {
  let to: PublicKey;
  try {
    to = new PublicKey(recipient.trim());
  } catch {
    return { ok: false, error: `invalid recipient address "${recipient}"` };
  }
  let amount: bigint;
  try {
    amount = parseUsdc(amountUsdc);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  return pay(ctx, to, amount, reason || "direct payment");
}
