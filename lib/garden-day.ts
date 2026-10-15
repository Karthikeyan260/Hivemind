import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { HttpError } from "@/lib/api";
import { listCheckins, MOODS } from "@/lib/checkin";
import { listResults } from "@/lib/games/stats";
import { listHabits } from "@/lib/habits";
import { festivalOn } from "@/lib/pet-looks";
import { listPlays } from "@/lib/plays";
import { readJSON } from "@/lib/private-store";
import { localDayStart, localParts } from "@/lib/reminders";

/**
 * One day of the owner's life, as the garden remembers it (what opens when a flower is tapped): the
 * evening check-in (mood and what they wrote), habits done, songs played, notes and memories saved,
 * games won, and whether Nova and they went on a lantern walk.
 */
export type GardenDay = {
  date: string;
  festival?: string;
  mood?: { emoji: string; word: string };
  reflection?: string;
  habits: { emoji: string; name: string }[];
  songs: { title: string; artists: string; image?: string }[];
  notes: { title: string; summary?: string }[];
  memories: string[];
  wins: string[];
  walked: boolean;
};

const GAME_NAME: Record<string, string> = { chess: "Chess", cards: "Colour Clash", ludo: "Ludo", draw: "Draw & Guess", dots: "Dots & Boxes" };

export async function getGardenDay(supabase: SupabaseClient, date: string): Promise<GardenDay> {
  // A real calendar date (2026-02-30 is not).
  const parsed = new Date(`${date}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(+parsed) || parsed.toISOString().slice(0, 10) !== date) throw new HttpError(400, "A date like 2026-10-15, please.");
  // The local day's bounds (noon UTC is safely inside the same local date).
  const start = localDayStart(new Date(`${date}T12:00:00Z`));
  const end = localDayStart(new Date(`${date}T12:00:00Z`), 1);
  const within = (iso: string) => localParts(new Date(iso)).date === date;

  const [habits, checkins, plays, games, saved, notes, memories] = await Promise.all([
    listHabits(supabase).catch(() => []),
    listCheckins(supabase).catch(() => []),
    listPlays(supabase, date.slice(0, 7)).catch(() => []),
    listResults(supabase).catch(() => []),
    readJSON<{ walks?: string[] } | null>(supabase, "pet", null).catch(() => null),
    supabase.from("notes").select("id, title, summary").gte("created_at", start.toISOString()).lt("created_at", end.toISOString()).order("created_at").limit(12),
    supabase.from("memories").select("title").gte("created_at", start.toISOString()).lt("created_at", end.toISOString()).order("created_at").limit(8),
  ]);

  const checkin = checkins.find((c) => c.date === date);
  let reflection: string | undefined;
  if (checkin?.noteId) {
    const { data } = await supabase.from("notes").select("content").eq("id", checkin.noteId).maybeSingle();
    // The note starts with a "Mood: …" line; the card shows the mood on its own.
    reflection = (data?.content as string | undefined)?.replace(/^Mood:[^\n]*\n+/, "").trim().slice(0, 600) || undefined;
  }

  // The same song played twice in a row counts once.
  const songs: GardenDay["songs"] = [];
  for (const p of plays.filter((x) => within(x.at))) if (!songs.some((s) => s.title === p.title)) songs.push({ title: p.title, artists: p.artists, image: p.image });

  return {
    date,
    festival: festivalOn(date)?.name,
    mood: checkin ? MOODS[checkin.mood] : undefined,
    reflection,
    habits: habits.filter((h) => h.log.includes(date)).map((h) => ({ emoji: h.emoji || "✅", name: h.name })),
    songs: songs.slice(0, 8),
    notes: (notes.data ?? []).filter((n) => n.id !== checkin?.noteId).map((n) => ({ title: n.title as string, summary: (n.summary as string | null) ?? undefined })),
    memories: (memories.data ?? []).map((m) => m.title as string),
    wins: games.filter((g) => g.outcome === "win" && within(g.at)).map((g) => GAME_NAME[g.game] ?? g.game),
    walked: (saved?.walks ?? []).includes(date),
  };
}
