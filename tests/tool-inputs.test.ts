import { describe, expect, it } from "vitest";
import { str } from "@/lib/agents/tools/shared";

describe("tool text arguments", () => {
  it("drops NUL characters (the database refuses them) and trims", () => {
    expect(str("  hello\u0000 world \u0000")).toBe("hello world");
    expect(str("\u0000")).toBe("");
  });
  it("turns missing values into an empty string", () => {
    expect(str(undefined)).toBe("");
    expect(str(null)).toBe("");
    expect(str(12)).toBe("12");
  });
});
