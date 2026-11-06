// Owner actions on the vault of (OWNER_KEYPAIR, AGENT_KEYPAIR). The dashboard replaces this later.
//
//   npm run owner -- status
//   npm run owner -- revoke
//   npm run owner -- deposit 2
//   npm run owner -- withdraw [amount|all]

import { getAccount } from "@solana/spl-token";
import { Connection, type TransactionInstruction } from "@solana/web3.js";
import {
  depositIx,
  explorerAddress,
  explorerTx,
  fetchVault,
  formatUsdc,
  leashProgram,
  parseUsdc,
  revokeIx,
  sendTx,
  spentToday,
  vaultAddress,
  vaultTokenAddress,
  withdrawIx,
  type VaultState,
} from "@leash/sdk";
import { getConfig, loadKeypair } from "@leash/sdk/node";

const cfg = getConfig();
const connection = new Connection(cfg.rpcUrl, "confirmed");
const program = leashProgram(connection);
const owner = loadKeypair(cfg.ownerKeypairPath);
const agent = loadKeypair(cfg.agentKeypairPath).publicKey;
const vault = vaultAddress(owner.publicKey, agent);

async function vaultBalance(v: VaultState): Promise<bigint> {
  return (await getAccount(connection, vaultTokenAddress(v.address, v.mint))).amount;
}

async function status(v: VaultState) {
  console.log(`Vault      ${vault.toBase58()}`);
  console.log(`           ${explorerAddress(vault)}`);
  console.log(`Owner      ${v.owner.toBase58()}`);
  console.log(`Agent      ${v.agent.toBase58()}`);
  console.log(`Balance    ${formatUsdc(await vaultBalance(v))}`);
  console.log(`Today      ${formatUsdc(spentToday(v))} of ${formatUsdc(v.dailyCap)}`);
  console.log(`Per tx     ${formatUsdc(v.perTxMax)}`);
  console.log(`Allowlist  ${v.allowlist.map((k) => k.toBase58()).join(", ") || "(empty: nobody)"}`);
  console.log(`Expires    ${new Date(v.expiresAt * 1000).toISOString()}`);
  console.log(`Revoked    ${v.revoked ? "YES" : "no"}`);
}

async function run(label: string, ix: TransactionInstruction) {
  const res = await sendTx(connection, [ix], [owner]);
  if (!res.ok) throw new Error(`${label} failed: ${res.error?.name} ${res.error?.message ?? ""}`);
  console.log(`${label}: ${explorerTx(res.signature)}`);
}

async function main() {
  const [cmd = "status", arg] = process.argv.slice(2);
  const v = await fetchVault(program, vault);
  if (!v) throw new Error(`No vault at ${vault.toBase58()}. Run "npm run setup" first.`);

  switch (cmd) {
    case "status":
      return status(v);
    case "revoke":
      await run("Revoked", await revokeIx(program, { owner: owner.publicKey, vault }));
      console.log("The agent can no longer pay from this vault. Withdraw still works.");
      return;
    case "deposit": {
      if (!arg) throw new Error("Usage: npm run owner -- deposit <amount>");
      const amount = parseUsdc(arg);
      await run(`Deposited ${formatUsdc(amount)}`, await depositIx(program, { depositor: owner.publicKey, vault, mint: v.mint, amount }));
      return;
    }
    case "withdraw": {
      const amount = !arg || arg === "all" ? await vaultBalance(v) : parseUsdc(arg);
      if (amount === 0n) return console.log("Vault is empty.");
      await run(`Withdrew ${formatUsdc(amount)}`, await withdrawIx(program, { owner: owner.publicKey, vault, mint: v.mint, amount }));
      return;
    }
    default:
      throw new Error(`Unknown command "${cmd}". Use: status | revoke | deposit <amount> | withdraw [amount|all]`);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
