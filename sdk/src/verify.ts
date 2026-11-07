// Server-side check that a transaction really paid us through Leash.

import { Connection, PublicKey } from "@solana/web3.js";
import { isRateLimited, LEASH_PROGRAM_ID, withRpcRetry } from "./leash";

export interface PaymentRequirement {
  mint: PublicKey;
  /** Recipient wallet (owner of the receiving token account). */
  recipient: PublicKey;
  /** Minimum amount in base units. */
  price: bigint;
  /** Reject payments older than this. Guards replays after a restart wipes the used-signature set. */
  maxAgeSec?: number;
}

export type VerifyResult = { ok: true; received: bigint } | { ok: false; reason: string };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Checks that `signature` is a confirmed, successful transaction that invokes the
 * Leash program and moves at least `price` of `mint` to a token account owned by `recipient`.
 * Replay protection (signature not used before) is the caller's job.
 */
export async function verifyPayment(
  connection: Connection,
  signature: string,
  req: PaymentRequirement,
): Promise<VerifyResult> {
  let tx = null;
  try {
    for (let i = 0; i < 8 && !tx; i++) {
      tx = await withRpcRetry(() =>
        connection.getParsedTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 }),
      );
      if (!tx) await sleep(1000);
    }
  } catch (e) {
    if (isRateLimited(e)) return { ok: false, reason: "the Solana RPC is rate-limiting, try again" };
    return { ok: false, reason: "invalid transaction signature" };
  }
  if (!tx?.meta) return { ok: false, reason: "transaction not found or not confirmed" };
  if (tx.meta.err) return { ok: false, reason: "transaction failed on-chain" };

  const invokesLeash = tx.transaction.message.instructions.some((ix) => ix.programId.equals(LEASH_PROGRAM_ID));
  if (!invokesLeash) return { ok: false, reason: "transaction does not invoke the Leash program" };

  const maxAge = req.maxAgeSec ?? 600;
  if (tx.blockTime && Date.now() / 1000 - tx.blockTime > maxAge) {
    return { ok: false, reason: "payment is too old" };
  }

  const mint = req.mint.toBase58();
  const owner = req.recipient.toBase58();
  let received = 0n;
  for (const post of tx.meta.postTokenBalances ?? []) {
    if (post.mint !== mint || post.owner !== owner) continue;
    const pre = tx.meta.preTokenBalances?.find((b) => b.accountIndex === post.accountIndex);
    received += BigInt(post.uiTokenAmount.amount) - BigInt(pre?.uiTokenAmount.amount ?? "0");
  }
  if (received < req.price) {
    return { ok: false, reason: `received ${received} base units, price is ${req.price}` };
  }
  return { ok: true, received };
}
