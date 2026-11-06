"use client";

import { explorerAddress } from "@leash/sdk";
import { useWallet } from "@solana/wallet-adapter-react";
import { PROGRAM_ID, short } from "@/lib/config";
import { useBalances, useIsDevnet, useKeys, useVault } from "@/lib/hooks";
import CreateVaultForm from "./CreateVaultForm";
import Providers from "./Providers";
import VaultCard from "./VaultCard";
import WalletPanel, { Hint } from "./WalletPanel";

export default function Dashboard() {
  return (
    <Providers>
      <Screen />
    </Providers>
  );
}

function Screen() {
  const { publicKey } = useWallet();
  const isDevnet = useIsDevnet();
  const { balances } = useBalances(publicKey);
  const { keys, error: keysError } = useKeys();
  const vault = useVault(publicKey, keys?.agent ?? null);

  return (
    <div className="mx-auto max-w-7xl px-6 py-6">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="text-3xl">🐕‍🦺</span>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Leash</h1>
            <p className="text-sm text-zinc-400">The payment firewall for AI agents</p>
          </div>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 font-medium text-emerald-300">
            devnet
          </span>
          <a className="mono link" href={explorerAddress(PROGRAM_ID)} target="_blank" rel="noreferrer">
            program {short(PROGRAM_ID)}
          </a>
        </div>
      </header>

      <main className="grid gap-6 lg:grid-cols-2">
        <section className="flex flex-col gap-6">
          <WalletPanel balances={balances} isDevnet={isDevnet} />

          {keysError && (
            <div className="card">
              <Hint tone="red">Dashboard server: {keysError}</Hint>
            </div>
          )}

          {publicKey && keys && vault.address && vault.view.loaded && !vault.view.state && (
            <CreateVaultForm
              program={vault.program}
              keys={keys}
              vaultAddress={vault.address}
              balances={balances}
              onCreated={vault.refresh}
            />
          )}

          {publicKey && vault.address && vault.view.state && (
            <VaultCard address={vault.address} state={vault.view.state} balance={vault.view.balance} />
          )}
        </section>

        <section className="flex flex-col gap-6">
          <div className="card text-zinc-500">Agent console comes next.</div>
        </section>
      </main>
    </div>
  );
}
