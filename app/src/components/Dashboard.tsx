"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { USDC_MINT } from "@/lib/config";
import { useActivity } from "@/lib/activity";
import { useBalances, useIsDevnet, useKeys, useVault } from "@/lib/hooks";
import { PUBLIC_DEMO } from "@/lib/publicDemo";
import ActivityLog from "./ActivityLog";
import AgentConsole from "./AgentConsole";
import CreateVaultForm from "./CreateVaultForm";
import DepositForm from "./DepositForm";
import FaucetButton from "./FaucetButton";
import Header from "./Header";
import OwnerActions from "./OwnerActions";
import Providers from "./Providers";
import PublicAgentNotice from "./PublicAgentNotice";
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
  const { balances, refresh: refreshBalances } = useBalances(publicKey);
  const { keys, error: keysError, reload: reloadKeys } = useKeys();
  const vault = useVault(publicKey, keys?.agent ?? null);
  const activity = useActivity(vault.program, vault.view.state ? vault.address : null);
  const refreshAll = () => {
    refreshBalances();
    vault.refresh();
    activity.refresh();
  };
  const labels = new Map(Object.entries(keys?.services ?? {}).map(([name, k]) => [k.toBase58(), `${name} service`]));
  if (keys?.attacker) labels.set(keys.attacker.toBase58(), "attacker");

  return (
    <div className="mx-auto max-w-7xl px-6 py-6">
      <Header />

      <main className="grid gap-6 lg:grid-cols-2">
        <section className="flex flex-col gap-6">
          <WalletPanel
            balances={balances}
            isDevnet={isDevnet}
            usdcAction={publicKey && USDC_MINT ? <FaucetButton wallet={publicKey} onDone={refreshBalances} /> : null}
          />

          {keysError && (
            <div className="card">
              <Hint tone="red">Dashboard server: {keysError}</Hint>
            </div>
          )}

          {publicKey && keys && vault.address && vault.view.loaded && !vault.view.state && (
            <CreateVaultForm
              key={vault.address.toBase58()}
              program={vault.program}
              keys={keys}
              vaultAddress={vault.address}
              balances={balances}
              onCreated={() => {
                refreshAll();
                reloadKeys();
              }}
            />
          )}

          {publicKey && vault.address && vault.view.state && (
            <>
              <VaultCard
                address={vault.address}
                state={vault.view.state}
                balance={vault.view.balance}
                keys={keys}
                onCliChanged={PUBLIC_DEMO ? undefined : reloadKeys}
              />
              <div className="card">
                <DepositForm
                  program={vault.program}
                  vaultAddress={vault.address}
                  mint={vault.view.state.mint}
                  balances={balances}
                  onDone={refreshAll}
                />
              </div>
              <OwnerActions
                key={vault.address.toBase58()}
                program={vault.program}
                vaultAddress={vault.address}
                state={vault.view.state}
                balance={vault.view.balance}
                onDone={refreshAll}
              />
              <ActivityLog view={activity.view} labels={labels} />
            </>
          )}
        </section>

        <section className="flex flex-col gap-6">
          {PUBLIC_DEMO ? (
            <PublicAgentNotice agent={keys?.agent ?? null} />
          ) : (
            <AgentConsole
              attacker={keys?.attacker ?? null}
              vault={vault.view.state ? vault.address : null}
              revoked={vault.view.state?.revoked ?? false}
              onFinished={refreshAll}
            />
          )}
        </section>
      </main>
    </div>
  );
}
