"use client";

import { explorerAddress, formatUsdc, type VaultState } from "@leash/sdk";
import type { PublicKey } from "@solana/web3.js";
import { short } from "@/lib/config";

interface Props {
  address: PublicKey;
  state: VaultState;
  balance: bigint;
}

export default function VaultCard({ address, state, balance }: Props) {
  return (
    <div className="card">
      <div className="label">Vault</div>
      <a className="mono link mt-1 block text-lg" href={explorerAddress(address)} target="_blank" rel="noreferrer">
        {short(address, 6)}
      </a>
      <div className="mt-3 text-3xl font-semibold tabular-nums">{formatUsdc(balance)}</div>
      <div className="mt-1 text-sm text-zinc-400">
        max {formatUsdc(state.perTxMax)} per payment · {formatUsdc(state.dailyCap)} per day ·{" "}
        {state.revoked ? "revoked" : "active"}
      </div>
    </div>
  );
}
