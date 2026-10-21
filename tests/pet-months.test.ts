import { describe, expect, it } from "vitest";
import { monthsBetween } from "@/lib/pet";

describe("the months the pet counts songs from", () => {
  it("is every month from the birth month to today's, not just those two", () => {
    expect(monthsBetween("2026-07-14", "2026-10-21")).toEqual(["2026-07", "2026-08", "2026-09", "2026-10"]);
  });
  it("crosses a year end", () => {
    expect(monthsBetween("2025-11-02", "2026-02-10")).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
  });
  it("the same month is one month", () => {
    expect(monthsBetween("2026-10-01", "2026-10-21")).toEqual(["2026-10"]);
  });
  it("never runs away on a bad date (born after today, or years back)", () => {
    expect(monthsBetween("2027-01-01", "2026-10-21")).toEqual(["2026-10"]);
    expect(monthsBetween("1990-01-01", "2026-10-21").length).toBeLessThanOrEqual(60);
  });
});
