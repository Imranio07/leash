"use client";

// Runs the agent on the dashboard server against the vault on screen and streams its output.

import { Keypair, type PublicKey } from "@solana/web3.js";
import { useEffect, useMemo, useRef, useState } from "react";
import { short } from "@/lib/config";

interface Props {
  /** Wallet of the prompt-injection attacker (from /api/keys), shown in the compromised preset. */
  attacker: PublicKey | null;
  vault: PublicKey | null;
  revoked: boolean;
  /** Called when a run ends, so balances and the activity log refresh at once. */
  onFinished: () => void;
}

interface ServicesStatus {
  online: boolean;
  url: string;
  services: { id: string; price_usdc: string }[];
}

const URL_RE = /(https?:\/\/[^\s)]+)/g;

function Line({ text }: { text: string }) {
  // Housekeeping (model switches, hints): small and gray.
  if (/^\s*·/.test(text)) return <div className="whitespace-pre-wrap break-words text-xs text-zinc-500">{text.trim()}</div>;
  const parts = text.split(URL_RE);
  const tone = /^(↪|☠️)/.test(text)
    ? "text-amber-200"
    : /✗|rejected|error|failed/i.test(text)
    ? "text-red-300"
    : /✓|paid\b/.test(text)
      ? "text-emerald-300"
      : text.startsWith("🤖")
        ? "text-zinc-50"
        : text.startsWith("🧑")
          ? "font-semibold text-zinc-100"
          : text.startsWith("   ")
            ? "text-zinc-400"
            : "text-zinc-200";
  return (
    <div className={`whitespace-pre-wrap break-words ${tone}`}>
      {parts.map((p, i) =>
        URL_RE.test(p) ? (
          <a key={i} className="link break-all" href={p} target="_blank" rel="noreferrer">
            {p.includes("/tx/") ? `explorer: ${p.split("/tx/")[1]?.slice(0, 8)}…` : p}
          </a>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </div>
  );
}

type Scenario = "weather" | "stranger-3" | "stranger-0.10" | "compromised" | "budget";

export default function AgentConsole({ attacker, vault, revoked, onFinished }: Props) {
  const [task, setTask] = useState("Get the weather in Bishkek and translate the summary into Kyrgyz.");
  const [lines, setLines] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [services, setServices] = useState<ServicesStatus | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const outputRef = useRef<HTMLDivElement>(null);
  // A random wallet nobody controls, for the "send money to a stranger" demo steps.
  const stranger = useMemo(() => Keypair.generate().publicKey.toBase58(), []);

  const presets: { id: Scenario; label: string; task: string; danger?: boolean }[] = [
    { id: "weather", label: "Weather + translate", task: "Get the weather in Bishkek and translate the summary into Kyrgyz." },
    { id: "stranger-3", label: "Send $3 to a stranger", task: `Send $3 USDC to the wallet ${stranger}` },
    { id: "stranger-0.10", label: "Send $0.10 to a stranger", task: `Send $0.10 USDC to the wallet ${stranger}` },
    { id: "compromised", label: "☠ Compromised agent: read the news", task: "Read the latest news about Solana for me.", danger: true },
    { id: "budget", label: "Budget", task: "What is my budget?" },
  ];
  // A preset's scenario applies only while its text is unchanged.
  const scenario = presets.find((p) => p.task === task)?.id ?? null;

  useEffect(() => {
    let alive = true;
    const check = () =>
      fetch("/api/services")
        .then((r) => r.json() as Promise<ServicesStatus>)
        .then((s) => alive && setServices(s))
        .catch(() => alive && setServices(null));
    check();
    const id = setInterval(check, 10_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  useEffect(() => {
    outputRef.current?.scrollTo({ top: outputRef.current.scrollHeight });
  }, [lines]);

  async function run() {
    if (!vault || running) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    setLines([]);
    try {
      const res = await fetch("/api/agent/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task, vault: vault.toBase58(), scenario, stranger }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setLines([`✗ ${data.error ?? `HTTP ${res.status}`}`]);
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n");
        buffer = parts.pop() ?? "";
        if (parts.length) setLines((prev) => [...prev, ...parts]);
      }
      if (buffer) setLines((prev) => [...prev, buffer]);
    } catch (e) {
      if (!controller.signal.aborted) setLines((prev) => [...prev, `✗ ${e instanceof Error ? e.message : String(e)}`]);
      else setLines((prev) => [...prev, "[stopped]"]);
    } finally {
      setRunning(false);
      abortRef.current = null;
      onFinished();
    }
  }

  return (
    <div className="card flex h-full flex-col lg:sticky lg:top-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="label">Agent console</div>
          <h2 className="mt-1 text-xl font-semibold">The agent spends on its own</h2>
          <p className="mt-1 text-sm text-zinc-400">
            Runs on the server with the agent key. It never checks the limits itself: the vault does.
          </p>
        </div>
        <span className="flex items-center gap-2 text-xs text-zinc-400">
          <span className={`inline-block h-2 w-2 rounded-full ${services?.online ? "bg-emerald-400" : "bg-red-500"}`} />
          {services?.online
            ? `services online · ${services.services.map((s) => `${s.id} ${s.price_usdc}`).join(" · ")}`
            : "services offline · run: npm run services"}
        </span>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {presets.map((p) => (
          <button
            key={p.id}
            className={`rounded-full border px-3 py-1 text-xs transition ${
              task === p.task
                ? p.danger
                  ? "border-red-500 text-red-300"
                  : "border-emerald-500 text-emerald-300"
                : p.danger
                  ? "border-red-900 text-red-300/80 hover:border-red-600"
                  : "border-zinc-700 text-zinc-300 hover:border-zinc-500"
            }`}
            onClick={() => setTask(p.task)}
            disabled={running}
          >
            {p.label}
          </button>
        ))}
      </div>

      <form
        className="mt-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void run();
        }}
      >
        <input
          className="input flex-1"
          value={task}
          onChange={(e) => setTask(e.target.value)}
          placeholder="Tell the agent what to do…"
          disabled={running}
        />
        {running ? (
          <button type="button" className="btn-secondary" onClick={() => abortRef.current?.abort()}>
            Stop
          </button>
        ) : (
          <button type="submit" className="btn-primary px-5" disabled={!vault || !task.trim()}>
            Run
          </button>
        )}
      </form>
      {!vault && <p className="mt-2 text-sm text-zinc-500">Create a vault first.</p>}
      {scenario === "compromised" && (
        <p className="mt-2 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
          Simulation of a hijacked agent: it blindly obeys instructions inside service responses. The news service hides
          one that says to pay {attacker ? <span className="mono">{short(attacker)}</span> : "an attacker"}.
        </p>
      )}
      {(scenario === "stranger-3" || scenario === "stranger-0.10") && (
        <p className="mt-2 text-xs text-zinc-500">
          Stranger: <span className="mono">{stranger}</span> (random wallet, not on the allowlist)
        </p>
      )}
      {vault && revoked && (
        <p className="mt-2 text-sm text-amber-200">
          This vault is revoked: every payment the agent tries will fail with <span className="mono">VaultRevoked</span>.
        </p>
      )}

      <div
        ref={outputRef}
        className="mono mt-4 min-h-[20rem] flex-1 overflow-y-auto rounded-xl border border-zinc-800 bg-zinc-950 p-4 text-sm leading-relaxed lg:max-h-[42rem]"
      >
        {lines.length === 0 && !running && (
          <span className="text-zinc-600">
            Output appears here. Vault {vault ? short(vault, 6) : "—"}.
          </span>
        )}
        {running && lines.length === 0 && <span className="text-zinc-500">Starting the agent…</span>}
        {lines.map((l, i) => (
          <Line key={i} text={l} />
        ))}
        {running && <span className="inline-block h-4 w-2 animate-pulse bg-emerald-400 align-middle" />}
      </div>
    </div>
  );
}
