"use client";

import { explorerAddress, explorerTx, formatUsdc, type ActivityEntry } from "@leash/sdk";
import type { ActivityView } from "@/lib/activity";
import { short } from "@/lib/config";

interface Props {
  view: ActivityView;
  /** Wallet → label, e.g. the service names. */
  labels: Map<string, string>;
}

function when(e: ActivityEntry): string {
  if (!e.time) return "…";
  return new Date(e.time * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function Wallet({ address, labels }: { address: string; labels: Map<string, string> }) {
  const label = labels.get(address);
  return (
    <span className="inline-flex items-center gap-1.5">
      <a className="mono link" href={explorerAddress(address)} target="_blank" rel="noreferrer">
        {short(address)}
      </a>
      {label && <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-300">{label}</span>}
    </span>
  );
}

function Row({ e, labels }: { e: ActivityEntry; labels: Map<string, string> }) {
  const amount = e.amount !== undefined ? formatUsdc(e.amount) : "";
  const signature = e.signature.split("#")[0]!;

  let text: React.ReactNode;
  switch (e.kind) {
    case "agent_pay":
      text = (
        <>
          Agent {e.ok ? "paid" : "tried to pay"} <b className="tabular-nums">{amount}</b>
          {e.recipient && (
            <>
              {" → "}
              <Wallet address={e.recipient} labels={labels} />
            </>
          )}
        </>
      );
      break;
    case "create_vault":
      text = "Owner created the vault";
      break;
    case "deposit":
      text = (
        <>
          Deposit <b className="tabular-nums">{amount}</b>
        </>
      );
      break;
    case "withdraw":
      text = (
        <>
          Owner withdrew <b className="tabular-nums">{amount}</b>
        </>
      );
      break;
    case "update_policy":
      text = "Owner updated the policy";
      break;
    case "revoke":
      text = <span className="font-semibold text-red-300">Owner revoked the vault</span>;
      break;
    default:
      text = "Leash transaction";
  }

  return (
    <li className={`flex gap-3 border-b border-zinc-800/80 py-3 last:border-0 ${e.ok ? "" : "bg-red-500/5"}`}>
      <span className={`mt-0.5 text-lg leading-none ${e.ok ? "text-emerald-400" : "text-red-400"}`}>{e.ok ? "✓" : "✗"}</span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="text-zinc-100">{text}</span>
          {e.error && (
            <span className="mono rounded border border-red-500/50 bg-red-500/10 px-2 py-0.5 text-sm font-semibold text-red-300">
              {e.error}
            </span>
          )}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500">
          <span className="tabular-nums">{when(e)}</span>
          {e.spentToday !== undefined && <span>spent today {formatUsdc(e.spentToday)}</span>}
          {e.intentHash && (
            <span className="mono" title={`intent_hash (sha256 of the task): ${e.intentHash}`}>
              intent {e.intentHash.slice(0, 10)}…
            </span>
          )}
          <a className="link" href={explorerTx(signature)} target="_blank" rel="noreferrer">
            explorer ↗
          </a>
        </div>
      </div>
    </li>
  );
}

export default function ActivityLog({ view, labels }: Props) {
  return (
    <div className="card">
      <div className="flex items-center justify-between">
        <div>
          <div className="label">Activity · from the chain</div>
          <h2 className="mt-1 text-xl font-semibold">Every payment and rejection</h2>
        </div>
        <span className="flex items-center gap-2 text-xs text-zinc-500">
          <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-emerald-400" /> live
          {view.pending > 0 && ` · decoding ${view.pending}`}
        </span>
      </div>
      {!view.loaded ? (
        <p className="mt-4 text-zinc-500">Loading…</p>
      ) : view.entries.length === 0 ? (
        <p className="mt-4 text-zinc-500">No transactions yet.</p>
      ) : (
        <ul className="mt-3 max-h-[30rem] overflow-y-auto pr-1">
          {view.entries.map((e) => (
            <Row key={e.signature} e={e} labels={labels} />
          ))}
        </ul>
      )}
    </div>
  );
}
