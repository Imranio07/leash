// Turns confirmed transactions that touch a vault into activity-log entries.
// Browser-safe; used by the dashboard. The chain is the only source of truth here.

import { BorshInstructionCoder } from "@anchor-lang/core";
import type { ParsedTransactionWithMeta, PartiallyDecodedInstruction, PublicKey } from "@solana/web3.js";
import { decodeError, type LeashProgram } from "./leash";
import { formatUsdc } from "./money";

export type ActivityKind = "agent_pay" | "create_vault" | "deposit" | "update_policy" | "revoke" | "withdraw" | "other";

export interface ActivityEntry {
  /** Transaction signature, with "#<index>" appended when one transaction yields several rows. */
  signature: string;
  /** Unix seconds; null when the RPC has no block time yet. */
  time: number | null;
  slot: number;
  kind: ActivityKind;
  ok: boolean;
  /** Leash error name for rejected transactions, e.g. "ExceedsPerTxLimit". */
  error?: string;
  /** Base units, for payments, deposits and withdrawals. */
  amount?: bigint;
  /** Recipient wallet for payments (token account owner when the wallet is unknown). */
  recipient?: string;
  intentHash?: string;
  /** Spent today after this payment (from the PaymentEvent). */
  spentToday?: bigint;
  /** Who signed: the agent for payments, the owner or depositor otherwise. */
  signer?: string;
}

const KIND_BY_IX: Record<string, ActivityKind> = {
  agentPay: "agent_pay",
  createVault: "create_vault",
  deposit: "deposit",
  updatePolicy: "update_policy",
  revoke: "revoke",
  withdraw: "withdraw",
};

const toHex = (bytes: number[] | Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

interface DecodedIx {
  name: string;
  data: Record<string, unknown>;
}

// The generic coder only exposes encode; the Borsh one can decode instruction data.
const ixCoders = new WeakMap<LeashProgram, BorshInstructionCoder>();
function instructionCoder(program: LeashProgram): BorshInstructionCoder {
  let coder = ixCoders.get(program);
  if (!coder) {
    coder = new BorshInstructionCoder(program.idl);
    ixCoders.set(program, coder);
  }
  return coder;
}

/**
 * When a payment is rejected, the recipient's token account may not exist (its creation in
 * the same transaction was rolled back), so there is no token balance naming the wallet.
 * The agent creates the account with the Associated Token program, whose parsed
 * instruction does name it.
 */
function walletFromAtaCreation(instructions: ParsedTransactionWithMeta["transaction"]["message"]["instructions"], tokenAccount: PublicKey): string | undefined {
  for (const ix of instructions) {
    if (!("parsed" in ix)) continue;
    const parsed = ix.parsed as { type?: string; info?: { account?: string; wallet?: string } } | undefined;
    if (parsed?.type?.startsWith("create") && parsed.info?.account === tokenAccount.toBase58()) return parsed.info.wallet;
  }
  return undefined;
}

/**
 * Decodes one transaction into activity entries, one per Leash instruction
 * (a create + deposit transaction gives two). Empty when Leash is not invoked.
 * A failed transaction gives a single entry for the instruction that failed.
 */
export function decodeActivity(program: LeashProgram, tx: ParsedTransactionWithMeta): ActivityEntry[] {
  const programId = program.programId;
  const message = tx.transaction.message;
  const leashIxs = message.instructions
    .map((ix, index) => ({ ix, index }))
    .filter((x): x is { ix: PartiallyDecodedInstruction; index: number } => x.ix.programId.equals(programId) && "data" in x.ix);
  if (!leashIxs.length) return [];

  const ok = !tx.meta?.err;
  const logs = tx.meta?.logMessages ?? [];
  const signer = message.accountKeys.find((k) => k.signer)?.pubkey.toBase58();

  // Which instruction failed, so the error is attached to the right row.
  let failedIndex: number | null = null;
  if (!ok) {
    const err = tx.meta?.err as { InstructionError?: [number, unknown] } | null;
    failedIndex = err?.InstructionError?.[0] ?? null;
  }
  const chosen = ok ? leashIxs : [leashIxs.find((x) => x.index === failedIndex) ?? leashIxs[0]!];

  const entries = chosen.map(({ ix, index }) => {
    const entry: ActivityEntry = {
      signature: `${tx.transaction.signatures[0]!}${chosen.length > 1 ? `#${index}` : ""}`,
      time: tx.blockTime ?? null,
      slot: tx.slot,
      kind: "other",
      ok,
      signer,
    };
    let decoded: DecodedIx | null = null;
    try {
      decoded = instructionCoder(program).decode(ix.data, "base58") as DecodedIx | null;
    } catch {
      // Unknown instruction layout (e.g. an older program version): keep kind "other".
    }
    if (decoded) {
      entry.kind = KIND_BY_IX[decoded.name] ?? "other";
      const amount = decoded.data.amount as { toString(): string } | undefined;
      if (amount !== undefined) entry.amount = BigInt(amount.toString());
      const hash = decoded.data.intentHash as number[] | undefined;
      if (hash) entry.intentHash = toHex(hash);
    }
    if (entry.kind === "agent_pay") {
      // The recipient wallet is the owner of the 5th account (recipient_token_account).
      const tokenAccount = ix.accounts[4];
      if (tokenAccount) {
        const accountIndex = message.accountKeys.findIndex((k) => k.pubkey.equals(tokenAccount));
        const balance = tx.meta?.postTokenBalances?.find((b) => b.accountIndex === accountIndex);
        entry.recipient = balance?.owner ?? walletFromAtaCreation(message.instructions, tokenAccount) ?? tokenAccount.toBase58();
      }
    }
    if (!ok) entry.error = decodeError(tx.meta?.err ?? null, logs).name;
    return entry;
  });

  // PaymentEvents carry the authoritative recipient wallet and the running total,
  // one per successful agent_pay, in order.
  if (ok) {
    const payments = entries.filter((e) => e.kind === "agent_pay");
    let i = 0;
    for (const line of logs) {
      if (!line.startsWith("Program data: ")) continue;
      try {
        const event = program.coder.events.decode(line.slice("Program data: ".length)) as {
          name: string;
          data: Record<string, unknown>;
        } | null;
        // Anchor's TS coder camel-cases event names ("paymentEvent").
        if (event?.name.toLowerCase() !== "paymentevent") continue;
        const target = payments[i++];
        if (!target) break;
        const d = event.data as {
          recipient: PublicKey;
          amount: { toString(): string };
          intentHash: number[];
          spentToday: { toString(): string };
        };
        target.recipient = d.recipient.toBase58();
        target.amount = BigInt(d.amount.toString());
        target.intentHash = toHex(d.intentHash);
        target.spentToday = BigInt(d.spentToday.toString());
      } catch {
        // Not one of our events.
      }
    }
  }
  return entries;
}

/** One-line description for logs and UIs. */
export function describeActivity(e: ActivityEntry): string {
  const amount = e.amount !== undefined ? formatUsdc(e.amount) : "";
  switch (e.kind) {
    case "agent_pay":
      return e.ok ? `Agent paid ${amount}` : `Agent payment of ${amount} rejected`;
    case "create_vault":
      return "Vault created";
    case "deposit":
      return `Deposit ${amount}`;
    case "withdraw":
      return `Withdraw ${amount}`;
    case "update_policy":
      return "Policy updated";
    case "revoke":
      return "Vault revoked";
    default:
      return "Leash transaction";
  }
}
