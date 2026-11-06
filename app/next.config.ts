import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { NextConfig } from "next";

const repoRoot = path.join(__dirname, "..");

/** Values from the repo-level .env (written by `npm run setup`), used unless NEXT_PUBLIC_* overrides them. */
function rootEnv(): Record<string, string> {
  const file = path.join(repoRoot, ".env");
  if (!existsSync(file)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m?.[1] && m[2] !== undefined) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}
const env = rootEnv();
const idl = JSON.parse(readFileSync(path.join(repoRoot, "sdk/src/idl/leash.json"), "utf8")) as { address: string };

const config: NextConfig = {
  transpilePackages: ["@leash/sdk"],
  turbopack: { root: repoRoot },
  outputFileTracingRoot: repoRoot,
  env: {
    NEXT_PUBLIC_RPC_URL: process.env.NEXT_PUBLIC_RPC_URL ?? env.RPC_URL ?? "https://api.devnet.solana.com",
    NEXT_PUBLIC_PROGRAM_ID: process.env.NEXT_PUBLIC_PROGRAM_ID ?? idl.address,
    NEXT_PUBLIC_USDC_MINT: process.env.NEXT_PUBLIC_USDC_MINT ?? env.USDC_MINT ?? "",
    NEXT_PUBLIC_SERVICES_URL: process.env.NEXT_PUBLIC_SERVICES_URL ?? env.SERVICES_URL ?? "http://localhost:4021",
  },
};

export default config;
