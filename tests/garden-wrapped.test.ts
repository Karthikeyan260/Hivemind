import { describe, expect, it } from "vitest";
import { gardenGrew, SEASON_LOOK, seasonOfMonth, SEASONS } from "@/lib/garden-layout";

describe("the garden in Wrapped", () => {
  it("gives each month its season", () => {
    expect(seasonOfMonth("2026-03")).toBe("spring");
    expect(seasonOfMonth("2026-06")).toBe("summer");
    expect(seasonOfMonth("2026-10")).toBe("autumn");
    expect(seasonOfMonth("2026-12")).toBe("winter");
    expect(seasonOfMonth("2026-01")).toBe("winter");
    for (const s of SEASONS) expect(SEASON_LOOK[s].name.length).toBeGreaterThan(0);
  });
  it("counts what the month grew", () => {
    const g = gardenGrew({ habits: [{ done: 12 }, { done: 5 }], moods: { count: 9 }, games: { won: 3 }, music: { plays: 40 } });
    expect(g).toEqual({ flowers: 17, trees: 9, gems: 3, songs: 40 });
    expect(gardenGrew({ habits: [], moods: { count: 0 }, games: { won: 0 }, music: { plays: 0 } })).toEqual({ flowers: 0, trees: 0, gems: 0, songs: 0 });
  });
});
