// Public (hosted) mode, e.g. on Vercel: the site runs without the local repo, keypair files,
// LLM keys or paid services. Owner actions work through Phantom; the agent console is off.
// Enabled with NEXT_PUBLIC_LEASH_PUBLIC_DEMO=1. Safe to import from client and server code.

export const PUBLIC_DEMO = process.env.NEXT_PUBLIC_LEASH_PUBLIC_DEMO === "1";

/** The vault from the demo video, linked from the top of the page. */
export const DEMO_VAULT = process.env.NEXT_PUBLIC_DEMO_VAULT || "";

export const DEMO_VIDEO_URL = "https://youtu.be/y5pidHukmPo";
export const REPO_URL = "https://github.com/Imranio07/leash";

/** Test USDC sent per faucet request on the public site, and how often a wallet may ask. */
export const PUBLIC_FAUCET_AMOUNT_USDC = "20";
export const PUBLIC_FAUCET_COOLDOWN_MIN = 10;

/** The public keys the dashboard needs, from env (same shape as GET /api/keys). No secrets. */
export function publicKeysFromEnv() {
  const services = Object.fromEntries(
    (process.env.NEXT_PUBLIC_SERVICE_WALLETS || "")
      .split(",")
      .map((pair) => pair.trim().split(":"))
      .filter((p): p is [string, string] => p.length === 2 && !!p[0] && !!p[1]),
  );
  return {
    agent: process.env.NEXT_PUBLIC_AGENT_PUBKEY || "",
    services,
    attacker: process.env.NEXT_PUBLIC_ATTACKER_PUBKEY || "",
    cliVault: null,
  };
}
