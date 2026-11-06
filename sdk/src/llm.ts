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
  /** Tried in order when the model above is overloaded, hangs or is out of quota. */
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

export interface LlmConfig {
  provider: ProviderName;
  /** Primary model first, then fallbacks. */
  models: string[];
  baseUrl: string;
  apiKey: string;
  temperature?: number;
}

/** Reads LLM_PROVIDER, LLM_MODEL, LLM_FALLBACK_MODELS and the provider's API key from .env. */
export function llmConfigFromEnv(): LlmConfig {
  const provider = env("LLM_PROVIDER", "gemini") as ProviderName;
  const p = PROVIDERS[provider];
  if (!p) throw new Error(`LLM_PROVIDER must be one of: ${Object.keys(PROVIDERS).join(", ")}`);
  const apiKey = env(p.keyVar);
  if (!apiKey) throw new Error(`${p.keyVar} is empty. Put your key in .env (see .env.example).`);
  const fallbackEnv = env("LLM_FALLBACK_MODELS");
  const fallbacks =
    fallbackEnv === "none"
      ? []
      : fallbackEnv
        ? fallbackEnv.split(",").map((m) => m.trim()).filter(Boolean)
        : p.fallbackModels;
  return {
    provider,
    models: [...new Set([env("LLM_MODEL", p.model), ...fallbacks])],
    baseUrl: p.baseUrl,
    apiKey,
    temperature: p.temperature,
  };
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
  model: string,
  messages: ChatMessage[],
  tools?: ToolDef[],
): Promise<ChatMessage> {
  const body = JSON.stringify({
    model,
    messages,
    ...(cfg.temperature !== undefined ? { temperature: cfg.temperature } : {}),
    ...(tools?.length ? { tools, tool_choice: "auto" } : {}),
  });
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(`${cfg.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.apiKey}` },
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
      if (!msg) throw new Error(`${cfg.provider}/${model}: empty response`);
      return msg;
    }
    const raw = await res.text();
    if (res.status === 429 && /per ?day/i.test(raw)) throw new ModelUnavailable("daily free-tier quota used up");
    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable) throw new Error(`${cfg.provider}/${model} ${res.status}: ${errorMessage(raw)}`);
    // Overloaded or rate-limited: a couple of short retries, then try the next model.
    if (attempt >= 2) throw new ModelUnavailable(`${res.status} ${errorMessage(raw)}`);
    const wait = Number(res.headers.get("retry-after")) * 1000 || 2000 * 2 ** attempt;
    await sleep(Math.min(wait, 10_000));
  }
}

/**
 * One chat completion with tool calling. Tries the configured model first; if it can't
 * answer, moves to the next fallback model and keeps using it for the rest of the run.
 */
export async function chat(cfg: LlmConfig, messages: ChatMessage[], tools?: ToolDef[]): Promise<ChatMessage> {
  const models = cfg.models.filter((m) => !unavailable.has(m));
  if (!models.length) throw new Error(`${cfg.provider}: no model available (tried ${cfg.models.join(", ")})`);
  for (const [i, model] of models.entries()) {
    try {
      return await chatWithModel(cfg, model, messages, tools);
    } catch (e) {
      const next = models[i + 1];
      if (!(e instanceof ModelUnavailable)) throw e;
      unavailable.add(model);
      if (!next) throw new Error(`${cfg.provider}: ${model} is unavailable (${e.message}) and no fallback is left`);
      console.warn(`⚠️  ${model} is unavailable (${e.message.slice(0, 90)}), using ${next}`);
    }
  }
  throw new Error("unreachable");
}
