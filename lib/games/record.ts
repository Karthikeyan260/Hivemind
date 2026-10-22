"use client";

/**
 * Saves a finished game to the owner's record (Games page). Only the owner's device can save (a
 * friend's page gets "locked" and nothing happens). `key` identifies the game, so a reload or a
 * second render never counts it twice.
 */
export type Outcome = "win" | "loss" | "draw";
type Result = { game: "chess" | "cards" | "ludo" | "draw" | "dots" | "snakes" | "business" | "bingo" | "connect4"; mode: "bot" | "friend"; outcome: Outcome; vs: string; level?: string; detail?: string };

const SEEN = "hm-games-recorded";
const sending = new Set<string>();

export function recordResult(key: string, r: Result) {
  let seen: string[] = [];
  try {
    seen = JSON.parse(localStorage.getItem(SEEN) ?? "[]") as string[];
  } catch {}
  if (seen.includes(key) || sending.has(key)) return;
  sending.add(key);
  // Marked as saved only once the server has it (offline or a lapsed session: the next render retries).
  void fetch("/api/games/stats", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...r, vs: r.vs.slice(0, 40), key: key.slice(0, 120) }) })
    .then((res) => {
      if (!res.ok) return;
      try {
        const now = JSON.parse(localStorage.getItem(SEEN) ?? "[]") as string[];
        localStorage.setItem(SEEN, JSON.stringify([...now, key].slice(-100)));
      } catch {}
    })
    .catch(() => {})
    .finally(() => sending.delete(key));
}

/** A short, stable id for a game from things both sides agree on (e.g. its moves). */
export function gameKey(...parts: (string | number)[]) {
  let h = 2166136261;
  for (const ch of parts.join("|")) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return (h >>> 0).toString(36);
}
