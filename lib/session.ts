// Single-owner access gate. Runs in proxy.ts (Node runtime) and route handlers.
import { createHash, randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { readJSON, writeJSON } from "@/lib/private-store";
import { getSecret } from "@/lib/secrets";

export const SESSION_COOKIE = "sb_owner";
/** Survives logout: marks a browser that has unlocked before (it skips the all-addresses lockout). */
export const TRUSTED_COOKIE = "sb_trusted";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 180;
export const TRUSTED_MAX_AGE = 60 * 60 * 24 * 365;

export const passwordRequired = () => !!process.env.APP_PASSWORD;

/** Deployed without APP_PASSWORD would expose the whole brain publicly — refuse instead. */
export const misconfigured = () => !process.env.APP_PASSWORD && process.env.NODE_ENV === "production";

async function hmac(key: string, msg: string) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(msg));
  return Buffer.from(sig).toString("hex");
}

export function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Sessions: each unlock gets its own random id, kept (hashed) in the private bucket with an expiry
 * and a fingerprint of the password it was opened with. The cookie is "v2.<id>.<sig>" signed with a
 * random server secret, so it reveals nothing about the password, can be ended on its own (logout),
 * all at once ("log out all devices"), and every session ends when the password changes.
 */
type Session = { id: string; created: string; expires: string; device: string; pw: string };
const KEY = "auth/sessions";
const hashId = (sid: string) => createHash("sha256").update(sid).digest("hex");
const pwPrint = async () => (await hmac(await getSecret("session"), `pw:${process.env.APP_PASSWORD ?? ""}`)).slice(0, 32);

// Each instance re-reads the list at most every 10 s (the proxy and the routes keep separate copies,
// so a logout elsewhere takes effect within that).
let cached: { at: number; list: Session[] } | null = null;
let lastFresh = 0;
async function sessions(fresh = false): Promise<Session[]> {
  if (!fresh && cached && Date.now() - cached.at < 10_000) return cached.list;
  const list = await readJSON<Session[]>(db(), KEY, []);
  cached = { at: Date.now(), list };
  return list;
}
async function save(list: Session[]) {
  const now = Date.now();
  const live = list.filter((s) => +new Date(s.expires) > now).slice(-30);
  await writeJSON(db(), KEY, live);
  cached = { at: Date.now(), list: live };
}

/** Opens a session; returns the cookie value. */
export async function createSession(device: string) {
  const sid = randomBytes(24).toString("hex");
  const sig = await hmac(await getSecret("session"), `sid:${sid}`);
  const now = Date.now();
  await save([...(await sessions(true)), { id: hashId(sid), created: new Date(now).toISOString(), expires: new Date(now + SESSION_MAX_AGE * 1000).toISOString(), device: device.slice(0, 80), pw: await pwPrint() }]);
  return `v2.${sid}.${sig}`;
}

async function parse(cookie: string | undefined) {
  const m = /^v2\.([a-f0-9]{48})\.([a-f0-9]{64})$/.exec(cookie ?? "");
  if (!m) return null;
  const want = await hmac(await getSecret("session"), `sid:${m[1]}`);
  return safeEqual(m[2], want) ? m[1] : null;
}

export async function isUnlocked(cookieValue: string | undefined) {
  if (!passwordRequired()) return !misconfigured();
  let sid: string | null;
  try {
    sid = await parse(cookieValue);
  } catch {
    return false; // can't check the signature (no secret yet): locked
  }
  if (!sid) return false;
  try {
    let s = (await sessions()).find((x) => x.id === hashId(sid));
    // Signed by us but not in this instance's copy: most likely a login that just happened
    // elsewhere. Re-read now (at most once a second, and only real signed cookies get this far).
    if (!s && Date.now() - lastFresh > 1000) {
      lastFresh = Date.now();
      s = (await sessions(true)).find((x) => x.id === hashId(sid));
    }
    return !!s && +new Date(s.expires) > Date.now() && s.pw === (await pwPrint());
  } catch {
    // Storage blipped: the signature already proves this cookie was issued here, so let the owner
    // in rather than bounce them to the unlock page (a logout elsewhere applies once storage is back).
    return true;
  }
}

/** Ends this browser's session (logout). */
export async function endSession(cookieValue: string | undefined) {
  const sid = await parse(cookieValue).catch(() => null);
  if (!sid) return;
  await save((await sessions(true)).filter((s) => s.id !== hashId(sid)));
}

/** Ends every session ("log out all devices"). */
export const endAllSessions = () => save([]);

/** Signed in browsers, for Settings ("this phone, since…"). */
export const listSessions = async () => (await sessions(true)).map(({ created, expires, device }) => ({ created, expires, device }));

/** A browser that unlocked before keeps this cookie; it skips the all-addresses lockout. */
export async function trustedCookie() {
  const id = randomBytes(12).toString("hex");
  return `${id}.${await hmac(await getSecret("session"), `trusted:${id}`)}`;
}
export async function isTrusted(cookieValue: string | undefined) {
  const m = /^([a-f0-9]{24})\.([a-f0-9]{64})$/.exec(cookieValue ?? "");
  if (!m) return false;
  return safeEqual(m[2], await hmac(await getSecret("session"), `trusted:${m[1]}`).catch(() => ""));
}

/**
 * Proof that a call / game peer really is the owner's browser: an HMAC only the server can make,
 * handed only to the logged-in owner. A guest checks it before sending any audio or game data, so
 * someone squatting the room's public peer id on the PeerJS broker can't pose as the owner. Signed
 * with its own random secret, never the password (a captured proof must not allow offline guessing).
 */
export const peerProof = async (kind: string, room: string, nonce: string) => hmac(await getSecret("peer"), `peer-v1:${kind}:${room}:${nonce}`);
