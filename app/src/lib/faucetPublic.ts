// Public-site faucet: sends test USDC from a dedicated faucet wallet (FAUCET_SECRET_KEY, a
// JSON array of 64 bytes, set only in the hosting env). It is not the mint authority and not
// the program's upgrade authority: a leak can only lose the test USDC and SOL it holds.
//
// Rate limit without a database: every drip carries a memo with the wallet, and the faucet's
// own recent transactions (one RPC call) show who got USDC in the last 10 minutes.

import { explorerTx, parseUsdc, rpcConnection, sendTx } from "@leash/sdk";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { Keypair, LAMPORTS_PER_SOL, PublicKey, TransactionInstruction, type Connection } from "@solana/web3.js";
import { NextResponse } from "next/server";
import { DEVNET_GENESIS_HASH } from "./config";
import { PUBLIC_FAUCET_AMOUNT_USDC, PUBLIC_FAUCET_COOLDOWN_MIN } from "./publicDemo";

const AMOUNT = parseUsdc(PUBLIC_FAUCET_AMOUNT_USDC);
const DECIMALS = 6; // our test USDC, like USDC
const COOLDOWN_SEC = PUBLIC_FAUCET_COOLDOWN_MIN * 60;
/** All wallets together: at most this many drips per cooldown window. */
const GLOBAL_MAX_PER_WINDOW = 30;
const MEMO_PROGRAM_ID = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
const MEMO_PREFIX = "leash-faucet";

/** Requests in flight on this instance (the on-chain check cannot see them yet). */
const inFlight = new Set<string>();
let connection: Connection | null = null;
let genesisOk = false;

const fail = (status: number, error: string) => NextResponse.json({ error }, { status });

function faucetKeypair(): Keypair | null {
  const raw = process.env.FAUCET_SECRET_KEY?.trim();
  if (!raw) return null;
  try {
    return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw) as number[]));
  } catch {
    return null;
  }
}

export async function publicFaucet(req: Request): Promise<Response> {
  let wallet: PublicKey;
  try {
    const body = (await req.json()) as { wallet?: string };
    wallet = new PublicKey(body.wallet ?? "");
    if (!PublicKey.isOnCurve(wallet.toBytes())) throw new Error("off curve");
  } catch {
    return fail(400, "wallet must be a regular wallet address (base58)");
  }
  const mintStr = process.env.NEXT_PUBLIC_USDC_MINT;
  const faucet = faucetKeypair();
  if (!mintStr || !faucet) return fail(503, "The faucet is not configured on this site.");
  const mint = new PublicKey(mintStr);

  const key = wallet.toBase58();
  if (inFlight.has(key)) return fail(429, "A request for this wallet is already in progress.");
  inFlight.add(key);
  try {
    connection ??= rpcConnection(process.env.RPC_URL?.trim() || "https://api.devnet.solana.com");
    if (!genesisOk) {
      if ((await connection.getGenesisHash()) !== DEVNET_GENESIS_HASH) return fail(403, "The faucet only runs on devnet.");
      genesisOk = true;
    }

    // Who got USDC from the faucet recently?
    const now = Math.floor(Date.now() / 1000);
    const recent = (await connection.getSignaturesForAddress(faucet.publicKey, { limit: 100 }, "confirmed")).filter(
      (s) => !s.err && s.memo?.includes(MEMO_PREFIX) && (s.blockTime ?? now) > now - COOLDOWN_SEC,
    );
    const mine = recent.find((s) => s.memo?.includes(key));
    if (mine) {
      const wait = Math.max(1, Math.ceil(((mine.blockTime ?? now) + COOLDOWN_SEC - now) / 60));
      return fail(429, `This wallet already got test USDC. Try again in ${wait} min.`);
    }
    if (recent.length >= GLOBAL_MAX_PER_WINDOW) return fail(429, "The faucet is busy. Try again in a few minutes.");

    const source = getAssociatedTokenAddressSync(mint, faucet.publicKey);
    const target = getAssociatedTokenAddressSync(mint, wallet);
    const [faucetInfo, sourceBalance] = await Promise.all([
      connection.getAccountInfo(faucet.publicKey, "confirmed"),
      connection.getTokenAccountBalance(source, "confirmed").catch(() => null),
    ]);
    if ((faucetInfo?.lamports ?? 0) < 0.01 * LAMPORTS_PER_SOL || BigInt(sourceBalance?.value.amount ?? "0") < AMOUNT) {
      return fail(503, "The faucet is empty. Please tell the Leash team.");
    }

    const res = await sendTx(
      connection,
      [
        createAssociatedTokenAccountIdempotentInstruction(faucet.publicKey, target, wallet, mint),
        createTransferCheckedInstruction(source, mint, target, faucet.publicKey, AMOUNT, DECIMALS),
        new TransactionInstruction({ programId: MEMO_PROGRAM_ID, keys: [], data: Buffer.from(`${MEMO_PREFIX} ${key}`, "utf8") }),
      ],
      [faucet],
    );
    if (!res.ok) return fail(500, `Transfer failed: ${res.error?.name ?? "unknown error"}`);
    return NextResponse.json({ signature: res.signature, explorer: explorerTx(res.signature), amount: AMOUNT.toString() });
  } catch (e) {
    return fail(500, e instanceof Error ? e.message : String(e));
  } finally {
    inFlight.delete(key);
  }
}
