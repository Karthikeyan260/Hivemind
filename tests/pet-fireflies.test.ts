import { describe, expect, it } from "vitest";
import { catchFly, flyLine, GAME_MS, GOLD_POINTS, LIFE_MS, MAX_FLIES, newFlyGame, spawnGap, tickFlies } from "@/lib/pet-fireflies";

/** A repeatable stream of numbers in 0..1. */
const seeded = (seed = 7) => () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

describe("catch fireflies", () => {
  it("fireflies appear, drift inside the play area, and fade after a few seconds", () => {
    const r = seeded();
    let g = newFlyGame();
    for (let i = 0; i < 60; i++) g = tickFlies(g, 100, r);
    expect(g.flies.length).toBeGreaterThan(0);
    for (const f of g.flies) {
      expect(f.x).toBeGreaterThanOrEqual(0.04);
      expect(f.x).toBeLessThanOrEqual(0.96);
      expect(f.y).toBeGreaterThanOrEqual(0.1);
      expect(f.y).toBeLessThanOrEqual(0.9);
      expect(f.age).toBeLessThan(LIFE_MS);
    }
  });
  it("never has more than the cap on the screen", () => {
    const r = seeded(3);
    let g = newFlyGame();
    for (let i = 0; i < 280; i++) {
      g = tickFlies(g, 100, r);
      expect(g.flies.length).toBeLessThanOrEqual(MAX_FLIES);
    }
  });
  it("a tap catches one for a point, a golden one for three, and a miss does nothing", () => {
    const r = seeded(11);
    let g = newFlyGame();
    while (g.flies.length < 4) g = tickFlies(g, 100, r);
    const plain = g.flies.find((f) => !f.gold);
    if (plain) {
      const { game, points } = catchFly(g, plain.id);
      expect(points).toBe(1);
      expect(game.score).toBe(1);
      expect(game.flies.some((f) => f.id === plain.id)).toBe(false);
    }
    const gold = { ...g, flies: [{ ...g.flies[0], gold: true }] };
    expect(catchFly(gold, g.flies[0].id).points).toBe(GOLD_POINTS);
    expect(catchFly(g, 99999)).toEqual({ game: g, points: 0 });
  });
  it("catching the same one twice counts once", () => {
    const r = seeded(5);
    let g = newFlyGame();
    while (!g.flies.length) g = tickFlies(g, 100, r);
    const id = g.flies[0].id;
    const once = catchFly(g, id);
    expect(catchFly(once.game, id).points).toBe(0);
  });
  it("ends after 30 seconds, and nothing counts after that", () => {
    const r = seeded(9);
    let g = newFlyGame();
    let steps = 0;
    while (!g.over && steps++ < 1000) g = tickFlies(g, 100, r);
    expect(g.over).toBe(true);
    expect(g.t).toBe(GAME_MS);
    expect(steps).toBe(GAME_MS / 100);
    const id = g.flies[0]?.id ?? 1;
    expect(catchFly(g, id).points).toBe(0);
    expect(tickFlies(g, 100, r)).toBe(g);
  });
  it("comes quicker as the game goes on", () => {
    expect(spawnGap(0)).toBeGreaterThan(spawnGap(GAME_MS));
    expect(spawnGap(GAME_MS)).toBeGreaterThanOrEqual(380);
  });
  it("a game left alone scores nothing; someone who taps everything scores well", () => {
    const r = seeded(21);
    let idle = newFlyGame();
    while (!idle.over) idle = tickFlies(idle, 100, r);
    expect(idle.score).toBe(0);
    let g = newFlyGame();
    const r2 = seeded(21);
    while (!g.over) {
      g = tickFlies(g, 100, r2);
      for (const f of [...g.flies]) g = catchFly(g, f.id).game;
    }
    expect(g.score).toBeGreaterThan(20);
  });
  it("says something fitting about the score", () => {
    expect(flyLine(12, 12, true)).toContain("record");
    expect(flyLine(40, 40, false)).toContain("master");
    expect(flyLine(2, 30, false)).toContain("try");
  });
});
