import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { HttpError } from "@/lib/api";
import { resolveWhen } from "@/lib/reminders";

const seeded = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const DATES = ["today", "tomorrow", "tonight", "friday", "next monday", "this sunday", "in 3 days", "in 0 days", "in 99999 days", "day after tomorrow", "2026-10-31", "2026-2-30", "2026-13-40", "0000-00-00", "9999-12-31", "10-31", "", "   ", "garbage", "Friday!", "next", "in days", "\u0000", "🌸", "x".repeat(5000)];
const TIMES = ["", "7", "7 am", "7:30pm", "12 am", "12 pm", "0:00", "23:59", "24:00", "25:61", "noon", "midnight", "7:5", "07.30", "7pm tomorrow", "abc", "99", "-3", "1:2:3", "🌸", "x".repeat(2000)];
const WHENS = [undefined, "2026-10-31T10:30", "2026-10-31 10:30", "2019-01-01T00:00", "not a date", "2026-99-99T99:99", ""];

describe("resolveWhen never crashes", () => {
  it("answers with a real time or a clean 400 for any date/time text", () => {
    const r = seeded(11);
    const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
    const now = new Date("2026-10-28T05:00:00Z");
    for (let i = 0; i < 4000; i++) {
      const input = { date: pick(DATES), time: pick(TIMES), when: pick(WHENS), in_minutes: pick([undefined, 0, -5, 30, 1.5, 1e9, NaN]), all_day: pick([undefined, true, false]) } as never;
      try {
        const { due } = resolveWhen(input, now);
        expect(Number.isFinite(due.getTime()), JSON.stringify(input)).toBe(true);
      } catch (e) {
        expect(e instanceof HttpError, `${JSON.stringify(input).slice(0, 120)} threw ${String(e).slice(0, 80)}`).toBe(true);
        expect((e as HttpError).status).toBe(400);
      }
    }
  });
  it("weekdays land on the right day from any starting day", () => {
    for (let d = 0; d < 7; d++) {
      const now = new Date(Date.UTC(2026, 9, 25 + d, 5, 0)); // 25 Oct 2026 is a Sunday
      for (const [i, name] of ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"].entries()) {
        const { due } = resolveWhen({ date: name, time: "10:00" }, now);
        const weekday = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Kolkata", weekday: "long" }).format(due).toLowerCase();
        expect(weekday).toBe(name);
        expect(due.getTime()).toBeGreaterThanOrEqual(now.getTime() - 24 * 3600_000);
        expect(due.getTime()).toBeLessThan(now.getTime() + 8 * 24 * 3600_000);
        void i;
      }
    }
  });
});
