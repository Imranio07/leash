"use client";

import { explorerAddress, formatUsdc, spentToday, type VaultState } from "@leash/sdk";
import type { PublicKey } from "@solana/web3.js";
import { useState } from "react";
import { short } from "@/lib/config";
import type { Keys } from "@/lib/hooks";

interface Props {
  address: PublicKey;
  state: VaultState;
  balance: bigint;
  keys: Keys | null;
  /** Re-reads /api/keys after the CLI vault changes. */
  onCliChanged?: () => void;
}

type Status = "active" | "revoked" | "expired";

function statusOf(v: VaultState): Status {
  if (v.revoked) return "revoked";
  if (v.expiresAt <= Math.floor(Date.now() / 1000)) return "expired";
  return "active";
}

const BADGE: Record<Status, { text: string; cls: string }> = {
  active: { text: "ACTIVE", cls: "border-emerald-500/50 bg-emerald-500/15 text-emerald-300" },
  revoked: { text: "REVOKED", cls: "border-red-500/60 bg-red-500/15 text-red-300" },
  expired: { text: "EXPIRED", cls: "border-amber-500/50 bg-amber-500/15 text-amber-200" },
};

function timeLeft(expiresAt: number): string {
  const sec = expiresAt - Math.floor(Date.now() / 1000);
  if (sec <= 0) return "expired";
  const d = Math.floor(sec / 86_400);
  const h = Math.floor((sec % 86_400) / 3600);
  if (d >= 1) return `${d}d ${h}h left`;
  const m = Math.floor((sec % 3600) / 60);
  return `${h}h ${m}m left`;
}

export default function VaultCard({ address, state, balance, keys, onCliChanged }: Props) {
  const status = statusOf(state);
  const spent = spentToday(state);
  const pct = state.dailyCap > 0n ? Number((spent * 1000n) / state.dailyCap) / 10 : 0;
  const labels = new Map(Object.entries(keys?.services ?? {}).map(([name, k]) => [k.toBase58(), `${name} service`]));
  const isCliVault = keys?.cliVault === address.toBase58();
  const [cliBusy, setCliBusy] = useState(false);
  const [cliError, setCliError] = useState<string | null>(null);

  async function useForCli() {
    setCliBusy(true);
    setCliError(null);
    try {
      const r = await fetch("/api/vault/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vault: address.toBase58() }),
      });
      if (!r.ok) throw new Error(((await r.json()) as { error?: string }).error ?? `HTTP ${r.status}`);
      onCliChanged?.();
    } catch (e) {
      setCliError(e instanceof Error ? e.message : String(e));
    } finally {
      setCliBusy(false);
    }
  }

  return (
    <div className="card">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="label">Vault</div>
          <a className="mono link mt-1 block text-lg" href={explorerAddress(address)} target="_blank" rel="noreferrer">
            {short(address, 6)}
          </a>
        </div>
        <span className={`rounded-xl border px-4 py-2 text-xl font-bold tracking-wide ${BADGE[status].cls}`}>
          {BADGE[status].text}
        </span>
      </div>

      <div className="mt-5 grid gap-6 sm:grid-cols-2">
        <div>
          <div className="label">Balance</div>
          <div className="mt-1 text-4xl font-semibold tabular-nums">{formatUsdc(balance)}</div>
        </div>
        <div>
          <div className="label">Spent today</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums">
            {formatUsdc(spent)} <span className="text-base font-normal text-zinc-400">of {formatUsdc(state.dailyCap)}</span>
          </div>
          <div className="mt-2 h-3 w-full overflow-hidden rounded-full bg-zinc-800">
            <div
              className={`h-full rounded-full transition-all ${pct >= 100 ? "bg-red-500" : pct >= 75 ? "bg-amber-400" : "bg-emerald-500"}`}
              style={{ width: `${Math.min(100, pct)}%` }}
            />
          </div>
          <div className="mt-1 text-xs text-zinc-500">{pct.toFixed(0)}% of the daily cap · resets at 00:00 UTC</div>
        </div>
      </div>

      <dl className="mt-6 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[auto_1fr]">
        <dt className="label self-center">Per payment</dt>
        <dd className="font-medium tabular-nums">max {formatUsdc(state.perTxMax)}</dd>

        <dt className="label self-center">Expires</dt>
        <dd className="font-medium">
          {new Date(state.expiresAt * 1000).toLocaleString()} <span className="text-zinc-500">· {timeLeft(state.expiresAt)}</span>
        </dd>

        <dt className="label self-center">Agent key</dt>
        <dd>
          <a className="mono link" href={explorerAddress(state.agent)} target="_blank" rel="noreferrer">
            {state.agent.toBase58()}
          </a>
        </dd>

        <dt className="label self-start pt-0.5">Allowed recipients</dt>
        <dd className="flex flex-col gap-1">
          {state.allowlist.length === 0 && <span className="text-red-300">none (the agent cannot pay anyone)</span>}
          {state.allowlist.map((k) => (
            <span key={k.toBase58()} className="flex flex-wrap items-center gap-2">
              <a className="mono link" href={explorerAddress(k)} target="_blank" rel="noreferrer">
                {short(k, 6)}
              </a>
              {labels.get(k.toBase58()) && (
                <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-300">{labels.get(k.toBase58())}</span>
              )}
            </span>
          ))}
        </dd>

        <dt className="label self-center">CLI agent</dt>
        <dd className="flex flex-wrap items-center gap-3">
          {isCliVault ? (
            <span className="text-emerald-300">points at this vault (LEASH_VAULT in .env)</span>
          ) : (
            <>
              <span className="text-zinc-400">points at {keys?.cliVault ? short(keys.cliVault, 6) : "no vault"}</span>
              <button className="btn-secondary px-3 py-1" onClick={useForCli} disabled={cliBusy}>
                {cliBusy ? "Saving…" : "Use this vault"}
              </button>
            </>
          )}
          {cliError && <span className="text-red-300">{cliError}</span>}
        </dd>
      </dl>
    </div>
  );
}
