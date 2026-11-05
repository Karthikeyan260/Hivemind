import { describe, expect, it } from "vitest";
import { score } from "@/lib/fuzzy";

describe("score", () => {
  it("ranks exact, prefix, word-start, substring, then scattered letters", () => {
    const s = (t: string) => score(t, "gar");
    expect(score("garden", "garden")).toBe(100);
    expect(s("Garden")).toBeGreaterThan(s("Nova's garden"));
    expect(s("Nova's garden")).toBeGreaterThan(s("Stargarden"));
    expect(s("Stargarden")).toBeGreaterThan(s("Gaps and rows"));
    expect(s("Gaps and rows")).toBeGreaterThan(0);
    expect(s("Calls")).toBe(0);
  });

  it("matches everything for an empty query and ignores case", () => {
    expect(score("Memories", "  ")).toBe(1);
    expect(score("Memories", "MEM")).toBe(80);
  });

  it("does not match a single stray letter", () => {
    expect(score("Calls", "z")).toBe(0);
    expect(score("Web tasks", "wt")).toBeGreaterThan(0);
  });
});
