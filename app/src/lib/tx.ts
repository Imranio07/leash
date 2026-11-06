"use client";

// Sends owner transactions through the connected wallet and turns failures into readable messages.

import { decodeError } from "@leash/sdk";
import type { WalletContextState } from "@solana/wallet-adapter-react";
import { Transaction, type Connection, type TransactionError, type TransactionInstruction } from "@solana/web3.js";

export class TxError extends Error {
  constructor(
    message: string,
    public signature?: string,
  ) {
    super(message);
  }
}

function walletErrorMessage(e: unknown): string {
  const err = e as { message?: string; error?: { logs?: string[] }; logs?: string[] };
  const logs = err.error?.logs ?? err.logs;
  if (logs?.length) {
    const d = decodeError(null, logs);
    if (d.code !== undefined) return `${d.name}: ${d.message ?? ""}`.trim();
  }
  const msg = err.message ?? String(e);
  if (/rejected|cancel|denied/i.test(msg)) return "You rejected the transaction in the wallet.";
  if (/insufficient funds|0x1\b/i.test(msg)) return "Not enough funds for this transaction.";
  return msg;
}

/** Signs with the wallet, sends, waits for confirmation and returns the signature. */
export async function sendOwnerTx(
  connection: Connection,
  wallet: WalletContextState,
  instructions: TransactionInstruction[],
): Promise<string> {
  if (!wallet.publicKey) throw new TxError("Connect a wallet first.");
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  const tx = new Transaction({ feePayer: wallet.publicKey, blockhash, lastValidBlockHeight }).add(...instructions);

  let signature: string;
  try {
    signature = await wallet.sendTransaction(tx, connection, { preflightCommitment: "confirmed" });
  } catch (e) {
    throw new TxError(walletErrorMessage(e));
  }

  let err: TransactionError | null = null;
  try {
    err = (await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed")).value.err;
  } catch (e) {
    // web3.js rejects with the raw TransactionError when it finds the failure by polling.
    if (e instanceof Error) throw new TxError(e.message, signature);
    err = e as TransactionError;
  }
  if (err) {
    const info = await connection.getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
    const d = decodeError(err, info?.meta?.logMessages ?? []);
    throw new TxError(`${d.name}${d.message ? `: ${d.message}` : ""}`, signature);
  }
  return signature;
}
