import { describe, expect, it } from "vitest";
import { GameResult } from "@/lib/games/stats";
import { GAME_HUES, GAME_NAMES, gameName } from "@/lib/games/names";

describe("game names", () => {
  it("every game the record accepts has a name and a garden colour", () => {
    const ids = GameResult.shape.game.options;
    expect(ids.length).toBeGreaterThanOrEqual(8);
    for (const id of ids) {
      expect(GAME_NAMES[id], `${id} needs a name`).toBeTruthy();
      expect(GAME_HUES[id], `${id} needs a hue`).toBeTypeOf("number");
    }
  });
  it("shows an unknown game as it is", () => {
    expect(gameName("snakes")).toBe("Snakes & Ladders");
    expect(gameName("mystery")).toBe("mystery");
  });
});
