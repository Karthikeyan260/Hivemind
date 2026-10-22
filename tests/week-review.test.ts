import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/private-store", () => ({ readJSON: async (_s: unknown, _k: string, f: unknown) => f, writeJSON: async () => {} }));

import { reviewWeek } from "@/lib/week";

const base = { done: 0, due: 0, checkins: 0, moods: [], wins: 0, played: 0, best: null };

describe("reviewWeek", () => {
  it("calls the week strong, decent or slower by the habit rate", () => {
    expect(reviewWeek({ ...base, done: 12, due: 14 }).headline).toBe("A strong week");
    expect(reviewWeek({ ...base, done: 8, due: 14 }).headline).toBe("A decent week");
    expect(reviewWeek({ ...base, done: 3, due: 14 }).headline).toBe("A slower week");
  });
  it("says what happened, only the parts that did", () => {
    const r = reviewWeek({ done: 5, due: 7, checkins: 4, moods: [4, 5, 3, 4], wins: 2, played: 30, best: { name: "Walking", emoji: "🚶", done: 5, due: 7 } });
    expect(r.speech).toContain("5 of 7 habit days done, Walking went best");
    expect(r.speech).toContain("4 night check-ins, mostly a good mood");
    expect(r.speech).toContain("2 games won");
    expect(r.speech).toContain("30 songs played");
    expect(r.avgMood).toBe(4);
    const quiet = reviewWeek(base);
    expect(quiet.headline).toBe("A quiet week");
    expect(quiet.speech).toContain("Not much to count yet");
  });
  it("uses singular words for one", () => {
    const r = reviewWeek({ ...base, checkins: 1, moods: [2], wins: 1, played: 1 });
    expect(r.speech).toContain("1 night check-in,");
    expect(r.speech).toContain("1 game won");
    expect(r.speech).toContain("1 song played");
    expect(r.headline).toBe("A week without habits set up");
  });
});
