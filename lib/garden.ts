import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { listCheckins } from "@/lib/checkin";
import { listResults } from "@/lib/games/stats";
import { type Garden, type GardenItem, hueOf } from "@/lib/garden-layout";
import { listHabits } from "@/lib/habits";
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

  const songs = plays.filter((p) => localParts(new Date(p.at)).date >= since).length;
  const butterflies = Math.min(12, Math.floor(songs / SONGS_PER_BUTTERFLY));

  return {
    items: [...trees, ...lamps, ...gems, ...flowers],
    butterflies,
    counts: { flowers: flowers.length, trees: full + (growing ? 1 : 0), lamps: lamps.length, gems: gems.length, butterflies },
    pet: pet?.name ?? "Nova",
    stage: pet?.stage ?? 0,
  };
}
