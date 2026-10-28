import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/private-store", () => ({ readJSON: async (_s: unknown, _k: string, f: unknown) => f, writeJSON: async () => {} }));
vi.mock("@/lib/push", () => ({ notify: async () => 0 }));
import { stats, type Habit } from "@/lib/habits";

const seeded = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const DAY = 86_400_000;

/** Slow and obvious: list every scheduled day from creation to today, then read the streaks off the list. */
function oracle(h: Habit, today: string) {
  const start = Date.parse(`${h.created}T00:00:00Z`);
  const end = Date.parse(`${today}T00:00:00Z`);
  const days: { date: string; done: boolean }[] = [];
  for (let t = start; t <= end; t += DAY) {
    const date = iso(t);
    if (h.days.includes(new Date(t).getUTCDay())) days.push({ date, done: h.log.includes(date) });
  }
  // streak: from the latest scheduled day backwards; today only counts if it's done
  let list = days;
  if (list.length && list[list.length - 1].date === today && !list[list.length - 1].done) list = list.slice(0, -1);
  let streak = 0;
  for (let i = list.length - 1; i >= 0 && list[i].done; i--) streak++;
  let best = 0, run = 0;
  for (const d of days) {
    if (d.done) best = Math.max(best, ++run);
    else if (d.date !== today) run = 0;
  }
  return { streak, best };
}

describe("habit streaks match a brute-force count", () => {
  it("over thousands of random habits", () => {
    for (let seed = 1; seed <= 3000; seed++) {
      const r = seeded(seed);
      const today = iso(Date.parse("2026-06-01T00:00:00Z") + Math.floor(r() * 400) * DAY);
      const back = Math.floor(r() * 120);
      const created = iso(Date.parse(`${today}T00:00:00Z`) - back * DAY);
      const days = [0, 1, 2, 3, 4, 5, 6].filter(() => r() < 0.6);
      if (!days.length) days.push(Math.floor(r() * 7));
      const p = r(); // how reliable this person is
      const log: string[] = [];
      for (let i = 0; i <= back; i++) if (r() < p) log.push(iso(Date.parse(`${created}T00:00:00Z`) + i * DAY));
      const h: Habit = { id: "h", name: "x", emoji: "x", times: ["07:00"], days, created, log };
      const want = oracle(h, today);
      const got = stats(h, today);
      expect({ streak: got.streak, best: got.best }, `seed ${seed}: days ${days} created ${created} today ${today}`).toEqual(want);
      expect(got.rate === null || (got.rate >= 0 && got.rate <= 100)).toBe(true);
      expect(got.last30).toHaveLength(30);
    }
  });
});
