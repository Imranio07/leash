"use client";

import { decodeVault, leashProgram, vaultAddress, vaultTokenAddress, type LeashProgram, type VaultState } from "@leash/sdk";
import { useConnection } from "@solana/wallet-adapter-react";
import { getAssociatedTokenAddressSync, unpackAccount } from "@solana/spl-token";
import type { AccountInfo } from "@solana/web3.js";
import { LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DEVNET_GENESIS_HASH, POLL_MS, PROGRAM_ID, USDC_MINT } from "./config";

/**
 * Runs `fn` now and every `ms`, with a manual `refresh()`. Skips ticks while the tab is
 * hidden: the public devnet RPC rate-limits per IP, and every open tab counts.
 */
export function usePolling(fn: () => Promise<void>, deps: unknown[], ms = POLL_MS) {
  const [tick, setTick] = useState(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  useEffect(() => {
    let alive = true;
    // On a 429 from the RPC, wait longer before the next poll (up to 30 s).
    let pauseUntil = 0;
    let failures = 0;
    const run = () => {
      if (Date.now() < pauseUntil) return;
      fnRef
        .current()
        .then(() => {
          failures = 0;
        })
        .catch((e) => {
          if (/429|Too many requests|rate limit/i.test(String(e))) {
            failures++;
            pauseUntil = Date.now() + Math.min(30_000, ms * 2 ** failures);
          } else console.warn("poll failed", e);
        });
    };
    run();
    const id = setInterval(() => alive && !document.hidden && run(), ms);
    const onVisible = () => alive && !document.hidden && run();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive = false;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
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

function tokenAmount(address: PublicKey | null, info: AccountInfo<Buffer> | null | undefined): bigint | null {
  if (!address || !info) return null;
  try {
    return unpackAccount(address, info, info.owner).amount;
  } catch {
    return null;
  }
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
    // One request for both: the wallet (SOL) and its USDC token account.
    const ata = USDC_MINT ? getAssociatedTokenAddressSync(USDC_MINT, owner, true) : null;
    const [wallet, token] = await connection.getMultipleAccountsInfo(ata ? [owner, ata] : [owner], "confirmed");
    setBalances({ sol: (wallet?.lamports ?? 0) / LAMPORTS_PER_SOL, usdc: tokenAmount(ata, token), loaded: true });
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

/**
 * Public keys from the server (agent, service wallets, attacker). Never includes private keys.
 * Re-read every few seconds, so `npm run fresh` shows up without reloading the page.
 */
export function useKeys() {
  const [keys, setKeys] = useState<Keys | null>(null);
  const [error, setError] = useState<string | null>(null);
  const last = useRef<string>("");

  const reload = usePolling(async () => {
    const r = await fetch("/api/keys", { cache: "no-store" });
    const text = await r.text();
    const data = JSON.parse(text) as {
      agent?: string;
      services?: Record<string, string>;
      attacker?: string;
      cliVault?: string | null;
      error?: string;
    };
    if (!r.ok || !data.agent) {
      setError(data.error ?? `HTTP ${r.status}`);
      return;
    }
    setError(null);
    if (text === last.current) return; // unchanged: keep the same objects
    last.current = text;
    setKeys({
      agent: new PublicKey(data.agent),
      services: Object.fromEntries(Object.entries(data.services ?? {}).map(([k, v]) => [k, new PublicKey(v)])),
      attacker: data.attacker ? new PublicKey(data.attacker) : null,
      cliVault: data.cliVault ?? null,
    });
  }, [], 5000);

  return { keys, error, reload };
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
    // One request for the vault and its token account (assuming the configured mint).
    const guess = USDC_MINT ? vaultTokenAddress(address, USDC_MINT) : null;
    const [vaultInfo, tokenInfo] = await connection.getMultipleAccountsInfo(guess ? [address, guess] : [address], "confirmed");
    const state = vaultInfo ? decodeVault(program, address, vaultInfo.data) : null;
    let balance = tokenAmount(guess, tokenInfo) ?? 0n;
    if (state && (!USDC_MINT || !state.mint.equals(USDC_MINT))) {
      const ata = vaultTokenAddress(address, state.mint);
      balance = tokenAmount(ata, await connection.getAccountInfo(ata, "confirmed")) ?? 0n;
    }
    setView({ loaded: true, state, balance });
  }, [address?.toBase58(), program]);

  return { program, address, view, refresh };
}
