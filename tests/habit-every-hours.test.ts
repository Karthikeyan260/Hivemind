import { describe, expect, it } from "vitest";
import { everyHours } from "@/lib/habits";

describe("every N hours", () => {
  it("covers a daytime window", () => {
    expect(everyHours(3, "09:00", "21:00")).toEqual(["09:00", "12:00", "15:00", "18:00", "21:00"]);
  });
  it("covers a window that runs past midnight", () => {
    expect(everyHours(3, "23:00", "02:00")).toEqual(["23:00", "02:00"]);
    expect(everyHours(2, "22:00", "01:00")).toEqual(["22:00", "00:00"]);
  });
  it("never goes below every half hour, or past 24 reminders", () => {
    expect(everyHours(0.1, "00:00", "23:59").length).toBe(24);
    expect(everyHours(0.1, "00:00", "01:00")).toEqual(["00:00", "00:30", "01:00"]);
  });
});
