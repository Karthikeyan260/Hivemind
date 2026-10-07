// Single-owner access gate. Runs in proxy.ts (Node runtime) and route handlers.
export const SESSION_COOKIE = "sb_owner";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 365;

export const passwordRequired = () => !!process.env.APP_PASSWORD;

/** Deployed without APP_PASSWORD would expose the whole brain publicly — refuse instead. */
export const misconfigured = () => !process.env.APP_PASSWORD && process.env.NODE_ENV === "production";

async function hmac(key: string, msg: string) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(msg));
  return Buffer.from(sig).toString("hex");
}

/** Token changes whenever APP_PASSWORD changes, which logs out every browser. */
export const sessionToken = () => hmac(process.env.APP_PASSWORD ?? "", "second-brain-owner-v1");

export function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function isUnlocked(cookieValue: string | undefined) {
  if (!passwordRequired()) return !misconfigured();
  return !!cookieValue && safeEqual(cookieValue, await sessionToken());
}

/**
 * Proof that a call / game peer really is the owner's browser: an HMAC only the server can make,
 * handed only to the logged-in owner. A guest checks it before sending any audio or game data, so
 * someone squatting the room's public peer id on the PeerJS broker can't pose as the owner.
 */
export const peerProof = (kind: string, room: string, nonce: string) => hmac(process.env.APP_PASSWORD ?? "", `peer-v1:${kind}:${room}:${nonce}`);
