import { describe, expect, it } from "vitest";
import { islandSize, layout, towerSpot, type GardenItem } from "@/lib/garden-layout";

const flower = (i: number): GardenItem => ({ kind: "flower", id: `f:h${i % 4}:2026-10-${String((i % 28) + 1).padStart(2, "0")}-${i}`, date: "2026-10-01", label: "x", hue: 120 });

describe("clock tower spot", () => {
  it("is on the island, away from the middle, and nothing is planted on it", () => {
    for (const n of [5, 40, 150]) {
      const items = Array.from({ length: n }, (_, i) => flower(i));
      const { cx, cy, rx, ry } = islandSize(n);
      const t = towerSpot(n);
      expect(Math.hypot((t.x - cx) / rx, (t.y - cy) / ry)).toBeLessThan(0.7);
      expect(Math.hypot((t.x - cx) / rx, (t.y - cy) / ry)).toBeGreaterThan(0.3);
      for (const p of layout(items)) expect(((p.x - t.x) / 42) ** 2 + ((p.y - t.y) / 15) ** 2).toBeGreaterThanOrEqual(1);
    }
  });
});
