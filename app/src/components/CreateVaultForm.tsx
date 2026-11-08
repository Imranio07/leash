"use client";

import { createVaultIx, depositIx, explorerAddress, explorerTx, formatUsdc, parseUsdc, type LeashProgram } from "@leash/sdk";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import type { PublicKey } from "@solana/web3.js";
import { useState } from "react";
import { short, USDC_MINT } from "@/lib/config";
import type { Balances, Keys } from "@/lib/hooks";
import { PUBLIC_DEMO } from "@/lib/publicDemo";
import { sendOwnerTx } from "@/lib/tx";
import PolicyFields, { parsePolicy, type PolicyForm } from "./PolicyFields";
import { Hint } from "./WalletPanel";

interface Props {
  program: LeashProgram;
  keys: Keys;
  vaultAddress: PublicKey;
  balances: Balances;
  onCreated: () => void;
}

export default function CreateVaultForm({ program, keys, vaultAddress, balances, onCreated }: Props) {
  const { connection } = useConnection();
  const wallet = useWallet();
  const [form, setForm] = useState<PolicyForm>({
    perTxMax: "0.25",
    dailyCap: "1",
    allowlist: Object.values(keys.services)
      .map((k) => k.toBase58())
      .join("\n"),
    days: "7",
  });
  const [deposit, setDeposit] = useState("5");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ signature: string; cli: string } | null>(null);

  const usdc = balances.usdc ?? 0n;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!wallet.publicKey || !USDC_MINT) return;
    setError(null);
    setBusy(true);
    try {
      const policy = parsePolicy(form);
      const depositAmount = deposit.trim() ? parseUsdc(deposit) : 0n;
      if (depositAmount > usdc) {
        throw new Error(
          `You hold ${formatUsdc(usdc)} USDC but want to deposit ${formatUsdc(depositAmount)}. Get test USDC first or lower the deposit.`,
        );
      }
      const owner = wallet.publicKey;
      const instructions = [await createVaultIx(program, { owner, agent: keys.agent, mint: USDC_MINT, policy })];
      if (depositAmount > 0n) {
        instructions.push(await depositIx(program, { depositor: owner, vault: vaultAddress, mint: USDC_MINT, amount: depositAmount }));
      }
      const signature = await sendOwnerTx(connection, wallet, instructions);

      // Point the CLI agent at the new vault so `npm run agent` works without editing files.
      let cli = "LEASH_VAULT written to .env: the CLI agent uses this vault now.";
      if (PUBLIC_DEMO) cli = "";
      else try {
        const r = await fetch("/api/vault/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ vault: vaultAddress.toBase58() }),
        });
        if (!r.ok) cli = `CLI not updated: ${((await r.json()) as { error?: string }).error ?? r.status}`;
      } catch {
        cli = "CLI not updated (dashboard server unreachable).";
      }
      setDone({ signature, cli });
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="card">
        <div className="label">Vault</div>
        <h2 className="mt-1 text-2xl font-semibold text-emerald-300">Vault created</h2>
        <p className="mt-2 text-zinc-300">
          <a className="link" href={explorerTx(done.signature)} target="_blank" rel="noreferrer">
            View the transaction
          </a>
          {" · "}
          <a className="mono link" href={explorerAddress(vaultAddress)} target="_blank" rel="noreferrer">
            {short(vaultAddress, 6)}
          </a>
        </p>
        {done.cli && <p className="mt-2 text-sm text-zinc-400">{done.cli}</p>}
      </div>
    );
  }

  return (
    <form className="card" onSubmit={submit}>
      <div className="label">Vault</div>
      <h2 className="mt-1 text-2xl font-semibold">Create a vault for your agent</h2>
      <p className="mt-2 text-zinc-400">
        The rules below are enforced by the Leash program on Solana. The agent key can only pay within them.
      </p>

      <div className="mt-5 grid gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="label">
              {PUBLIC_DEMO ? "Agent key (the Leash demo agent, public key only)" : "Agent key (from keys/agent.json, public key only)"}
            </span>
            <input className="input mono mt-1 text-sm" value={keys.agent.toBase58()} readOnly />
          </label>
          <label className="block">
            <span className="label">Initial deposit (USDC) · you hold {formatUsdc(usdc)}</span>
            <input className="input mt-1" inputMode="decimal" value={deposit} onChange={(e) => setDeposit(e.target.value)} disabled={busy} />
          </label>
        </div>
        <PolicyFields value={form} onChange={setForm} disabled={busy} />
      </div>

      {error && <Hint tone="red">{error}</Hint>}

      <div className="mt-5 flex flex-wrap items-center gap-4">
        <button type="submit" className="btn-primary px-6 py-3 text-base" disabled={busy || !USDC_MINT}>
          {busy ? "Confirm in Phantom…" : "Create vault"}
        </button>
        <span className="text-sm text-zinc-500">
          Vault address <span className="mono">{short(vaultAddress, 6)}</span> · one transaction: create + deposit
        </span>
      </div>
    </form>
  );
}
