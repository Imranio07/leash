"use client";

import { fetchVault, leashProgram, vaultAddress, vaultTokenAddress, type LeashProgram, type VaultState } from "@leash/sdk";
import { useConnection } from "@solana/wallet-adapter-react";
import { getAccount, getAssociatedTokenAddressSync, TokenAccountNotFoundError } from "@solana/spl-token";
import { LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DEVNET_GENESIS_HASH, POLL_MS, PROGRAM_ID, USDC_MINT } from "./config";

/** Runs `fn` now and every `ms`, with a manual `refresh()`. */
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

export interface Keys {
  agent: PublicKey;
  services: Record<string, PublicKey>;
  /** Wallet of the prompt-injection attacker in the news demo. */
  attacker: PublicKey | null;
  /** Vault the CLI agent currently points at (LEASH_VAULT in .env). */
  cliVault: string | null;
}

/** Public keys from the server (agent, service wallets). Never includes private keys. */
export function useKeys() {
  const [keys, setKeys] = useState<Keys | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    fetch("/api/keys")
      .then(async (r) => {
        const data = (await r.json()) as {
          agent?: string;
          services?: Record<string, string>;
          attacker?: string;
          cliVault?: string | null;
          error?: string;
        };
        if (!alive) return;
        if (!r.ok || !data.agent) throw new Error(data.error ?? `HTTP ${r.status}`);
        setKeys({
          agent: new PublicKey(data.agent),
          services: Object.fromEntries(Object.entries(data.services ?? {}).map(([k, v]) => [k, new PublicKey(v)])),
          attacker: data.attacker ? new PublicKey(data.attacker) : null,
          cliVault: data.cliVault ?? null,
        });
        setError(null);
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, [tick]);
  return { keys, error, reload: () => setTick((t) => t + 1) };
}

export interface VaultView {
  loaded: boolean;
  state: VaultState | null;
  /** USDC held by the vault, base units. */
  balance: bigint;
}

/** The vault of (owner, agent): its PDA, on-chain state and token balance, polled. */
export function useVault(owner: PublicKey | null, agent: PublicKey | null) {
  const { connection } = useConnection();
  const program: LeashProgram = useMemo(() => leashProgram(connection, PROGRAM_ID), [connection]);
  const address = useMemo(
    () => (owner && agent ? vaultAddress(owner, agent, PROGRAM_ID) : null),
    [owner?.toBase58(), agent?.toBase58()], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const [view, setView] = useState<VaultView>({ loaded: false, state: null, balance: 0n });

  const refresh = usePolling(async () => {
    if (!address) {
      setView({ loaded: false, state: null, balance: 0n });
      return;
    }
    const state = await fetchVault(program, address);
    let balance = 0n;
    if (state) {
      try {
        balance = (await getAccount(connection, vaultTokenAddress(address, state.mint), "confirmed")).amount;
      } catch (e) {
        if (!(e instanceof TokenAccountNotFoundError)) throw e;
      }
    }
    setView({ loaded: true, state, balance });
  }, [address?.toBase58(), program]);

  return { program, address, view, refresh };
}
