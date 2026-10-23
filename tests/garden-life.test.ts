import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { GardenLife, type LifeCtx } from "@/components/garden/garden-life";

function make(over: Partial<LifeCtx> = {}) {
  const island = new THREE.Group();
  const dayOnly: THREE.Object3D[] = [];
  const cleared: [number, number, number][] = [];
  const flowers = Array.from({ length: 12 }, (_, i) => new THREE.Vector3(Math.cos(i) * 4, 0.1, Math.sin(i) * 4));
  const ctx: LifeCtx = {
    island,
    R: 9,
    quality: "high",
    reduced: false,
    heightAt: () => 0,
    dayOnly,
    flowers,
    pond: { c: new THREE.Vector3(5, 0, 3), r: 1.4, sy: 0.7 },
    home: new THREE.Vector3(0, 0, -3),
    pathWorld: () => 0,
    clear: (x, z, r) => cleared.push([x, z, r]),
    ...over,
  };
  return { life: new GardenLife(ctx), island, dayOnly, cleared, ctx };
}

describe("the island's life", () => {
  it("builds birds, bees, dragonflies, koi and a fence, and hides the daytime ones at night", () => {
    const { island, dayOnly } = make();
    // 5 birds in flight + 2 perched + 4 bees (each with a pollen trail) + 2 dragonflies are day-only; the koi, fence and mailbox are not.
    expect(dayOnly).toHaveLength(17);
    expect(island.children.length).toBeGreaterThan(dayOnly.length);
  });
  it("makes fewer on a slow device", () => {
    const hi = make().dayOnly.length;
    const lo = make({ quality: "low" }).dayOnly.length;
    expect(lo).toBeLessThan(hi);
  });
  it("without flowers there are no bees, without a pond no dragonflies or koi", () => {
    const noFlowers = make({ flowers: [] }).dayOnly.length;
    expect(noFlowers).toBe(9);
    const noPond = make({ pond: null });
    expect(noPond.dayOnly).toHaveLength(15);
    expect(() => noPond.life.update(1, 0.016)).not.toThrow();
  });
  it("keeps everything moving, finite and in place for a long run", () => {
    const { life, island, ctx } = make();
    for (let f = 0; f < 3000; f++) life.update(f * 0.016, 0.016);
    island.traverse((o) => {
      expect(Number.isFinite(o.position.x + o.position.y + o.position.z)).toBe(true);
    });
    const pond = ctx.pond!;
    const koi = island.children.filter((o) => Math.abs(o.position.y - (pond.c.y + 0.034)) < 1e-6);
    expect(koi.length).toBe(5);
    for (const k of koi) {
      expect(Math.hypot((k.position.x - pond.c.x) / pond.r, (k.position.z - pond.c.z) / (pond.r * pond.sy))).toBeLessThan(0.75);
    }
  });
  it("keeps the birds in a loop over the island, well above the ground", () => {
    const { life, island, dayOnly, ctx } = make();
    const birds = dayOnly.slice(0, 5);
    for (let f = 0; f < 800; f++) {
      life.update(f * 0.05, 0.05);
      for (const b of birds) {
        expect(Math.hypot(b.position.x, b.position.z)).toBeGreaterThan(ctx.R * 0.6);
        expect(Math.hypot(b.position.x, b.position.z)).toBeLessThan(ctx.R * 1.3);
        expect(b.position.y).toBeGreaterThan(3.5);
      }
    }
    expect(island.children).toContain(birds[0]);
  });
  it("bees come back to rest by a flower", () => {
    const { life, dayOnly, ctx } = make();
    const bee = dayOnly[8];
    for (let f = 0; f < 600; f++) life.update(f * 0.05, 0.05);
    const near = ctx.flowers.some((fl) => Math.hypot(bee.position.x - fl.x, bee.position.z - fl.z) < 1.5 && bee.position.y < 3);
    expect(near).toBe(true);
  });
  it("presses the grass flat where the fence and mailbox stand", () => {
    const { cleared } = make();
    expect(cleared.length).toBeGreaterThan(8);
    expect(cleared.every(([x, z, r]) => Number.isFinite(x + z) && r > 0)).toBe(true);
  });
});

describe("the perched birds", () => {
  it("sit on the fence posts, look about and stay put", () => {
    const { life, dayOnly } = make();
    const perched = dayOnly.slice(5, 7);
    const start = perched.map((p) => p.position.clone());
    for (let f = 0; f < 1200; f++) life.update(f * 0.05, 0.05);
    perched.forEach((p, i) => {
      expect(Math.hypot(p.position.x - start[i].x, p.position.z - start[i].z)).toBeLessThan(1e-6);
      expect(p.position.y).toBeGreaterThanOrEqual(start[i].y - 1e-6);
      expect(p.position.y).toBeLessThan(start[i].y + 0.5);
    });
  });
  it("can be found for a closer look", () => {
    const { life } = make();
    for (const k of ["bird", "perched", "bee", "dragon", "koi"] as const) expect(life.where(k), k).not.toBeNull();
    expect(make({ pond: null }).life.where("koi")).toBeNull();
  });
});
