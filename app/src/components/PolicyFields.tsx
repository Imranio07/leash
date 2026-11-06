"use client";

// Policy inputs shared by "Create vault" and "Update policy". Amounts are parsed with integer math.

import { parseUsdc, type PolicyArgs } from "@leash/sdk";
import { PublicKey } from "@solana/web3.js";

export interface PolicyForm {
  perTxMax: string;
  dailyCap: string;
  allowlist: string;
  days: string;
}

export const MAX_ALLOWLIST = 8;

export function parseAllowlist(text: string): PublicKey[] {
  const seen = new Set<string>();
  const keys: PublicKey[] = [];
  for (const raw of text.split(/[\s,;]+/)) {
    const item = raw.trim();
    if (!item || seen.has(item)) continue;
    let key: PublicKey;
    try {
      key = new PublicKey(item);
    } catch {
      throw new Error(`"${item}" is not a valid Solana address`);
    }
    seen.add(item);
    keys.push(key);
  }
  if (keys.length > MAX_ALLOWLIST) throw new Error(`Allowlist holds at most ${MAX_ALLOWLIST} addresses`);
  return keys;
}

/** Validates the form and returns program arguments, or throws a message for the user. */
export function parsePolicy(f: PolicyForm): PolicyArgs {
  const perTxMax = parseUsdc(f.perTxMax);
  const dailyCap = parseUsdc(f.dailyCap);
  if (perTxMax <= 0n || dailyCap <= 0n) throw new Error("Limits must be greater than zero");
  if (perTxMax > dailyCap) throw new Error("The per-payment limit cannot exceed the daily cap");
  const days = Number(f.days);
  if (!Number.isInteger(days) || days < 1 || days > 365) throw new Error("Expiry must be 1 to 365 days");
  return {
    perTxMax,
    dailyCap,
    allowlist: parseAllowlist(f.allowlist),
    expiresAt: Math.floor(Date.now() / 1000) + days * 86_400,
  };
}

interface Props {
  value: PolicyForm;
  onChange: (next: PolicyForm) => void;
  disabled?: boolean;
}

export default function PolicyFields({ value, onChange, disabled }: Props) {
  const set = (k: keyof PolicyForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    onChange({ ...value, [k]: e.target.value });
  const count = value.allowlist.split(/[\s,;]+/).filter(Boolean).length;

  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <label className="block">
        <span className="label">Max per payment (USDC)</span>
        <input className="input mt-1" inputMode="decimal" value={value.perTxMax} onChange={set("perTxMax")} disabled={disabled} />
      </label>
      <label className="block">
        <span className="label">Daily cap (USDC)</span>
        <input className="input mt-1" inputMode="decimal" value={value.dailyCap} onChange={set("dailyCap")} disabled={disabled} />
      </label>
      <label className="block">
        <span className="label">Valid for (days)</span>
        <input className="input mt-1" inputMode="numeric" value={value.days} onChange={set("days")} disabled={disabled} />
      </label>
      <label className="block sm:col-span-3">
        <span className="label">
          Allowed recipients · {count}/{MAX_ALLOWLIST} · one wallet address per line
        </span>
        <textarea
          className="input mono mt-1 min-h-24 text-sm"
          value={value.allowlist}
          onChange={set("allowlist")}
          disabled={disabled}
          spellCheck={false}
        />
        <span className="mt-1 block text-xs text-zinc-500">
          Default deny: the agent can pay only these wallets. Empty means nobody.
        </span>
      </label>
    </div>
  );
}
