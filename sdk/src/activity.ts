// Turns confirmed transactions that touch a vault into activity-log entries.
// Browser-safe; used by the dashboard. The chain is the only source of truth here.

import { BorshInstructionCoder } from "@anchor-lang/core";
import type { ParsedTransactionWithMeta, PartiallyDecodedInstruction, PublicKey } from "@solana/web3.js";
import { decodeError, type LeashProgram } from "./leash";
import { formatUsdc } from "./money";

export type ActivityKind = "agent_pay" | "create_vault" | "deposit" | "update_policy" | "revoke" | "withdraw" | "other";

export interface ActivityEntry {
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

/** Decodes one transaction. Returns null when it does not invoke the Leash program. */
export function decodeActivity(program: LeashProgram, tx: ParsedTransactionWithMeta): ActivityEntry | null {
  const programId = program.programId;
  const message = tx.transaction.message;
  const ix = message.instructions.find(
    (i): i is PartiallyDecodedInstruction => i.programId.equals(programId) && "data" in i,
  );
  if (!ix) return null;

  const entry: ActivityEntry = {
    signature: tx.transaction.signatures[0]!,
    time: tx.blockTime ?? null,
    slot: tx.slot,
    kind: "other",
    ok: !tx.meta?.err,
    signer: message.accountKeys.find((k) => k.signer)?.pubkey.toBase58(),
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
      const index = message.accountKeys.findIndex((k) => k.pubkey.equals(tokenAccount));
      const balance = tx.meta?.postTokenBalances?.find((b) => b.accountIndex === index);
      entry.recipient = balance?.owner ?? tokenAccount.toBase58();
    }
  }

  const logs = tx.meta?.logMessages ?? [];
  if (!entry.ok) {
    entry.error = decodeError(tx.meta?.err ?? null, logs).name;
    return entry;
  }

  // PaymentEvent carries the authoritative recipient wallet and the running total.
  for (const line of logs) {
    const data = line.startsWith("Program data: ") ? line.slice("Program data: ".length) : null;
    if (!data) continue;
    try {
      const event = program.coder.events.decode(data) as { name: string; data: Record<string, unknown> } | null;
      if (event?.name !== "PaymentEvent") continue;
      const d = event.data as {
        recipient: PublicKey;
        amount: { toString(): string };
        intentHash: number[];
        spentToday: { toString(): string };
      };
      entry.recipient = d.recipient.toBase58();
      entry.amount = BigInt(d.amount.toString());
      entry.intentHash = toHex(d.intentHash);
      entry.spentToday = BigInt(d.spentToday.toString());
    } catch {
      // Not one of our events.
    }
  }
  return entry;
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
