// Tells the dashboard whether the paid services are running (the browser can't call them
// directly: no CORS on the services server).

import { getConfig } from "@leash/sdk/node";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const url = getConfig().servicesUrl;
  try {
    const r = await fetch(`${url}/services`, { signal: AbortSignal.timeout(3000), cache: "no-store" });
    const services = (await r.json()) as { id: string; price_usdc: string }[];
    return NextResponse.json({ online: r.ok, url, services });
  } catch {
    return NextResponse.json({ online: false, url, services: [] });
  }
}
