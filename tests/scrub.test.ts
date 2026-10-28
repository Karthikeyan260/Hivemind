import { describe, expect, it } from "vitest";
import { scrub } from "@/lib/scrub";
import { str } from "@/lib/agents/tools/shared";

const NUL = String.fromCharCode(0);
const HIGH = String.fromCharCode(0xd83d); // first half of 😀
const LOW = String.fromCharCode(0xde00); // second half of 😀

describe("scrub", () => {
  it("keeps whole emoji and normal text untouched", () => {
    expect(scrub("hello 😀 தமிழ் 🌸!")).toBe("hello 😀 தமிழ் 🌸!");
  });
  it("drops NUL characters and lone halves of an emoji", () => {
    expect(scrub(`a${NUL}b`)).toBe("ab");
    expect(scrub(`a${HIGH}b`)).toBe("ab");
    expect(scrub(`a${LOW}b`)).toBe("ab");
    expect(scrub(`x${HIGH}`)).toBe("x");
  });
  it("cleans a title cut through an emoji", () => {
    const text = "x".repeat(59) + "😀 and more";
    expect(scrub(text.slice(0, 60))).toBe("x".repeat(59));
  });
  it("is what the agent tools use for their text arguments", () => {
    expect(str(`  hi${NUL}${HIGH} there `)).toBe("hi there");
  });
});
