// Node-only: .env, file paths and keypair files.

import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { Keypair, PublicKey } from "@solana/web3.js";

/**
 * Repo root: the directory holding Anchor.toml. Checked in this order: LEASH_ROOT,
 * the location of this file (sdk/src/config.ts; a bundler may have moved it), then upwards
 * from the working directory.
 */
function findRoot(): string {
  const fromEnv = process.env.LEASH_ROOT;
  const hasAnchorToml = (dir: string) => existsSync(resolve(dir, "Anchor.toml"));
  if (fromEnv && hasAnchorToml(fromEnv)) return resolve(fromEnv);
  const starts = [resolve(dirname(fileURLToPath(import.meta.url)), "../.."), process.cwd()];
  for (const start of starts) {
    for (let dir = start; ; dir = dirname(dir)) {
      if (hasAnchorToml(dir)) return dir;
      if (dirname(dir) === dir) break;
    }
  }
  throw new Error("Leash repo root not found (no Anchor.toml above the working directory). Set LEASH_ROOT.");
}

export const ROOT = findRoot();
const ENV_PATH = resolve(ROOT, ".env");

/** Keys whose current value came from .env (so a newer .env may replace them). */
const fromFile = new Set<string>();
let loadedMtime = -1;

function readEnvFile(): Record<string, string> {
  return existsSync(ENV_PATH) ? (parseEnv(readFileSync(ENV_PATH, "utf8")) as Record<string, string>) : {};
}

/**
 * Loads ROOT/.env, and again whenever the file changes, so long-running processes (the
 * dashboard server) see edits without a restart. A non-empty value set in the shell wins;
 * an empty one does not block the file.
 */
export function loadEnv(): void {
  const mtime = existsSync(ENV_PATH) ? statSync(ENV_PATH).mtimeMs : 0;
  if (mtime === loadedMtime) return;
  loadedMtime = mtime;
  for (const [key, value] of Object.entries(readEnvFile())) {
    const current = process.env[key];
    const fromShell = current !== undefined && current !== "" && !fromFile.has(key);
    if (fromShell) continue;
    process.env[key] = value;
    fromFile.add(key);
  }
}

/**
 * Environment for a child process (agent, services) that reads .env itself: every key that
 * .env defines is removed, so the child gets the file's current values, not a stale copy.
 */
export function childEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = { ...process.env };
  for (const key of Object.keys(readEnvFile())) delete out[key];
  return { ...out, ...extra };
}

export function env(name: string, fallback = ""): string {
  loadEnv();
  const v = process.env[name]?.trim();
  return v ? v : fallback;
}

/** Expands "~" and resolves relative paths against the repo root. */
export function resolvePath(p: string): string {
  const expanded = p.startsWith("~/") ? resolve(homedir(), p.slice(2)) : p;
  return isAbsolute(expanded) ? expanded : resolve(ROOT, expanded);
}

export interface Config {
  rpcUrl: string;
  /** null until `npm run setup` creates or picks a mint. */
  mint: PublicKey | null;
  ownerKeypairPath: string;
  agentKeypairPath: string;
  servicesUrl: string;
  servicesPort: number;
}

export function getConfig(): Config {
  const mint = env("USDC_MINT");
  return {
    rpcUrl: env("RPC_URL", "https://api.devnet.solana.com"),
    mint: mint ? new PublicKey(mint) : null,
    ownerKeypairPath: resolvePath(env("OWNER_KEYPAIR", "~/.config/solana/id.json")),
    agentKeypairPath: resolvePath(env("AGENT_KEYPAIR", "keys/agent.json")),
    servicesUrl: env("SERVICES_URL", "http://localhost:4021").replace(/\/$/, ""),
    servicesPort: Number(env("SERVICES_PORT", "4021")),
  };
}

/** Receiving wallets of the paid services (gitignored keys/ folder). */
export const SERVICE_KEY_PATHS = {
  weather: resolvePath("keys/weather.json"),
  translate: resolvePath("keys/translate.json"),
  news: resolvePath("keys/news.json"),
} as const;

export type ServiceName = keyof typeof SERVICE_KEY_PATHS;

/** The wallet a malicious news article asks the agent to pay (prompt-injection demo). Never allowlisted. */
export const ATTACKER_KEY_PATH = resolvePath("keys/attacker.json");

/** Reads a Solana CLI keypair file (JSON array of 64 bytes). */
export function loadKeypair(path: string): Keypair {
  if (!existsSync(path)) throw new Error(`Keypair file not found: ${path}. Run "npm run setup" first.`);
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, "utf8")) as number[]));
}

/** Loads a keypair file, creating it first if it does not exist. */
export function loadOrCreateKeypair(path: string): Keypair {
  if (existsSync(path)) return loadKeypair(path);
  const kp = Keypair.generate();
  saveKeypair(path, kp);
  return kp;
}

/** Writes a keypair file readable only by the current user. */
export function saveKeypair(path: string, kp: Keypair): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(Array.from(kp.secretKey)), { mode: 0o600 });
  chmodSync(path, 0o600);
}

/** Sets KEY=value in .env (creating it from .env.example if needed). Other lines are kept. */
export function writeEnvValue(key: string, value: string): void {
  if (!existsSync(ENV_PATH)) copyFileSync(resolve(ROOT, ".env.example"), ENV_PATH);
  const text = readFileSync(ENV_PATH, "utf8");
  const line = new RegExp(`^${key}=.*$`, "m");
  const next = line.test(text) ? text.replace(line, `${key}=${value}`) : `${text.trimEnd()}\n${key}=${value}\n`;
  writeFileSync(ENV_PATH, next);
  chmodSync(ENV_PATH, 0o600); // holds API keys: owner-only, like keys/
  process.env[key] = value;
  fromFile.add(key);
}
