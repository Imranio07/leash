// Server-only helpers for the API routes. Never import this from a client component:
// it reads keypair files from keys/ and the owner key named in .env.

import { ATTACKER_KEY_PATH, getConfig, loadKeypair, loadOrCreateKeypair, SERVICE_KEY_PATHS } from "@leash/sdk/node";
import { Connection, type Keypair, type PublicKey } from "@solana/web3.js";
import { NextResponse } from "next/server";
import { rpcConnection } from "@leash/sdk";
import { DEVNET_GENESIS_HASH } from "./config";

let connection: Connection | null = null;
/** One shared connection (one keep-alive pool), without web3.js's own 429 retries. */
export const serverConnection = () => (connection ??= rpcConnection(getConfig().rpcUrl));

export function jsonError(status: number, error: string) {
  return NextResponse.json({ error }, { status });
}

/** The agent key from keys/agent.json. Only its public key ever leaves the server. */
export function agentKeypair(): Keypair {
  return loadKeypair(getConfig().agentKeypairPath);
}

/** Receiving wallets of the paid services (created on first use; they are demo wallets). */
export function serviceWallets(): Record<string, PublicKey> {
  return Object.fromEntries(Object.entries(SERVICE_KEY_PATHS).map(([name, path]) => [name, loadOrCreateKeypair(path).publicKey]));
}

/** The wallet the malicious news article asks the agent to pay. Never allowlisted. */
export function attackerWallet(): PublicKey {
  return loadOrCreateKeypair(ATTACKER_KEY_PATH).publicKey;
}

let genesisCache: string | null = null;

/** Throws unless the RPC is devnet. Guards the routes that sign with the owner key. */
export async function assertDevnet(connection: Connection): Promise<void> {
  genesisCache ??= await connection.getGenesisHash();
  if (genesisCache !== DEVNET_GENESIS_HASH) throw new Error("This action is only allowed on devnet");
}

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
