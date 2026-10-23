import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

// The real pet code against an in-memory private store; pushes are only recorded.
const store = new Map<string, unknown>();
const sent: { title: string; body: string; tag?: string }[] = [];
vi.mock("server-only", () => ({}));
vi.mock("@/lib/private-store", () => ({
  readJSON: async (_s: unknown, key: string, fallback: unknown) => (store.has(key) ? structuredClone(store.get(key)) : fallback),
  writeJSON: async (_s: unknown, key: string, value: unknown) => void store.set(key, structuredClone(value)),
}));
vi.mock("@/lib/push", () => ({ notify: async (_s: unknown, n: (typeof sent)[number]) => (sent.push(n), 1) }));

const { cleanPetName, getPet, logWalk, recordFireflies, renamePet, runPetNudges, STAGES, wearAccessory } = await import("@/lib/pet");

let memories = 0;
let chats: string[] = [];
const chain: Record<string, unknown> = {
  select: () => chain,
  gte: () => chain,
  eq: () => chain,
  order: () => chain,
  limit: () => chain,
  then: (f: (r: { count: number; data: { content: string }[] }) => unknown) => Promise.resolve(f({ count: memories, data: chats.map((content) => ({ content })) })),
};
const supabase = { from: () => chain } as unknown as SupabaseClient;

