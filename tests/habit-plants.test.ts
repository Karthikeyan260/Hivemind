import { describe, expect, it } from "vitest";
import { type GardenItem, layout, plantLabel, plantStage } from "@/lib/garden-layout";

describe("how a habit grows", () => {
  it("a seed, then a sprout at a week, a sapling at two, a tree at 21 in a row", () => {
    expect([0, 3, 6].map((s) => plantStage(s, s))).toEqual([0, 0, 0]);
    expect(plantStage(7, 7)).toBe(1);
    expect(plantStage(13, 13)).toBe(1);
    expect(plantStage(14, 14)).toBe(2);
    expect(plantStage(20, 20)).toBe(2);
    expect(plantStage(21, 21)).toBe(3);
  });
  it("a tree stays a tree after the streak breaks, but a plant that never got there starts again", () => {
    expect(plantStage(0, 30)).toBe(3);
    expect(plantStage(2, 25)).toBe(3);
    expect(plantStage(0, 18)).toBe(0);
    expect(plantStage(3, 18)).toBe(0);
  });
  it("says where it is and what is left", () => {
    expect(plantLabel("Walking", "🚶", 0, 3, 3)).toContain("3 days in a row, 4 more to sprout");
    expect(plantLabel("Walking", "🚶", 1, 8, 8)).toContain("a sprout");
    expect(plantLabel("Walking", "🚶", 1, 8, 8)).toContain("6 more to a sapling");
    expect(plantLabel("Walking", "🚶", 2, 14, 14)).toContain("7 more to become a tree");
    expect(plantLabel("Walking", "🚶", 0, 1, 1)).toContain("1 day in a row");
    const tree = plantLabel("Walking", "🚶", 3, 2, 25);
    expect(tree).toContain("grew into a tree: 25 days in a row");
    expect(tree).toContain("(running: 2)");
  });
});

describe("plants on the island", () => {
  const plant = (id: string, stage: 0 | 1 | 2 | 3): GardenItem => ({ kind: "plant", id: `p:${id}`, label: id, hue: 100, stage, streak: stage * 7 });
  const flower = (h: string, d: number): GardenItem => ({ kind: "flower", id: `f:${h}:2026-10-${String(d).padStart(2, "0")}`, date: `2026-10-${String(d).padStart(2, "0")}`, label: "f", hue: 200 });

  it("every habit's plant is placed, even a brand-new habit with no flowers yet", () => {
    const items = [plant("a", 1), plant("b", 0), plant("c", 3), flower("a", 1), flower("a", 2)];
    const placed = layout(items).filter((p) => p.kind === "plant");
    expect(placed.map((p) => p.id).sort()).toEqual(["p:a", "p:b", "p:c"]);
  });
  it("keeps plants apart, and the same each time", () => {
    const items = [plant("a", 1), plant("b", 0), plant("c", 3), plant("d", 2), flower("a", 1)];
    const one = layout(items).filter((p) => p.kind === "plant");
    const two = layout(items).filter((p) => p.kind === "plant");
    expect(one.map((p) => [p.id, p.x, p.y])).toEqual(two.map((p) => [p.id, p.x, p.y]));
    for (const a of one) for (const b of one) if (a !== b) expect(Math.hypot(a.x - b.x, (a.y - b.y) * 2.2)).toBeGreaterThan(8);
  });
});
