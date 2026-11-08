// Prepares the public (Vercel) dashboard: creates and funds the faucet wallet keys/faucet.json
// (devnet SOL for fees and token-account rent, test USDC to hand out), then writes every env
// variable the site needs to keys/vercel.env (gitignored), ready for Vercel's "Import .env".
// Prints only public values. Devnet only.
//
//   npm run vercel-env

import { writeFileSync } from "node:fs";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createMintToInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { LAMPORTS_PER_SOL, SystemProgram } from "@solana/web3.js";
import { formatUsdc, parseUsdc, rpcConnection, sendTx, explorerTx } from "@leash/sdk";
import {
  ATTACKER_KEY_PATH,
  env,
  getConfig,
  loadKeypair,
  loadOrCreateKeypair,
  resolvePath,
  SERVICE_KEY_PATHS,
} from "@leash/sdk/node";

const DEVNET_GENESIS_HASH = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
const FAUCET_PATH = resolvePath("keys/faucet.json");
const OUT_PATH = resolvePath("keys/vercel.env");
const TARGET_SOL = 1;
const TARGET_USDC = parseUsdc("5000");
/** The vault from the demo video, linked from the public site. */
const DEMO_VAULT = process.argv[2] ?? "9chWTKp9ud2CWUXSKE5UAQSCr5KmTgQQhVLPzhgmN2Jj";

const cfg = getConfig();
if (!cfg.mint) throw new Error('No USDC_MINT in .env. Run "npm run setup" first.');
const connection = rpcConnection(cfg.rpcUrl);
if ((await connection.getGenesisHash()) !== DEVNET_GENESIS_HASH) throw new Error("RPC_URL is not devnet");

const owner = loadKeypair(cfg.ownerKeypairPath);
const faucet = loadOrCreateKeypair(FAUCET_PATH);
const faucetAta = getAssociatedTokenAddressSync(cfg.mint, faucet.publicKey);
console.log(`faucet wallet  ${faucet.publicKey.toBase58()}  (${FAUCET_PATH})`);

const lamports = await connection.getBalance(faucet.publicKey, "confirmed");
const usdc = BigInt((await connection.getTokenAccountBalance(faucetAta, "confirmed").catch(() => null))?.value.amount ?? "0");
const ixs = [];
if (lamports < (TARGET_SOL / 2) * LAMPORTS_PER_SOL) {
  ixs.push(SystemProgram.transfer({ fromPubkey: owner.publicKey, toPubkey: faucet.publicKey, lamports: TARGET_SOL * LAMPORTS_PER_SOL - lamports }));
}
if (usdc < TARGET_USDC / 2n) {
  ixs.push(createAssociatedTokenAccountIdempotentInstruction(owner.publicKey, faucetAta, faucet.publicKey, cfg.mint));
  ixs.push(createMintToInstruction(cfg.mint, faucetAta, owner.publicKey, TARGET_USDC - usdc));
}
if (ixs.length) {
  const res = await sendTx(connection, ixs, [owner]);
  if (!res.ok) throw new Error(`Funding failed: ${res.error?.name ?? "unknown"}`);
  console.log(`funded         ${explorerTx(res.signature)}`);
}
const solNow = (await connection.getBalance(faucet.publicKey, "confirmed")) / LAMPORTS_PER_SOL;
const usdcNow = (await connection.getTokenAccountBalance(faucetAta, "confirmed")).value.amount;
console.log(`faucet holds   ${solNow} SOL, ${formatUsdc(usdcNow)} test USDC`);

const services = Object.entries(SERVICE_KEY_PATHS)
  .map(([name, path]) => `${name}:${loadKeypair(path).publicKey.toBase58()}`)
  .join(",");
const publicVars: Record<string, string> = {
  NEXT_PUBLIC_LEASH_PUBLIC_DEMO: "1",
  NEXT_PUBLIC_USDC_MINT: cfg.mint.toBase58(),
  NEXT_PUBLIC_AGENT_PUBKEY: loadKeypair(cfg.agentKeypairPath).publicKey.toBase58(),
  NEXT_PUBLIC_SERVICE_WALLETS: services,
  NEXT_PUBLIC_ATTACKER_PUBKEY: loadKeypair(ATTACKER_KEY_PATH).publicKey.toBase58(),
  NEXT_PUBLIC_DEMO_VAULT: DEMO_VAULT,
};
const secretVars: Record<string, string> = {
  // Server only: the RPC proxy and the faucet use it; the browser never sees it.
  RPC_URL: env("RPC_URL", "https://api.devnet.solana.com"),
  FAUCET_SECRET_KEY: JSON.stringify(Array.from(faucet.secretKey)),
};

const lines = [
  "# Leash public dashboard (Vercel). SECRET: contains the faucet key and the RPC URL. Do not commit or share.",
  ...Object.entries({ ...publicVars, ...secretVars }).map(([k, v]) => `${k}=${v}`),
  "",
];
writeFileSync(OUT_PATH, lines.join("\n"), { mode: 0o600 });

console.log(`\nwrote ${OUT_PATH} (${Object.keys(publicVars).length + Object.keys(secretVars).length} variables)`);
console.log("public values:");
for (const [k, v] of Object.entries(publicVars)) console.log(`  ${k}=${v}`);
console.log(`secret values (not printed): ${Object.keys(secretVars).join(", ")}`);
