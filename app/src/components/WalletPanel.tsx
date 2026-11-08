"use client";

import { formatUsdc } from "@leash/sdk";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { explorerAddress } from "@leash/sdk";
import { short, USDC_MINT } from "@/lib/config";
import type { Balances } from "@/lib/hooks";
import { PUBLIC_DEMO } from "@/lib/publicDemo";

interface Props {
  balances: Balances;
  isDevnet: boolean | null;
  /** Rendered next to the USDC balance (e.g. the test-USDC faucet button). */
  usdcAction?: React.ReactNode;
}

export default function WalletPanel({ balances, isDevnet, usdcAction }: Props) {
  const { publicKey, disconnect, connecting, wallet } = useWallet();
  const { setVisible } = useWalletModal();

  if (!publicKey) {
    return (
      <div className="card flex flex-col items-start gap-4">
        <div>
          <div className="label">Owner</div>
          <h2 className="mt-1 text-2xl font-semibold">Connect your wallet</h2>
          <p className="mt-2 max-w-md text-zinc-400">
            The owner creates a vault, funds it and sets the rules. Everything runs on <b>Solana devnet</b>: switch
            Phantom to Devnet first (Settings → Developer Settings → Testnet Mode).
          </p>
          {PUBLIC_DEMO && (
            <p className="mt-2 max-w-md text-sm text-zinc-400">
              You need a little devnet SOL for fees: get it free at{" "}
              <a className="link" href="https://faucet.solana.com" target="_blank" rel="noreferrer">
                faucet.solana.com
              </a>
              . Test USDC comes from the <b>Get test USDC</b> button once you are connected.
            </p>
          )}
        </div>
        <button className="btn-primary px-6 py-3 text-base" onClick={() => setVisible(true)} disabled={connecting}>
          {connecting ? "Connecting…" : "Connect Phantom"}
        </button>
      </div>
    );
  }

  const noSol = balances.loaded && balances.sol !== null && balances.sol < 0.005;

  return (
    <div className="card">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="label">Owner · {wallet?.adapter.name ?? "wallet"}</div>
          <a className="mono link mt-1 block text-lg" href={explorerAddress(publicKey)} target="_blank" rel="noreferrer">
            {short(publicKey, 6)}
          </a>
        </div>
        <button className="btn-secondary" onClick={() => disconnect()}>
          Disconnect
        </button>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4">
        <div>
          <div className="label">SOL (fees)</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums">
            {balances.sol === null ? "…" : balances.sol.toFixed(3)}
          </div>
        </div>
        <div>
          <div className="label">USDC</div>
          <div className="mt-1 flex flex-wrap items-center gap-3">
            <span className="text-2xl font-semibold tabular-nums">
              {!USDC_MINT ? "—" : !balances.loaded ? "…" : formatUsdc(balances.usdc ?? 0n)}
            </span>
            {usdcAction}
          </div>
        </div>
      </div>

      {isDevnet === false && (
        <Hint tone="red">
          The dashboard RPC is not devnet. Set <span className="mono">NEXT_PUBLIC_RPC_URL</span> to a devnet endpoint.
        </Hint>
      )}
      {noSol && (
        <Hint tone="amber">
          This wallet has no SOL on devnet, so it cannot pay transaction fees. In Phantom open Settings → Developer
          Settings → turn on <b>Testnet Mode</b> and pick <b>Solana Devnet</b>, then get free SOL at{" "}
          <a className="link" href="https://faucet.solana.com" target="_blank" rel="noreferrer">
            faucet.solana.com
          </a>
          . If Phantom is on Mainnet, it will also warn about every transaction.
        </Hint>
      )}
      {!USDC_MINT && (
        <Hint tone="amber">
          No USDC mint configured. Run <span className="mono">npm run setup</span> in the repo, then restart the
          dashboard.
        </Hint>
      )}
    </div>
  );
}

export function Hint({ tone, children }: { tone: "red" | "amber" | "zinc"; children: React.ReactNode }) {
  const cls = {
    red: "border-red-500/40 bg-red-500/10 text-red-200",
    amber: "border-amber-500/40 bg-amber-500/10 text-amber-100",
    zinc: "border-zinc-700 bg-zinc-800/50 text-zinc-300",
  }[tone];
  return <div className={`mt-4 rounded-lg border px-4 py-3 text-sm leading-relaxed ${cls}`}>{children}</div>;
}
