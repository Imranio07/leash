// Local dashboard faucet: mints test USDC to a wallet. Devnet only, and only for our own test
// mint (the owner key from .env is its mint authority). Circle USDC has its own faucet.
// Server-only: reads keypair files.

import { explorerTx, parseUsdc, sendTx } from "@leash/sdk";
import { getConfig, loadKeypair } from "@leash/sdk/node";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createMintToInstruction,
  getAssociatedTokenAddressSync,
  getMint,
} from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { NextResponse } from "next/server";
import { assertDevnet, errorMessage, jsonError, serverConnection } from "@/lib/server";

const AMOUNT = parseUsdc("20");
const COOLDOWN_MS = 15_000;
const lastDrip = new Map<string, number>();

export async function localFaucet(req: Request) {
  try {
    const body = (await req.json()) as { wallet?: string };
    let wallet: PublicKey;
    try {
      wallet = new PublicKey(body.wallet ?? "");
    } catch {
      return jsonError(400, "wallet must be a base58 public key");
    }
    const cfg = getConfig();
    if (!cfg.mint) return jsonError(400, 'No USDC mint configured. Run "npm run setup" first.');

    const connection = serverConnection();
    try {
      await assertDevnet(connection);
    } catch (e) {
      return jsonError(403, errorMessage(e));
    }
    const owner = loadKeypair(cfg.ownerKeypairPath);
    const mintInfo = await getMint(connection, cfg.mint);
    if (!mintInfo.mintAuthority?.equals(owner.publicKey)) {
      return jsonError(400, "This mint is not the Leash test mint, so the dashboard cannot mint it. Use the Circle faucet.");
    }

    const key = wallet.toBase58();
    const last = lastDrip.get(key) ?? 0;
    if (Date.now() - last < COOLDOWN_MS) return jsonError(429, "Please wait a few seconds between drips.");
    lastDrip.set(key, Date.now());

    const ata = getAssociatedTokenAddressSync(cfg.mint, wallet, true);
    const res = await sendTx(
      connection,
      [
        createAssociatedTokenAccountIdempotentInstruction(owner.publicKey, ata, wallet, cfg.mint),
        createMintToInstruction(cfg.mint, ata, owner.publicKey, AMOUNT),
      ],
      [owner],
    );
    if (!res.ok) return jsonError(500, `Mint failed: ${res.error?.name ?? "unknown error"}`);
    return NextResponse.json({ signature: res.signature, explorer: explorerTx(res.signature), amount: AMOUNT.toString() });
  } catch (e) {
    return jsonError(500, errorMessage(e));
  }
}
