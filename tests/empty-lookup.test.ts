import { beforeEach, describe, expect, it, vi } from "vitest";

// An in-memory stand-in for the private store, so the real lookups run.
const files = new Map<string, unknown>();
vi.mock("@/lib/private-store", () => ({
  readJSON: async (_s: unknown, key: string, fallback: unknown) => (files.has(key) ? structuredClone(files.get(key)) : fallback),
  writeJSON: async (_s: unknown, key: string, value: unknown) => void files.set(key, structuredClone(value)),
  removeFiles: async () => {},
}));
vi.mock("@/lib/push", () => ({ notify: async () => 0 }));

import { findApp } from "@/lib/apps";
import { removeBirthday } from "@/lib/birthdays";
import { checkHabit, findHabit, removeHabit, snoozeHabit, type Habit } from "@/lib/habits";

const supabase = {} as never;
const habit = (id: string, name: string): Habit => ({ id, name, emoji: "✅", times: ["07:00"], days: [0, 1, 2, 3, 4, 5, 6], created: "2026-10-01", log: [] });

describe("an empty or blank request never matches anything (it would hit the first item)", () => {
  beforeEach(() => files.clear());

  it("habits: nothing is found, removed, snoozed or ticked for ''", async () => {
    files.set("habits", [habit("a", "Exercise"), habit("b", "Water")]);
    expect(findHabit(files.get("habits") as Habit[], "")).toBeUndefined();
    expect(findHabit(files.get("habits") as Habit[], "   ")).toBeUndefined();
    expect(await removeHabit(supabase, "")).toBeNull();
    expect((files.get("habits") as Habit[]).map((h) => h.name)).toEqual(["Exercise", "Water"]);
    await expect(snoozeHabit(supabase, " ")).rejects.toThrow();
    await expect(checkHabit(supabase, "")).rejects.toThrow();
    expect((files.get("habits") as Habit[])[0].log).toEqual([]);
  });
  it("habits: real names still match, even inside a sentence", () => {
    const all = [habit("a", "Exercise"), habit("b", "Water")];
    expect(findHabit(all, "water")?.id).toBe("b");
    expect(findHabit(all, "I did my exercise today")?.id).toBe("a");
  });
  it("birthdays: '' removes nobody", async () => {
    files.set("birthdays", [{ id: "1", name: "Priya", month: 3, day: 4, kind: "birthday" }]);
    expect(await removeBirthday(supabase, "")).toBeNull();
    expect(await removeBirthday(supabase, "  ")).toBeNull();
    expect((files.get("birthdays") as unknown[]).length).toBe(1);
    expect((await removeBirthday(supabase, "priya"))?.name).toBe("Priya");
  });
  it("apps: '' finds no app", async () => {
    files.set("apps/index", [{ id: "x", name: "Petrol log", description: "fuel" }]);
    expect(await findApp(supabase, "")).toBeNull();
    expect(await findApp(supabase, "   ")).toBeNull();
    expect((await findApp(supabase, "petrol"))?.id).toBe("x");
  });
});
