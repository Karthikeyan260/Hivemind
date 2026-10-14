import { describe, expect, it } from "vitest";
import { judgeGuess } from "@/lib/pet-seek";

const spot = { name: "Weather Chennai", row: "top", col: "left" } as const;

describe("judgeGuess", () => {
  it("finds it by the thing it hides behind", () => {
    expect(judgeGuess("is it near the weather card?", spot)).toBe("found");
    expect(judgeGuess("behind chennai", spot)).toBe("found");
  });
  it("finds it by row and column", () => {
    expect(judgeGuess("top left", spot)).toBe("found");
    expect(judgeGuess("mela idathu pakkam", spot)).toBe("found");
  });
  it("says warm when half right, cold otherwise", () => {
    expect(judgeGuess("top right", spot)).toBe("warm");
    expect(judgeGuess("bottom left", spot)).toBe("warm");
    expect(judgeGuess("bottom right", spot)).toBe("cold");
    expect(judgeGuess("near the music player", spot)).toBe("cold");
  });
  it("a centre spot needs no column", () => {
    expect(judgeGuess("in the middle", { name: "Routines", row: "middle", col: "center" })).toBe("found");
  });
});
