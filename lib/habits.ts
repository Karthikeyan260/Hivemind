import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { HttpError } from "@/lib/api";
import { readJSON, writeJSON } from "@/lib/private-store";
import { notify } from "@/lib/push";
import { addDays, localParts } from "@/lib/reminders";

/**
 * Habits: reminders at set times on chosen weekdays, ticked off once per day (from the app, by voice,
 * or straight from the notification). Streaks count consecutive scheduled days that were done.
 */
export type Habit = {
  id: string;
  name: string;
  emoji: string;
  /** Local "HH:MM" times to remind (e.g. ["07:00"] or every 2 h → ["09:00", "11:00", …]). */
  times: string[];
  /** Weekdays it's scheduled, 0 = Sunday. */
  days: number[];
  created: string;
  /** Local dates ("2026-10-01") it was done. */
  log: string[];
  /** Bookkeeping so each alert fires once: "2026-10-01 07:00" style keys, last nudge / summary dates. */
  alerted?: string[];
  nudged?: string;
  snoozeUntil?: string;
};

const KEY = "habits";
const STATE = "habits-state";
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

export const listHabits = (supabase: SupabaseClient) => readJSON<Habit[]>(supabase, KEY, []);
const save = (supabase: SupabaseClient, all: Habit[]) => writeJSON(supabase, KEY, all);

const dayOf = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();
const scheduledOn = (h: Habit, date: string) => h.days.includes(dayOf(date)) && date >= h.created.slice(0, 10);

/** Streak: consecutive scheduled days done, counting back from today (today only counts once done). */
export function stats(h: Habit, today = localParts().date) {
  const done = new Set(h.log);
  let streak = 0;
  let d = done.has(today) ? today : addDays(today, -1);
  for (let i = 0; i < 400; i++, d = addDays(d, -1)) {
    if (d < h.created.slice(0, 10)) break;
    if (!h.days.includes(dayOf(d))) continue;
    if (!done.has(d)) break;
    streak++;
  }
  // Best streak over the whole history.
  let best = 0;
  let run = 0;
  for (let x = h.created.slice(0, 10); x <= today; x = addDays(x, 1)) {
    if (!h.days.includes(dayOf(x))) continue;
    if (done.has(x)) best = Math.max(best, ++run);
    else if (x !== today) run = 0;
  }
  const last30 = Array.from({ length: 30 }, (_, i) => addDays(today, i - 29)).map((date) => ({ date, scheduled: scheduledOn(h, date), done: done.has(date) }));
  const sched = last30.filter((x) => x.scheduled && x.date < today).length;
  const hit = last30.filter((x) => x.scheduled && x.done).length;
  return { streak, best, doneToday: done.has(today), dueToday: scheduledOn(h, today), rate: sched ? Math.round((hit / Math.max(1, sched)) * 100) : null, last30 };
}

export type HabitView = Habit & ReturnType<typeof stats>;
export async function habitsWithStats(supabase: SupabaseClient): Promise<HabitView[]> {
  const today = localParts().date;
  return (await listHabits(supabase)).map((h) => ({ ...h, ...stats(h, today) }));
}

const TIME = /^([01]?\d|2[0-3]):([0-5]\d)$/;
const hhmm = (s: string) => {
  const m = s.trim().match(TIME);
  if (!m) throw new HttpError(400, `"${s}" isn't a time like 07:00 or 21:30.`);
  return `${m[1].padStart(2, "0")}:${m[2]}`;
};

/** "every N hours from 09:00 to 21:00" → the list of times. */
export function everyHours(n: number, from = "09:00", to = "21:00") {
  const [fh, fm] = hhmm(from).split(":").map(Number);
  const [th, tm] = hhmm(to).split(":").map(Number);
  const out: string[] = [];
  for (let t = fh * 60 + fm; t <= th * 60 + tm && out.length < 24; t += Math.max(30, n * 60)) out.push(`${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`);
  return out;
}

export async function addHabit(supabase: SupabaseClient, h: { name: string; emoji?: string; times: string[]; days?: number[] }) {
  const name = h.name.trim();
  if (!name) throw new HttpError(400, "Name the habit.");
  const times = [...new Set(h.times.map(hhmm))].sort();
  if (!times.length) throw new HttpError(400, "When should I remind you? e.g. 07:00");
  const days = [...new Set((h.days?.length ? h.days : ALL_DAYS).filter((d) => d >= 0 && d <= 6))].sort();
  const all = await listHabits(supabase);
  const same = all.find((x) => x.name.toLowerCase() === name.toLowerCase());
  const habit: Habit = same
    ? { ...same, times, days, emoji: h.emoji || same.emoji }
    : { id: crypto.randomUUID().slice(0, 12), name, emoji: h.emoji || "✅", times, days, created: localParts().date, log: [] };
  await save(supabase, [...all.filter((x) => x.id !== habit.id), habit]);
  return habit;
}

/** exact: only the habit with this id (API routes: a URL must never match by name). */
export function findHabit(all: Habit[], which: string, exact = false) {
  if (exact) return all.find((x) => x.id === which);
  const q = which.toLowerCase().trim();
  return all.find((x) => x.id === which) ?? all.find((x) => x.name.toLowerCase() === q) ?? all.find((x) => x.name.toLowerCase().includes(q) || q.includes(x.name.toLowerCase()));
}

export async function removeHabit(supabase: SupabaseClient, which: string, exact = false) {
  const all = await listHabits(supabase);
  const h = findHabit(all, which, exact);
  if (!h) return null;
  await save(supabase, all.filter((x) => x.id !== h.id));
  return h;
}

