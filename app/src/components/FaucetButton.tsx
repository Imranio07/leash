"use client";

import { formatUsdc } from "@leash/sdk";
import type { PublicKey } from "@solana/web3.js";
import { useState } from "react";
import { PUBLIC_DEMO, PUBLIC_FAUCET_AMOUNT_USDC, PUBLIC_FAUCET_COOLDOWN_MIN } from "@/lib/publicDemo";

const TITLE = PUBLIC_DEMO
  ? `Sends $${PUBLIC_FAUCET_AMOUNT_USDC} of test USDC on devnet, once per ${PUBLIC_FAUCET_COOLDOWN_MIN} minutes per wallet`
  : "Mints $20 of test USDC on devnet";

interface Props {
  wallet: PublicKey;
  onDone: () => void;
}

/** Asks the dashboard server for $20 of test USDC for the connected wallet. */
export default function FaucetButton({ wallet, onDone }: Props) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string; href?: string } | null>(null);

  async function drip() {
    setBusy(true);
    setResult(null);
    try {
      const r = await fetch("/api/faucet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet: wallet.toBase58() }),
      });
      const data = (await r.json()) as { error?: string; explorer?: string; amount?: string };
      if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`);
      setResult({ ok: true, text: `+${formatUsdc(data.amount ?? "0")}`, href: data.explorer });
      onDone();
    } catch (e) {
      setResult({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="flex flex-wrap items-center gap-2">
      <button className="btn-secondary" onClick={drip} disabled={busy} title={TITLE}>
        {busy ? "Sending…" : "Get test USDC"}
      </button>
      {result &&
        (result.ok ? (
          <a className="link text-sm" href={result.href} target="_blank" rel="noreferrer">
            {result.text} ✓
          </a>
        ) : (
          <span className="text-sm text-red-300">{result.text}</span>
        ))}
    </span>
  );
}
