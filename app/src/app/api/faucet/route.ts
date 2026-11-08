// Test-USDC faucet. The local dashboard mints with the owner key from .env; the public site
// sends from a dedicated faucet wallet (see lib/faucetPublic.ts).

import { PUBLIC_DEMO } from "@/lib/publicDemo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  if (PUBLIC_DEMO) return (await import("@/lib/faucetPublic")).publicFaucet(req);
  return (await import("@/lib/faucetLocal")).localFaucet(req);
}
