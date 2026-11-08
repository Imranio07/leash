"use client";

import { explorerAddress } from "@leash/sdk";
import type { PublicKey } from "@solana/web3.js";
import { short } from "@/lib/config";
import { DEMO_VIDEO_URL, REPO_URL } from "@/lib/publicDemo";

/** Stands in for the agent console on the public site: the agent needs its key and LLM keys. */
export default function PublicAgentNotice({ agent }: { agent: PublicKey | null }) {
  return (
    <div className="card">
      <div className="label">Agent console</div>
      <h2 className="mt-1 text-2xl font-semibold">The agent and paid services run locally</h2>
      <p className="mt-3 leading-relaxed text-zinc-300">
        Watch the demo video, or clone the repo and run <span className="mono rounded bg-zinc-800 px-1.5 py-0.5">npm run demo</span>.
        The agent holds its own key and the LLM API keys, so this public site does not run it.
      </p>
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <a className="btn-primary px-5 py-2.5" href={DEMO_VIDEO_URL} target="_blank" rel="noreferrer">
          ▶ Watch the demo video
        </a>
        <a className="btn-secondary px-5 py-2.5" href={REPO_URL} target="_blank" rel="noreferrer">
          GitHub: how to run it
        </a>
      </div>
      {agent && (
        <p className="mt-5 text-sm leading-relaxed text-zinc-400">
          A vault you create here names the Leash demo agent key{" "}
          <a className="mono link" href={explorerAddress(agent)} target="_blank" rel="noreferrer">
            {short(agent, 6)}
          </a>
          . Like any agent, it can only pay the allowed recipients within your limits, and Revoke stops it at once.
          You can always withdraw.
        </p>
      )}
    </div>
  );
}
