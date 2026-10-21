import { describe, expect, it } from "vitest";
import { PREVIEW_WIND, SKIES, windStrength } from "@/lib/sky";

describe("windStrength", () => {
  it("follows the real wind, within a sane range", () => {
    expect(windStrength(16)).toBe(1);
    expect(windStrength(0)).toBe(0.5);
    expect(windStrength(8)).toBe(0.5);
    expect(windStrength(32)).toBe(2);
    expect(windStrength(120)).toBe(2.2);
  });
  it("no reading means the usual breeze", () => {
    expect(windStrength(null)).toBe(1);
    expect(windStrength(undefined)).toBe(1);
    expect(windStrength(NaN)).toBe(1);
  });
  it("every previewed sky has a wind, and storms blow harder than calm", () => {
    for (const s of SKIES) expect(PREVIEW_WIND[s]).toBeGreaterThan(0);
    expect(windStrength(PREVIEW_WIND.thunder)).toBeGreaterThan(windStrength(PREVIEW_WIND.calm));
  });
});
