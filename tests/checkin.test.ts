import { describe, expect, it } from "vitest";
import { nudgeDue } from "@/lib/checkin";

describe("night check-in: the 9 pm nudge", () => {
  it("goes once, between 9 and 11 pm, only if tonight's check-in isn't done", () => {
    expect(nudgeDue(21, "2026-10-13", undefined, false)).toBe(true);
    expect(nudgeDue(22, "2026-10-13", "2026-10-12", false)).toBe(true);
    expect(nudgeDue(20, "2026-10-13", undefined, false)).toBe(false); // too early
    expect(nudgeDue(23, "2026-10-13", undefined, false)).toBe(false); // too late, don't wake them
    expect(nudgeDue(21, "2026-10-13", "2026-10-13", false)).toBe(false); // already sent tonight
    expect(nudgeDue(21, "2026-10-13", undefined, true)).toBe(false); // already checked in
  });
});
