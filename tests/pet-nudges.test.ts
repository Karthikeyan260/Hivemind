import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

// In-memory private store and a push that only records what it would send.
const store = new Map<string, unknown>();
const sent: { title: string; body: string; tag?: string; actions?: unknown }[] = [];
vi.mock("@/lib/private-store", () => ({
  readJSON: async (_s: unknown, key: string, fallback: unknown) => (store.has(key) ? structuredClone(store.get(key)) : fallback),
  writeJSON: async (_s: unknown, key: string, value: unknown) => void store.set(key, structuredClone(value)),
}));
vi.mock("@/lib/push", () => ({
  notify: async (_s: unknown, n: (typeof sent)[number]) => (sent.push(n), 1),
}));

const { runHabitAlerts } = await import("@/lib/habits");
const { runPetNudges } = await import("@/lib/pet");

// Memories are counted with a Supabase query: none here.
const chain = { select: () => chain, gte: () => chain, then: (f: (r: { count: number }) => unknown) => Promise.resolve(f({ count: 0 })) };
const supabase = { from: () => chain } as unknown as SupabaseClient;
// 2026-10-15 is a Thursday (weekday 4); IST = UTC + 5:30.
const at = (hhmm: string, date = "2026-10-15") => new Date(`${date}T${hhmm}:00+05:30`);
const habit = (id: string, name: string, emoji: string, log: string[] = []) => ({ id, name, emoji, times: ["07:00"], days: [0, 1, 2, 3, 4, 5, 6], created: "2026-10-01T00:00:00.000Z", log });

beforeEach(() => {
  store.clear();
  sent.length = 0;
});

describe("the pet's evening 'hungry' nudge", () => {
  it("sends ONE notification for every habit still open at 8 pm, in the pet's name", async () => {
    store.set("pet", { born: "2026-10-14", lastSeen: "2026-10-15", name: "Pixel" });
    store.set("habits", [habit("a", "Walking", "🚶"), habit("b", "Reading", "📖"), habit("c", "Water", "💧", ["2026-10-15"])]);
    await runHabitAlerts(supabase, at("20:05"));
    const hungry = sent.filter((n) => n.tag === "pet-hungry");
    expect(hungry).toHaveLength(1);
    expect(hungry[0].title).toBe("🍚 Pixel is hungry");
    expect(hungry[0].body).toContain("2 habits pending");
    expect(hungry[0].body).toContain("Walking");
    expect(hungry[0].body).not.toContain("Water"); // already done today
    expect(hungry[0].actions).toBeUndefined(); // ✓ Done only makes sense for a single habit
    // Not again the same evening.
    sent.length = 0;
    await runHabitAlerts(supabase, at("20:40"));
    expect(sent.filter((n) => n.tag === "pet-hungry")).toHaveLength(0);
  });

  it("keeps the ✓ Done button when one habit is open, and defaults the name to Nova", async () => {
    store.set("habits", [habit("a", "Walking", "🚶")]);
    await runHabitAlerts(supabase, at("20:10"));
    const [n] = sent.filter((x) => x.tag === "pet-hungry");
    expect(n.title).toBe("🍚 Nova is hungry");
    expect(n.body).toContain("Walking innum pending");
    expect(n.actions).toBeTruthy();
  });

  it("stays quiet before 8 pm and when everything is done", async () => {
    store.set("habits", [habit("a", "Walking", "🚶")]);
    await runHabitAlerts(supabase, at("19:30"));
    store.set("habits", [habit("a", "Walking", "🚶", ["2026-10-15"])]);
    await runHabitAlerts(supabase, at("20:30"));
    expect(sent.filter((n) => n.tag === "pet-hungry")).toHaveLength(0);
  });
});

describe("the pet's other pushes", () => {
  it("misses you after 3 days away: once per absence, daytime only, without marking it seen", async () => {
    store.set("pet", { born: "2026-10-01", lastSeen: "2026-10-12", name: "Nova", stageNotified: 0 });
    await runPetNudges(supabase, at("08:00")); // too early
    expect(sent).toHaveLength(0);
    await runPetNudges(supabase, at("11:00"));
    expect(sent.map((n) => n.title)).toEqual(["🥺 Nova misses you"]);
    expect(sent[0].body).toContain("3 days");
    await runPetNudges(supabase, at("15:00")); // already told
    expect(sent).toHaveLength(1);
    expect((store.get("pet") as { lastSeen: string }).lastSeen).toBe("2026-10-12"); // the scheduler isn't the owner
  });

  it("evolved: once when it reaches a new stage (the first check only records the stage)", async () => {
    store.set("pet", { born: "2026-10-01", lastSeen: "2026-10-15", name: "Nova" });
    store.set("habits", [habit("a", "Walking", "🚶", Array.from({ length: 7 }, (_, i) => `2026-10-0${i + 2}`))]); // 70 points = stage 2
    await runPetNudges(supabase, at("12:00"));
    expect(sent).toHaveLength(0);
    expect((store.get("pet") as { stageNotified: number }).stageNotified).toBe(1);
    store.set("pet", { ...(store.get("pet") as object), stageNotified: 0 });
    await runPetNudges(supabase, at("12:00"));
    expect(sent.map((n) => n.title)).toEqual(["✨ Nova evolved!"]);
    expect(sent[0].body).toContain("Baby Nova");
    await runPetNudges(supabase, at("13:00"));
    expect(sent).toHaveLength(1);
  });
});
