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

const PROVIDERS = {
  gemini: {
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    model: "gemini-2.5-flash",
    keyVar: "GEMINI_API_KEY",
  },
  groq: {
    baseUrl: "https://api.groq.com/openai/v1",
    model: "llama-3.3-70b-versatile",
    keyVar: "GROQ_API_KEY",
  },
} as const;

export type ProviderName = keyof typeof PROVIDERS;

export interface LlmConfig {
  provider: ProviderName;
  model: string;
  baseUrl: string;
  apiKey: string;
}

/** Reads LLM_PROVIDER, LLM_MODEL and the provider's API key from .env. */
export function llmConfigFromEnv(): LlmConfig {
  const provider = env("LLM_PROVIDER", "gemini") as ProviderName;
  const p = PROVIDERS[provider];
  if (!p) throw new Error(`LLM_PROVIDER must be one of: ${Object.keys(PROVIDERS).join(", ")}`);
  const apiKey = env(p.keyVar);
  if (!apiKey) throw new Error(`${p.keyVar} is empty. Put your key in .env (see .env.example).`);
  return { provider, model: env("LLM_MODEL", p.model), baseUrl: p.baseUrl, apiKey };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** One chat completion. Retries rate limits and server errors (free tiers hit 429 often). */
export async function chat(
  cfg: LlmConfig,
  messages: ChatMessage[],
  tools?: ToolDef[],
): Promise<ChatMessage> {
  const body = JSON.stringify({
    model: cfg.model,
    messages,
    temperature: 0,
    ...(tools?.length ? { tools, tool_choice: "auto" } : {}),
  });
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.apiKey}` },
      body,
      signal: AbortSignal.timeout(60_000),
    });
    if (res.ok) {
      const data = (await res.json()) as { choices?: { message: ChatMessage }[] };
      const msg = data.choices?.[0]?.message;
      if (!msg) throw new Error(`${cfg.provider}: empty response`);
      return msg;
    }
    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt >= 4) {
      throw new Error(`${cfg.provider} ${res.status}: ${(await res.text()).slice(0, 500)}`);
    }
    const wait = Number(res.headers.get("retry-after")) * 1000 || 2000 * 2 ** attempt;
    await sleep(Math.min(wait, 30_000));
  }
}
