// Server-only helpers for the API routes. Never import this from a client component:
// it reads keypair files from keys/ and the owner key named in .env.

import { getConfig, loadKeypair, SERVICE_KEY_PATHS } from "@leash/sdk/node";
import { Connection, type Keypair, type PublicKey } from "@solana/web3.js";
import { NextResponse } from "next/server";
import { DEVNET_GENESIS_HASH } from "./config";

export const serverConnection = () => new Connection(getConfig().rpcUrl, "confirmed");

export function jsonError(status: number, error: string) {
  return NextResponse.json({ error }, { status });
}

/** The agent key from keys/agent.json. Only its public key ever leaves the server. */
export function agentKeypair(): Keypair {
  return loadKeypair(getConfig().agentKeypairPath);
}

/** Receiving wallets of the two paid services, if their keys exist. */
export function serviceWallets(): Record<string, PublicKey> {
  const out: Record<string, PublicKey> = {};
  for (const [name, path] of Object.entries(SERVICE_KEY_PATHS)) {
    try {
      out[name] = loadKeypair(path).publicKey;
    } catch {
      // Service key not created yet.
    }
  }
  return out;
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
