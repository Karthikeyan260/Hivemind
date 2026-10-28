import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const files = new Map<string, unknown>();
vi.mock("@/lib/private-store", () => ({
  readJSON: async (_s: unknown, key: string, fallback: unknown) => (files.has(key) ? structuredClone(files.get(key)) : fallback),
  writeJSON: async (_s: unknown, key: string, value: unknown) => void files.set(key, structuredClone(value)),
}));
let plan = "{}";
vi.mock("@/lib/ai/providers", async () => {
  const real = await vi.importActual<typeof import("@/lib/ai/providers")>("@/lib/ai/providers");
  return { ...real, generateWithFallback: async () => ({ text: plan }) };
});
const updated: string[] = [];
vi.mock("@/lib/knowledge", () => ({
  updateMemory: async (_s: unknown, id: string) => void updated.push(id),
  createMemory: async () => ({ id: "new" }),
}));
vi.mock("@/lib/activity", () => ({ logActivity: async () => "act" }));

import { dream, shownInFull, SHOWN } from "@/lib/dream";

const deleted: string[] = [];
type Mem = { id: string; title: string; content: string; memory_type: string };
const stub = (mems: Mem[]) =>
  ({
    from: (table: string) => {
      const chain: Record<string, unknown> = {
        select: () => chain,
        order: () => chain,
        limit: () => Promise.resolve({ data: table === "memories" ? mems : [], error: null }),
        eq: (_c: string, v: string) => ({ ...chain, maybeSingle: () => Promise.resolve({ data: mems.find((m) => m.id === v) ?? null }) }),
        gte: () => chain,
        delete: () => ({ eq: (_c: string, v: string) => (deleted.push(v), Promise.resolve({ error: null })) }),
      };
      return chain;
    },
  }) as never;

const short = (id: string, text: string): Mem => ({ id, title: id, content: text, memory_type: "fact" });
const long = (id: string): Mem => ({ id, title: id, content: "word ".repeat(200), memory_type: "fact" });

describe("Dream mode only touches memories it was shown in full", () => {
  beforeEach(() => {
    files.clear();
    updated.length = 0;
    deleted.length = 0;
  });

  it("knows what 'shown in full' means", () => {
    expect(shownInFull({ content: "short" })).toBe(true);
    expect(shownInFull({ content: "x".repeat(SHOWN) })).toBe(true);
    expect(shownInFull({ content: "x".repeat(SHOWN + 1) })).toBe(false);
  });

  it("merges two short duplicates", async () => {
    plan = JSON.stringify({ merges: [{ keep: "m1", drop: ["m2"], title: "Phone", content: "Phone is 123" }], updates: [], learned: [] });
    const d = await dream(stub([short("a", "Phone is 123"), short("b", "My phone number is 123")]), "2026-10-28");
    expect(d.changes.map((c) => c.kind)).toEqual(["merged"]);
    expect(updated).toEqual(["a"]);
    expect(deleted).toEqual(["b"]);
  });

  it("never merges into, rewrites or deletes a long memory", async () => {
    plan = JSON.stringify({
      merges: [
        { keep: "m1", drop: ["m3"], title: "x", content: "merged" }, // keep is long
        { keep: "m2", drop: ["m1"], title: "y", content: "merged2" }, // the only drop is long
      ],
      updates: [{ id: "m1", content: "new text", reason: "changed" }],
      learned: [],
    });
    const d = await dream(stub([long("L1"), short("S2", "short one"), short("S3", "other short")]), "2026-10-28");
    expect(updated).toEqual([]);
    expect(deleted).toEqual([]);
    expect(d.changes).toEqual([]);
  });

  it("a merge drops only the short ones when some duplicates are long", async () => {
    plan = JSON.stringify({ merges: [{ keep: "m1", drop: ["m2", "m3"], title: "t", content: "merged" }], updates: [], learned: [] });
    await dream(stub([short("S1", "a"), long("L2"), short("S3", "b")]), "2026-10-28");
    expect(updated).toEqual(["S1"]);
    expect(deleted).toEqual(["S3"]);
  });
});
