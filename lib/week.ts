import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { listCheckins } from "@/lib/checkin";
import { listResults } from "@/lib/games/stats";
import { listHabits } from "@/lib/habits";
import { weekStats } from "@/lib/pet";
import { listPlays } from "@/lib/plays";
import { addDays, localParts } from "@/lib/reminders";

/**
 * "Your week": the last seven days in a few numbers (habit days done of those due, night check-ins and
 * the mood they added up to, games won, songs played, the habit that went best), shown on Sundays
 * with the day's brief. No AI: it is only the owner's own numbers.
 */
export type WeekReview = {
  done: number;
  due: number;
  checkins: number;
  /** Average mood of the week's check-ins (1..5), or null with none. */
  avgMood: number | null;
  wins: number;
  played: number;
  best: { name: string; emoji: string; done: number; due: number } | null;
  /** One line on how it went. */
  headline: string;
  /** The same, to read aloud. */
  speech: string;
};

const FACES = ["a rough", "a meh", "an okay", "a good", "a great"];

/** The review of a week from its counts (pure). */
export function reviewWeek(w: { done: number; due: number; checkins: number; moods: number[]; wins: number; played: number; best: WeekReview["best"] }): WeekReview {
  const rate = w.due ? w.done / w.due : null;
  const headline = rate === null ? (w.checkins || w.wins || w.played ? "A week without habits set up" : "A quiet week") : rate >= 0.85 ? "A strong week" : rate >= 0.5 ? "A decent week" : "A slower week";
  const avgMood = w.moods.length ? Math.round((w.moods.reduce((a, b) => a + b, 0) / w.moods.length) * 10) / 10 : null;
  const bits: string[] = [];
  if (w.due) bits.push(`${w.done} of ${w.due} habit days done${w.best && w.best.done > 0 ? `, ${w.best.name} went best` : ""}`);
  if (w.checkins) bits.push(`${w.checkins} night check-in${w.checkins === 1 ? "" : "s"}${avgMood !== null ? `, mostly ${FACES[Math.min(4, Math.max(0, Math.round(avgMood) - 1))]} mood` : ""}`);
  if (w.wins) bits.push(`${w.wins} game${w.wins === 1 ? "" : "s"} won`);
  if (w.played) bits.push(`${w.played} song${w.played === 1 ? "" : "s"} played`);
  return { done: w.done, due: w.due, checkins: w.checkins, avgMood, wins: w.wins, played: w.played, best: w.best, headline, speech: `${headline}. ${bits.length ? `${bits.join(". ")}.` : "Not much to count yet."}` };
}

/** The review of the seven days ending `today` (a "YYYY-MM-DD"). */
export async function weekReview(supabase: SupabaseClient, today = localParts().date): Promise<WeekReview> {
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, i - 6));
  const months = [...new Set(days.map((d) => d.slice(0, 7)))];
  const [habits, checkins, results, plays] = await Promise.all([
    listHabits(supabase).catch(() => []),
    listCheckins(supabase).catch(() => []),
    listResults(supabase).catch(() => []),
    Promise.all(months.map((m) => listPlays(supabase, m).catch(() => []))).then((x) => x.flat()),
  ]);
  const inWeek = (d: string) => days.includes(d);
  const dayOf = (iso: string) => localParts(new Date(iso)).date;
  const wins = results.filter((r) => r.outcome === "win").map((r) => dayOf(r.at));
  const mine = checkins.filter((c) => inWeek(c.date));
  const stats = weekStats(habits, mine.map((c) => c.date), wins, today);
  // The habit with the most days done this week (of those due).
  let best: WeekReview["best"] = null;
  for (const h of habits) {
    const own = weekStats([h], [], [], today);
    if (own.due && own.done > (best?.done ?? 0)) best = { name: h.name, emoji: h.emoji || "✅", done: own.done, due: own.due };
  }
  return reviewWeek({ ...stats, moods: mine.map((c) => c.mood), played: plays.filter((p) => inWeek(dayOf(p.at))).length, best });
}
