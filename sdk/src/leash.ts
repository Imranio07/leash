// Leash program client. Browser-safe: no Node APIs here.

import { BN, Program, type Provider } from "@anchor-lang/core";
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import {
  Connection,
  PublicKey,
  Transaction,
  type Signer,
  type TransactionError,
  type TransactionInstruction,
} from "@solana/web3.js";
import idlJson from "./idl/leash.json";
import type { Leash } from "./idl/leash";

export const LEASH_PROGRAM_ID = new PublicKey(idlJson.address);
const VAULT_SEED = new TextEncoder().encode("vault");
const SECONDS_PER_DAY = 86_400;

export type LeashProgram = Program<Leash>;

/** Program client for building instructions and reading accounts (it never signs). */
export function leashProgram(connection: Connection, programId: PublicKey = LEASH_PROGRAM_ID): LeashProgram {
  const provider: Provider = { connection };
  const idl = programId.equals(LEASH_PROGRAM_ID) ? idlJson : { ...idlJson, address: programId.toBase58() };
  return new Program<Leash>(idl as Leash, provider);
}

export function vaultAddress(owner: PublicKey, agent: PublicKey, programId: PublicKey = LEASH_PROGRAM_ID): PublicKey {
  return PublicKey.findProgramAddressSync([VAULT_SEED, owner.toBytes(), agent.toBytes()], programId)[0];
}

/** The vault's token account: the ATA of the vault PDA. */
export function vaultTokenAddress(vault: PublicKey, mint: PublicKey): PublicKey {
  return getAssociatedTokenAddressSync(mint, vault, true);
}

/**
 * A connection that does not retry rate-limited calls on its own. web3.js retries every 429
 * four times by default; with several clients on one IP that keeps the public devnet RPC
 * throttled. Callers that must succeed use `withRpcRetry` instead.
 */
export function rpcConnection(url: string): Connection {
  return new Connection(url, { commitment: "confirmed", disableRetryOnRateLimit: true });
}

/** The RPC's host name only, safe to print (API keys live in the path or query). */
export function rpcHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "invalid RPC_URL";
  }
}

export function explorerTx(signature: string): string {
  return `https://explorer.solana.com/tx/${signature}?cluster=devnet`;
}

export function explorerAddress(address: PublicKey | string): string {
  return `https://explorer.solana.com/address/${address.toString()}?cluster=devnet`;
}

/** intent_hash = sha256(task text). */
export async function intentHash(text: string): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return new Uint8Array(digest);
}

// ---------- vault state ----------

export interface VaultState {
  address: PublicKey;
  owner: PublicKey;
  agent: PublicKey;
  mint: PublicKey;
  perTxMax: bigint;
  dailyCap: bigint;
  allowlist: PublicKey[];
  expiresAt: number;
  /** Raw counter for `dayIndex`. Use `spentToday()` for the current day. */
  spentToday: bigint;
  dayIndex: number;
  revoked: boolean;
}

export async function fetchVault(program: LeashProgram, vault: PublicKey): Promise<VaultState | null> {
  const info = await withRpcRetry(() => program.provider.connection.getAccountInfo(vault, "confirmed"));
  return info ? decodeVault(program, vault, info.data) : null;
}

/** Decodes raw vault account data (e.g. from a batched getMultipleAccountsInfo). */
export function decodeVault(program: LeashProgram, vault: PublicKey, data: Uint8Array): VaultState {
  const v = program.coder.accounts.decode<{
    owner: PublicKey;
    agent: PublicKey;
    mint: PublicKey;
    perTxMax: BN;
    dailyCap: BN;
    allowlist: PublicKey[];
    allowlistLen: number;
    expiresAt: BN;
    spentToday: BN;
    dayIndex: BN;
    revoked: boolean;
  }>("vault", Buffer.from(data));
  return {
    address: vault,
    owner: v.owner,
    agent: v.agent,
    mint: v.mint,
    perTxMax: BigInt(v.perTxMax.toString()),
    dailyCap: BigInt(v.dailyCap.toString()),
    allowlist: v.allowlist.slice(0, v.allowlistLen),
    expiresAt: v.expiresAt.toNumber(),
    spentToday: BigInt(v.spentToday.toString()),
    dayIndex: v.dayIndex.toNumber(),
    revoked: v.revoked,
  };
}

/** Spent in the current UTC day. The program resets the counter on the first payment of a new day. */
export function spentToday(v: VaultState, nowSec = Math.floor(Date.now() / 1000)): bigint {
  return v.dayIndex === Math.floor(nowSec / SECONDS_PER_DAY) ? v.spentToday : 0n;
}

