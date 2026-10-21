import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { GAME_NAMES } from "@/lib/games/names";
import { routines } from "@/lib/agents/tools/routines";

describe("game_record tool", () => {
  it("can filter by every game that is recorded", () => {
    const enumValues = (routines.game_record.parameters as { properties: { game: { enum: string[] } } }).properties.game.enum;
    expect(enumValues).toEqual(Object.keys(GAME_NAMES));
    expect(enumValues).toContain("bingo");
  });
});
