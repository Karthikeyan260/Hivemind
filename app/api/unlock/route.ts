import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { addMarker, clearMarkers, countMarkers } from "@/lib/private-store";
import { createSession, endAllSessions, endSession, isTrusted, isUnlocked, passwordRequired, safeEqual, SESSION_COOKIE, SESSION_MAX_AGE, TRUSTED_COOKIE, TRUSTED_MAX_AGE, trustedCookie } from "@/lib/session";

// Brute-force guard: after MAX_FAILS wrong passwords from one address within the window, that
// address is locked out until the window passes. Each failure is its own stored marker (parallel
// guesses can't overwrite each other), and an in-memory count also stops bursts on this instance.
const MAX_FAILS = 8;
/** Across all addresses: stops guessing from many rotating IPs. A browser that has unlocked before
 * (trusted-device cookie) isn't held by this one, so strangers can't lock the owner out. */
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
  const trusted = await isTrusted(cookieOf(req, TRUSTED_COOKIE)).catch(() => false);
  if (stored >= MAX_FAILS || (total >= MAX_FAILS_GLOBAL && !trusted)) return locked(15);

  if (typeof password !== "string" || !safeEqual(password, process.env.APP_PASSWORD!)) {
    await Promise.all([addMarker(supabase, prefix(ip)).catch(() => {}), addMarker(supabase, "unlock-fails-all").catch(() => {})]);
    await new Promise((r) => setTimeout(r, 800)); // slow down guessing
    return NextResponse.json({ error: "Wrong password" }, { status: 401 });
  }

  burst.delete(ip);
  await clearMarkers(supabase, prefix(ip)).catch(() => {});
  const res = NextResponse.json({ ok: true });
  const cookie = { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/" };
  res.cookies.set(SESSION_COOKIE, await createSession(req.headers.get("user-agent") ?? "browser"), { ...cookie, maxAge: SESSION_MAX_AGE });
  if (!trusted) res.cookies.set(TRUSTED_COOKIE, await trustedCookie(), { ...cookie, maxAge: TRUSTED_MAX_AGE });
  return res;
}

const cookieOf = (req: Request, name: string) =>
  req.headers
    .get("cookie")
    ?.split(/;\s*/)
    .find((c) => c.startsWith(`${name}=`))
    ?.slice(name.length + 1);

/** Logout: ends this browser's session. ?all=1 (only from a signed-in browser) ends every session. */
export async function DELETE(req: Request) {
  const mine = cookieOf(req, SESSION_COOKIE);
  if (new URL(req.url).searchParams.get("all") === "1") {
    if (!(await isUnlocked(mine))) return NextResponse.json({ error: "Locked" }, { status: 401 });
    await endAllSessions();
  } else await endSession(mine).catch(() => {});
  const res = new NextResponse(null, { status: 204 });
  res.cookies.delete(SESSION_COOKIE);
  return res;
}