/** 2026-10-15 is a Thursday. IST = UTC + 5:30. */
const at = (date: string, hhmm = "12:00") => new Date(`${date}T${hhmm}:00+05:30`);
const habit = (id: string, log: string[], created = "2026-09-01T00:00:00.000Z", days = [0, 1, 2, 3, 4, 5, 6]) => ({ id, name: id, emoji: "✅", times: ["07:00"], days, created, log });
const dates = (from: string, n: number) => Array.from({ length: n }, (_, i) => new Date(Date.parse(`${from}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10));
const result = (key: string, outcome: "win" | "loss" | "draw", date: string) => ({ game: "chess", mode: "bot", outcome, vs: "HIVEMIND", key, at: `${date}T10:00:00.000Z` });

beforeEach(() => {
  store.clear();
  sent.length = 0;
  memories = 0;
  chats = [];
});

describe("a new pet", () => {
  it("starts as a star seed with nothing earned and a first line", async () => {
    const p = await getPet(supabase, at("2026-10-15"));
    expect(p).toMatchObject({ name: "Nova", stage: 0, xp: 0, days: 1, mood: "happy", unlocked: [], wear: null });
    expect(p.stageName).toBe("Star seed");
    expect(p.fireflies).toEqual({ best: 0, plays: 0 });
    expect(p.line.length).toBeGreaterThan(3);
  });
  it("is born the first day it is seen, and remembers it", async () => {
    await getPet(supabase, at("2026-10-15"));
    expect(store.get("pet")).toMatchObject({ born: "2026-10-15", lastSeen: "2026-10-15" });
    const later = await getPet(supabase, at("2026-10-20"));
    expect(later.days).toBe(6);
  });
  it("the scheduler looking in does not count as the owner being here", async () => {
    await getPet(supabase, at("2026-10-15"));
    await getPet(supabase, at("2026-10-18"), { touch: false });
    expect(store.get("pet")).toMatchObject({ lastSeen: "2026-10-15" });
  });
});

describe("growth", () => {
  it("is fed by habits, check-ins, wins, games, memories and songs", async () => {
    store.set("pet", { born: "2026-10-01", lastSeen: "2026-10-14", name: "Nova" });
    store.set("habits", [habit("a", ["2026-10-13", "2026-10-14"], "2026-10-01T00:00:00.000Z")]); // 2 × 10
    store.set("checkins/index", [{ date: "2026-10-12", at: "x", mood: 4, habitsDone: [], moved: 0 }]); // 8
    store.set("games/stats", [result("g1", "win", "2026-10-10"), result("g2", "loss", "2026-10-11")]); // win 6 + 2 games × 2
    memories = 3; // 6
    store.set("plays/2026-10", [{ title: "s", artists: "a", at: "2026-10-10T10:00:00.000Z" }]); // 1
    const p = await getPet(supabase, at("2026-10-15"));
    expect(p.xp).toBe(20 + 8 + 6 + 4 + 6 + 1);
  });
  it("evolves through the four stages as points add up", async () => {
    const stageAt = async (n: number) => {
      store.clear();
      store.set("pet", { born: "2026-09-01", lastSeen: "2026-10-14", name: "Nova" });
      store.set("habits", [habit("a", dates("2026-09-01", n), "2026-09-01T00:00:00.000Z")]);
      return (await getPet(supabase, at("2026-10-15"))).stage;
    };
    expect(await stageAt(5)).toBe(0);
    expect(await stageAt(6)).toBe(1);
    expect(await stageAt(30)).toBe(2);
    expect(await stageAt(90)).toBe(3);
    expect(STAGES).toHaveLength(4);
  });
  it("counts only a few songs a day, so a playlist left on does not grow it", async () => {
    store.set("pet", { born: "2026-10-01", lastSeen: "2026-10-14", name: "Nova" });
    store.set("plays/2026-10", Array.from({ length: 200 }, (_, i) => ({ title: `s${i}`, artists: "a", at: "2026-10-10T10:00:00.000Z" })));
    expect((await getPet(supabase, at("2026-10-15"))).xp).toBe(10);
  });
});

describe("mood and what it says", () => {
  it("is hungry by late morning when habits are due and none done", async () => {
    store.set("pet", { born: "2026-10-01", lastSeen: "2026-10-14", name: "Nova" });
    store.set("habits", [habit("a", ["2026-10-13", "2026-10-14"])]);
    const p = await getPet(supabase, at("2026-10-15", "12:00"));
    expect(p.mood).toBe("hungry");
    expect(p.fed).toEqual({ done: 0, due: 1 });
    expect(p.line).toContain("1 habit");
    expect((await getPet(supabase, at("2026-10-15", "09:00"))).mood).toBe("happy");
  });
  it("is full and happy once everything due is done", async () => {
    store.set("pet", { born: "2026-10-01", lastSeen: "2026-10-14", name: "Nova" });
    store.set("habits", [habit("a", ["2026-10-15"])]);
    const p = await getPet(supabase, at("2026-10-15", "12:00"));
    expect(p.mood).toBe("happy");
    expect(p.line).toContain("Full vayiru");
    expect(p.today.some((t) => t.includes("a (+10)"))).toBe(true);
  });
  it("sulks after two skipped days, and misses you after three days away", async () => {
    store.set("pet", { born: "2026-10-01", lastSeen: "2026-10-14", name: "Nova" });
    store.set("habits", [habit("a", ["2026-10-10"])]);
    expect((await getPet(supabase, at("2026-10-15"))).mood).toBe("sulking");
    store.set("pet", { born: "2026-10-01", lastSeen: "2026-10-10", name: "Nova" });
    const gone = await getPet(supabase, at("2026-10-15"));
    expect(gone.mood).toBe("missed");
    expect(gone.line).toContain("5 days");
  });
  it("talks about the week on Sundays when all is well", async () => {
    // 2026-10-25 is a Sunday: the week before was done 6 days of 7.
    store.set("pet", { born: "2026-10-01", lastSeen: "2026-10-24", name: "Nova" });
    store.set("habits", [habit("a", dates("2026-10-19", 7).filter((d) => d !== "2026-10-21").concat("2026-10-25"), "2026-10-01T00:00:00.000Z")]);
    const p = await getPet(supabase, at("2026-10-25", "12:00"));
    expect(p.week.due).toBe(7);
    expect(p.week.done).toBe(6);
    expect(p.line).toMatch(/Intha vaaram 6\/7/);
    expect((await getPet(supabase, at("2026-10-24", "12:00"))).line).not.toMatch(/Intha vaaram/);
  });
});

describe("accessories", () => {
  it("come from growth: bow at Baby", async () => {
    store.set("pet", { born: "2026-09-01", lastSeen: "2026-10-14", name: "Nova" });
    store.set("habits", [habit("a", dates("2026-09-01", 10), "2026-09-01T00:00:00.000Z")]);
    const p = await getPet(supabase, at("2026-10-15"));
    expect(p.unlocked).toContain("bow");
    expect(p.unlocked).not.toContain("garland");
  });
  it("a 7-day habit streak earns the cap; a crown needs 5 wins in a row; 100 songs earn headphones", async () => {
    store.set("pet", { born: "2026-09-01", lastSeen: "2026-10-14", name: "Nova" });
    store.set("habits", [habit("a", dates("2026-10-08", 8), "2026-09-01T00:00:00.000Z")]);
    store.set("games/stats", ["1", "2", "3", "4", "5"].map((k, i) => result(k, "win", `2026-10-0${i + 1}`)));
    store.set("plays/2026-10", Array.from({ length: 100 }, (_, i) => ({ title: `s${i}`, artists: "a", at: "2026-10-05T10:00:00.000Z" })));
    const p = await getPet(supabase, at("2026-10-15"));
    expect(p.unlocked).toEqual(expect.arrayContaining(["cap", "crown", "headphones"]));
    store.set("games/stats", ["1", "2", "3", "4"].map((k, i) => result(k, "win", `2026-10-0${i + 1}`)).concat(result("5", "loss", "2026-10-05"), result("6", "win", "2026-10-06")));
    expect((await getPet(supabase, at("2026-10-15"))).unlocked).not.toContain("crown");
  });
  it("opening the app in winter earns the scarf for good, but not the scheduler looking in", async () => {
    await getPet(supabase, at("2026-12-10"), { touch: false });
    expect((await getPet(supabase, at("2026-12-10"), { touch: false })).unlocked).not.toContain("scarf");
    expect((await getPet(supabase, at("2026-12-10"))).unlocked).toContain("scarf");
    const spring = await getPet(supabase, at("2027-04-01"));
    expect(spring.unlocked).toContain("scarf");
  });
  it("being here on a festival earns its hat, kept for good", async () => {
    await getPet(supabase, at("2026-11-07"));
    const later = await getPet(supabase, at("2027-02-20"));
    expect(later.unlocked).toContain("hat-deepavali");
    expect(later.unlocked).not.toContain("hat-christmas");
    await getPet(supabase, at("2026-12-25"));
    expect((await getPet(supabase, at("2027-02-21"))).unlocked).toEqual(expect.arrayContaining(["hat-deepavali", "hat-christmas"]));
  });
  it("can only be worn once earned, and can be taken off", async () => {
    store.set("pet", { born: "2026-10-01", lastSeen: "2026-10-14", name: "Nova" });
    await expect(wearAccessory(supabase, "crown")).rejects.toThrow(/Not earned/);
    store.set("pet", { born: "2026-09-01", lastSeen: "2026-10-14", name: "Nova" });
    store.set("habits", [habit("a", dates("2026-09-01", 10), "2026-09-01T00:00:00.000Z")]);
    expect((await wearAccessory(supabase, "bow")).wear).toBe("bow");
    expect((await getPet(supabase, at("2026-10-15"))).wear).toBe("bow");
    expect((await wearAccessory(supabase, "none")).wear).toBeNull();
    expect((await getPet(supabase, at("2026-10-15"))).wear).toBeNull();
  });
  it("a worn one it no longer has is not shown", async () => {
    store.set("pet", { born: "2026-10-01", lastSeen: "2026-10-14", name: "Nova", wear: "crown" });
    expect((await getPet(supabase, at("2026-10-15"))).wear).toBeNull();
  });
});

describe("its name", () => {
  it("is cleaned up: letters, up to 20, capitalised", () => {
    expect(cleanPetName("  pixel  ")).toBe("Pixel");
    expect(cleanPetName("sp@rky!!")).toBe("Sprky");
    expect(cleanPetName("a very long pet name indeed")).toHaveLength(20);
    expect(cleanPetName("🙂🙂")).toBe("");
  });
  it("can be changed, and a name with nothing in it is refused", async () => {
    expect(await renamePet(supabase, "pixel")).toBe("Pixel");
    expect((await getPet(supabase, at("2026-10-15"))).name).toBe("Pixel");
    await expect(renamePet(supabase, "!!!")).rejects.toThrow();
    expect((await getPet(supabase, at("2026-10-15"))).name).toBe("Pixel");
  });
});

describe("lantern walks and fireflies", () => {
  it("a finished walk grows it, three a day at most", async () => {
    store.set("pet", { born: "2026-10-01", lastSeen: "2026-10-14", name: "Nova" });
    for (let i = 0; i < 3; i++) expect(await logWalk(supabase)).toMatchObject({ counted: true, xp: 5 });
    expect(await logWalk(supabase)).toEqual({ counted: false, xp: 0 });
  });
  it("the firefly game keeps the best score without touching the rest", async () => {
    store.set("pet", { born: "2026-10-01", lastSeen: "2026-10-14", name: "Pixel", wear: "bow", walks: ["2026-10-14"] });
    await recordFireflies(supabase, 14);
    await recordFireflies(supabase, 9);
    expect(store.get("pet")).toMatchObject({ name: "Pixel", wear: "bow", walks: ["2026-10-14"], fireflies: { best: 14, plays: 2 } });
    expect((await getPet(supabase, at("2026-10-15"))).fireflies).toMatchObject({ best: 14, plays: 2 });
  });
});

describe("its own notifications", () => {
  it("says it misses you once after three days away, in the daytime", async () => {
    store.set("pet", { born: "2026-10-01", lastSeen: "2026-10-10", name: "Pixel" });
    expect(await runPetNudges(supabase, at("2026-10-15", "08:00"))).toBe(0);
    expect(await runPetNudges(supabase, at("2026-10-15", "11:00"))).toBe(1);
    expect(sent[0].title).toContain("Pixel misses you");
    expect(await runPetNudges(supabase, at("2026-10-15", "12:00"))).toBe(0);
  });
  it("announces a new stage once, and never at night", async () => {
    store.set("pet", { born: "2026-09-01", lastSeen: "2026-10-15", name: "Nova", stageNotified: 0 });
    store.set("habits", [habit("a", dates("2026-09-01", 10), "2026-09-01T00:00:00.000Z")]);
    expect(await runPetNudges(supabase, at("2026-10-15", "23:00"))).toBe(0);
    expect(await runPetNudges(supabase, at("2026-10-15", "10:00"))).toBe(1);
    expect(sent[0].title).toContain("evolved");
    expect(await runPetNudges(supabase, at("2026-10-15", "11:00"))).toBe(0);
  });
});

describe("Nova's wish of the day", () => {
  /** A day whose wish is the given one (the pick depends on the date). */
  const dayWith = async (id: string) => {
    for (let d = 1; d <= 28; d++) {
      const date = `2026-11-${String(d).padStart(2, "0")}`;
      store.clear();
      store.set("pet", { born: "2026-10-01", lastSeen: date, name: "Nova" });
      if ((await getPet(supabase, at(date), { touch: false })).wish.id === id) return date;
    }
    throw new Error(`no day with a ${id} wish`);
  };
  it("asks for one thing a day, the same all day", async () => {
    store.set("pet", { born: "2026-10-01", lastSeen: "2026-10-14", name: "Nova" });
    const a = await getPet(supabase, at("2026-10-15", "08:00"));
    const b = await getPet(supabase, at("2026-10-15", "20:00"));
    expect(a.wish.id).toBe(b.wish.id);
    expect(a.wish.text.length).toBeGreaterThan(5);
    expect(a.wish.done).toBe(false);
  });
  it("is done by doing it: growth points, the day's list, and kept for good", async () => {
    const date = await dayWith("song");
    store.clear();
    store.set("pet", { born: "2026-10-01", lastSeen: date, name: "Nova" });
    const before = (await getPet(supabase, at(date), { touch: false })).xp;
    store.set("plays/2026-11", [{ title: "s", artists: "a", at: `${date}T10:00:00.000Z` }]);
    const p = await getPet(supabase, at(date));
    expect(p.wish.done).toBe(true);
    expect(p.xp).toBe(before + 8 + 1); // the wish, and the song itself
    expect(p.today.some((t) => t.includes("Wish done"))).toBe(true);
    expect((store.get("pet") as { wishes?: string[] }).wishes).toEqual([date]);
    // Counted once, and still counted later.
    await getPet(supabase, at(date, "21:00"));
    expect((store.get("pet") as { wishes?: string[] }).wishes).toEqual([date]);
    store.delete("plays/2026-11");
    const later = await getPet(supabase, at("2026-12-20"));
    expect(later.xp).toBe(before + 8);
  });
  it("the scheduler looking in does not record it", async () => {
    const date = await dayWith("song");
    store.clear();
    store.set("pet", { born: "2026-10-01", lastSeen: date, name: "Nova" });
    store.set("plays/2026-11", [{ title: "s", artists: "a", at: `${date}T10:00:00.000Z` }]);
    await getPet(supabase, at(date), { touch: false });
    expect((store.get("pet") as { wishes?: string[] }).wishes).toBeUndefined();
  });
  it("fireflies played today finish a fireflies wish", async () => {
    const date = await dayWith("fireflies");
    store.clear();
    store.set("pet", { born: "2026-10-01", lastSeen: date, name: "Nova", fireflies: { best: 9, plays: 1, last: date } });
    expect((await getPet(supabase, at(date))).wish.done).toBe(true);
    store.set("pet", { born: "2026-10-01", lastSeen: date, name: "Nova", fireflies: { best: 9, plays: 1, last: "2026-11-01" } });
    expect((await getPet(supabase, at(date))).wish.done).toBe(date === "2026-11-01");
  });
});

describe("Nova learning the owner's words", () => {
  it("picks up the Tanglish the owner keeps using, and nothing else", async () => {
    store.set("pet", { born: "2026-10-01", lastSeen: "2026-10-14", name: "Nova" });
    chats = ["seri da", "semma da", "ok seri semma", "my number is 9876543210", "da seri semma"];
    const p = await getPet(supabase, at("2026-10-15"));
    expect(p.words.map((w) => w.word).sort()).toEqual(["da", "semma", "seri"]);
  });
  it("works it out once a day and keeps it", async () => {
    store.set("pet", { born: "2026-10-01", lastSeen: "2026-10-14", name: "Nova" });
    chats = ["seri", "seri", "seri"];
    await getPet(supabase, at("2026-10-15", "08:00"));
    expect((store.get("pet") as { words?: { date: string } }).words?.date).toBe("2026-10-15");
    // The chats change later the same day: it still says what it learned this morning.
    chats = [];
    expect((await getPet(supabase, at("2026-10-15", "20:00"))).words).toEqual([{ word: "seri", count: 3 }]);
    // The next day it looks again.
    expect((await getPet(supabase, at("2026-10-16"))).words).toEqual([]);
  });
  it("the scheduler looking in does not save it", async () => {
    store.set("pet", { born: "2026-10-01", lastSeen: "2026-10-14", name: "Nova" });
    chats = ["seri", "seri", "seri"];
    await getPet(supabase, at("2026-10-15"), { touch: false });
    expect((store.get("pet") as { words?: unknown }).words).toBeUndefined();
  });
  it("has no words to start with", async () => {
    expect((await getPet(supabase, at("2026-10-15"))).words).toEqual([]);
  });
});
