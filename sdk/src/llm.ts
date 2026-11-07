// Minimal chat client with tool calling. Gemini and Groq both serve the
// OpenAI-compatible /chat/completions API, so one code path covers both.
//
// Models are tried along a chain. A model that is overloaded, slow, out of quota or
// gives an unusable answer (checked by the caller's `validate`) is skipped for the rest
// of the run, and the same request goes to the next model.

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
  keyVar: string;
  /** Omitted for Gemini 3: Google recommends its default temperature (low values can loop). */
  temperature?: number;
}

const PROVIDERS = {
  groq: { baseUrl: "https://api.groq.com/openai/v1", keyVar: "GROQ_API_KEY", temperature: 0 },
  gemini: { baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", keyVar: "GEMINI_API_KEY" },
} satisfies Record<string, Provider>;

export type ProviderName = keyof typeof PROVIDERS;
const PROVIDER_NAMES = Object.keys(PROVIDERS) as ProviderName[];

/**
 * Default order. Groq's gpt-oss-120b calls tools reliably and answers in about a second;
 * Gemini's free tier allows ~20 requests/day per model and its Flash-Lite sometimes writes
 * tool calls as text, so it goes last.
 */
const DEFAULT_CHAIN =
  "groq:openai/gpt-oss-120b,gemini:gemini-3.8-flash,gemini:gemini-3.5-flash,groq:openai/gpt-oss-20b,gemini:gemini-3.5-flash-lite";

export interface ModelRef {
  provider: ProviderName;
  model: string;
}

export interface LlmConfig {
  chain: ModelRef[];
  keys: Partial<Record<ProviderName, string>>;
}

export const modelLabel = (m: ModelRef) => `${m.provider}:${m.model}`;

function parseModelRef(text: string): ModelRef {
  const m = /^([a-z]+):(.+)$/.exec(text.trim());
  if (!m || !PROVIDER_NAMES.includes(m[1] as ProviderName)) {
    throw new Error(`LLM_CHAIN entry "${text}" must look like provider:model (providers: ${PROVIDER_NAMES.join(", ")})`);
  }
  return { provider: m[1] as ProviderName, model: m[2]! };
}

/** Reads LLM_CHAIN and the API keys from .env. Models whose provider has no key are dropped. */
export function llmConfigFromEnv(): LlmConfig {
  const keys: Partial<Record<ProviderName, string>> = {};
  for (const name of PROVIDER_NAMES) {
    const key = env(PROVIDERS[name].keyVar);
    if (key) keys[name] = key;
  }
  const seen = new Set<string>();
  const chain = env("LLM_CHAIN", DEFAULT_CHAIN)
    .split(",")
    .filter((t) => t.trim())
    .map(parseModelRef)
    .filter((m) => {
      const label = modelLabel(m);
      if (seen.has(label) || !keys[m.provider]) return false;
      seen.add(label);
      return true;
    });
  if (!chain.length) throw new Error("No LLM available: put GROQ_API_KEY or GEMINI_API_KEY in .env (see .env.example).");
  return { chain, keys };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Groq answers in ~1 s, Gemini Flash in 2-8 s. Anything slower is treated as unavailable. */
const REQUEST_TIMEOUT_MS = 10_000;

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

/** This model can't serve the request now; another model may. */
class ModelUnavailable extends Error {}

/** Models that failed this run; skipped from then on so we don't wait on them every step. */
const unavailable = new Set<string>();

type Extra = { extra_content?: unknown };

/**
 * Keeps only standard fields. Gemini 3 needs its thought signatures (`extra_content`) back;
 * tool calls made by another model get Google's documented placeholder signature.
 * Other providers get no extra fields (Groq rejects unknown ones such as `reasoning`).
 */
function wireMessages(messages: ChatMessage[], provider: ProviderName): Record<string, unknown>[] {
  return messages.map((m) => {
    const out: Record<string, unknown> = { role: m.role, content: m.content ?? (m.tool_calls ? null : "") };
    if (m.tool_calls) {
      out.tool_calls = m.tool_calls.map((tc) => {
        const call: Record<string, unknown> = {
          id: tc.id,
          type: "function",
          function: { name: tc.function.name, arguments: tc.function.arguments },
        };
        if (provider === "gemini") {
          call.extra_content = (tc as ToolCall & Extra).extra_content ?? {
            google: { thought_signature: "skip_thought_signature_validator" },
          };
        }
        return call;
      });
    }
    if (m.tool_call_id) out.tool_call_id = m.tool_call_id;
    if (m.role === "tool" && m.name) out.name = m.name;
    if (provider === "gemini" && (m as ChatMessage & Extra).extra_content) {
      out.extra_content = (m as ChatMessage & Extra).extra_content;
    }
    return out;
  });
}

async function chatWithModel(
  cfg: LlmConfig,
  ref: ModelRef,
  messages: ChatMessage[],
  tools?: ToolDef[],
): Promise<ChatMessage> {
  const p: Provider = PROVIDERS[ref.provider];
  const body = JSON.stringify({
    model: ref.model,
    messages: wireMessages(messages, ref.provider),
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
      throw new ModelUnavailable(e instanceof Error ? e.message : String(e));
    }
    if (res.ok) {
      const data = (await res.json()) as { choices?: { message: ChatMessage }[] };
      const msg = data.choices?.[0]?.message;
      if (!msg) throw new ModelUnavailable("empty response");
      return msg;
    }
    const raw = await res.text();
    if (res.status === 429 && /per ?day/i.test(raw)) throw new ModelUnavailable("daily free-tier quota used up");
    // Overloaded or rate-limited: one short retry. Anything else: move on to the next model.
    if ((res.status === 429 || res.status >= 500) && attempt === 0) {
      const wait = Number(res.headers.get("retry-after")) * 1000 || 1500;
      if (wait <= 3000) {
        await sleep(wait);
        continue;
      }
    }
    throw new ModelUnavailable(`${res.status} ${errorMessage(raw)}`);
  }
}

export interface ChatOptions {
  /** Returns a reason when the reply is unusable (e.g. a tool call written as text). */
  validate?: (msg: ChatMessage) => string | null;
  /** Called when a model is skipped. Defaults to a plain log line. */
  onSwitch?: (from: ModelRef, to: ModelRef | null, reason: string) => void;
}

const defaultOnSwitch: NonNullable<ChatOptions["onSwitch"]> = (from, to, reason) =>
  console.log(`· ${modelLabel(from)} unavailable (${reason.slice(0, 90)})${to ? `, using ${modelLabel(to)}` : ""}`);

/** One chat completion with tool calling, walking the model chain until a usable reply. */
export async function chat(
  cfg: LlmConfig,
  messages: ChatMessage[],
  tools?: ToolDef[],
  opts: ChatOptions = {},
): Promise<ChatMessage> {
  const onSwitch = opts.onSwitch ?? defaultOnSwitch;
  const models = cfg.chain.filter((m) => !unavailable.has(modelLabel(m)));
  for (const [i, ref] of models.entries()) {
    let reason: string;
    try {
      const msg = await chatWithModel(cfg, ref, messages, tools);
      const invalid = opts.validate?.(msg) ?? null;
      if (!invalid) return msg;
      reason = invalid;
    } catch (e) {
      if (!(e instanceof ModelUnavailable)) throw e;
      reason = e.message;
    }
    unavailable.add(modelLabel(ref));
    onSwitch(ref, models[i + 1] ?? null, reason);
  }
  throw new Error(`no model could answer (tried ${cfg.chain.map(modelLabel).join(", ")})`);
}

/** First model of the chain that has not failed in this run. */
export function currentModel(cfg: LlmConfig): ModelRef | null {
  return cfg.chain.find((m) => !unavailable.has(modelLabel(m))) ?? null;
}
