// Minimal chat client with tool calling. Gemini and Groq both serve the
// OpenAI-compatible /chat/completions API, so one code path covers both.

import { env } from "./config";

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface ToolDef {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

interface Provider {
  baseUrl: string;
  model: string;
  /** Tried in order (after `model`) when a model is overloaded, hangs or is out of quota. */
  fallbackModels: string[];
  keyVar: string;
  /** Omitted for Gemini 3: Google recommends its default temperature (low values can loop). */
  temperature?: number;
}

const PROVIDERS: Record<"gemini" | "groq", Provider> = {
  gemini: {
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    model: "gemini-3.8-flash",
    // The free tier limits requests per day per model, so each fallback adds its own quota.
    fallbackModels: ["gemini-3.5-flash", "gemini-3.5-flash-lite"],
    keyVar: "GEMINI_API_KEY",
  },
  groq: {
    baseUrl: "https://api.groq.com/openai/v1",
    model: "llama-3.3-70b-versatile",
    fallbackModels: [],
    keyVar: "GROQ_API_KEY",
    temperature: 0,
  },
};

export type ProviderName = keyof typeof PROVIDERS;
const PROVIDER_NAMES = Object.keys(PROVIDERS) as ProviderName[];

export interface ModelRef {
  provider: ProviderName;
  model: string;
}

export interface LlmConfig {
  /** Primary model first, then fallbacks, possibly from other providers. */
  chain: ModelRef[];
  keys: Partial<Record<ProviderName, string>>;
}

export const modelLabel = (m: ModelRef) => `${m.provider}:${m.model}`;

/** "groq:llama-3.3-70b-versatile" or a bare model name (uses `defaultProvider`). */
function parseModelRef(text: string, defaultProvider: ProviderName): ModelRef {
  const m = /^([a-z]+):(.+)$/.exec(text.trim());
  if (m && PROVIDER_NAMES.includes(m[1] as ProviderName)) return { provider: m[1] as ProviderName, model: m[2]! };
  return { provider: defaultProvider, model: text.trim() };
}

/**
 * Reads LLM_PROVIDER, LLM_MODEL, LLM_FALLBACK_MODELS and the API keys from .env.
 * Default chain: the provider's own models, then the default model of every other provider
 * that has a key. Models whose provider has no key are dropped.
 */
export function llmConfigFromEnv(): LlmConfig {
  const provider = env("LLM_PROVIDER", "gemini") as ProviderName;
  const p = PROVIDERS[provider];
  if (!p) throw new Error(`LLM_PROVIDER must be one of: ${PROVIDER_NAMES.join(", ")}`);
  const keys: Partial<Record<ProviderName, string>> = {};
  for (const name of PROVIDER_NAMES) {
    const key = env(PROVIDERS[name].keyVar);
    if (key) keys[name] = key;
  }
  if (!keys[provider]) throw new Error(`${p.keyVar} is empty. Put your key in .env (see .env.example).`);

  const primary: ModelRef = { provider, model: env("LLM_MODEL", p.model) };
  const fallbackEnv = env("LLM_FALLBACK_MODELS");
  let fallbacks: ModelRef[];
  if (fallbackEnv === "none") {
    fallbacks = [];
  } else if (fallbackEnv) {
    fallbacks = fallbackEnv.split(",").filter((t) => t.trim()).map((t) => parseModelRef(t, provider));
  } else {
    fallbacks = [
      ...p.fallbackModels.map((model) => ({ provider, model })),
      ...PROVIDER_NAMES.filter((n) => n !== provider).map((n) => ({ provider: n, model: PROVIDERS[n].model })),
    ];
  }
  const seen = new Set<string>();
  const chain = [primary, ...fallbacks].filter((m) => {
    const label = modelLabel(m);
    if (seen.has(label) || !keys[m.provider]) return false;
    seen.add(label);
    return true;
  });
  return { chain, keys };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// Normal replies take 2-10 s; an overloaded model can hang far longer.
const REQUEST_TIMEOUT_MS = 30_000;

/** Pulls `error.message` out of an OpenAI- or Gemini-style error body. */
function errorMessage(body: string): string {
  try {
    const j = JSON.parse(body) as { error?: { message?: string } } | { error?: { message?: string } }[];
    const msg = (Array.isArray(j) ? j[0] : j)?.error?.message;
    if (msg) return msg.slice(0, 300);
  } catch {
    // Not JSON: fall through to the raw text.
  }
  return body.slice(0, 300);
}

/** This model can't answer now (overloaded, hanging, out of quota); another model may. */
class ModelUnavailable extends Error {}

/** Models that failed this run; skipped from then on so we don't wait on them every step. */
const unavailable = new Set<string>();

async function chatWithModel(
  cfg: LlmConfig,
  ref: ModelRef,
  messages: ChatMessage[],
  tools?: ToolDef[],
): Promise<ChatMessage> {
  const p = PROVIDERS[ref.provider];
  const body = JSON.stringify({
    model: ref.model,
    messages,
    ...(p.temperature !== undefined ? { temperature: p.temperature } : {}),
    ...(tools?.length ? { tools, tool_choice: "auto" } : {}),
  });
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(`${p.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.keys[ref.provider]}` },
        body,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (e) {
      if (e instanceof Error && e.name === "TimeoutError") {
        throw new ModelUnavailable(`no answer in ${REQUEST_TIMEOUT_MS / 1000}s`);
      }
      throw e;
    }
    if (res.ok) {
      const data = (await res.json()) as { choices?: { message: ChatMessage }[] };
      const msg = data.choices?.[0]?.message;
      if (!msg) throw new Error(`${modelLabel(ref)}: empty response`);
      return msg;
    }
    const raw = await res.text();
    if (res.status === 429 && /per ?day/i.test(raw)) throw new ModelUnavailable("daily free-tier quota used up");
    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable) throw new Error(`${modelLabel(ref)} ${res.status}: ${errorMessage(raw)}`);
    // Overloaded or rate-limited: a couple of short retries, then try the next model.
    if (attempt >= 2) throw new ModelUnavailable(`${res.status} ${errorMessage(raw)}`);
    const wait = Number(res.headers.get("retry-after")) * 1000 || 2000 * 2 ** attempt;
    await sleep(Math.min(wait, 10_000));
  }
}

/**
 * One chat completion with tool calling. Tries the chain in order; a model that can't
 * answer is skipped for the rest of the run, so the conversation continues on the next one.
 */
export async function chat(cfg: LlmConfig, messages: ChatMessage[], tools?: ToolDef[]): Promise<ChatMessage> {
  const models = cfg.chain.filter((m) => !unavailable.has(modelLabel(m)));
  if (!models.length) throw new Error(`no LLM available (tried ${cfg.chain.map(modelLabel).join(", ")})`);
  for (const [i, ref] of models.entries()) {
    try {
      return await chatWithModel(cfg, ref, messages, tools);
    } catch (e) {
      if (!(e instanceof ModelUnavailable)) throw e;
      unavailable.add(modelLabel(ref));
      const next = models[i + 1];
      if (!next) throw new Error(`${modelLabel(ref)} is unavailable (${e.message}) and no fallback is left`);
      console.warn(`⚠️  ${modelLabel(ref)} is unavailable (${e.message.slice(0, 90)}), using ${modelLabel(next)}`);
    }
  }
  throw new Error("unreachable");
}
