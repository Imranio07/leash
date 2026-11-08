// JSON-RPC proxy for the public site: the browser talks to /api/rpc/devnet and the server
// forwards to RPC_URL (a keyed devnet RPC), so the key never reaches the browser.
// Only the read and send methods the dashboard uses are forwarded. Falls back to the public
// devnet RPC when the upstream fails or rate-limits. ("devnet" in the path also tells the
// wallet adapter which cluster this endpoint is.)

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const PUBLIC_DEVNET = "https://api.devnet.solana.com";
const MAX_BODY_BYTES = 64 * 1024;
const MAX_BATCH = 25;

const ALLOWED = new Set([
  "getAccountInfo",
  "getBalance",
  "getBlockHeight",
  "getEpochInfo",
  "getFeeForMessage",
  "getGenesisHash",
  "getHealth",
  "getLatestBlockhash",
  "getMinimumBalanceForRentExemption",
  "getMultipleAccounts",
  "getSignatureStatuses",
  "getSignaturesForAddress",
  "getSlot",
  "getTokenAccountBalance",
  "getTokenSupply",
  "getTransaction",
  "getVersion",
  "isBlockhashValid",
  "sendTransaction",
  "simulateTransaction",
]);

interface RpcCall {
  jsonrpc?: string;
  id?: unknown;
  method?: unknown;
}

function rpcError(status: number, message: string, id: unknown = null) {
  return Response.json({ jsonrpc: "2.0", id, error: { code: -32601, message } }, { status });
}

async function forward(url: string, body: string): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
}

/** Browsers send Origin on POSTs: only pages of this site may use the proxy from a browser. */
function sameSite(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  try {
    const host = new URL(origin).host;
    return host === req.headers.get("host") || host === new URL(req.url).host;
  } catch {
    return false;
  }
}

export async function POST(req: Request) {
  if (!sameSite(req)) return rpcError(403, "cross-origin requests are not allowed");

  const body = await req.text();
  if (body.length > MAX_BODY_BYTES) return rpcError(413, "request too large");
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return rpcError(400, "invalid JSON");
  }
  const calls = (Array.isArray(parsed) ? parsed : [parsed]) as RpcCall[];
  if (calls.length === 0 || calls.length > MAX_BATCH) return rpcError(400, `batch size must be 1..${MAX_BATCH}`);
  for (const call of calls) {
    if (typeof call?.method !== "string" || !ALLOWED.has(call.method)) {
      return rpcError(403, `method not allowed: ${String(call?.method)}`, call?.id ?? null);
    }
  }

  const upstreams = [process.env.RPC_URL?.trim() || PUBLIC_DEVNET];
  if (upstreams[0] !== PUBLIC_DEVNET) upstreams.push(PUBLIC_DEVNET);

  let last: Response | null = null;
  for (const url of upstreams) {
    try {
      const r = await forward(url, body);
      if (r.status === 429 || r.status >= 500) {
        last = r;
        continue;
      }
      return new Response(await r.text(), { status: r.status, headers: { "Content-Type": "application/json" } });
    } catch {
      last = null;
    }
  }
  if (last) return new Response(await last.text(), { status: last.status, headers: { "Content-Type": "application/json" } });
  return rpcError(502, "RPC upstream unreachable");
}
