import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { upcomingBirthdays } from "@/lib/birthdays";
import { briefHeadline, getBrief } from "@/lib/brief";
import { habitsWithStats } from "@/lib/habits";
import { agenda, localParts, type Reminder } from "@/lib/reminders";

/**
 * "Your day": what's on today, in one place and one short spoken script. Reminders (overdue, today,
 * tomorrow), habits still to do today with their streaks, birthdays this week, and the news brief's
 * headline. No AI call, so it's instant and free; the morning card and the voice "brief me" use it.
 */
export type DayItem = { id: string; title: string; when: string; all_day: boolean };
export type DayBrief = {
  greeting: string;
  date: string;
  overdue: DayItem[];
  today: DayItem[];
  tomorrow: DayItem[];
  habits: { name: string; emoji: string; streak: number; done: boolean }[];
  birthdays: { name: string; days: number; label: string; kind: string; turning: number | null }[];
  news: string | null;
  speech: string;
};

const item = (r: Reminder): DayItem => ({ id: r.id, title: r.title, when: r.all_day ? "all day" : (r.when.split(", ").pop() ?? r.when), all_day: r.all_day });
const pending = (l: Reminder[]) => l.filter((r) => r.status === "pending").map(item);
const list = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export async function dayBrief(supabase: SupabaseClient, name?: string): Promise<DayBrief> {
  const { date, hour: h } = localParts();
  const [a, habits, birthdays, news] = await Promise.all([
    agenda(supabase, 2),
    habitsWithStats(supabase).catch(() => []),
    upcomingBirthdays(supabase, 7).catch(() => []),
    getBrief(supabase, date).catch(() => null),
  ]);
  const greeting = `${h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening"}${name ? `, ${name}` : ""}`;
  const day: Omit<DayBrief, "speech"> = {
    greeting,
    date,
    overdue: pending(a.overdue),
    today: pending(a.today),
    tomorrow: pending(a.tomorrow),
    habits: habits.filter((x) => x.dueToday).map((x) => ({ name: x.name, emoji: x.emoji, streak: x.streak, done: x.doneToday })),
    birthdays: birthdays.map((b) => ({ name: b.name, days: b.days, label: b.label, kind: b.kind, turning: b.turning })),
    news: news ? briefHeadline(news) : null,
  };
  return { ...day, speech: speak(day) };
}

/** The spoken version: short sentences, the important things first. */
function speak(d: Omit<DayBrief, "speech">) {
  const s: string[] = [`${d.greeting}.`];
  if (d.today.length) s.push(`Today you have ${list(d.today.slice(0, 4).map((r) => (r.all_day ? r.title : `${r.title} at ${r.when}`)))}${d.today.length > 4 ? `, and ${d.today.length - 4} more` : ""}.`);
  else s.push("Nothing is on your calendar today.");
  if (d.overdue.length) s.push(`${plural(d.overdue.length, "thing is", "things are")} overdue: ${list(d.overdue.slice(0, 3).map((r) => r.title))}.`);
  const todo = d.habits.filter((x) => !x.done);
  if (todo.length) {
    const best = [...todo].sort((x, y) => y.streak - x.streak)[0];
    s.push(`Habits to do: ${list(todo.slice(0, 4).map((x) => x.name))}.${best.streak >= 2 ? ` Keep your ${best.streak} day ${best.name} streak going.` : ""}`);
  } else if (d.habits.length) s.push("All your habits are done for today. Nice.");
  for (const b of d.birthdays.slice(0, 2)) {
    const what = b.kind === "anniversary" ? "anniversary" : "birthday";
    s.push(b.days === 0 ? `It's ${b.name}'s ${what} today${b.turning ? `, turning ${b.turning}` : ""}. Don't forget to wish them.` : `${b.name}'s ${what} is ${b.days === 1 ? "tomorrow" : `in ${b.days} days`}.`);
  }
  if (d.tomorrow.length) s.push(`Tomorrow: ${list(d.tomorrow.slice(0, 3).map((r) => r.title))}.`);
  if (d.news) s.push(`In the news you follow: ${d.news}`);
  return s.join(" ");
}
