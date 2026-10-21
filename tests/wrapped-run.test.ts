import { describe, expect, it } from "vitest";
import { longestRun } from "@/lib/wrapped";

const september = Array.from({ length: 30 }, (_, i) => `2026-09-${String(i + 1).padStart(2, "0")}`);
const dow = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay();

describe("wrapped: a habit's best run", () => {
  it("a weekday-only habit done every weekday runs the whole month, not just 5 days", () => {
    const weekdays = [1, 2, 3, 4, 5];
    const done = new Set(september.filter((d) => weekdays.includes(dow(d))));
    expect(done.size).toBe(22);
    expect(longestRun(september, done, weekdays)).toBe(22);
  });
  it("a missed scheduled day ends the run", () => {
    const all = [0, 1, 2, 3, 4, 5, 6];
    const done = new Set(september.filter((d) => d !== "2026-09-10"));
    expect(longestRun(september, done, all)).toBe(20); // 11th to 30th
  });
  it("nothing done is a run of 0", () => {
    expect(longestRun(september, new Set(), [1, 2, 3])).toBe(0);
  });
});
