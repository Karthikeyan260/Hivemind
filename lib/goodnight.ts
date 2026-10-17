import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { listHabits } from "@/lib/habits";
import { listPlays } from "@/lib/plays";
import { getProfile } from "@/lib/profile";
import { addDays, agenda, localParts } from "@/lib/reminders";

/**
 * "Nova, good night": what Nova says at bedtime (tomorrow in two short lines, from the owner's own
 * reminders and habits, no AI) and a calm song to fall asleep to, from an artist they actually play.
 */
export type GoodNight = { name: string; lines: string[]; song: string };

const DOW = [0, 1, 2, 3, 4, 5, 6];
const dayOf = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay();
const time = (iso: string) => new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: process.env.HOME_TZ || "Asia/Kolkata" }).replace(":00", "");
const hhmm = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  const ampm = h >= 12 ? "pm" : "am";
  const h12 = h % 12 || 12;
  return m ? `${h12}:${String(m).padStart(2, "0")} ${ampm}` : `${h12} ${ampm}`;
};

export async function goodNight(supabase: SupabaseClient): Promise<GoodNight> {
  const today = localParts().date;
  const tomorrow = addDays(today, 1);
  const [plan, habits, profile, plays] = await Promise.all([
    agenda(supabase, 2).catch(() => null),
    listHabits(supabase).catch(() => []),
    getProfile(supabase).catch(() => null),
    listPlays(supabase, today.slice(0, 7)).catch(() => []),
  ]);
  const name = profile?.name?.split(" ")[0] || "friend";

  // Line 1: tomorrow's reminders (first two, with times).
  const rem = plan?.tomorrow ?? [];
  const first = rem
    .slice(0, 2)
    .map((r) => (r.all_day ? r.title : `${r.title} at ${time(r.due_at)}`))
    .join(", and ");
  const line1 = rem.length ? `Tomorrow: ${first}${rem.length > 2 ? `, plus ${rem.length - 2} more` : ""}.` : "Nothing on the calendar tomorrow. A free day!";

  // Line 2: habits due tomorrow.
  const due = habits.filter((h) => (h.days ?? DOW).includes(dayOf(tomorrow)) && tomorrow >= h.created.slice(0, 10));
  const line2 = due.length ? `Don't forget ${due.slice(0, 2).map((h) => `${h.name}${h.times?.[0] ? ` at ${hhmm(h.times[0])}` : ""}`).join(" and ")}${due.length > 2 ? ` and ${due.length - 2} more` : ""}.` : "";

  // A calm song from the artist they've played most this month (a melody, for sleeping).
  const counts = new Map<string, number>();
  for (const p of plays) {
    const a = (p.artists.split(",")[0] || "").trim();
    if (a) counts.set(a, (counts.get(a) ?? 0) + 1);
  }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const song = top ? `${top} soft melody` : "Ilaiyaraaja night melody";

  return { name, lines: [line1, line2, `Good night, ${name}. Sleep well 🌙`].filter(Boolean), song };
}
