import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { weekLine, weekStats } from "@/lib/pet";

// 2026-10-25 is a Sunday.
const SUN = "2026-10-25";
const daily = (log: string[], created = "2026-09-01") => ({ days: [0, 1, 2, 3, 4, 5, 6], created, log });

describe("weekStats", () => {
  it("counts the seven days up to today", () => {
    const log = ["2026-10-19", "2026-10-20", "2026-10-22", "2026-10-25", "2026-10-18"]; // the 18th is eight days back
    const w = weekStats([daily(log)], ["2026-10-24", "2026-10-10"], ["2026-10-25", "2026-10-25", "2026-10-01"], SUN);
    expect(w).toEqual({ done: 4, due: 7, checkins: 1, wins: 2 });
  });
  it("only counts a habit on its own days and after it was made", () => {
    const weekdays = { days: [1, 2, 3, 4, 5], created: "2026-09-01", log: [] };
    expect(weekStats([weekdays], [], [], SUN).due).toBe(5);
    expect(weekStats([daily([], "2026-10-23")], [], [], SUN).due).toBe(3);
  });
  it("no habits means nothing due", () => {
    expect(weekStats([], [], [], SUN)).toEqual({ done: 0, due: 0, checkins: 0, wins: 0 });
  });
});

describe("weekLine", () => {
  it("is quiet when no habit was due", () => {
    expect(weekLine({ done: 0, due: 0, checkins: 3, wins: 1 })).toBeNull();
  });
  it("cheers, encourages or nudges by how the week went", () => {
    expect(weekLine({ done: 6, due: 7, checkins: 0, wins: 0 })).toMatch(/semma week/);
    expect(weekLine({ done: 4, due: 7, checkins: 0, wins: 0 })).toMatch(/Adutha vaaram/);
    expect(weekLine({ done: 1, due: 7, checkins: 0, wins: 0 })).toMatch(/fresh start/);
  });
  it("mentions check-ins and wins when there were some", () => {
    const l = weekLine({ done: 7, due: 7, checkins: 5, wins: 1 })!;
    expect(l).toMatch(/5 night check-ins/);
    expect(l).toMatch(/1 game win /);
  });
});
