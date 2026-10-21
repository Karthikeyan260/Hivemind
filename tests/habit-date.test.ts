import { beforeEach, describe, expect, it, vi } from "vitest";

// An in-memory stand-in for the private store, so the habits module runs for real.
const files = new Map<string, unknown>();
vi.mock("@/lib/private-store", () => ({
  readJSON: async (_s: unknown, key: string, fallback: unknown) => (files.has(key) ? structuredClone(files.get(key)) : fallback),
  writeJSON: async (_s: unknown, key: string, value: unknown) => void files.set(key, structuredClone(value)),
}));
vi.mock("@/lib/push", () => ({ notify: async () => 0 }));

import { checkHabit, habitsWithStats, type Habit } from "@/lib/habits";

const supabase = {} as never;
const habit = (log: string[]): Habit => ({ id: "h1", name: "Gym", emoji: "🏋️", times: ["07:00"], days: [0, 1, 2, 3, 4, 5, 6], created: "2026-10-01", log });

describe("habits for a given day (a check-in at 12:30 am is still last night's)", () => {
  beforeEach(() => files.clear());

  it("asked as of a given date, a habit is open or done for THAT day, not the calendar's today", async () => {
    files.set("habits", [habit(["2026-10-20"])]); // done on the 20th only
    const asOf20 = (await habitsWithStats(supabase, "2026-10-20"))[0];
    expect(asOf20.doneToday).toBe(true);
    const asOf21 = (await habitsWithStats(supabase, "2026-10-21"))[0];
    expect(asOf21.doneToday).toBe(false);
    expect(asOf21.dueToday).toBe(true);
  });

  it("ticking with a date credits that day, so a late check-in marks last night's habit", async () => {
    files.set("habits", [habit([])]);
    await checkHabit(supabase, "Gym", { exact: false, date: "2026-10-20" });
    expect((files.get("habits") as Habit[])[0].log).toEqual(["2026-10-20"]);
  });
});
