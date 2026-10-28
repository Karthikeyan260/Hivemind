import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const files = new Map<string, unknown>();
vi.mock("@/lib/private-store", () => ({
  readJSON: async (_s: unknown, key: string, fallback: unknown) => (files.has(key) ? structuredClone(files.get(key)) : fallback),
  writeJSON: async (_s: unknown, key: string, value: unknown) => void files.set(key, structuredClone(value)),
}));
vi.mock("@/lib/push", () => ({ notify: async () => 0 }));
import { addBirthday, listBirthdays, validDate } from "@/lib/birthdays";

const supabase = {} as never;
const base = { name: "Asha", month: 3, day: 12, kind: "birthday" as const };

describe("birthday input", () => {
  beforeEach(() => files.clear());

  it("real dates are valid, including 29 February", () => {
    expect(validDate(2, 29)).toBe(true);
    expect(validDate(12, 31)).toBe(true);
    expect(validDate(4, 30)).toBe(true);
  });
  it("impossible, fractional and non-numeric dates are refused", () => {
    for (const [m, d] of [[2, 30], [4, 31], [13, 1], [0, 5], [3, 0], [3, 12.5], [2.5, 10], [Number.NaN, 1], [3, Number.NaN], [-1, 5]]) expect(validDate(m, d), `${m}/${d}`).toBe(false);
  });
  it("a refused date saves nothing", async () => {
    await expect(addBirthday(supabase, { ...base, month: 3, day: 12.5 })).rejects.toThrow("doesn't exist");
    expect(await listBirthdays(supabase)).toEqual([]);
  });
  it("a year that isn't a sensible year is dropped, a good one is kept", async () => {
    expect((await addBirthday(supabase, { ...base, year: Number.NaN })).year).toBeUndefined();
    expect((await addBirthday(supabase, { ...base, name: "B", year: 1850 })).year).toBeUndefined();
    expect((await addBirthday(supabase, { ...base, name: "C", year: 1990.5 })).year).toBeUndefined();
    expect((await addBirthday(supabase, { ...base, name: "D", year: 1990 })).year).toBe(1990);
  });
  it("saving the same person again updates them instead of adding another", async () => {
    await addBirthday(supabase, base);
    await addBirthday(supabase, { ...base, day: 13 });
    const all = await listBirthdays(supabase);
    expect(all).toHaveLength(1);
    expect(all[0].day).toBe(13);
  });
});
