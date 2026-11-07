// End-to-end check of the dashboard's agent console in a real (headless) Chrome:
// for each preset it clicks the preset, prints the task field, clicks Run and prints the output.
// Uses the vault in LEASH_VAULT; its owner is impersonated by a read-only test wallet.
//
//   npm run e2e                                   all five presets
//   npm run e2e -- "Send \$3 to a stranger"        some of them (button labels)
//   DASHBOARD_URL=http://localhost:3000 PAUSE_MS=20000 npm run e2e
//
// Needs Google Chrome (CHROME_PATH to override) and the dashboard + services running.

import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { PublicKey } from "@solana/web3.js";
import { fetchVault, leashProgram, rpcConnection } from "@leash/sdk";
import { env, getConfig, ROOT } from "@leash/sdk/node";

const ALL = ["Weather + translate", "Send $3 to a stranger", "Send $0.10 to a stranger", "☠ Compromised agent: read the news", "Budget"];

const vaultEnv = env("LEASH_VAULT");
if (!vaultEnv) throw new Error("LEASH_VAULT is empty: create a vault in the dashboard first.");
const vault = await fetchVault(leashProgram(rpcConnection(getConfig().rpcUrl)), new PublicKey(vaultEnv));
if (!vault) throw new Error(`No vault at ${vaultEnv}`);
const labels = process.argv.slice(2).length ? process.argv.slice(2) : ALL;
const res = spawnSync(
  process.execPath,
  [
    resolve(ROOT, "scripts/e2e/cdp.mjs"),
    env("DASHBOARD_URL", "http://localhost:3000"),
    vault.owner.toBase58(),
    JSON.stringify(Array.from(vault.owner.toBytes())),
    "run",
    ...labels,
  ],
  { stdio: "inherit", env: { ...process.env, PAUSE_MS: env("PAUSE_MS", "20000") } },
);
process.exit(res.status ?? 1);
