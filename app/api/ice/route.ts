import { NextResponse } from "next/server";

/**
 * Relay logins for game night, friend games and calls (see lib/ice.ts). Friends are not signed in, so this path is open.
 * It only hands out short-lived logins for a TURN relay the owner set up; with none set up it answers an empty list and
 * the browser uses its built-in servers.
 *
 *  - Cloudflare Realtime TURN: TURN_KEY_ID and TURN_KEY_API_TOKEN (Cloudflare dashboard > Realtime > TURN)
 *  - Metered: METERED_DOMAIN (like yourapp.metered.live) and METERED_API_KEY
 */
const TTL_S = 3600;
let cache: { at: number; servers: unknown[] } | null = null;

async function fromCloudflare() {
  const id = process.env.TURN_KEY_ID;
  const token = process.env.TURN_KEY_API_TOKEN;
  if (!id || !token) return null;
  const res = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${id}/credentials/generate-ice-servers`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ ttl: TTL_S }),
    signal: AbortSignal.timeout(6000),
  });
  if (!res.ok) throw new Error(`Cloudflare TURN ${res.status}`);
  const j = (await res.json()) as { iceServers?: unknown };
  return Array.isArray(j.iceServers) ? j.iceServers : [];
}

async function fromMetered() {
  const domain = process.env.METERED_DOMAIN;
  const key = process.env.METERED_API_KEY;
  if (!domain || !key) return null;
  const res = await fetch(`https://${domain}/api/v1/turn/credentials?apiKey=${encodeURIComponent(key)}`, { signal: AbortSignal.timeout(6000) });
  if (!res.ok) throw new Error(`Metered TURN ${res.status}`);
  const j = (await res.json()) as unknown;
  return Array.isArray(j) ? j : [];
}

export async function GET() {
  // Reused for half the login's life, so a busy night is a handful of calls, not one per friend.
  if (cache && Date.now() - cache.at < (TTL_S * 1000) / 2) return NextResponse.json({ iceServers: cache.servers }, { headers: { "cache-control": "no-store" } });
  try {
    const servers = (await fromCloudflare()) ?? (await fromMetered()) ?? [];
    if (servers.length) cache = { at: Date.now(), servers };
    return NextResponse.json({ iceServers: servers }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    console.warn("ice:", err instanceof Error ? err.message : err);
    return NextResponse.json({ iceServers: cache?.servers ?? [] }, { headers: { "cache-control": "no-store" } });
  }
}
