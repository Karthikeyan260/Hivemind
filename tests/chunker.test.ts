import { describe, expect, it } from "vitest";
import { chunkText } from "@/lib/rag/chunker";

/** A lone half of an emoji (what slicing in the middle of one leaves behind). */
const hasBrokenPair = (s: string) => /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(s);

describe("chunkText", () => {
  it("returns nothing for empty text and one chunk for short text", () => {
    expect(chunkText("")).toEqual([]);
    expect(chunkText("   \n\n  ")).toEqual([]);
    expect(chunkText("hello")).toEqual(["hello"]);
  });
  it("never cuts an emoji in half (the database refuses a broken one)", () => {
    for (let shift = 0; shift < 6; shift++) {
      const text = "x".repeat(shift) + "😀".repeat(2500) + " tail";
      for (const c of chunkText(text)) expect(hasBrokenPair(c)).toBe(false);
    }
    const chatty = Array.from({ length: 400 }, (_, i) => `[10:${i % 60}] Asha: haha 😂😂 that was 🔥 number ${i}`).join("\n\n");
    for (const c of chunkText(chatty)) expect(hasBrokenPair(c)).toBe(false);
  });
  it("keeps every sentence of a long text (overlap may repeat, nothing may vanish)", () => {
    const words = Array.from({ length: 900 }, (_, i) => `Sentence number ${i} says something useful.`);
    const joined = chunkText(words.join(" ")).join("\n");
    for (let i = 0; i < 900; i += 37) expect(joined).toContain(`Sentence number ${i} says`);
  });
  it("terminates quickly on odd shapes", () => {
    const t0 = Date.now();
    for (const t of ["a".repeat(200_000), ".".repeat(5000), "!?".repeat(3000), ("word ".repeat(300) + "\n\n").repeat(200), "\u0000".repeat(3000)]) {
      const chunks = chunkText(t);
      expect(chunks.every((c) => c.length <= 1300)).toBe(true);
    }
    expect(Date.now() - t0).toBeLessThan(3000);
  });
});
