import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { addMarker, clearMarkers, countMarkers } from "@/lib/private-store";
import { passwordRequired, safeEqual, SESSION_COOKIE, SESSION_MAX_AGE, sessionToken } from "@/lib/session";

// Brute-force guard: after MAX_FAILS wrong passwords from one address within the window, that
// address is locked out until the window passes. Each failure is its own stored marker (parallel
// guesses can't overwrite each other), and an in-memory count also stops bursts on this instance.
const MAX_FAILS = 8;
/** Across all addresses: stops guessing from many rotating IPs. */
const MAX_FAILS_GLOBAL = 60;
const WINDOW_MS = 15 * 60_000;
const burst = new Map<string, number[]>();

// Vercel sets x-real-ip itself (a client can't fake it); x-forwarded-for is only a local fallback.
const clientIp = (req: Request) => (req.headers.get("x-real-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0] ?? "unknown").trim();
// Folder name per address (hashed: no raw IPs stored).
const prefix = (ip: string) => `unlock-fails/${createHash("sha256").update(ip).digest("hex").slice(0, 24)}`;

function locked(mins: number) {
  return NextResponse.json({ error: `Too many wrong attempts. Try again in ${mins} min.` }, { status: 429, headers: { "Retry-After": String(mins * 60) } });
}

export async function POST(req: Request) {
  const { password } = (await req.json().catch(() => ({}))) as { password?: unknown };
  if (!passwordRequired()) return NextResponse.json({ ok: true });

  const supabase = db();
  const ip = clientIp(req);
  const now = Date.now();

  // Count this attempt in memory first (synchronously), so a burst can't all slip past the check.
  const recent = (burst.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= MAX_FAILS) return locked(Math.ceil((recent[0] + WINDOW_MS - now) / 60_000));
  // Reserve the slot now, before any await, so parallel requests see it; released on success.
  burst.set(ip, [...recent, now]);
  const [stored, total] = await Promise.all([
    countMarkers(supabase, prefix(ip), now - WINDOW_MS).catch(() => 0),
    countMarkers(supabase, "unlock-fails-all", now - WINDOW_MS).catch(() => 0),
  ]);
  if (stored >= MAX_FAILS || total >= MAX_FAILS_GLOBAL) return locked(15);

  if (typeof password !== "string" || !safeEqual(password, process.env.APP_PASSWORD!)) {
    await Promise.all([addMarker(supabase, prefix(ip)).catch(() => {}), addMarker(supabase, "unlock-fails-all").catch(() => {})]);
    await new Promise((r) => setTimeout(r, 800)); // slow down guessing
    return NextResponse.json({ error: "Wrong password" }, { status: 401 });
  }

  burst.delete(ip);
  await clearMarkers(supabase, prefix(ip)).catch(() => {});
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, await sessionToken(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
  return res;
}

export async function DELETE() {
  const res = new NextResponse(null, { status: 204 });
  res.cookies.delete(SESSION_COOKIE);
  return res;
}
