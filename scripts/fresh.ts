// Prepares a fresh agent so you can create a new vault from the dashboard (Phantom = owner).
// Nothing to edit by hand and no restarts: the dashboard picks up the new agent within seconds,
// and creating the vault there points the CLI agent at it (LEASH_VAULT).
//
//   npm run fresh
//   npm run fresh -- --force    even if the current vault still holds USDC
//
// What it does, as OWNER_KEYPAIR (id.json) pays the small setup costs:
// - archives keys/agent.json and creates a new agent key;
// - makes sure the service wallets (weather, translate, news) and the demo attacker exist,
//   with token accounts for the USDC mint;
// - sends the agent 0.05 SOL for transaction fees (it never holds USDC);
// - clears LEASH_VAULT, since the old vault belongs to the old agent.

import { existsSync, renameSync } from "node:fs";
import { getAccount } from "@solana/spl-token";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { fetchVault, formatUsdc, leashProgram, vaultTokenAddress } from "@leash/sdk";
import { env, getConfig, loadKeypair, saveKeypair, writeEnvValue } from "@leash/sdk/node";
import { attackerWallet, ensureMint, ensureServiceAccounts, fundAgentFees, serviceKeys } from "./lib";

async function main() {
  const cfg = getConfig();
  const connection = new Connection(cfg.rpcUrl, "confirmed");
  const owner = loadKeypair(cfg.ownerKeypairPath);
  const sol = await connection.getBalance(owner.publicKey);
  if (sol < 0.1 * LAMPORTS_PER_SOL) throw new Error(`${owner.publicKey.toBase58()} needs at least 0.1 devnet SOL (solana airdrop 1)`);

  const { mint } = await ensureMint(connection, owner, cfg.mint, 0n);

  // The dashboard only shows the vault of the current agent, so don't strand money in the old one.
  const current = env("LEASH_VAULT");
  if (current && !process.argv.includes("--force")) {
    const state = await fetchVault(leashProgram(connection), new PublicKey(current));
    if (state) {
      const balance = await getAccount(connection, vaultTokenAddress(state.address, state.mint))
        .then((a) => a.amount)
        .catch(() => 0n);
      if (balance > 0n) {
        const how = state.owner.equals(owner.publicKey)
          ? '"npm run owner -- withdraw all"'
          : "the dashboard with the owner's wallet (Withdraw → Withdraw all)";
        throw new Error(
          `the current vault ${current} still holds ${formatUsdc(balance)}. Withdraw it first with ${how}, ` +
            `or run "npm run fresh -- --force" to leave it there.`,
        );
      }
    }
  }

  if (existsSync(cfg.agentKeypairPath)) {
    const archived = cfg.agentKeypairPath.replace(/\.json$/, `-${Date.now()}.json`);
    renameSync(cfg.agentKeypairPath, archived);
    console.log(`Old agent key archived: ${archived}`);
  }
  const agent = Keypair.generate();
  saveKeypair(cfg.agentKeypairPath, agent);
  console.log(`New agent  ${agent.publicKey.toBase58()}`);

  const services = serviceKeys();
  const attacker = attackerWallet();
  await ensureServiceAccounts(connection, owner, mint, Object.values(services).map((k) => k.publicKey));
  for (const [name, kp] of Object.entries(services)) console.log(`Service    ${name.padEnd(9)} ${kp.publicKey.toBase58()}`);
  console.log(`Attacker   ${attacker.toBase58()} (never allowlisted)`);

  await fundAgentFees(connection, owner, agent.publicKey);
  writeEnvValue("LEASH_VAULT", "");

  console.log(`
Ready for a fresh vault:
  1. Dashboard (npm run app): within a few seconds it shows "Create a vault" for the new agent,
     with $0.25 / $1 / weather + translate + news prefilled. Create it with Phantom.
  2. The dashboard writes LEASH_VAULT, so "npm run agent" uses the new vault too.
  3. Keep "npm run services" running (restart it once if it was started before /news existed).`);
}

main().catch((e) => {
  console.error(`fresh failed: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
