import { beforeEach, describe, expect, it, vi } from "vitest";

const files = new Map<string, unknown>();
vi.mock("server-only", () => ({}));
vi.mock("@/lib/private-store", () => ({
  readJSON: async (_s: unknown, key: string, fallback: unknown) => (files.has(key) ? structuredClone(files.get(key)) : fallback),
  writeJSON: async (_s: unknown, key: string, value: unknown) => void files.set(key, structuredClone(value)),
}));

import { recordFireflies } from "@/lib/pet";

const supabase = {} as never;

describe("recordFireflies", () => {
  beforeEach(() => files.clear());

  it("keeps the best score and counts the rounds", async () => {
    expect(await recordFireflies(supabase, 12)).toMatchObject({ score: 12, best: 12, plays: 1, newBest: true });
    expect(await recordFireflies(supabase, 8)).toMatchObject({ best: 12, plays: 2, newBest: false });
    expect(await recordFireflies(supabase, 20)).toMatchObject({ best: 20, plays: 3, newBest: true });
    expect(await recordFireflies(supabase, 20)).toMatchObject({ newBest: false });
  });
  it("keeps the rest of the pet as it was", async () => {
    files.set("pet", { born: "2026-09-01", lastSeen: "2026-10-01", name: "Pixel", walks: ["2026-10-01"] });
    await recordFireflies(supabase, 5);
    expect(files.get("pet")).toMatchObject({ born: "2026-09-01", name: "Pixel", walks: ["2026-10-01"], fireflies: { best: 5, plays: 1 } });
  });
  it("clamps nonsense scores", async () => {
    expect((await recordFireflies(supabase, -4)).score).toBe(0);
    expect((await recordFireflies(supabase, 99999)).score).toBe(500);
    expect((await recordFireflies(supabase, Number.NaN)).score).toBe(0);
  });
});
