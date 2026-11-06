"use client";

// Everything below needs the browser (wallet adapter, Buffer), so it is loaded without SSR.

import { Buffer } from "buffer";
import dynamic from "next/dynamic";

if (typeof window !== "undefined" && !window.Buffer) window.Buffer = Buffer;

const Dashboard = dynamic(() => import("./Dashboard"), {
  ssr: false,
  loading: () => <div className="p-10 text-zinc-500">Loading…</div>,
});

export default function ClientApp() {
  return <Dashboard />;
}
