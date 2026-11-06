"use client";

import { depositIx, explorerTx, formatUsdc, parseUsdc, type LeashProgram } from "@leash/sdk";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import type { PublicKey } from "@solana/web3.js";
import { useState } from "react";
import type { Balances } from "@/lib/hooks";
import { sendOwnerTx } from "@/lib/tx";

interface Props {
  program: LeashProgram;
  vaultAddress: PublicKey;
  mint: PublicKey;
  balances: Balances;
  onDone: () => void;
}

/** Owner tops up the vault from their own USDC. */
export default function DepositForm({ program, vaultAddress, mint, balances, onDone }: Props) {
  const { connection } = useConnection();
  const wallet = useWallet();
  const [amount, setAmount] = useState("5");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string; href?: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!wallet.publicKey) return;
    setBusy(true);
    setMsg(null);
    try {
      const value = parseUsdc(amount);
      if (value <= 0n) throw new Error("Enter an amount above zero");
      if (value > (balances.usdc ?? 0n)) {
        throw new Error(`You hold ${formatUsdc(balances.usdc ?? 0n)}. Get test USDC first.`);
      }
      const sig = await sendOwnerTx(connection, wallet, [
        await depositIx(program, { depositor: wallet.publicKey, vault: vaultAddress, mint, amount: value }),
      ]);
      setMsg({ ok: true, text: `Deposited ${formatUsdc(value)}`, href: explorerTx(sig) });
      onDone();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="flex flex-wrap items-end gap-3" onSubmit={submit}>
      <label className="block">
        <span className="label">Deposit (USDC)</span>
        <input className="input mt-1 w-32" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} disabled={busy} />
      </label>
      <button type="submit" className="btn-primary" disabled={busy}>
        {busy ? "Confirm in Phantom…" : "Deposit"}
      </button>
      {msg &&
        (msg.ok ? (
          <a className="link text-sm" href={msg.href} target="_blank" rel="noreferrer">
            {msg.text} ✓
          </a>
        ) : (
          <span className="text-sm text-red-300">{msg.text}</span>
        ))}
    </form>
  );
}
