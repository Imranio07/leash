"use client";

// Read-only view of any vault: rules, balance and the activity log. No wallet needed.

import { PublicKey } from "@solana/web3.js";
import { useMemo } from "react";
import { useActivity } from "@/lib/activity";
import { useKeys, useVaultAt } from "@/lib/hooks";
import { DEMO_VAULT, DEMO_VIDEO_URL } from "@/lib/publicDemo";
import ActivityLog from "./ActivityLog";
import Header from "./Header";
import Providers from "./Providers";
import VaultCard from "./VaultCard";

export default function VaultPage({ address }: { address: string }) {
  return (
    <Providers>
      <ReadOnlyVault address={address} />
    </Providers>
  );
}

function parseAddress(s: string): PublicKey | null {
  try {
    return new PublicKey(decodeURIComponent(s));
  } catch {
    return null;
  }
}

function ReadOnlyVault({ address }: { address: string }) {
  const key = useMemo(() => parseAddress(address), [address]);
  const { keys } = useKeys();
  const vault = useVaultAt(key);
  const activity = useActivity(vault.program, vault.view.state ? key : null);
  const labels = new Map(Object.entries(keys?.services ?? {}).map(([name, k]) => [k.toBase58(), `${name} service`]));
  if (keys?.attacker) labels.set(keys.attacker.toBase58(), "attacker");
  const isDemo = !!key && key.toBase58() === DEMO_VAULT;

  return (
    <div className="mx-auto max-w-7xl px-6 py-6">
      <Header showDemoLinks={false} />

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 text-sm">
        <a href="/" className="link">
          ← Dashboard: connect Phantom to create your own vault
        </a>
        <span className="text-zinc-500">Read-only · no wallet needed · everything is read from the chain</span>
      </div>

      {isDemo && (
        <div className="card mb-6 text-sm leading-relaxed text-zinc-300">
          <b>The vault from the demo video.</b> The agent bought weather and a Kyrgyz translation ($0.05 each), was
          refused $3 and $0.10 to a stranger, was tricked by a prompt injection into paying an attacker (refused), and
          was then revoked by the owner. Every line below is a devnet transaction.{" "}
          <a className="link" href={DEMO_VIDEO_URL} target="_blank" rel="noreferrer">
            ▶ Watch the video
          </a>
        </div>
      )}

      {!key ? (
        <div className="card text-red-300">“{address}” is not a valid Solana address.</div>
      ) : !vault.view.loaded ? (
        <div className="card text-zinc-500">Loading the vault…</div>
      ) : !vault.view.state ? (
        <div className="card text-zinc-300">No Leash vault at this address on devnet.</div>
      ) : (
        <main className="grid gap-6 lg:grid-cols-2">
          <section className="flex flex-col gap-6">
            <VaultCard address={key} state={vault.view.state} balance={vault.view.balance} keys={keys} showOwner />
          </section>
          <section className="flex flex-col gap-6">
            <ActivityLog view={activity.view} labels={labels} />
          </section>
        </main>
      )}
    </div>
  );
}
