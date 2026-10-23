import { describe, expect, it } from "vitest";
import { ACCESSORIES, accessoryFor, bestWinStreak, earnedAccessories, type EarnFacts, festivalOn, isWinter, unlocked } from "@/lib/pet-looks";

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

const NONE: EarnFacts = { stage: 0, bestStreak: 0, winStreak: 0, songs: 0, winter: false, festivals: [] };

describe("earning accessories", () => {
  it("each one comes from its own doing", () => {
    expect(earnedAccessories(NONE)).toEqual([]);
    expect(earnedAccessories({ ...NONE, bestStreak: 7 })).toEqual(["cap"]);
    expect(earnedAccessories({ ...NONE, bestStreak: 6 })).toEqual([]);
    expect(earnedAccessories({ ...NONE, winStreak: 5 })).toEqual(["crown"]);
    expect(earnedAccessories({ ...NONE, songs: 99 })).toEqual([]);
    expect(earnedAccessories({ ...NONE, songs: 100 })).toEqual(["headphones"]);
    expect(earnedAccessories({ ...NONE, winter: true })).toEqual(["scarf"]);
    expect(earnedAccessories({ ...NONE, festivals: ["deepavali", "christmas"] }).sort()).toEqual(["hat-christmas", "hat-deepavali"]);
  });
  it("adds up, and growth still unlocks the first three", () => {
    const all = earnedAccessories({ stage: 3, bestStreak: 30, winStreak: 9, songs: 500, winter: true, festivals: ["pongal", "puthandu", "deepavali", "karthigai", "christmas", "newyear", "india"] });
    expect(all).toHaveLength(ACCESSORIES.length);
  });
  it("has a festival hat for every festival", () => {
    const ids = ["pongal", "puthandu", "deepavali", "karthigai", "christmas", "newyear", "india"];
    for (const f of ids) expect(ACCESSORIES.some((a) => a.earn.type === "festival" && a.earn.id === f), f).toBe(true);
  });
  it("counts the best run of wins: a loss starts again, a draw does not break it", () => {
    expect(bestWinStreak([])).toBe(0);
    expect(bestWinStreak(["win", "win", "loss", "win"])).toBe(2);
    expect(bestWinStreak(["win", "win", "draw", "win", "win", "win"])).toBe(5);
    expect(bestWinStreak(["loss", "loss"])).toBe(0);
  });
  it("knows winter", () => {
    expect(["2026-12-01", "2027-01-15", "2027-02-28"].map(isWinter)).toEqual([true, true, true]);
    expect(["2026-11-30", "2027-03-01", "2026-10-23"].map(isWinter)).toEqual([false, false, false]);
  });
  it("understands the new ones when asked", () => {
    expect(accessoryFor("wear the crown")).toBe("crown");
    expect(accessoryFor("put on headphones")).toBe("headphones");
    expect(accessoryFor("a scarf please")).toBe("scarf");
    expect(accessoryFor("wear the cap")).toBe("cap");
    expect(accessoryFor("santa hat")).toBe("hat-christmas");
    expect(accessoryFor("the mango leaf crown")).toBe("hat-puthandu");
    expect(accessoryFor("diya crown")).toBe("hat-deepavali");
    expect(accessoryFor("tricolour band")).toBe("hat-india");
    // Words that only contain them aren't requests.
    expect(accessoryFor("I am walking and making tea")).toBeNull();
    expect(accessoryFor("the escape plan")).toBeNull();
  });
});
