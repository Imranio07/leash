// Owner-side helpers shared by setup, fresh and demo. The owner is OWNER_KEYPAIR (id.json).

import { createMint, getAccount, getMint, getOrCreateAssociatedTokenAccount, mintTo } from "@solana/spl-token";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram } from "@solana/web3.js";
import {
  createVaultIx,
  depositIx,
  fetchVault,
  formatUsdc,
  parseUsdc,
  sendTx,
  vaultAddress,
  type LeashProgram,
  type PolicyArgs,
} from "@leash/sdk";
import {
  ATTACKER_KEY_PATH,
  loadOrCreateKeypair,
  SERVICE_KEY_PATHS,
  writeEnvValue,
  type ServiceName,
} from "@leash/sdk/node";

/** The demo policy from the spec. */
export const DEMO = {
  perTxMax: parseUsdc("0.25"),
  dailyCap: parseUsdc("1"),
  deposit: parseUsdc("5"),
  ownerMint: parseUsdc("100"),
  agentFeeSol: 0.05,
};

export function demoPolicy(allowlist: PublicKey[], days = 30): PolicyArgs {
  return {
    perTxMax: DEMO.perTxMax,
    dailyCap: DEMO.dailyCap,
    allowlist,
    expiresAt: Math.floor(Date.now() / 1000) + days * 86_400,
  };
}

/** Service receiving wallets (weather, translate, news), created if missing. */
export function serviceKeys(): Record<ServiceName, Keypair> {
  return Object.fromEntries(
    Object.entries(SERVICE_KEY_PATHS).map(([name, path]) => [name, loadOrCreateKeypair(path)]),
  ) as Record<ServiceName, Keypair>;
}

/** The prompt-injection attacker's wallet. Never allowlisted. */
export function attackerWallet(): PublicKey {
  return loadOrCreateKeypair(ATTACKER_KEY_PATH).publicKey;
}

/**
 * The USDC mint (USDC_MINT, or a new 6-decimal test mint saved to .env) and the owner's
 * balance, topped up to `need` when the owner is the mint authority.
 */
export async function ensureMint(
  connection: Connection,
  owner: Keypair,
  configured: PublicKey | null,
  need: bigint,
): Promise<{ mint: PublicKey; ownerBalance: bigint }> {
  let mint = configured;
  if (!mint) {
    mint = await createMint(connection, owner, owner.publicKey, null, 6);
    writeEnvValue("USDC_MINT", mint.toBase58());
    console.log(`  created test mint ${mint.toBase58()} (saved to .env)`);
  }
  const info = await getMint(connection, mint);
  if (info.decimals !== 6) throw new Error(`Mint ${mint.toBase58()} has ${info.decimals} decimals, need 6`);
  const ata = await getOrCreateAssociatedTokenAccount(connection, owner, mint, owner.publicKey);
  let ownerBalance = (await getAccount(connection, ata.address)).amount;
  if (ownerBalance < need && info.mintAuthority?.equals(owner.publicKey)) {
    await mintTo(connection, owner, mint, ata.address, owner, DEMO.ownerMint);
    ownerBalance += DEMO.ownerMint;
    console.log(`  minted ${formatUsdc(DEMO.ownerMint)} of test USDC to the owner`);
  }
  if (ownerBalance < need) {
    throw new Error(`Owner needs ${formatUsdc(need)} of ${mint.toBase58()} (Circle USDC: faucet.circle.com)`);
  }
  return { mint, ownerBalance };
}

/** Sends the agent some SOL for transaction fees (it never holds USDC). */
export async function fundAgentFees(connection: Connection, owner: Keypair, agent: PublicKey, sol = DEMO.agentFeeSol) {
  const balance = await connection.getBalance(agent);
  if (balance >= 0.02 * LAMPORTS_PER_SOL) return;
  const res = await sendTx(
    connection,
    [SystemProgram.transfer({ fromPubkey: owner.publicKey, toPubkey: agent, lamports: Math.round(sol * LAMPORTS_PER_SOL) })],
    [owner],
  );
  if (!res.ok) throw new Error(`Funding the agent failed: ${res.error?.name}`);
  console.log(`  sent ${sol} SOL to the agent for fees`);
}

/** Creates the services' token accounts, so the first payment to each one is cheap. */
export async function ensureServiceAccounts(connection: Connection, owner: Keypair, mint: PublicKey, wallets: PublicKey[]) {
  for (const w of wallets) await getOrCreateAssociatedTokenAccount(connection, owner, mint, w);
}

/** Creates the (owner, agent) vault with `policy` and deposits `deposit`, in one transaction. */
export async function createFundedVault(
  connection: Connection,
  program: LeashProgram,
  owner: Keypair,
  agent: PublicKey,
  mint: PublicKey,
  policy: PolicyArgs,
  deposit: bigint,
): Promise<{ vault: PublicKey; signature: string }> {
  const vault = vaultAddress(owner.publicKey, agent);
  if (await fetchVault(program, vault)) throw new Error(`Vault ${vault.toBase58()} already exists`);
  const res = await sendTx(
    connection,
    [
      await createVaultIx(program, { owner: owner.publicKey, agent, mint, policy }),
      await depositIx(program, { depositor: owner.publicKey, vault, mint, amount: deposit }),
    ],
    [owner],
  );
  if (!res.ok) throw new Error(`create_vault failed: ${res.error?.name} ${res.error?.message ?? ""}`);
  return { vault, signature: res.signature };
}
