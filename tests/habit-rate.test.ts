import { describe, expect, it } from "vitest";
import { type Habit, stats } from "@/lib/habits";

const habit = (created: string, log: string[]): Habit => ({ id: "h1", name: "Walking", emoji: "🚶", times: ["18:30"], days: [0, 1, 2, 3, 4, 5, 6], created, log });

describe("habit 30-day rate", () => {
  it("never goes past 100% (a habit started yesterday, done yesterday and today)", () => {
    expect(stats(habit("2026-10-15", ["2026-10-15", "2026-10-16"]), "2026-10-16").rate).toBe(100);
  });
  it("counts today only once it's done", () => {
    expect(stats(habit("2026-10-14", ["2026-10-14"]), "2026-10-16").rate).toBe(50);
    expect(stats(habit("2026-10-14", ["2026-10-14", "2026-10-16"]), "2026-10-16").rate).toBe(67);
  });
});
