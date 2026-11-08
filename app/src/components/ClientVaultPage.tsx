"use client";

// The read-only vault page needs the browser (web3.js, Buffer), so it is loaded without SSR.

import { Buffer } from "buffer";
import dynamic from "next/dynamic";

if (typeof window !== "undefined" && !window.Buffer) window.Buffer = Buffer;

const VaultPage = dynamic(() => import("./VaultPage"), {
  ssr: false,
  loading: () => <div className="p-10 text-zinc-500">Loading…</div>,
});

export default function ClientVaultPage({ address }: { address: string }) {
  return <VaultPage address={address} />;
}
