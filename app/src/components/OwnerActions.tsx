"use client";

// Owner controls: Revoke (two-step confirm), Withdraw, Update policy.

import {
  explorerTx,
  formatUsdc,
  parseUsdc,
  revokeIx,
  updatePolicyIx,
  withdrawIx,
  type LeashProgram,
  type VaultState,
} from "@leash/sdk";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import type { PublicKey } from "@solana/web3.js";
import { useState } from "react";
import { sendOwnerTx } from "@/lib/tx";
import PolicyFields, { parsePolicy, type PolicyForm } from "./PolicyFields";

interface Props {
  program: LeashProgram;
  vaultAddress: PublicKey;
  state: VaultState;
  balance: bigint;
  onDone: () => void;
}

type Panel = "none" | "withdraw" | "policy" | "revoke";

interface Status {
  ok: boolean;
  text: string;
  href?: string;
}

export default function OwnerActions({ program, vaultAddress, state, balance, onDone }: Props) {
  const { connection } = useConnection();
  const wallet = useWallet();
  const [panel, setPanel] = useState<Panel>("none");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [policy, setPolicy] = useState<PolicyForm>(() => ({
    perTxMax: formatUsdc(state.perTxMax).slice(1),
    dailyCap: formatUsdc(state.dailyCap).slice(1),
    allowlist: state.allowlist.map((k) => k.toBase58()).join("\n"),
    days: String(Math.max(1, Math.ceil((state.expiresAt - Date.now() / 1000) / 86_400))),
  }));

  const owner = wallet.publicKey;

  async function run(label: string, build: () => Promise<Parameters<typeof sendOwnerTx>[2]>) {
    setBusy(true);
    setStatus(null);
    try {
      const sig = await sendOwnerTx(connection, wallet, await build());
      setStatus({ ok: true, text: label, href: explorerTx(sig) });
      setPanel("none");
      onDone();
    } catch (e) {
      setStatus({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  const withdraw = (amount: bigint) =>
    run(`Withdrew ${formatUsdc(amount)}`, async () => {
      if (!owner) throw new Error("Connect a wallet first.");
      const ownerAta = getAssociatedTokenAddressSync(state.mint, owner, true);
      return [
        // Make sure the owner has a token account to receive the funds.
        createAssociatedTokenAccountIdempotentInstruction(owner, ownerAta, owner, state.mint),
        await withdrawIx(program, { owner, vault: vaultAddress, mint: state.mint, amount }),
      ];
    });

  const toggle = (p: Panel) => {
    setStatus(null);
    setPanel(panel === p ? "none" : p);
  };

  return (
    <div className="card">
      <div className="label">Owner controls</div>
      <div className="mt-3 flex flex-wrap gap-3">
        {!state.revoked && (
          <button className="btn-danger px-6 py-3 text-base" onClick={() => toggle("revoke")} disabled={busy}>
            Revoke agent access
          </button>
        )}
        <button className="btn-secondary px-5 py-3 text-base" onClick={() => toggle("withdraw")} disabled={busy || balance === 0n}>
          Withdraw
        </button>
        {!state.revoked && (
          <button className="btn-secondary px-5 py-3 text-base" onClick={() => toggle("policy")} disabled={busy}>
            Update policy
          </button>
        )}
      </div>

      {panel === "revoke" && (
        <div className="mt-4 rounded-xl border border-red-500/50 bg-red-500/10 p-4">
          <p className="text-lg font-semibold text-red-200">Revoke this agent for good?</p>
          <p className="mt-1 text-sm text-red-100/80">
            Permanent. The agent key can never pay from this vault again, even if it is compromised. You keep full
            access and can withdraw the balance at any time.
          </p>
          <div className="mt-3 flex gap-3">
            <button
              className="btn-danger px-6 py-3 text-base"
              disabled={busy}
              onClick={() =>
                run("Vault revoked", async () => {
                  if (!owner) throw new Error("Connect a wallet first.");
                  return [await revokeIx(program, { owner, vault: vaultAddress })];
                })
              }
            >
              {busy ? "Confirm in Phantom…" : "Yes, revoke now"}
            </button>
            <button className="btn-secondary" onClick={() => setPanel("none")} disabled={busy}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {panel === "withdraw" && (
        <form
          className="mt-4 flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            try {
              const amount = withdrawAmount.trim() ? parseUsdc(withdrawAmount) : balance;
              if (amount <= 0n) throw new Error("Enter an amount above zero");
              if (amount > balance) throw new Error(`The vault holds ${formatUsdc(balance)}`);
              void withdraw(amount);
            } catch (err) {
              setStatus({ ok: false, text: err instanceof Error ? err.message : String(err) });
            }
          }}
        >
          <label className="block">
            <span className="label">Amount (USDC) · vault holds {formatUsdc(balance)}</span>
            <input
              className="input mt-1 w-40"
              inputMode="decimal"
              placeholder="all"
              value={withdrawAmount}
              onChange={(e) => setWithdrawAmount(e.target.value)}
              disabled={busy}
            />
          </label>
          <button type="submit" className="btn-primary" disabled={busy}>
            {busy ? "Confirm in Phantom…" : withdrawAmount.trim() ? "Withdraw" : "Withdraw all"}
          </button>
        </form>
      )}

      {panel === "policy" && (
        <form
          className="mt-4 flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void run("Policy updated", async () => {
              if (!owner) throw new Error("Connect a wallet first.");
              return [await updatePolicyIx(program, { owner, vault: vaultAddress, policy: parsePolicy(policy) })];
            });
          }}
        >
          <PolicyFields value={policy} onChange={setPolicy} disabled={busy} />
          <div className="flex gap-3">
            <button type="submit" className="btn-primary" disabled={busy}>
              {busy ? "Confirm in Phantom…" : "Save policy"}
            </button>
            <button type="button" className="btn-secondary" onClick={() => setPanel("none")} disabled={busy}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {status &&
        (status.ok ? (
          <p className="mt-3 text-sm text-emerald-300">
            {status.text} ·{" "}
            <a className="link" href={status.href} target="_blank" rel="noreferrer">
              explorer ↗
            </a>
          </p>
        ) : (
          <p className="mt-3 text-sm text-red-300">{status.text}</p>
        ))}
    </div>
  );
}
