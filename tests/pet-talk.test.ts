import { describe, expect, it } from "vitest";
import { isJealous, pickChatter } from "@/lib/pet-talk";

describe("pickChatter", () => {
  it("asks the time-of-day question first, once", () => {
    expect(pickChatter({ hour: 13, sky: "calm", said: [] }).id).toBe("lunch");
    expect(pickChatter({ hour: 7, sky: "calm", said: [] }).say).toContain("Coffee");
    expect(pickChatter({ hour: 13, sky: "calm", said: ["lunch"], roll: 0 }).id).not.toBe("lunch");
  });
  it("talks about the weather once per sky", () => {
    expect(pickChatter({ hour: 11, sky: "rain", said: [] }).id).toBe("sky-rain");
    expect(pickChatter({ hour: 11, sky: "rain", said: ["sky-rain"], roll: 0 }).id).not.toBe("sky-rain");
  });
  it("otherwise picks something not said recently, and questions come with replies", () => {
    const c = pickChatter({ hour: 11, sky: "calm", said: ["mood"], roll: 0 });
    expect(c.id).not.toBe("mood");
    expect(pickChatter({ hour: 11, sky: "calm", said: [], roll: 0 }).replies?.length).toBe(2);
  });
});

describe("isJealous", () => {
  const min = 60_000;
  it("only after several HIVEMIND questions while the pet was ignored", () => {
    expect(isJealous({ asks: 5, sinceTouchMs: 25 * min, sinceJealousMs: 60 * min })).toBe(true);
    expect(isJealous({ asks: 2, sinceTouchMs: 25 * min, sinceJealousMs: 60 * min })).toBe(false);
    expect(isJealous({ asks: 5, sinceTouchMs: 5 * min, sinceJealousMs: 60 * min })).toBe(false);
    expect(isJealous({ asks: 5, sinceTouchMs: 25 * min, sinceJealousMs: 10 * min })).toBe(false);
  });
});
