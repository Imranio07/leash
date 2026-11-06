// Points the CLI agent (npm run agent / pay / call) at a vault by writing LEASH_VAULT to .env.

import { fetchVault, leashProgram } from "@leash/sdk";
import { writeEnvValue } from "@leash/sdk/node";
import { PublicKey } from "@solana/web3.js";
import { NextResponse } from "next/server";
import { PROGRAM_ID } from "@/lib/config";
import { agentKeypair, errorMessage, jsonError, serverConnection } from "@/lib/server";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { vault?: string };
    let vault: PublicKey;
    try {
      vault = new PublicKey(body.vault ?? "");
    } catch {
      return jsonError(400, "vault must be a base58 public key");
    }
    const connection = serverConnection();
    const state = await fetchVault(leashProgram(connection, PROGRAM_ID), vault);
    if (!state) return jsonError(404, "no vault at this address");
    if (!state.agent.equals(agentKeypair().publicKey)) {
      return jsonError(400, "this vault belongs to a different agent key than keys/agent.json");
    }
    writeEnvValue("LEASH_VAULT", vault.toBase58());
    return NextResponse.json({ ok: true, vault: vault.toBase58() });
  } catch (e) {
    return jsonError(500, errorMessage(e));
  }
}