/** Tick (or untick) a habit for a day; returns the new streak. */
export async function checkHabit(supabase: SupabaseClient, which: string, opts: { done?: boolean; date?: string; exact?: boolean } = {}) {
  const all = await listHabits(supabase);
  const h = findHabit(all, which, opts.exact);
  if (!h) throw new HttpError(404, `No habit called "${which}".`);
  const date = opts.date ?? localParts().date;
  const done = opts.done ?? true;
  h.log = done ? [...new Set([...h.log, date])].sort().slice(-800) : h.log.filter((d) => d !== date);
  h.snoozeUntil = undefined;
  await save(supabase, all);
  return { name: h.name, emoji: h.emoji, done, ...stats(h) };
}

export async function snoozeHabit(supabase: SupabaseClient, which: string, minutes = 30, exact = false) {
  const all = await listHabits(supabase);
  const h = findHabit(all, which, exact);
  if (!h) throw new HttpError(404, "No such habit.");
  h.snoozeUntil = new Date(Date.now() + minutes * 60_000).toISOString();
  await save(supabase, all);
  return { name: h.name, until: h.snoozeUntil };
}

const actions = [
  { action: "habit-done", title: "✓ Done" },
  { action: "habit-snooze", title: "Snooze 30 min" },
];

/**
 * Called by the 5-minute cron: reminders at each time (and after a snooze), one 8 pm nudge for
 * anything still open, and a Sunday-evening weekly summary.
 */
export async function runHabitAlerts(supabase: SupabaseClient, now = new Date()) {
  const lp = localParts(now);
  const all = await listHabits(supabase);
  if (!all.length) return 0;
  const nowMin = lp.hour * 60 + lp.minute;
  let sent = 0;
  // Only what this run changes, per habit: merged into a fresh copy at the end, so a "✓ Done"
  // tapped on a notification while these were being sent isn't overwritten by this stale list.
  const patch = new Map<string, Partial<Pick<(typeof all)[number], "alerted" | "nudged" | "snoozeUntil">>>();
  const mark = (id: string, p: Partial<Pick<(typeof all)[number], "alerted" | "nudged" | "snoozeUntil">>) => patch.set(id, { ...patch.get(id), ...p });

  for (const h of all) {
    const st = stats(h, lp.date);
    if (!st.dueToday || st.doneToday) continue;
    const streakTxt = st.streak ? ` · 🔥 ${st.streak}-day streak` : "";
    const data = { habit: h.id };

    // Snoozed: remind again once the snooze is over.
    if (h.snoozeUntil && Date.parse(h.snoozeUntil) <= now.getTime()) {
      h.snoozeUntil = undefined;
      mark(h.id, { snoozeUntil: undefined });
      sent += await notify(supabase, { title: `${h.emoji} ${h.name}`, body: `Snooze's over: time for ${h.name.toLowerCase()}${streakTxt}`, url: "/habits", tag: `habit-${h.id}`, actions, data });
      continue;
    }
    if (h.snoozeUntil) continue;

    // Scheduled times that just arrived (within the last 20 min, so a late cron run still catches them).
    for (const t of h.times) {
      const [hh, mm] = t.split(":").map(Number);
      const key = `${lp.date} ${t}`;
      const diff = nowMin - (hh * 60 + mm);
      if (diff < 0 || diff > 20 || h.alerted?.includes(key)) continue;
      h.alerted = [...(h.alerted ?? []).filter((k) => k >= addDays(lp.date, -2)), key];
      mark(h.id, { alerted: h.alerted });
      sent += await notify(supabase, { title: `${h.emoji} Time for ${h.name.toLowerCase()}`, body: `Tap ✓ Done when it's done${streakTxt}`, url: "/habits", tag: `habit-${h.id}`, actions, data });
    }

    // One gentle evening nudge at 8 pm if it's still not done.
    if (lp.hour >= 20 && lp.hour < 22 && h.nudged !== lp.date && h.times.some((t) => t < "20:00")) {
      h.nudged = lp.date;
      mark(h.id, { nudged: lp.date });
      sent += await notify(supabase, {
        title: `${h.emoji} Still time for ${h.name.toLowerCase()}`,
        body: st.streak ? `Keep your ${st.streak}-day streak going 🔥` : "A quick one before the day ends?",
        url: "/habits",
        tag: `habit-${h.id}`,
        actions,
        data,
      });
    }
  }
  if (patch.size) {
    const fresh = await listHabits(supabase);
    for (const h of fresh) {
      const p = patch.get(h.id);
      if (p) Object.assign(h, p);
    }
    await save(supabase, fresh);
  }

  // Sunday 7–10 pm: the week in one notification.
  if (lp.weekday === 0 && lp.hour >= 19 && lp.hour < 22) {
    const state = await readJSON<{ weekly?: string }>(supabase, STATE, {});
    if (state.weekly !== lp.date) {
      const week = Array.from({ length: 7 }, (_, i) => addDays(lp.date, i - 6));
      const parts = all.map((h) => {
        const sched = week.filter((d) => scheduledOn(h, d)).length;
        const done = week.filter((d) => h.log.includes(d)).length;
        return `${h.emoji} ${h.name} ${done}/${sched}`;
      });
      if ((await notify(supabase, { title: "📊 Your week in habits", body: parts.join(" · "), url: "/habits", tag: "habits-weekly" })) > 0) {
        await writeJSON(supabase, STATE, { ...state, weekly: lp.date });
        sent++;
      }
    }
  }
  return sent;
}
