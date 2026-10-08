import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// resolveWhen is pure; the note-writing side of reminders is never called.
vi.mock("@/lib/knowledge", () => ({ createNote: vi.fn() }));

import { addDays, HOME_TZ, localParts, resolveWhen } from "@/lib/reminders";

// Wednesday 7 Oct 2026, 10:00 in Asia/Kolkata (UTC+05:30).
const NOW = new Date("2026-10-07T04:30:00.000Z");

beforeAll(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterAll(() => {
  vi.useRealTimers();
});

const iso = (input: Parameters<typeof resolveWhen>[0]) => {
  const r = resolveWhen(input);
  return { at: r.due.toISOString(), allDay: r.allDay };
};

describe("resolveWhen (Asia/Kolkata)", () => {
  it("runs in the home zone", () => {
    expect(HOME_TZ).toBe("Asia/Kolkata");
    expect(localParts()).toMatchObject({ date: "2026-10-07", hour: 10, minute: 0, weekday: 3 });
  });
  it("tomorrow 15:00", () => {
    expect(iso({ date: "tomorrow", time: "15:00" })).toEqual({ at: "2026-10-08T09:30:00.000Z", allDay: false });
  });
  it("in 90 minutes", () => {
    expect(iso({ in_minutes: 90 })).toEqual({ at: "2026-10-07T06:00:00.000Z", allDay: false });
  });
  it("weekday names", () => {
    expect(iso({ date: "friday", time: "3 pm" })).toEqual({ at: "2026-10-09T09:30:00.000Z", allDay: false });
    // Today is Wednesday: "wednesday" is today, "next wednesday" a week on.
    expect(iso({ date: "wednesday", time: "9pm" })).toEqual({ at: "2026-10-07T15:30:00.000Z", allDay: false });
    expect(iso({ date: "next wednesday" })).toEqual({ at: "2026-10-14T03:30:00.000Z", allDay: true });
  });
  it("noon, in N days, and all-day at 9:00", () => {
    expect(iso({ date: "today", time: "noon" })).toEqual({ at: "2026-10-07T06:30:00.000Z", allDay: false });
    expect(iso({ date: "in 3 days", time: "7:30 pm" })).toEqual({ at: "2026-10-10T14:00:00.000Z", allDay: false });
    expect(iso({ date: "tomorrow" })).toEqual({ at: "2026-10-08T03:30:00.000Z", allDay: true });
  });
  it("a month-day already past this year means next year; a past year is never trusted", () => {
    expect(iso({ date: "2026-01-05" })).toEqual({ at: "2027-01-05T03:30:00.000Z", allDay: true });
    expect(iso({ when: "2025-10-09T10:00" })).toEqual({ at: "2026-10-09T04:30:00.000Z", allDay: false });
  });
  it("rejects unreadable times and dates", () => {
    expect(() => resolveWhen({ date: "today", time: "25:00" })).toThrow(/couldn't read the time/);
    expect(() => resolveWhen({ date: "someday" })).toThrow(/couldn't read the date/);
  });
});

describe("addDays", () => {
  it("crosses month and year ends", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
});
