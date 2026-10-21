import { describe, expect, it } from "vitest";
import { kuralAt } from "@/lib/kural";

describe("Thirukkural text", () => {
  it("has all 1330 kurals with the right words and chapters", () => {
    expect(kuralAt(1)?.line1).toBe("அகர முதல எழுத்தெல்லாம் ஆதி");
    expect(kuralAt(391)).toMatchObject({ line1: "கற்க கசடறக் கற்பவை கற்றபின்", line2: "நிற்க அதற்குத் தக.", chapter: { n: 40, en: "Learning" } });
    expect(kuralAt(1330)?.chapter.n).toBe(133);
    expect(kuralAt(0)).toBeNull();
    expect(kuralAt(1331)).toBeNull();
  });
});

describe("a kural on a topic", () => {
  it("picks from the chapters that fit, from the real text", async () => {
    const { kuralFor } = await import("@/lib/kural");
    expect([60, 61, 62, 63]).toContain(kuralFor("tell me a motivational kural", () => 0.5).chapter.n);
    expect(kuralFor("something about anger", () => 0).chapter.n).toBe(31);
    expect(kuralFor("learning", () => 0).chapter.en).toBe("Learning");
    // "career" contains "care", "already" contains "read", "sometimes" contains "time": not those topics.
    expect(kuralFor("career", () => 0).chapter.n).toBe(67);
    expect(kuralFor("i already know", () => 0).chapter.n).not.toBe(40);
    expect(kuralFor("sometimes", () => 0).chapter.n).not.toBe(49);
    expect(kuralFor("care", () => 0).chapter.n).toBe(8);
    expect(kuralFor("xyz", () => 0).line1.length).toBeGreaterThan(5);
    // With real randomness, many times (a random pick inside find() once returned nothing).
    for (let i = 0; i < 300; i++) for (const t of ["anger", "motivation", "friendship", "learning"]) expect(kuralFor(t).line1).toBeTruthy();
  });
});
