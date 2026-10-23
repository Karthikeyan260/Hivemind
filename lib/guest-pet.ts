import { stageFor } from "@/lib/pet-stages";

/**
 * A friend's pet at game night. Friends have no account, so their pet lives in their own browser (no
 * sign-up): they name it and pick a colour, and it grows from what they do at game night: each game they
 * play, and the firefly game. A new phone, or cleared browser data, starts a new pet. Pure functions plus
 * a thin saver, so the rules can be tested.
 */
export type GuestPet = {
  name: string;
  /** One of HUES (0..5): a tint for its glow. */
  hue: number;
  xp: number;
  games: number;
  fireflies: { best: number; plays: number };
  /** Flowers friends have given it. */
  flowers: number;
  made: string;
};

/** The six colours a friend can choose, as CSS hue rotations of Nova's gold, and their names. */
export const HUES: { name: string; rotate: number }[] = [
  { name: "Gold", rotate: 0 },
  { name: "Rose", rotate: 330 },
  { name: "Violet", rotate: 270 },
  { name: "Sky", rotate: 190 },
  { name: "Mint", rotate: 100 },
  { name: "Ember", rotate: 20 },
];

/** Growth points: a game played at game night, and a finished firefly round. */
export const GUEST_XP = { game: 3, fireflies: 2, fireflyPoint: 0.25 } as const;

const KEY = "hm-guest-pet";

export const cleanGuestName = (raw: string) => {
  const n = raw.normalize("NFC").replace(/[^\p{L}\p{M}\p{N} '-]/gu, "").replace(/\s+/g, " ").trim().slice(0, 16);
  return n ? n.charAt(0).toUpperCase() + n.slice(1) : "";
};

export function newGuestPet(rawName: string, hue: number, now = new Date()): GuestPet | null {
  const name = cleanGuestName(rawName);
  if (!name) return null;
  return { name, hue: Number.isInteger(hue) && hue >= 0 && hue < HUES.length ? hue : 0, xp: 0, games: 0, fireflies: { best: 0, plays: 0 }, flowers: 0, made: now.toISOString().slice(0, 10) };
}

/** A pet after one more game played. */
export const afterGame = (p: GuestPet): GuestPet => ({ ...p, xp: p.xp + GUEST_XP.game, games: p.games + 1 });

/** A pet after a firefly round with this score (best kept). */
export function afterFireflies(p: GuestPet, rawScore: number): { pet: GuestPet; newBest: boolean } {
  const score = Math.max(0, Math.min(500, Math.round(Number(rawScore) || 0)));
  const newBest = score > p.fireflies.best;
  return {
    pet: { ...p, xp: p.xp + GUEST_XP.fireflies + Math.floor(score * GUEST_XP.fireflyPoint), fireflies: { best: Math.max(p.fireflies.best, score), plays: p.fireflies.plays + 1 } },
    newBest,
  };
}

/** A pet given a flower. */
export const afterFlower = (p: GuestPet): GuestPet => ({ ...p, flowers: Math.min(9999, p.flowers + 1) });

export const guestStage = (p: GuestPet) => stageFor(p.xp);

/** What is read back from the browser's store: anything off is dropped (the store can be edited by hand). */
export function readGuestPet(raw: string | null): GuestPet | null {
  try {
    const v = JSON.parse(raw ?? "null") as Partial<GuestPet> | null;
    if (!v || typeof v !== "object") return null;
    const name = cleanGuestName(String(v.name ?? ""));
    if (!name) return null;
    const n = (x: unknown, max: number) => Math.max(0, Math.min(max, Math.round(Number(x) || 0)));
    return { name, hue: n(v.hue, HUES.length - 1), xp: n(v.xp, 99_999), games: n(v.games, 99_999), fireflies: { best: n(v.fireflies?.best, 500), plays: n(v.fireflies?.plays, 99_999) }, flowers: n(v.flowers, 9999), made: String(v.made ?? "").slice(0, 10) };
  } catch {
    return null;
  }
}

export function loadGuestPet(): GuestPet | null {
  try {
    return readGuestPet(localStorage.getItem(KEY));
  } catch {
    return null;
  }
}

export function saveGuestPet(p: GuestPet) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {}
}
