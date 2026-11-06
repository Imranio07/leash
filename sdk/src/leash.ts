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
import idlJson from "./idl/leash.json" with { type: "json" };
import type { Leash } from "./idl/leash";

export const LEASH_PROGRAM_ID = new PublicKey(idlJson.address);
const VAULT_SEED = new TextEncoder().encode("vault");
const SECONDS_PER_DAY = 86_400;

export type LeashProgram = Program<Leash>;

/** Program client for building instructions and reading accounts (it never signs). */
export function leashProgram(connection: Connection): LeashProgram {
  const provider: Provider = { connection };
  return new Program<Leash>(idlJson as Leash, provider);
}

export function vaultAddress(owner: PublicKey, agent: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [VAULT_SEED, owner.toBytes(), agent.toBytes()],
    LEASH_PROGRAM_ID,
  )[0];
}

/** The vault's token account: the ATA of the vault PDA. */
export function vaultTokenAddress(vault: PublicKey, mint: PublicKey): PublicKey {
  return getAssociatedTokenAddressSync(mint, vault, true);
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
  const v = await program.account.vault.fetchNullable(vault);
  if (!v) return null;
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

const IDL_ERRORS = new Map(idlJson.errors.map((e) => [e.code, e]));

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
    return e ? { name: e.name, code: e.code, message: e.msg } : { name: `Custom(${custom})`, code: custom };
  }
  return { name: err ? JSON.stringify(err) : "UnknownError" };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchLogs(connection: Connection, signature: string): Promise<string[]> {
  for (let i = 0; i < 10; i++) {
    const tx = await connection.getTransaction(signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
    if (tx) return tx.meta?.logMessages ?? [];
    await sleep(1000);
  }
  return [];
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
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  const tx = new Transaction({ feePayer: signers[0]!.publicKey, blockhash, lastValidBlockHeight });
  tx.add(...instructions);
  tx.sign(...signers);

  let signature: string;
  try {
    signature = await connection.sendRawTransaction(tx.serialize(), {
      skipPreflight: opts.skipPreflight ?? false,
      maxRetries: 5,
    });
  } catch (e) {
    // Preflight rejected it: nothing landed on-chain.
    const logs = (e as { logs?: string[] }).logs ?? [];
    return { signature: "", ok: false, error: decodeError(null, logs), logs };
  }

  let err: TransactionError | null;
  try {
    err = (await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed")).value.err;
  } catch (e) {
    // web3.js returns an on-chain failure in `value.err` when it hears it over the websocket,
    // but rejects with the raw TransactionError object when it finds it by polling.
    if (e instanceof Error) throw e;
    err = e as TransactionError;
  }
  if (!err) return { signature, ok: true, logs: [] };
  const logs = await fetchLogs(connection, signature);
  return { signature, ok: false, error: decodeError(err, logs), logs };
}
