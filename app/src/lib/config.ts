// Client-side configuration. Values are inlined at build time from NEXT_PUBLIC_* (see next.config.ts).

import { LEASH_PROGRAM_ID } from "@leash/sdk";
import { PublicKey } from "@solana/web3.js";

export const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL || "https://api.devnet.solana.com";
export const PROGRAM_ID = process.env.NEXT_PUBLIC_PROGRAM_ID
  ? new PublicKey(process.env.NEXT_PUBLIC_PROGRAM_ID)
  : LEASH_PROGRAM_ID;
/** null until `npm run setup` has created a mint (or NEXT_PUBLIC_USDC_MINT is set). */
export const USDC_MINT = process.env.NEXT_PUBLIC_USDC_MINT ? new PublicKey(process.env.NEXT_PUBLIC_USDC_MINT) : null;
export const SERVICES_URL = process.env.NEXT_PUBLIC_SERVICES_URL || "http://localhost:4021";

export const DEVNET_GENESIS_HASH = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
export const CIRCLE_DEVNET_USDC = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";

/** How often the dashboard re-reads the chain. */
export const POLL_MS = 4000;

export const short = (key: PublicKey | string, n = 4) => {
  const s = key.toString();
  return `${s.slice(0, n)}…${s.slice(-n)}`;
};
