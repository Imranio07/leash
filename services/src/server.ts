// Paid mock APIs. Each call costs $0.05, paid through a Leash vault (HTTP 402 style).
//
//   GET  /services                    free: list of services and prices
//   GET  /weather?city=Bishkek        Open-Meteo current weather
//   POST /translate {text, to:"ky"}   translation via the LLM
//
// Without X-Payment-Signature a paid endpoint answers 402 {price, mint, recipient, nonce}.

import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Connection, PublicKey } from "@solana/web3.js";
import { formatUsdc, LEASH_PROGRAM_ID, parseUsdc, verifyPayment } from "@leash/sdk";
import {
  chat,
  getConfig,
  llmConfigFromEnv,
  loadKeypair,
  SERVICE_KEY_PATHS,
  type LlmConfig,
} from "@leash/sdk/node";

const PRICE = parseUsdc("0.05");

const cfg = getConfig();
if (!cfg.mint) {
  console.error('USDC_MINT is empty. Run "npm run setup" first.');
  process.exit(1);
}
const mint = cfg.mint;
const connection = new Connection(cfg.rpcUrl, "confirmed");

let llm: LlmConfig | null = null;
try {
  llm = llmConfigFromEnv();
} catch (e) {
  console.warn(`/translate disabled: ${e instanceof Error ? e.message : e}`);
}

interface Service {
  id: string;
  method: "GET" | "POST";
  path: string;
  description: string;
  params: Record<string, string>;
  /** Receiving wallet; it is on the vault allowlist. */
  wallet: PublicKey;
}

const SERVICES = {
  weather: {
    id: "weather",
    method: "GET",
    path: "/weather",
    description: "Current weather for a city (Open-Meteo)",
    params: { city: "City name, e.g. Bishkek" },
    wallet: loadKeypair(SERVICE_KEY_PATHS.weather).publicKey,
  },
  translate: {
    id: "translate",
    method: "POST",
    path: "/translate",
    description: "Translate text into another language",
    params: { text: "Text to translate", to: "Target language code, e.g. ky (Kyrgyz)" },
    wallet: loadKeypair(SERVICE_KEY_PATHS.translate).publicKey,
  },
} satisfies Record<string, Service>;

/** Signatures already accepted (in memory; old payments are also rejected by age). */
const usedSignatures = new Set<string>();

class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

function log(service: string, text: string) {
  console.log(`${new Date().toISOString().slice(11, 19)}  ${service.padEnd(9)} ${text}`);
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body, null, 2));
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 16_384) throw new HttpError(413, "body too large");
  }
  try {
    return JSON.parse(raw || "{}") as Record<string, unknown>;
  } catch {
    throw new HttpError(400, "body must be JSON");
  }
}

/**
 * Lets the request through only with a valid, unused payment. Otherwise it answers
 * 402 itself and returns null. On success returns the signature, which the handler
 * must release (`usedSignatures.delete`) if it fails to deliver, so the agent can retry.
 */
async function paymentGate(req: IncomingMessage, res: ServerResponse, svc: Service): Promise<string | null> {
  const header = req.headers["x-payment-signature"];
  const sig = (Array.isArray(header) ? header[0] : header)?.trim();

  if (!sig) {
    log(svc.id, `402 Payment Required (${formatUsdc(PRICE)} to ${svc.wallet.toBase58().slice(0, 8)}…)`);
    send(res, 402, {
      error: "payment_required",
      service: svc.id,
      price: PRICE.toString(),
      price_usdc: formatUsdc(PRICE),
      mint: mint.toBase58(),
      recipient: svc.wallet.toBase58(),
      nonce: randomUUID(),
      program: LEASH_PROGRAM_ID.toBase58(),
      how: "Pay with Leash agent_pay, then retry with header X-Payment-Signature: <tx signature>",
    });
    return null;
  }

  if (usedSignatures.has(sig)) {
    log(svc.id, `rejected: signature already used ${sig.slice(0, 8)}…`);
    send(res, 402, { error: "payment_already_used" });
    return null;
  }
  usedSignatures.add(sig); // reserve before awaiting, so a parallel request can't reuse it

  const result = await verifyPayment(connection, sig, { mint, recipient: svc.wallet, price: PRICE });
  if (!result.ok) {
    usedSignatures.delete(sig);
    log(svc.id, `rejected: ${result.reason}`);
    send(res, 402, { error: "payment_invalid", reason: result.reason });
    return null;
  }
  log(svc.id, `paid ${formatUsdc(result.received)}, verified on-chain ${sig.slice(0, 8)}…`);
  return sig;
}

// ---------- weather ----------

const WMO: Record<number, string> = {
  0: "clear sky", 1: "mainly clear", 2: "partly cloudy", 3: "overcast",
  45: "fog", 48: "freezing fog",
  51: "light drizzle", 53: "drizzle", 55: "heavy drizzle", 56: "freezing drizzle", 57: "freezing drizzle",
  61: "light rain", 63: "rain", 65: "heavy rain", 66: "freezing rain", 67: "freezing rain",
  71: "light snow", 73: "snow", 75: "heavy snow", 77: "snow grains",
  80: "rain showers", 81: "rain showers", 82: "violent rain showers", 85: "snow showers", 86: "heavy snow showers",
  95: "thunderstorm", 96: "thunderstorm with hail", 99: "thunderstorm with hail",
};

