/**
 * What a friend's browser may send into a Friends Theatre room, and what we accept. Everything that arrives over the
 * wire is untrusted (the room link is public, and anyone holding it can open a connection with a hand-made message),
 * so each message is checked here before the room acts on it: unknown kinds, wrong types, huge or non-finite numbers,
 * oversized text, a flood of messages, unknown film ids and emoji we don't show are all dropped, never repaired.
 */
export type Msg =
  | { t: "hello"; name: string }
  | { t: "peers"; list: string[] }
  | { t: "state"; movie: string; time: number; playing: boolean }
  | { t: "ask" }
  | { t: "play"; time: number }
  | { t: "pause"; time: number }
  | { t: "seek"; time: number }
  | { t: "movie"; id: string }
  | { t: "hb"; movie: string; time: number; playing: boolean }
  | { t: "chat"; text: string }
  | { t: "react"; e: string }
  | { t: "count" };

/** The reactions the room offers; anything else is not shown. */
export const REACTIONS = ["😂", "👏", "❤️", "😮", "😢", "🔥"];

export const MAX_NAME = 24;
export const MAX_CHAT = 400;
export const MAX_PEERS = 8;
/** Most people connected to one browser at once. A joiner holding the link can open many connections; past this they are closed. */
export const MAX_CONNS = 12;
/** Longest id we even look at: a hostile peer's megabyte "id" is dropped without being scanned. */
const MAX_ID_LEN = 80;
/** A film is at most a day long: a time past that (or negative, NaN, Infinity) is garbage. */
export const MAX_TIME = 86_400;

// Zero-width and bidirectional-override characters let one name or message pose as another or flip the text around.
const INVISIBLE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f​-‏‪-‮⁠-⁤⁦-⁩﻿]/g;

/** Plain, single-spaced text of at most `max` characters, with control and look-alike characters removed. */
export function cleanText(v: unknown, max: number): string {
  if (typeof v !== "string") return "";
  // Cap first: a hostile peer can send a huge string, and cleaning all of it would freeze the page.
  const s = v.length > max * 8 ? v.slice(0, max * 8) : v;
  return s.replace(INVISIBLE, "").replace(/\s+/g, " ").trim().slice(0, max);
}

/** A room code: letters and digits only, long enough not to be guessed. The code is part of a public broker id, so keep it plain. */
export const ROOM_CODE = /^[a-zA-Z0-9]{8,40}$/;
export const isRoomCode = (v: unknown): v is string => typeof v === "string" && ROOM_CODE.test(v);

/** A PeerJS id as the broker hands them out (letters, digits, dash, underscore). */
const PEER_ID = /^[A-Za-z0-9_-]{4,80}$/;
/** Film ids in the catalogue: lowercase words, or yt- plus a YouTube id. */
const MOVIE_ID = /^[A-Za-z0-9_-]{1,80}$/;

const time = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= MAX_TIME ? v : null);

/**
 * The message if it is well formed, otherwise null. `knownMovie` says whether a film id is in the catalogue (so a
 * friend can't point the room at an arbitrary id). Only the fields we use are copied out, so extra keys, including
 * `__proto__`, never reach the rest of the app.
 */
export function parseMsg(raw: unknown, knownMovie: (id: string) => boolean): Msg | null {
  try {
    return parseUnsafe(raw, knownMovie);
  } catch {
    return null; // a hostile object (a throwing getter, say) is simply dropped
  }
}

function parseUnsafe(raw: unknown, knownMovie: (id: string) => boolean): Msg | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const m = raw as Record<string, unknown>;
  switch (m.t) {
    case "hello": {
      const name = cleanText(m.name, MAX_NAME);
      return { t: "hello", name: name || "Friend" };
    }
    case "peers": {
      if (!Array.isArray(m.list)) return null;
      // Look at only the first few entries: a list of millions must not cost millions of checks.
      const list = m.list.slice(0, MAX_PEERS * 4).filter((x): x is string => typeof x === "string" && x.length <= MAX_ID_LEN && PEER_ID.test(x)).slice(0, MAX_PEERS);
      return { t: "peers", list };
    }
    case "state":
    case "hb": {
      const tm = time(m.time);
      if (tm === null || typeof m.movie !== "string" || !MOVIE_ID.test(m.movie) || !knownMovie(m.movie) || typeof m.playing !== "boolean") return null;
      return { t: m.t, movie: m.movie, time: tm, playing: m.playing };
    }
    case "ask":
      return { t: "ask" };
    case "count":
      return { t: "count" };
    case "play":
    case "pause":
    case "seek": {
      const tm = time(m.time);
      return tm === null ? null : { t: m.t, time: tm };
    }
    case "movie":
      return typeof m.id === "string" && MOVIE_ID.test(m.id) && knownMovie(m.id) ? { t: "movie", id: m.id } : null;
    case "chat": {
      const text = cleanText(m.text, MAX_CHAT);
      return text ? { t: "chat", text } : null;
    }
    case "react":
      return typeof m.e === "string" && REACTIONS.includes(m.e) ? { t: "react", e: m.e } : null;
    default:
      return null;
  }
}

/** How many of each kind of message one friend may send in a window; the rest are ignored (a flood can't freeze the room). */
const LIMITS: Record<Msg["t"], [number, number]> = {
  hello: [3, 10_000],
  peers: [3, 10_000],
  state: [10, 10_000],
  hb: [10, 10_000],
  ask: [6, 10_000],
  count: [4, 10_000],
  play: [20, 10_000],
  pause: [20, 10_000],
  seek: [20, 10_000],
  movie: [6, 10_000],
  chat: [10, 10_000],
  react: [20, 10_000],
};

export class RateLimiter {
  private seen = new Map<string, number[]>();
  /** True if this message from this sender is within its allowance (and counts it). */
  allow(sender: string, kind: Msg["t"], now: number): boolean {
    const [max, windowMs] = LIMITS[kind];
    const key = `${sender}|${kind}`;
    const recent = (this.seen.get(key) ?? []).filter((t) => now - t < windowMs);
    if (recent.length >= max) {
      this.seen.set(key, recent);
      return false;
    }
    recent.push(now);
    this.seen.set(key, recent);
    return true;
  }
  forget(sender: string) {
    for (const k of this.seen.keys()) if (k.startsWith(`${sender}|`)) this.seen.delete(k);
  }
}

/**
 * A new random room code: 16 letters and digits (about 95 bits), from the browser's / server's secure random source.
 * Bytes that would make some characters likelier than others are thrown away, so every character is equally likely.
 */
export function newRoomCode(len = 16): string {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const limit = 256 - (256 % chars.length);
  let out = "";
  while (out.length < len) {
    const buf = new Uint8Array(len * 2);
    globalThis.crypto.getRandomValues(buf);
    for (const b of buf) if (b < limit && out.length < len) out += chars[b % chars.length];
  }
  return out;
}
