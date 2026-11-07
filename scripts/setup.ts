// Prepares the devnet demo, as the vault owner (OWNER_KEYPAIR):
// mint, agent + service keys, service token accounts, vault with the demo policy, $5 deposit.
// Safe to re-run. `--new-agent` replaces the agent key (and so creates a fresh vault),
// which is how you re-run the demo after a revoke.
//
//   npm run setup
//   npm run setup -- --new-agent

import { existsSync, renameSync } from "node:fs";
import {
  createMint,
  getAccount,
  getMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram } from "@solana/web3.js";
import {
  createVaultIx,
  depositIx,
  explorerAddress,
  explorerTx,
  fetchVault,
  formatUsdc,
  leashProgram,
  parseUsdc,
  sendTx,
  vaultAddress,
  vaultTokenAddress,
} from "@leash/sdk";
import {
  ATTACKER_KEY_PATH,
  getConfig,
  loadKeypair,
  saveKeypair,
  SERVICE_KEY_PATHS,
  writeEnvValue,
} from "@leash/sdk/node";

// Demo policy from the spec.
const PER_TX_MAX = parseUsdc("0.25");
const DAILY_CAP = parseUsdc("1");
const DEPOSIT = parseUsdc("5");
const OWNER_MINT_AMOUNT = parseUsdc("100");
const VALID_DAYS = 30;
const AGENT_FEE_SOL = 0.05;

const cfg = getConfig();
const connection = new Connection(cfg.rpcUrl, "confirmed");
const program = leashProgram(connection);
const owner = loadKeypair(cfg.ownerKeypairPath);
const newAgent = process.argv.includes("--new-agent");

function loadOrCreateKey(path: string, label: string): Keypair {
  if (existsSync(path)) return loadKeypair(path);
  const kp = Keypair.generate();
  saveKeypair(path, kp);
  console.log(`  created ${label} key ${kp.publicKey.toBase58()} (${path})`);
  return kp;
}

