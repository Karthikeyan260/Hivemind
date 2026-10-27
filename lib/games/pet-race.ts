/**
 * The pet race at game night: between games every pet runs along a track. Each owner taps to boost their own
 * pet; the first to the end wins a crown for the night. The owner's browser runs the race (it alone moves
 * pets and counts boosts), so a friend can only ever tap fast, never move a pet by hand.
 */
export const TRACK = 100;
/** Three seconds of "3, 2, 1" before the start. */
export const COUNT_MS = 3000;
/** A tap counts at most this often per player (a phone can't be out-tapped by a script). */
export const BOOST_GAP_MS = 90;
/** How far one tap moves a pet, and how far a pet walks by itself each tick, so nobody is left standing. */
export const BOOST_STEP = 2.2;
export const TICK_MS = 120;
const WALK = 0.26;
/** After this long the leader wins, so a race with nobody tapping still ends. */
export const MAX_RUN_MS = 30_000;
export const MIN_RACERS = 2;
export const MAX_RACERS = 6;

export type RaceLane = { id: string; p: number };
/** What everyone's screen is told (no timestamps: the owner's clock stays the owner's). */
export type RaceView = { phase: "count" | "run" | "done"; /** Seconds left in the countdown. */ left: number; lanes: RaceLane[]; winner?: string };

export type Race = { phase: "count" | "run" | "done"; startAt: number; lanes: RaceLane[]; last: Record<string, number>; winner?: string };

export function newRace(ids: string[], now: number): Race {
  return { phase: "count", startAt: now + COUNT_MS, lanes: ids.slice(0, MAX_RACERS).map((id) => ({ id, p: 0 })), last: {} };
}

/** A tap from a player: counts only while running, and not faster than BOOST_GAP_MS. */
export function boost(r: Race, id: string, now: number): boolean {
  if (r.phase !== "run") return false;
  const lane = r.lanes.find((l) => l.id === id);
  if (!lane || now - (r.last[id] ?? 0) < BOOST_GAP_MS) return false;
  r.last[id] = now;
  lane.p = Math.min(TRACK, lane.p + BOOST_STEP);
  return true;
}

/** One step of time: starts the race after the countdown, walks every pet a little, and finds a winner. */
export function tick(r: Race, now: number, rnd: () => number = Math.random): Race {
  if (r.phase === "count" && now >= r.startAt) r.phase = "run";
  if (r.phase !== "run") return r;
  for (const l of r.lanes) l.p = Math.min(TRACK, l.p + WALK + rnd() * 0.1);
  const top = r.lanes.reduce((a, b) => (b.p > a.p ? b : a), r.lanes[0]);
  if (top && (top.p >= TRACK || now - r.startAt > MAX_RUN_MS)) {
    r.phase = "done";
    r.winner = top.id;
  }
  return r;
}

export function viewOf(r: Race, now: number): RaceView {
  return { phase: r.phase, left: r.phase === "count" ? Math.max(1, Math.ceil((r.startAt - now) / 1000)) : 0, lanes: r.lanes.map((l) => ({ id: l.id, p: Math.round(l.p * 10) / 10 })), ...(r.winner ? { winner: r.winner } : {}) };
}

/** A race view that came over the wire: only well-formed values get through. */
export function cleanRace(v: unknown, cleanId: (s: unknown) => string): RaceView | null {
  const m = v as Partial<RaceView> | null;
  if (!m || typeof m !== "object" || !Array.isArray(m.lanes)) return null;
  if (m.phase !== "count" && m.phase !== "run" && m.phase !== "done") return null;
  const lanes = m.lanes.slice(0, MAX_RACERS).map((l) => ({ id: cleanId((l as RaceLane)?.id), p: Math.max(0, Math.min(TRACK, Number((l as RaceLane)?.p) || 0)) })).filter((l) => l.id);
  if (!lanes.length) return null;
  const winner = typeof m.winner === "string" ? cleanId(m.winner) : "";
  return { phase: m.phase, left: Math.max(0, Math.min(5, Math.floor(Number(m.left) || 0))), lanes, ...(winner && lanes.some((l) => l.id === winner) ? { winner } : {}) };
}
