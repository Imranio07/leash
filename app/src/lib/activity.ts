"use client";

// Live activity of a vault, read from the chain only: signatures for the vault address,
// then the parsed transactions, decoded with the program IDL.

import { decodeActivity, type ActivityEntry, type LeashProgram } from "@leash/sdk";
import { useConnection } from "@solana/wallet-adapter-react";
import type { PublicKey } from "@solana/web3.js";
import { useRef, useState } from "react";
import { usePolling } from "./hooks";

const MAX_SIGNATURES = 30;
const MAX_FETCH_TRIES = 5;
/** The public devnet RPC rate-limits batched transaction lookups, so decode a few per tick, newest first. */
const FETCH_PER_TICK = 4;

interface Pending {
  slot: number;
  blockTime: number | null;
  tries: number;
}

export interface ActivityView {
  entries: ActivityEntry[];
  /** Transactions seen but not decodable yet (the RPC has not served them). */
  pending: number;
  loaded: boolean;
}

export function useActivity(program: LeashProgram, vault: PublicKey | null) {
  const { connection } = useConnection();
  const decoded = useRef(new Map<string, ActivityEntry[]>());
  const pending = useRef(new Map<string, Pending>());
  const lastVault = useRef<string | null>(null);
  const [view, setView] = useState<ActivityView>({ entries: [], pending: 0, loaded: false });

  const refresh = usePolling(async () => {
    const key = vault?.toBase58() ?? null;
    if (key !== lastVault.current) {
      decoded.current.clear();
      pending.current.clear();
      lastVault.current = key;
      setView({ entries: [], pending: 0, loaded: false });
    }
    if (!vault) return;

    const infos = await connection.getSignaturesForAddress(vault, { limit: MAX_SIGNATURES }, "confirmed");
    for (const info of infos) {
      if (!decoded.current.has(info.signature) && !pending.current.has(info.signature)) {
        pending.current.set(info.signature, { slot: info.slot, blockTime: info.blockTime ?? null, tries: 0 });
      }
    }

    const toFetch = [...pending.current.entries()]
      .filter(([, p]) => p.tries < MAX_FETCH_TRIES)
      .sort((a, b) => b[1].slot - a[1].slot)
      .slice(0, FETCH_PER_TICK)
      .map(([s]) => s);
    if (toFetch.length) {
      try {
        const txs = await connection.getParsedTransactions(toFetch, { maxSupportedTransactionVersion: 0, commitment: "confirmed" });
        txs.forEach((tx, i) => {
          const sig = toFetch[i]!;
          if (tx) {
            decoded.current.set(sig, decodeActivity(program, tx));
            pending.current.delete(sig);
          } else {
            pending.current.get(sig)!.tries++;
          }
        });
      } catch (e) {
        // Rate-limited: leave them pending and try again next tick.
        if (!/429|Too many requests/i.test(String(e))) throw e;
      }
    }

    const entries = [...decoded.current.values()].flat().sort((a, b) => b.slot - a.slot || b.signature.localeCompare(a.signature));
    setView({ entries, pending: pending.current.size, loaded: true });
  }, [vault?.toBase58(), program]);

  return { view, refresh };
}
