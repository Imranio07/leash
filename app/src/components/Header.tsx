"use client";

import { explorerAddress, rpcHost } from "@leash/sdk";
import { PROGRAM_ID, RPC_PROXIED, RPC_URL, short } from "@/lib/config";
import { DEMO_VAULT, DEMO_VIDEO_URL, PUBLIC_DEMO, REPO_URL } from "@/lib/publicDemo";

/** Page header. On the public site it also links the demo vault and the video. */
export default function Header({ showDemoLinks = true }: { showDemoLinks?: boolean }) {
  const rpc = RPC_PROXIED ? "server RPC" : rpcHost(RPC_URL);
  return (
    <>
      <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <a href="/" className="flex items-center gap-3">
          <span className="text-3xl">🐕‍🦺</span>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Leash</h1>
            <p className="text-sm text-zinc-400">The payment firewall for AI agents</p>
          </div>
        </a>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span
            className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 font-medium text-emerald-300"
            title={`RPC: ${rpc}`}
          >
            devnet · {rpc}
          </span>
          <a className="mono link" href={explorerAddress(PROGRAM_ID)} target="_blank" rel="noreferrer">
            program {short(PROGRAM_ID)}
          </a>
          {PUBLIC_DEMO && (
            <a className="link" href={REPO_URL} target="_blank" rel="noreferrer">
              GitHub
            </a>
          )}
        </div>
      </header>

      {PUBLIC_DEMO && showDemoLinks && (
        <div className="card mb-6 flex flex-wrap items-center justify-between gap-4">
          <p className="max-w-2xl text-sm leading-relaxed text-zinc-300">
            <b>Live demo on Solana devnet.</b> See the vault from the demo video, with real payments, rejections and a
            revoke, or connect Phantom (Devnet) and create your own vault below.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            {DEMO_VAULT && (
              <a className="btn-primary px-5 py-2.5" href={`/vault/${DEMO_VAULT}`}>
                View the demo vault
              </a>
            )}
            <a className="btn-secondary px-5 py-2.5" href={DEMO_VIDEO_URL} target="_blank" rel="noreferrer">
              ▶ Demo video
            </a>
          </div>
        </div>
      )}
    </>
  );
}
