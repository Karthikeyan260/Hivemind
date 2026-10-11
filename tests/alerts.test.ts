import { beforeEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, unknown>();
const sent: { title: string; body: string }[] = [];
vi.mock("@/lib/private-store", () => ({
  readJSON: async (_s: unknown, k: string, fb: unknown) => (store.has(k) ? structuredClone(store.get(k)) : fb),
  writeJSON: async (_s: unknown, k: string, v: unknown) => void store.set(k, structuredClone(v)),
}));
vi.mock("@/lib/push", () => ({ notify: async (_s: unknown, m: { title: string; body: string }) => (sent.push(m), 1) }));

const { alertFailure, reasonOf } = await import("@/lib/alerts");

describe("failure alerts", () => {
  beforeEach(() => {
    store.clear();
    sent.length = 0;
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("tells the owner once a day per job", async () => {
    expect(await alertFailure({} as never, "brief", new Error("boom"))).toBe(true);
    expect(await alertFailure({} as never, "brief", new Error("boom again"))).toBe(false);
    expect(await alertFailure({} as never, "autopilot", "it failed")).toBe(true);
    expect(sent.map((s) => s.title)).toEqual(["⚠️ Morning brief failed", "⚠️ Autopilot failed"]);
  });

  it("explains common failures in plain words, without secrets", () => {
    expect(reasonOf(new Error("429 RESOURCE_EXHAUSTED quota"))).toMatch(/free quota ran out/);
    expect(reasonOf(new Error("Autopilot ran out of time"))).toMatch(/too long/);
    expect(reasonOf(new Error("fetch failed"))).toMatch(/network/);
    expect(reasonOf(new Error("bad request token=abc123 here"))).not.toMatch(/abc123/);
  });
});
