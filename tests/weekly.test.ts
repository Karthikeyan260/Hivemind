import { describe, expect, it } from "vitest";
import type { Habit } from "@/lib/habits";
import { weekHabits, weekLine } from "@/lib/weekly-calc";

const dates = Array.from({ length: 7 }, (_, i) => `2026-11-${String(10 + i).padStart(2, "0")}`); // Tue 10th … Mon 16th
const habit = (over: Partial<Habit>): Habit => ({ id: "h", name: "Walk", emoji: "🚶", times: [], days: [0, 1, 2, 3, 4, 5, 6], created: "2026-01-01T00:00:00Z", log: [], ...over });

describe("weekly review", () => {
  it("counts done and scheduled per day and overall", () => {
    const w = weekHabits([habit({ log: dates.slice(0, 3) }), habit({ name: "Read", log: dates })], dates);
    expect(w.days[0]).toEqual({ date: dates[0], scheduled: 2, done: 2 });
    expect(w.days[6]).toEqual({ date: dates[6], scheduled: 2, done: 1 });
    expect(w.rate).toBe(Math.round((10 / 14) * 100));
    expect(w.habits[0].name).toBe("Read");
  });
  it("skips days the habit is not scheduled and days before it was created", () => {
    const w = weekHabits([habit({ days: [1, 2, 3, 4, 5], created: "2026-11-12T08:00:00Z" })], dates);
    // 12th Thu … 16th Mon, weekdays only: Thu, Fri, Mon
    expect(w.habits[0].scheduled).toBe(3);
    expect(w.days[0].scheduled).toBe(0);
  });
  it("no habits means no rate", () => {
    expect(weekHabits([], dates).rate).toBeNull();
    expect(weekLine({ rate: null, lastRate: null, habits: [], moodAverage: null })).toMatch(/No habits/);
  });
  it("the line compares with last week and names best and weakest", () => {
    const line = weekLine({ rate: 70, lastRate: 60, moodAverage: null, habits: [{ name: "Read", done: 7, scheduled: 7 }, { name: "Gym", done: 1, scheduled: 7 }] });
    expect(line).toContain("up 10 points");
    expect(line).toContain("Best: Read (7/7)");
    expect(line).toContain("Needs a push: Gym (1/7)");
  });
});