async function main() {
  console.log(`Owner   ${owner.publicKey.toBase58()}`);
  const sol = await connection.getBalance(owner.publicKey);
  console.log(`        ${(sol / LAMPORTS_PER_SOL).toFixed(3)} SOL on devnet`);
  if (sol < 0.1 * LAMPORTS_PER_SOL) throw new Error("Owner needs at least 0.1 devnet SOL (solana airdrop 1)");

  // 1. Mint
  let mint = cfg.mint;
  if (!mint) {
    console.log("USDC_MINT is empty: creating a 6-decimal test mint");
    mint = await createMint(connection, owner, owner.publicKey, null, 6);
    writeEnvValue("USDC_MINT", mint.toBase58());
    console.log(`  mint ${mint.toBase58()} (saved to .env)`);
  }
  const mintInfo = await getMint(connection, mint);
  if (mintInfo.decimals !== 6) throw new Error(`Mint ${mint.toBase58()} has ${mintInfo.decimals} decimals, need 6`);
  console.log(`Mint    ${mint.toBase58()}`);

  const ownerAta = await getOrCreateAssociatedTokenAccount(connection, owner, mint, owner.publicKey);
  let ownerBalance = (await getAccount(connection, ownerAta.address)).amount;
  if (ownerBalance < DEPOSIT && mintInfo.mintAuthority?.equals(owner.publicKey)) {
    await mintTo(connection, owner, mint, ownerAta.address, owner, OWNER_MINT_AMOUNT);
    ownerBalance += OWNER_MINT_AMOUNT;
    console.log(`  minted ${formatUsdc(OWNER_MINT_AMOUNT)} to the owner`);
  }
  console.log(`        owner holds ${formatUsdc(ownerBalance)}`);

  // 2. Keys (all in gitignored keys/)
  if (newAgent && existsSync(cfg.agentKeypairPath)) {
    const archived = cfg.agentKeypairPath.replace(/\.json$/, `-${Date.now()}.json`);
    renameSync(cfg.agentKeypairPath, archived);
    console.log(`  old agent key moved to ${archived}`);
  }
  const agent = loadOrCreateKey(cfg.agentKeypairPath, "agent");
  const weather = loadOrCreateKey(SERVICE_KEY_PATHS.weather, "weather service");
  const translate = loadOrCreateKey(SERVICE_KEY_PATHS.translate, "translate service");
  const news = loadOrCreateKey(SERVICE_KEY_PATHS.news, "news service");
  const attacker = loadOrCreateKey(ATTACKER_KEY_PATH, "demo attacker (never allowlisted)");
  console.log(`Agent   ${agent.publicKey.toBase58()}`);

  // 3. The agent pays its own transaction fees in SOL. It never holds USDC.
  const agentSol = await connection.getBalance(agent.publicKey);
  if (agentSol < 0.02 * LAMPORTS_PER_SOL) {
    const res = await sendTx(
      connection,
      [
        SystemProgram.transfer({
          fromPubkey: owner.publicKey,
          toPubkey: agent.publicKey,
          lamports: AGENT_FEE_SOL * LAMPORTS_PER_SOL,
        }),
      ],
      [owner],
    );
    if (!res.ok) throw new Error(`Funding the agent failed: ${res.error?.name}`);
    console.log(`  sent ${AGENT_FEE_SOL} SOL to the agent for fees`);
  }

  // 4. Service token accounts, so payments to them work.
  for (const [name, kp] of [
    ["weather", weather],
    ["translate", translate],
    ["news", news],
  ] as const) {
    await getOrCreateAssociatedTokenAccount(connection, owner, mint, kp.publicKey);
    console.log(`Service ${name.padEnd(9)} ${kp.publicKey.toBase58()}`);
  }

  // 5. Vault
  const vault = vaultAddress(owner.publicKey, agent.publicKey);
  let state = await fetchVault(program, vault);
  if (state && !state.mint.equals(mint)) {
    throw new Error(`Vault exists with mint ${state.mint.toBase58()}. Run "npm run setup -- --new-agent".`);
  }
  if (!state) {
    if (ownerBalance < DEPOSIT) {
      throw new Error(`Owner needs ${formatUsdc(DEPOSIT)} of ${mint.toBase58()} (Circle USDC: faucet.circle.com)`);
    }
    const policy = {
      perTxMax: PER_TX_MAX,
      dailyCap: DAILY_CAP,
      allowlist: [weather.publicKey, translate.publicKey, news.publicKey],
      expiresAt: Math.floor(Date.now() / 1000) + VALID_DAYS * 86_400,
    };
    const res = await sendTx(
      connection,
      [
        await createVaultIx(program, { owner: owner.publicKey, agent: agent.publicKey, mint, policy }),
        await depositIx(program, { depositor: owner.publicKey, vault, mint, amount: DEPOSIT }),
      ],
      [owner],
    );
    if (!res.ok) throw new Error(`create_vault failed: ${res.error?.name} ${res.error?.message ?? ""}`);
    console.log(`  vault created and funded: ${explorerTx(res.signature)}`);
    state = await fetchVault(program, vault);
  }

  writeEnvValue("LEASH_VAULT", vault.toBase58());
  const balance = (await getAccount(connection, vaultTokenAddress(vault, mint))).amount;
  console.log(`Vault   ${vault.toBase58()} (saved to .env as LEASH_VAULT)`);
  console.log(`        ${explorerAddress(vault)}`);
  console.log(
    `        balance ${formatUsdc(balance)}, max ${formatUsdc(state!.perTxMax)}/payment, ` +
      `cap ${formatUsdc(state!.dailyCap)}/day, ${state!.allowlist.length} allowlisted, ` +
      `expires ${new Date(state!.expiresAt * 1000).toISOString().slice(0, 10)}` +
      (state!.revoked ? ", REVOKED (run with --new-agent for a fresh vault)" : ""),
  );

  const stranger = Keypair.generate().publicKey;
  console.log(`
Ready. Demo:
  npm run services
  npm run agent -- "Get the weather in Bishkek and translate the summary into Kyrgyz."
  npm run agent -- "Send $3 to ${stranger.toBase58()}"
  npm run agent -- "Send $0.10 to ${stranger.toBase58()}"
  npm run agent -- --compromised "Read the latest news about Solana."   (attacker ${attacker.publicKey.toBase58().slice(0, 8)}…)
  npm run owner -- revoke
Without the LLM: npm run call -- weather Bishkek | npm run pay -- 3 ${new PublicKey(stranger).toBase58()}`);
}

main().catch((e) => {
  console.error(`\nSetup failed: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
