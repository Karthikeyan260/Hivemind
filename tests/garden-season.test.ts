import { describe, expect, it } from "vitest";
import { fireflyCount, seasonOf } from "@/lib/garden-layout";

describe("Garden seasons", () => {
  it("every month has a season: spring Mar–May, summer Jun–Aug, autumn Sep–Nov, winter Dec–Feb", () => {
    const names = Array.from({ length: 12 }, (_, m) => seasonOf(m));
    expect(names).toEqual(["winter", "winter", "spring", "spring", "spring", "summer", "summer", "summer", "autumn", "autumn", "autumn", "winter"]);
  });
});

describe("Streak fireflies", () => {
  it("none without a streak, four a day, never more than 48", () => {
    expect(fireflyCount(0)).toBe(0);
    expect(fireflyCount(1)).toBe(4);
    expect(fireflyCount(6)).toBe(24);
    expect(fireflyCount(12)).toBe(48);
    expect(fireflyCount(400)).toBe(48);
    expect(fireflyCount(-3)).toBe(0);
  });
});

describe("Rare visitors", () => {
  it("an owl at a 7-day streak, a deer at 10 game wins, both when both are earned", async () => {
    const { visitorsFor } = await import("@/lib/garden-layout");
    expect(visitorsFor(6, 9)).toEqual([]);
    expect(visitorsFor(7, 9).map((v) => v.kind)).toEqual(["owl"]);
    expect(visitorsFor(2, 10).map((v) => v.kind)).toEqual(["deer"]);
    expect(visitorsFor(30, 40).map((v) => v.kind)).toEqual(["owl", "deer"]);
    expect(visitorsFor(7, 0)[0].label).toContain("7-day streak");
  });
});