interface Place {
  name: string;
  country: string;
  latitude: number;
  longitude: number;
}

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!r.ok) throw new HttpError(502, `upstream ${r.status}`);
  return (await r.json()) as T;
}

async function geocode(city: string): Promise<Place | null> {
  const url = `https://geocoding-api.open-meteo.com/v1/search?count=1&language=en&format=json&name=${encodeURIComponent(city)}`;
  const data = await getJson<{ results?: Place[] }>(url);
  return data.results?.[0] ?? null;
}

async function currentWeather(p: Place) {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${p.latitude}&longitude=${p.longitude}&timezone=auto` +
    "&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m";
  const data = await getJson<{
    current: {
      time: string;
      temperature_2m: number;
      apparent_temperature: number;
      relative_humidity_2m: number;
      weather_code: number;
      wind_speed_10m: number;
    };
  }>(url);
  const c = data.current;
  const conditions = WMO[c.weather_code] ?? `weather code ${c.weather_code}`;
  return {
    city: p.name,
    country: p.country,
    local_time: c.time,
    temperature_c: c.temperature_2m,
    feels_like_c: c.apparent_temperature,
    humidity_pct: c.relative_humidity_2m,
    wind_kmh: c.wind_speed_10m,
    conditions,
    summary:
      `${p.name}, ${p.country}: ${Math.round(c.temperature_2m)}°C (feels like ${Math.round(c.apparent_temperature)}°C), ` +
      `${conditions}, wind ${Math.round(c.wind_speed_10m)} km/h, humidity ${c.relative_humidity_2m}%.`,
    source: "open-meteo.com",
  };
}

async function handleWeather(req: IncomingMessage, res: ServerResponse, url: URL) {
  const city = url.searchParams.get("city")?.trim();
  if (!city || city.length > 80) throw new HttpError(400, "query parameter 'city' is required");
  // Validate before charging: never take money for a request we can't serve.
  const place = await geocode(city);
  if (!place) throw new HttpError(404, `city not found: ${city}`);

  const sig = await paymentGate(req, res, SERVICES.weather);
  if (!sig) return;
  try {
    send(res, 200, { ...(await currentWeather(place)), payment: sig });
  } catch (e) {
    usedSignatures.delete(sig);
    throw e;
  }
}

// ---------- translate ----------

const LANGUAGES: Record<string, string> = {
  ky: "Kyrgyz", ru: "Russian", en: "English", kk: "Kazakh", uz: "Uzbek", tg: "Tajik", tr: "Turkish",
  de: "German", fr: "French", es: "Spanish", it: "Italian", zh: "Chinese", ja: "Japanese", ko: "Korean", ar: "Arabic",
};

async function handleTranslate(req: IncomingMessage, res: ServerResponse) {
  const body = await readJson(req);
  const text = typeof body.text === "string" ? body.text.trim() : "";
  const to = typeof body.to === "string" ? body.to.trim().toLowerCase() : "";
  if (!text || text.length > 2000) throw new HttpError(400, "'text' is required (max 2000 chars)");
  if (!/^[a-z]{2,3}(-[a-z]{2,4})?$/.test(to)) throw new HttpError(400, "'to' must be a language code, e.g. ky");
  if (!llm) throw new HttpError(503, "translation is unavailable: no LLM key configured");
  const language = LANGUAGES[to] ?? to;

  const sig = await paymentGate(req, res, SERVICES.translate);
  if (!sig) return;
  try {
    const reply = await chat(llm, [
      {
        role: "system",
        content: `You are a professional translator. Translate the user's text into ${language}. Reply with the translation only.`,
      },
      { role: "user", content: text },
    ]);
    const translation = reply.content?.trim();
    if (!translation) throw new HttpError(502, "empty translation");
    send(res, 200, { to, language, text, translation, payment: sig });
  } catch (e) {
    usedSignatures.delete(sig);
    throw e;
  }
}

// ---------- server ----------

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  try {
    if (req.method === "GET" && url.pathname === "/services") {
      return send(
        res,
        200,
        Object.values(SERVICES).map(({ wallet, ...s }) => ({
          ...s,
          price: PRICE.toString(),
          price_usdc: formatUsdc(PRICE),
          recipient: wallet.toBase58(),
        })),
      );
    }
    if (req.method === "GET" && url.pathname === "/weather") return await handleWeather(req, res, url);
    if (req.method === "POST" && url.pathname === "/translate") return await handleTranslate(req, res);
    throw new HttpError(404, "not found");
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    if (status >= 500) console.error(e);
    if (!res.headersSent) send(res, status, { error: e instanceof Error ? e.message : String(e) });
  }
});

server.listen(cfg.servicesPort, () => {
  console.log(`Leash paid services on http://localhost:${cfg.servicesPort}  (each call ${formatUsdc(PRICE)})`);
  console.log(`  weather   → ${SERVICES.weather.wallet.toBase58()}`);
  console.log(`  translate → ${SERVICES.translate.wallet.toBase58()}${llm ? "" : "  (disabled: no LLM key)"}`);
  console.log(`  mint ${mint.toBase58()}`);
});
