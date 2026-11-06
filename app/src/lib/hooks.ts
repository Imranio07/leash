"use client";

import { useConnection } from "@solana/wallet-adapter-react";
import { getAccount, getAssociatedTokenAddressSync, TokenAccountNotFoundError } from "@solana/spl-token";
import { LAMPORTS_PER_SOL, type PublicKey } from "@solana/web3.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { DEVNET_GENESIS_HASH, POLL_MS, USDC_MINT } from "./config";

/** Runs `fn` now and every `ms`, with a manual `refresh()`. Ignores results from stale runs. */
export function usePolling(fn: () => Promise<void>, deps: unknown[], ms = POLL_MS) {
  const [tick, setTick] = useState(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  useEffect(() => {
    let alive = true;
    const run = () => fnRef.current().catch((e) => console.warn("poll failed", e));
    run();
    const id = setInterval(() => alive && run(), ms);
    return () => {
      alive = false;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick, ms]);
  return useCallback(() => setTick((t) => t + 1), []);
}

/** Whether the RPC endpoint is really devnet (checked once). */
export function useIsDevnet(): boolean | null {
  const { connection } = useConnection();
  const [isDevnet, setIsDevnet] = useState<boolean | null>(null);
  useEffect(() => {
    connection
      .getGenesisHash()
      .then((h) => setIsDevnet(h === DEVNET_GENESIS_HASH))
      .catch(() => setIsDevnet(null));
  }, [connection]);
  return isDevnet;
}

export interface Balances {
  sol: number | null;
  /** USDC base units; null when the wallet has no token account for the mint. */
  usdc: bigint | null;
  loaded: boolean;
}

/** SOL and USDC balances of a wallet, refreshed on every poll. */
export function useBalances(owner: PublicKey | null) {
  const { connection } = useConnection();
  const [balances, setBalances] = useState<Balances>({ sol: null, usdc: null, loaded: false });

  const refresh = usePolling(async () => {
    if (!owner) {
      setBalances({ sol: null, usdc: null, loaded: false });
      return;
    }
    const lamports = await connection.getBalance(owner, "confirmed");
    let usdc: bigint | null = null;
    if (USDC_MINT) {
      try {
        usdc = (await getAccount(connection, getAssociatedTokenAddressSync(USDC_MINT, owner, true), "confirmed")).amount;
      } catch (e) {
        if (!(e instanceof TokenAccountNotFoundError)) throw e;
      }
    }
    setBalances({ sol: lamports / LAMPORTS_PER_SOL, usdc, loaded: true });
  }, [owner?.toBase58(), connection]);

  return { balances, refresh };
}
