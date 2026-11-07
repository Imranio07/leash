// Drives a real headless Chrome through the DevTools protocol (no npm packages): opens the
// dashboard, clicks agent-console presets and Run, and prints what the page shows.
// The owner is a read-only Wallet Standard test wallet (it can't sign); the agent console
// needs no owner signature. Run it through `npm run e2e` (scripts/e2e-console.ts).
// Usage: node cdp.mjs <url> <ownerPubkeyBase58|-> <ownerBytesJson|-> <mode: inspect|run> [preset labels...]
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [url, ownerAddress, ownerBytesJson, mode, ...labels] = process.argv.slice(2);
const PORT = 9333;
const profile = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "leash-chrome-"));
const chrome = spawn(
  process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", "--window-size=1600,1200", "about:blank"],
  { stdio: "ignore" },
);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let target;
for (let i = 0; i < 50 && !target; i++) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    target = list.find((t) => t.type === "page");
  } catch {}
  if (!target) await sleep(200);
}
if (!target) throw new Error("chrome did not start");

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let id = 0;
const pending = new Map();
const consoleLines = [];
ws.addEventListener("message", (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  } else if (msg.method === "Runtime.consoleAPICalled") {
    consoleLines.push(`[console.${msg.params.type}] ${msg.params.args.map((a) => a.value ?? a.description ?? "").join(" ")}`);
  } else if (msg.method === "Runtime.exceptionThrown") {
    consoleLines.push(`[exception] ${msg.params.exceptionDetails?.exception?.description ?? msg.params.exceptionDetails?.text}`);
  }
});
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const n = ++id;
    pending.set(n, (m) => (m.error ? reject(new Error(`${method}: ${m.error.message}`)) : resolve(m.result)));
    ws.send(JSON.stringify({ id: n, method, params }));
  });
const evaluate = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
};

await send("Page.enable");
await send("Runtime.enable");

if (ownerAddress !== "-") {
  // A read-only Wallet Standard wallet with the owner's public key; it cannot sign anything.
  await send("Page.addScriptToEvaluateOnNewDocument", {
    source: `
      (() => {
        localStorage.setItem("walletName", JSON.stringify("Read-only test wallet"));
        const listeners = [];
        const account = { address: ${JSON.stringify(ownerAddress)}, publicKey: new Uint8Array(${ownerBytesJson}),
          chains: ["solana:devnet"], features: ["solana:signTransaction"] };
        const wallet = {
          version: "1.0.0", name: "Read-only test wallet",
          icon: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0naHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmcnLz4=",
          chains: ["solana:devnet"], accounts: [],
          features: {
            "standard:connect": { version: "1.0.0", connect: async () => {
              wallet.accounts = [account]; listeners.forEach((l) => l({ accounts: wallet.accounts }));
              return { accounts: wallet.accounts }; } },
            "standard:disconnect": { version: "1.0.0", disconnect: async () => { wallet.accounts = []; } },
            "standard:events": { version: "1.0.0", on: (_e, l) => { listeners.push(l); return () => {}; } },
            "solana:signTransaction": { version: "1.0.0", supportedTransactionVersions: ["legacy", 0],
              signTransaction: async () => { throw new Error("read-only test wallet cannot sign"); } },
          },
        };
        const callback = ({ register }) => register(wallet);
        try { window.dispatchEvent(new CustomEvent("wallet-standard:register-wallet", { detail: callback })); } catch {}
        window.addEventListener("wallet-standard:app-ready", ({ detail }) => callback(detail));
      })();`,
  });
}

await send("Page.navigate", { url });
const until = async (expr, ms, what) => {
  for (let t = 0; t < ms; t += 250) {
    if (await evaluate(expr).catch(() => false)) return;
    await sleep(250);
  }
  throw new Error(`timeout waiting for ${what}`);
};
await until(`!!document.querySelector("input.input") && [...document.querySelectorAll("button")].some(b => b.textContent.trim() === "Budget")`, 60000, "the agent console");

const clickByText = (text) =>
  evaluate(`(() => { const b = [...document.querySelectorAll("button")].find(b => b.textContent.trim() === ${JSON.stringify(text)}); if (!b) return false; b.click(); return true; })()`);
const consoleInput = `[...document.querySelectorAll("form input")].find(i => i.placeholder?.startsWith("Tell the agent"))`;
const fieldValue = () => evaluate(`${consoleInput}?.value ?? null`);
const outputText = () => evaluate(`(() => { const el = document.querySelector("div.mono.mt-4"); return el ? el.innerText : null; })()`);

if (mode === "inspect") {
  for (const label of labels) {
    const clicked = await clickByText(label);
    await sleep(300);
    console.log(`PRESET ${JSON.stringify(label)} clicked=${clicked} → field: ${JSON.stringify(await fieldValue())}`);
  }
}

if (mode === "run") {
  await until(`(() => { const b = [...document.querySelectorAll("form button")].find(b => b.textContent.trim() === "Run"); return b && !b.disabled; })()`, 60000, "an enabled Run button (vault loaded)");
  for (const [i, label] of labels.entries()) {
    if (i > 0) await sleep(Number(process.env.PAUSE_MS ?? 20000));
    await clickByText(label);
    await sleep(300);
    console.log(`\n================ PRESET: ${label}`);
    console.log(`field before Run: ${await fieldValue()}`);
    await evaluate(`[...document.querySelectorAll("form button")].find(b => b.textContent.trim() === "Run").click()`);
    await until(`(() => { const el = document.querySelector("div.mono.mt-4"); return el && /\\[agent finished|✗ (HTTP|an agent run|no vault|this vault)/.test(el.innerText); })()`, 180000, `the run of ${label}`);
    console.log(await outputText());
  }
}

if (consoleLines.length) console.log(`\n--- browser console ---\n${consoleLines.slice(-15).join("\n")}`);
ws.close();
chrome.kill();
process.exit(0);
