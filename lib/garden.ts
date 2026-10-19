import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { listCheckins, nightDay } from "@/lib/checkin";
import { listResults } from "@/lib/games/stats";
import { type Garden, type GardenItem, hueOf, visitorsFor } from "@/lib/garden-layout";
import { listHabits, stats as habitStats } from "@/lib/habits";
import { getPet } from "@/lib/pet";
import { listPlays } from "@/lib/plays";
import { readJSON } from "@/lib/private-store";
import { addDays, localParts } from "@/lib/reminders";

/**
 * Nova's garden, grown from what HIVEMIND already records (the last six months), nothing to log:
 * a flower for every day a habit was done, a tree for every few night check-ins (the newest still
 * growing), a lamp for every finished lantern walk, a gem for every game won, and butterflies from
 * the songs played.
 */
const DAYS = 183;
const CHECKINS_PER_TREE = 4;
const SONGS_PER_BUTTERFLY = 15;
const MAX_FLOWERS = 180;
/** Music flowers: one per song listened to (newest first), each artist with its own bed and colour. */
const MAX_MUSIC = 48;
const MUSIC_DAYS = 60;
/** "Raja Raja Chozhan" → "raja-raja-chozhan" (a stable key for ids). */
const slug = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "song";

const GAME_NAME: Record<string, string> = { chess: "Chess", cards: "Colour Clash", ludo: "Ludo", draw: "Draw & Guess", dots: "Dots & Boxes" };
const GAME_HUE: Record<string, number> = { chess: 200, cards: 330, ludo: 45, draw: 280, dots: 150 };

export async function getGarden(supabase: SupabaseClient): Promise<Garden> {
  const today = localParts().date;
  const since = addDays(today, -DAYS);
  const months = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(`${today.slice(0, 7)}-01T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() - i);
    return d.toISOString().slice(0, 7);
  });
  const [habits, checkins, games, pet, saved, plays] = await Promise.all([
    listHabits(supabase).catch(() => []),
    listCheckins(supabase).catch(() => []),
    listResults(supabase).catch(() => []),
    getPet(supabase, new Date(), { touch: false }).catch(() => null),
    readJSON<{ walks?: string[] } | null>(supabase, "pet", null).catch(() => null),
    Promise.all(months.map((m) => listPlays(supabase, m).catch(() => []))).then((x) => x.flat()),
  ]);

  const flowers: GardenItem[] = habits
    .flatMap((h) => h.log.filter((d) => d >= since).map((date) => ({ kind: "flower" as const, id: `f:${h.id}:${date}`, date, label: `${h.emoji || "🌸"} ${h.name} · ${date}`, hue: hueOf(h.id) })))
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, MAX_FLOWERS);

  const nights = checkins.filter((c) => c.date >= since).length;
  const full = Math.floor(nights / CHECKINS_PER_TREE);
  const growing = nights % CHECKINS_PER_TREE;
  const trees: GardenItem[] = [
    ...Array.from({ length: full }, (_, i) => ({ kind: "tree" as const, id: `t:${i}`, size: 1, label: `🌳 Grown from ${CHECKINS_PER_TREE} night check-ins` })),
    ...(growing ? [{ kind: "tree" as const, id: `t:${full}`, size: 0.25 + (0.75 * growing) / CHECKINS_PER_TREE, label: `🌱 Growing: ${growing} of ${CHECKINS_PER_TREE} check-ins` }] : []),
  ];

  const lamps: GardenItem[] = (saved?.walks ?? []).filter((d) => d >= since).map((date, i) => ({ kind: "lamp" as const, id: `l:${date}:${i}`, date, label: `🏮 Lantern walk · ${date}` }));

  const gems: GardenItem[] = games
    .filter((g) => g.outcome === "win" && localParts(new Date(g.at)).date >= since)
    .map((g) => ({ kind: "gem" as const, id: `g:${g.key}`, date: localParts(new Date(g.at)).date, label: `💎 Won ${GAME_NAME[g.game] ?? g.game} · ${localParts(new Date(g.at)).date}`, hue: GAME_HUE[g.game] ?? 190 }));

  // A flower for every song played (once per song), in its artist's bed: the garden shows your music taste.
  const musicSince = addDays(today, -MUSIC_DAYS);
  const seenSong = new Set<string>();
  const music: GardenItem[] = [];
  for (const p of [...plays].sort((a, b) => b.at.localeCompare(a.at))) {
    const date = localParts(new Date(p.at)).date;
    if (date < musicSince) break;
    const artist = (p.artists.split(",")[0] || "Unknown").trim();
    const key = `${slug(artist)}~${slug(p.title)}`;
    if (seenSong.has(key)) continue;
    seenSong.add(key);
    music.push({ kind: "flower", id: `m:${slug(artist)}:${slug(p.title)}`, date, label: `🎵 ${p.title} · ${artist}`, hue: hueOf(`artist:${slug(artist)}`) });
    if (music.length >= MAX_MUSIC) break;
  }

  const songs = plays.filter((p) => localParts(new Date(p.at)).date >= since).length;
  const butterflies = Math.min(12, Math.floor(songs / SONGS_PER_BUTTERFLY));

  // The best streak running across the habits (a habit's streak counts back from today or yesterday).
  const streak = habits.reduce((best, h) => Math.max(best, habitStats(h, today).streak), 0);

  // The mood of the last check-in, while it's fresh (tonight's or last night's).
  const lastNight = [...checkins].sort((a, b) => b.date.localeCompare(a.date))[0];
  const mood = lastNight && lastNight.date >= addDays(nightDay(), -1) ? lastNight.mood : null;

  return {
    items: [...trees, ...lamps, ...gems, ...flowers, ...music],
    butterflies,
    streak,
    mood,
    visitors: visitorsFor(streak, gems.length),
    counts: { flowers: flowers.length, trees: full + (growing ? 1 : 0), lamps: lamps.length, gems: gems.length, butterflies, music: music.length },
    pet: pet?.name ?? "Nova",
    stage: pet?.stage ?? 0,
  };
}
