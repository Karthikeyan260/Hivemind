import type { Habit } from "@/lib/habits";

const dow = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay();

/** Per day: how many scheduled habits were done; per habit: done / scheduled over the days. A habit counts only from the day it was created. */
export function weekHabits(habits: Habit[], dates: string[]) {
  const rows = habits.map((h) => {
    const log = new Set(h.log);
    const sched = dates.filter((d) => d >= h.created.slice(0, 10) && h.days.includes(dow(d)));
    return { name: h.name, emoji: h.emoji, sched, done: sched.filter((d) => log.has(d)).length, log };
  });
  const days = dates.map((date) => {
    const on = rows.filter((r) => r.sched.includes(date));
    return { date, scheduled: on.length, done: on.filter((r) => r.log.has(date)).length };
  });
  const scheduled = rows.reduce((s, r) => s + r.sched.length, 0);
  const done = rows.reduce((s, r) => s + r.done, 0);
  return {
    days,
    habits: rows.filter((r) => r.sched.length).map((r) => ({ name: r.name, emoji: r.emoji, done: r.done, scheduled: r.sched.length })).sort((a, b) => b.done / b.scheduled - a.done / a.scheduled),
    rate: scheduled ? Math.round((done / scheduled) * 100) : null,
  };
}

/** One plain sentence about the week from the numbers: habit rate against last week, best and weakest habit. */
export function weekLine(w: { rate: number | null; lastRate: number | null; habits: { name: string; done: number; scheduled: number }[]; moodAverage: number | null }) {
  if (w.rate === null) return "No habits were scheduled this week.";
  const parts = [`You finished ${w.rate}% of your habits this week`];
  if (w.lastRate !== null) {
    const d = w.rate - w.lastRate;
    parts[0] += d === 0 ? ", same as last week" : d > 0 ? `, up ${d} points from last week` : `, down ${-d} points from last week`;
  }
  const best = w.habits[0];
  const worst = w.habits.length > 1 ? w.habits[w.habits.length - 1] : null;
  let s = `${parts[0]}.`;
  if (best && best.done > 0) s += ` Best: ${best.name} (${best.done}/${best.scheduled}).`;
  if (worst && worst.name !== best?.name && worst.done / worst.scheduled < 0.5) s += ` Needs a push: ${worst.name} (${worst.done}/${worst.scheduled}).`;
  return s;
}
