// Public keys the dashboard needs: the agent, the service wallets and the demo attacker. No secrets.
// Local: read from the keypair files in keys/. Public site: from env (lib/publicDemo.ts).

import { NextResponse } from "next/server";
import { PUBLIC_DEMO, publicKeysFromEnv } from "@/lib/publicDemo";

export const dynamic = "force-dynamic";

export async function GET() {
  if (PUBLIC_DEMO) {
    const keys = publicKeysFromEnv();
    if (!keys.agent) return NextResponse.json({ error: "NEXT_PUBLIC_AGENT_PUBKEY is not set" }, { status: 500 });
    return NextResponse.json({ ...keys, mint: process.env.NEXT_PUBLIC_USDC_MINT || null });
  }
  const { env, getConfig } = await import("@leash/sdk/node");
  const { agentKeypair, attackerWallet, errorMessage, jsonError, serviceWallets } = await import("@/lib/server");
  try {
    const cfg = getConfig();
    const services = Object.fromEntries(Object.entries(serviceWallets()).map(([k, v]) => [k, v.toBase58()]));
    return NextResponse.json({
      agent: agentKeypair().publicKey.toBase58(),
      services,
      attacker: attackerWallet().toBase58(),
      mint: cfg.mint?.toBase58() ?? null,
      cliVault: env("LEASH_VAULT") || null,
    });
  } catch (e) {
    return jsonError(500, `${errorMessage(e)} (run "npm run setup" in the repo first)`);
  }
}
