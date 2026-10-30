import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GardenDay } from "@/lib/garden-day";

const store = new Map<string, unknown>();
let day: GardenDay;
let ai: () => Promise<{ text: string }>;
let aiCalls = 0;
vi.mock("@/lib/private-store", () => ({
  readJSON: async (_s: unknown, k: string, fb: unknown) => (store.has(k) ? structuredClone(store.get(k)) : fb),
  writeJSON: async (_s: unknown, k: string, v: unknown) => void store.set(k, structuredClone(v)),
}));
vi.mock("@/lib/garden-day", () => ({ getGardenDay: async () => day }));
vi.mock("@/lib/pet", () => ({ petName: async () => "Nova" }));
vi.mock("@/lib/ai/providers", () => ({
  generateWithFallback: async () => {
    aiCalls++;
    return ai();
  },
}));

const { dayFacts, plainEntry, writeDiary, listDiaryDates, getDiaryEntry } = await import("@/lib/nova-diary");

const empty = (date: string): GardenDay => ({ date, habits: [], songs: [], notes: [], memories: [], wins: [], walked: false });

describe("Nova's diary", () => {
  beforeEach(() => {
    store.clear();
    aiCalls = 0;
    ai = async () => ({ text: "Today we did yoga and listened to a song. I loved it. — Nova" });
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("a day with nothing in it has no facts, gets a quiet page, and never calls the model", async () => {
    day = empty("2026-10-30");
    expect(dayFacts(day)).toEqual([]);
    const e = await writeDiary({} as never, "2026-10-30");
    expect(e.text).toMatch(/quiet day/i);
    expect(e.ai).toBe(false);
    expect(aiCalls).toBe(0);
  });

  it("lists only what really happened", () => {
    const f = dayFacts({ ...empty("2026-10-30"), habits: [{ emoji: "🧘", name: "Yoga" }], walked: true, mood: { emoji: "😊", word: "Good" } });
    expect(f.join(" ")).toContain("Yoga");
    expect(f.join(" ")).toContain("lantern walk");
    expect(f.join(" ")).toContain("Good");
    expect(f.join(" ")).not.toMatch(/songs|notes|games/i);
  });

  it("saves the model's page, keeps the dates newest first, and a rewrite replaces the day", async () => {
    day = { ...empty("2026-10-29"), habits: [{ emoji: "🧘", name: "Yoga" }] };
    await writeDiary({} as never, "2026-10-29");
    day = { ...empty("2026-10-30"), habits: [{ emoji: "🧘", name: "Yoga" }], mood: { emoji: "😊", word: "Good" } };
    const e = await writeDiary({} as never, "2026-10-30");
    expect(e.ai).toBe(true);
    expect(e.mood).toBe("😊");
    await writeDiary({} as never, "2026-10-30");
    expect(await listDiaryDates({} as never)).toEqual(["2026-10-30", "2026-10-29"]);
    expect((await getDiaryEntry({} as never, "2026-10-30"))?.text).toContain("yoga");
  });

  it("falls back to a true plain page when the model fails or rambles", async () => {
    day = { ...empty("2026-10-30"), habits: [{ emoji: "🧘", name: "Yoga" }] };
    ai = async () => {
      throw new Error("quota");
    };
    const a = await writeDiary({} as never, "2026-10-30");
    expect(a.ai).toBe(false);
    expect(a.text).toContain("Yoga");
    ai = async () => ({ text: "x".repeat(2000) });
    expect((await writeDiary({} as never, "2026-10-30")).ai).toBe(false);
    ai = async () => ({ text: "ok" });
    expect((await writeDiary({} as never, "2026-10-30")).ai).toBe(false);
  });

  it("strips markdown and NULs from the model's page", async () => {
    day = { ...empty("2026-10-30"), habits: [{ emoji: "🧘", name: "Yoga" }] };
    ai = async () => ({ text: "**Today** I did `yoga` with you" + String.fromCharCode(0) + ", and it was lovely. — Nova" });
    const e = await writeDiary({} as never, "2026-10-30");
    expect(e.text).toBe("Today I did yoga with you, and it was lovely. — Nova");
  });

  it("the plain page counts habits and signs with the pet's name", () => {
    expect(plainEntry("Nova", { ...empty("2026-10-30"), habits: [{ emoji: "a", name: "A" }, { emoji: "b", name: "B" }] })).toContain("2 habits");
    expect(plainEntry("Nova", empty("2026-10-30"))).toContain("— Nova");
  });
});
