import { describe, expect, it } from "vitest";
import { accessoryFor, festivalOn, unlocked } from "@/lib/pet-looks";

describe("festivalOn", () => {
  it("finds moving festivals with a day either side", () => {
    expect(festivalOn("2026-11-07")?.id).toBe("deepavali");
    expect(festivalOn("2026-11-06")?.id).toBe("deepavali");
    expect(festivalOn("2026-11-08")?.id).toBe("deepavali");
    expect(festivalOn("2026-11-09")).toBeNull();
    expect(festivalOn("2026-11-24")?.id).toBe("karthigai");
  });
  it("finds fixed-date festivals every year", () => {
    expect(festivalOn("2027-01-14")?.id).toBe("pongal");
    expect(festivalOn("2027-04-14")?.id).toBe("puthandu");
    expect(festivalOn("2026-12-25")?.id).toBe("christmas");
    expect(festivalOn("2026-12-31")?.id).toBe("newyear");
    expect(festivalOn("2027-01-01")?.id).toBe("newyear");
    expect(festivalOn("2027-08-15")?.id).toBe("india");
    expect(festivalOn("2026-10-15")).toBeNull();
  });
});

describe("accessories", () => {
  it("unlock with growth", () => {
    expect(unlocked(0)).toEqual([]);
    expect(unlocked(1)).toEqual(["bow"]);
    expect(unlocked(3)).toEqual(["bow", "garland", "shades"]);
  });
  it("understand what was asked", () => {
    expect(accessoryFor("wear the malli garland")).toBe("garland");
    expect(accessoryFor("put on sunglasses")).toBe("shades");
    expect(accessoryFor("take it off")).toBe("none");
    expect(accessoryFor("the pink bow")).toBe("bow");
    expect(accessoryFor("a hat")).toBeNull();
  });
});
