import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { listCheckins } from "@/lib/checkin";
import { listResults } from "@/lib/games/stats";
import { type Habit, listHabits } from "@/lib/habits";
import { addDays, localDayStart, localParts } from "@/lib/reminders";
import { weekHabits, weekLine } from "@/lib/weekly-calc";

export type Weekly = {
  from: string;
  to: string;
  line: string;
  days: { date: string; weekday: string; done: number; scheduled: number; mood: number | null }[];
  habits: { name: string; emoji: string; done: number; scheduled: number }[];
  rate: number | null;
  lastRate: number | null;
  moodAverage: number | null;
  notes: number;
  games: { played: number; won: number };
};

/** The last 7 days ending today (home time), from the owner's own data. No AI: every number and the one-line summary are computed. */
export async function weeklyReview(supabase: SupabaseClient, today = localParts().date): Promise<Weekly> {
  const from = addDays(today, -6);
  const dates = Array.from({ length: 7 }, (_, i) => addDays(from, i));
  const prev = Array.from({ length: 7 }, (_, i) => addDays(from, i - 7));
  const start = localDayStart(new Date(`${from}T12:00:00Z`));
  const [habits, checkins, results, notes] = await Promise.all([
    listHabits(supabase).catch(() => [] as Habit[]),
    listCheckins(supabase).catch(() => []),
    listResults(supabase).catch(() => []),
    supabase.from("notes").select("id", { count: "exact", head: true }).gte("created_at", start.toISOString()).then((r) => r.count ?? 0),
  ]);
  const h = weekHabits(habits, dates);
  const last = weekHabits(habits, prev);
  const moods = new Map(checkins.filter((c) => dates.includes(c.date)).map((c) => [c.date, c.mood]));
  const moodValues = [...moods.values()];
  const games = results.filter((r) => +new Date(r.at) >= +start);
  const moodAverage = moodValues.length ? Math.round((moodValues.reduce((s, m) => s + m, 0) / moodValues.length) * 10) / 10 : null;
  const w: Weekly = {
    from,
    to: today,
    line: "",
    days: h.days.map((d) => ({ ...d, weekday: new Date(`${d.date}T12:00:00Z`).toLocaleDateString("en-IN", { weekday: "short", timeZone: "UTC" }), mood: moods.get(d.date) ?? null })),
    habits: h.habits,
    rate: h.rate,
    lastRate: last.rate,
    moodAverage,
    notes,
    games: { played: games.length, won: games.filter((g) => g.outcome === "win").length },
  };
  w.line = weekLine(w);
  return w;
}
