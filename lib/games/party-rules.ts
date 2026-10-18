/**
 * Game night's plain rules, kept apart from the connection code so they can be tested: who is at the
 * table, who sits in a game, what a spoken game or name means, and Draw & Guess's word, view and turns.
 */
import type { PartyGameKind, PartyPlayer } from "@/lib/games/party";

export const cleanName = (v: unknown) =>
  String(v ?? "")
    .slice(0, 20)
    .replace(/[^\p{L}\p{M}\p{N} .'-]/gu, "")
    .trim();
export const cleanId = (v: unknown) =>
  String(v ?? "")
    .replace(/[^a-z0-9-]/gi, "")
    .slice(0, 40);

/** Ids the games keep for themselves (the owner, HIVEMIND's bots, Draw & Guess's AI): no friend may use one. */
export const reservedId = (id: string) => id === "host" || id === "ai" || /^bot\d*$/i.test(id);

/** Everyone at the table now: friends who are connected, and the owner. */
export const here = (players: PartyPlayer[]) => players.filter((p) => p.online || p.host);

/** The seats for a game: the first `max` people here, in the order they joined. */
export const seatsFor = (players: PartyPlayer[], max: number) => here(players).slice(0, max).map((p) => ({ id: p.id, name: p.name }));

/** The reactions anyone at the table can send; anything else on the wire is dropped. */
export const REACTIONS = ["😂", "🔥", "😮", "👏", "❤️", "🎉"] as const;
export const isReaction = (e: unknown): e is (typeof REACTIONS)[number] => REACTIONS.includes(e as (typeof REACTIONS)[number]);
/** A friend can send a reaction this often at most (the owner's table drops faster ones). */
export const REACT_GAP_MS = 350;

/** Chat: plain text, one line, at most 200 characters (control characters and extra spaces dropped). */
export const CHAT_MAX = 200;
export const CHAT_GAP_MS = 700;
export const cleanChat = (v: unknown) =>
  String(v ?? "")
    .replace(/[\u0000-\u001f\u007f\u200b\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, CHAT_MAX);

/** Group voice: of two friends, the one with the smaller id calls, so each pair connects once. */
export const callsFirst = (me: string, other: string) => me < other;

/** A game said in words ("let's play ludo", "colour clash", "uno", "draw and guess"), or null. */
export function spokenGame(said: string): PartyGameKind | null {
  const t = said.toLowerCase();
  if (/\bludo\b/.test(t)) return "ludo";
  if (/snakes?|ladders?|paramapadham/.test(t)) return "snakes";
  if (/business|monopoly|property game/.test(t)) return "business";
  if (/bingo|housie|tambola/.test(t)) return "bingo";
  if (/\bchess\b/.test(t)) return "chess";
  if (/\bdots?\b|\bboxes\b/.test(t)) return "dots";
  if (/\bdraw(ing)?\b|\bguess\b|pictionary|sketch/.test(t)) return "draw";
  if (/\bcards?\b|colou?r clash|\buno\b/.test(t)) return "cards";
  return null;
}

/** A player named in what was said ("remove Priya", "play against arun"): the longest name that appears, so "Kavin" beats "Kavi". */
export function spokenPlayer<T extends { name: string }>(players: T[], said: string): T | null {
  const t = ` ${said.toLowerCase()} `;
  const hits = players.filter((p) => p.name.trim() && t.includes(p.name.toLowerCase().trim()));
  return hits.sort((a, b) => b.name.length - a.name.length)[0] ?? null;
}

/* ── Draw & Guess ── */

/** Lower case, letters and spaces only, a plural "s" dropped: "Umbrellas!" and "umbrella" match. */
export const normWord = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/s$/, "");

/** A right guess: the word itself, or a guess containing a word longer than 3 letters ("a big umbrella"). */
export function rightGuess(guess: string, word: string) {
  const g = normWord(guess);
  const w = normWord(word);
  if (!g || !w) return false;
  return g === w || (w.length > 3 && g.includes(w));
}

/** Points for a right guess: 50, plus a point for every second left. The drawer gets 25 for each friend who gets it. */
export const guessPoints = (secsLeft: number) => 50 + Math.max(0, Math.round(secsLeft));
export const DRAWER_POINTS = 25;

/** What one player may see: the word only if they're drawing, have guessed it, or the round is over. */
export function drawView<S extends { phase: string; drawer: string; guessed: string[]; word: string }>(s: S, id: string): S {
  return s.phase !== "playing" || id === s.drawer || s.guessed.includes(id) ? s : { ...s, word: "" };
}

/** The round from `n` on whose drawer is still here (skipping anyone who left), or null when the game is over. */
export function nextRound(order: string[], total: number, n: number, present: Set<string>): { n: number; drawer: string } | null {
  for (let k = n; k <= total; k++) {
    const drawer = order[(k - 1) % order.length];
    if (present.has(drawer)) return { n: k, drawer };
  }
  return null;
}

/** The round is over: time's up, the drawer left, or everyone still here (but the drawer) has guessed. */
export function roundDone(s: { order: string[]; drawer: string; guessed: string[] }, present: Set<string>, timeUp: boolean) {
  if (timeUp || !present.has(s.drawer)) return true;
  const guessers = s.order.filter((id) => id !== s.drawer && present.has(id));
  return guessers.length > 0 && guessers.every((id) => s.guessed.includes(id));
}