// ---------- instructions ----------

const bn = (x: bigint | number) => new BN(x.toString());

export interface PolicyArgs {
  perTxMax: bigint;
  dailyCap: bigint;
  allowlist: PublicKey[];
  expiresAt: number;
}

export function createVaultIx(
  program: LeashProgram,
  a: { owner: PublicKey; agent: PublicKey; mint: PublicKey; policy: PolicyArgs },
): Promise<TransactionInstruction> {
  const vault = vaultAddress(a.owner, a.agent);
  return program.methods
    .createVault(bn(a.policy.perTxMax), bn(a.policy.dailyCap), a.policy.allowlist, bn(a.policy.expiresAt))
    .accountsPartial({
      owner: a.owner,
      agent: a.agent,
      mint: a.mint,
      vault,
      vaultTokenAccount: vaultTokenAddress(vault, a.mint),
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .instruction();
}

export function depositIx(
  program: LeashProgram,
  a: { depositor: PublicKey; vault: PublicKey; mint: PublicKey; amount: bigint },
): Promise<TransactionInstruction> {
  return program.methods
    .deposit(bn(a.amount))
    .accountsPartial({
      depositor: a.depositor,
      vault: a.vault,
      mint: a.mint,
      depositorTokenAccount: getAssociatedTokenAddressSync(a.mint, a.depositor, true),
      vaultTokenAccount: vaultTokenAddress(a.vault, a.mint),
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .instruction();
}

export function revokeIx(program: LeashProgram, a: { owner: PublicKey; vault: PublicKey }) {
  return program.methods.revoke().accountsPartial({ owner: a.owner, vault: a.vault }).instruction();
}

export function updatePolicyIx(
  program: LeashProgram,
  a: { owner: PublicKey; vault: PublicKey; policy: PolicyArgs },
): Promise<TransactionInstruction> {
  return program.methods
    .updatePolicy(bn(a.policy.perTxMax), bn(a.policy.dailyCap), a.policy.allowlist, bn(a.policy.expiresAt))
    .accountsPartial({ owner: a.owner, vault: a.vault })
    .instruction();
}

export function withdrawIx(
  program: LeashProgram,
  a: { owner: PublicKey; vault: PublicKey; mint: PublicKey; amount: bigint },
): Promise<TransactionInstruction> {
  return program.methods
    .withdraw(bn(a.amount))
    .accountsPartial({
      owner: a.owner,
      vault: a.vault,
      mint: a.mint,
      vaultTokenAccount: vaultTokenAddress(a.vault, a.mint),
      ownerTokenAccount: getAssociatedTokenAddressSync(a.mint, a.owner, true),
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .instruction();
}

export function agentPayIx(
  program: LeashProgram,
  a: {
    agent: PublicKey;
    vault: PublicKey;
    mint: PublicKey;
    recipientTokenAccount: PublicKey;
    amount: bigint;
    intentHash: Uint8Array;
  },
): Promise<TransactionInstruction> {
  return program.methods
    .agentPay(bn(a.amount), Array.from(a.intentHash))
    .accountsPartial({
      agent: a.agent,
      vault: a.vault,
      mint: a.mint,
      vaultTokenAccount: vaultTokenAddress(a.vault, a.mint),
      recipientTokenAccount: a.recipientTokenAccount,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .instruction();
}

// ---------- sending and errors ----------

export interface ProgramErrorInfo {
  /** e.g. "ExceedsPerTxLimit" */
  name: string;
  code?: number;
  message?: string;
}

export interface SendResult {
  signature: string;
  ok: boolean;
  error?: ProgramErrorInfo;
  logs: string[];
}

export const isRateLimited = (e: unknown) =>
  /429|Too many requests|rate limit/i.test(e instanceof Error ? e.message : String(e));

/** Runs an RPC call, waiting 1, 2, 4, 8 s between attempts while the RPC answers 429. */
export async function withRpcRetry<T>(fn: () => Promise<T>, tries = 5): Promise<T> {
  let delay = 1000;
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (!isRateLimited(e) || i >= tries - 1) throw e;
      console.log(`   · devnet RPC is rate-limiting, retrying in ${delay / 1000}s`);
      await new Promise((r) => setTimeout(r, delay));
      delay = Math.min(delay * 2, 8000);
    }
  }
}

const IDL_ERRORS = new Map(idlJson.errors.map((e) => [e.code, e]));

/** SPL Token errors that can surface through agent_pay's transfer (codes below Anchor's 100). */
const TOKEN_ERRORS: Record<number, { name: string; msg: string }> = {
  1: { name: "InsufficientFunds", msg: "the vault does not hold enough USDC" },
  3: { name: "MintMismatch", msg: "account not associated with this mint" },
  4: { name: "OwnerMismatch", msg: "owner does not match" },
  17: { name: "AccountFrozen", msg: "account is frozen" },
};

/** Codes from the Leash program itself: Anchor framework errors (100+) and ours (6000+). */
export const isLeashError = (e: ProgramErrorInfo | undefined) => e?.code !== undefined && e.code >= 100;

/** Turns an on-chain failure into an error name, preferring Anchor's "Error Code: X" log line. */
export function decodeError(err: TransactionError | null, logs: string[]): ProgramErrorInfo {
  for (const line of logs) {
    const m = /Error Code: (\w+)\. Error Number: (\d+)\. Error Message: (.*?)\.?$/.exec(line);
    if (m) return { name: m[1]!, code: Number(m[2]), message: m[3] };
  }
  const custom = (err as { InstructionError?: [number, { Custom?: number }] } | null)?.InstructionError?.[1]
    ?.Custom;
  if (custom !== undefined) {
    const e = IDL_ERRORS.get(custom);
    if (e) return { name: e.name, code: e.code, message: e.msg };
    const t = TOKEN_ERRORS[custom];
    if (t) return { name: t.name, code: custom, message: t.msg };
    return { name: `Custom(${custom})`, code: custom };
  }
  return { name: err ? JSON.stringify(err) : "UnknownError" };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchLogs(connection: Connection, signature: string): Promise<string[]> {
  for (let i = 0; i < 6; i++) {
    const tx = await withRpcRetry(() =>
      connection.getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 }),
    );
    if (tx) return tx.meta?.logMessages ?? [];
    await sleep(1500);
  }
  return [];
}


/**
 * Waits for a transaction by polling its status over HTTP. Returns its error (null when it
 * succeeded). Deliberately no WebSocket: web3.js reconnects its socket in a loop when the
 * public devnet RPC throttles connections, which makes the throttling worse.
 */
export async function confirmSignature(
  connection: Connection,
  signature: string,
  lastValidBlockHeight: number,
  timeoutMs = 90_000,
): Promise<TransactionError | null> {
  const start = Date.now();
  let delay = 700;
  for (let i = 0; Date.now() - start < timeoutMs; i++) {
    try {
      const { value } = await connection.getSignatureStatuses([signature]);
      const status = value[0];
      if (status?.err) return status.err;
      if (status && (status.confirmationStatus === "confirmed" || status.confirmationStatus === "finalized")) return null;
      if (i % 6 === 5 && (await connection.getBlockHeight("confirmed")) > lastValidBlockHeight) {
        throw new Error(`transaction ${signature} expired before it was confirmed`);
      }
      delay = 700;
    } catch (e) {
      if (!isRateLimited(e)) throw e;
      delay = Math.min(delay * 2, 5000); // throttled: back off
    }
    await sleep(delay);
  }
  throw new Error(`transaction ${signature} was not confirmed within ${timeoutMs / 1000}s`);
}

/**
 * Signs, sends and confirms. The first signer pays the fee.
 * With `skipPreflight`, a transaction the program rejects still lands on-chain,
 * so the rejection is visible in the explorer.
 */
export async function sendTx(
  connection: Connection,
  instructions: TransactionInstruction[],
  signers: Signer[],
  opts: { skipPreflight?: boolean } = {},
): Promise<SendResult> {
  const { blockhash, lastValidBlockHeight } = await withRpcRetry(() => connection.getLatestBlockhash("confirmed"));
  const tx = new Transaction({ feePayer: signers[0]!.publicKey, blockhash, lastValidBlockHeight });
  tx.add(...instructions);
  tx.sign(...signers);

  let signature: string;
  try {
    const raw = tx.serialize();
    // Resending the same signed transaction is safe: it can land at most once.
    signature = await withRpcRetry(() =>
      connection.sendRawTransaction(raw, { skipPreflight: opts.skipPreflight ?? false, maxRetries: 5 }),
    );
  } catch (e) {
    if (isRateLimited(e)) throw e;
    // Preflight rejected it: nothing landed on-chain.
    const logs = (e as { logs?: string[] }).logs ?? [];
    return { signature: "", ok: false, error: decodeError(null, logs), logs };
  }

  const err = await confirmSignature(connection, signature, lastValidBlockHeight);
  if (!err) return { signature, ok: true, logs: [] };
  const logs = await fetchLogs(connection, signature);
  return { signature, ok: false, error: decodeError(err, logs), logs };
}
