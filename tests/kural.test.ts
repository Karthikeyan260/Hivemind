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
