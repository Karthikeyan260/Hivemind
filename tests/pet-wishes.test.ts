import { describe, expect, it } from "vitest";
import { wishFor, type WishFacts } from "@/lib/pet-wishes";

const NONE: WishFacts = { habitsDue: 0, habitsDone: 0, songs: 0, wins: 0, walks: 0, checkin: false, fireflies: false };
const days = Array.from({ length: 40 }, (_, i) => new Date(Date.parse("2026-10-01T00:00:00Z") + i * 86_400_000).toISOString().slice(0, 10));

describe("Nova's wish of the day", () => {
  it("is the same all day, and changes from day to day", () => {
    const a = wishFor("2026-10-23", NONE);
    expect(wishFor("2026-10-23", NONE)).toEqual(a);
    expect(new Set(days.map((d) => wishFor(d, NONE).id)).size).toBeGreaterThan(2);
  });
  it("never asks for habits when none are due", () => {
    for (const d of days) expect(wishFor(d, NONE).id).not.toBe("habits");
  });
  it("can ask for habits when some are due, and they are done once all are", () => {
    const due = { ...NONE, habitsDue: 2 };
    const day = days.find((d) => wishFor(d, due).id === "habits");
    expect(day).toBeTruthy();
    expect(wishFor(day!, due).done).toBe(false);
    expect(wishFor(day!, { ...due, habitsDone: 1 }).done).toBe(false);
    expect(wishFor(day!, { ...due, habitsDone: 2 }).done).toBe(true);
  });
  it("is done when what it asked for happens", () => {
    const dayFor = (id: string, f: WishFacts) => days.find((d) => wishFor(d, f).id === id)!;
    expect(wishFor(dayFor("song", NONE), { ...NONE, songs: 1 }).done).toBe(true);
    expect(wishFor(dayFor("win", NONE), { ...NONE, wins: 1 }).done).toBe(true);
    expect(wishFor(dayFor("walk", NONE), { ...NONE, walks: 1 }).done).toBe(true);
    expect(wishFor(dayFor("checkin", NONE), { ...NONE, checkin: true }).done).toBe(true);
    expect(wishFor(dayFor("fireflies", NONE), { ...NONE, fireflies: true }).done).toBe(true);
    // Something else being done doesn't finish it.
    expect(wishFor(dayFor("song", NONE), { ...NONE, wins: 3 }).done).toBe(false);
  });
});
