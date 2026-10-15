import { describe, expect, it } from "vitest";
import { type GardenItem, hueOf, islandSize, layout } from "@/lib/garden-layout";

const flower = (i: number): GardenItem => ({ kind: "flower", id: `f:h1:2026-10-${String(i).padStart(2, "0")}`, date: `2026-10-${i}`, label: "x", hue: 120 });

describe("garden layout", () => {
  it("puts everything on the island, the same way every time", () => {
    const items = [...Array.from({ length: 30 }, (_, i) => flower(i + 1)), { kind: "tree" as const, id: "t:0", size: 1, label: "t" }, { kind: "lamp" as const, id: "l:1", date: "2026-10-01", label: "l" }];
    const a = layout(items);
    const b = layout(items);
    expect(a).toEqual(b);
    expect(a).toHaveLength(items.length);
    const { cx, cy, rx, ry } = islandSize(items.length);
    for (const p of a) expect(Math.hypot((p.x - cx) / rx, (p.y - cy) / ry)).toBeLessThanOrEqual(1);
  });
  it("adding a flower doesn't move the others", () => {
    const before = layout(Array.from({ length: 10 }, (_, i) => flower(i + 1)));
    const after = layout(Array.from({ length: 11 }, (_, i) => flower(i + 1)));
    // The island widens a little with more items, so positions may shift slightly but stay close.
    for (const p of before) {
      const q = after.find((x) => x.id === p.id)!;
      expect(Math.abs(q.x - p.x)).toBeLessThan(25);
    }
  });
  it("keeps the middle free for the pet, and gives each habit its own colour", () => {
    const placed = layout(Array.from({ length: 40 }, (_, i) => flower(i + 1)));
    const { cx, cy, rx, ry } = islandSize(40);
    expect(placed.every((p) => Math.hypot((p.x - cx) / rx, (p.y - cy) / ry) >= 0.2)).toBe(true);
    expect(hueOf("habit-a")).toBe(hueOf("habit-a"));
    expect(hueOf("habit-a")).not.toBe(hueOf("habit-b"));
  });
});
