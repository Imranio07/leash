"use client";

import { Buffer } from "buffer";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { useMemo, type ReactNode } from "react";
import { RPC_URL } from "@/lib/config";
import "@solana/wallet-adapter-react-ui/styles.css";

if (typeof window !== "undefined" && !window.Buffer) window.Buffer = Buffer;

export default function Providers({ children }: { children: ReactNode }) {
  // Phantom registers itself through the Wallet Standard, so no adapter list is needed.
  const wallets = useMemo(() => [], []);
  return (
    // No automatic 429 retries: pollers back off on their own (see usePolling).
    <ConnectionProvider endpoint={RPC_URL} config={{ commitment: "confirmed", disableRetryOnRateLimit: true }}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
