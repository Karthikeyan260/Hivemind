import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/private-store", () => ({ readJSON: async (_s: unknown, _k: string, f: unknown) => f, writeJSON: async () => {} }));

import { pickResurface } from "@/lib/resurface";
import { ago } from "@/components/day/your-day";

const row = (id: string, made: string, content = "A memory long enough to be worth showing again.") => ({ id, title: `Memory ${id}`, content, created_at: `${made}T10:00:00+05:30` });
const TODAY = "2026-10-22";

describe("pickResurface", () => {
  it("never shows a recent memory, a tiny one, or one shown in the last three months", () => {
    const rows = [row("new", "2026-10-10"), row("tiny", "2026-01-01", "hi"), row("seen", "2026-01-02")];
    expect(pickResurface(rows, { seen: "2026-09-01" }, TODAY)).toBeNull();
    expect(pickResurface(rows.slice(0, 2), {}, TODAY)).toBeNull();
  });
  it("brings a memory back once the three months are over", () => {
    const rows = [row("seen", "2026-01-02")];
    expect(pickResurface(rows, { seen: "2026-06-01" }, TODAY)?.id).toBe("seen");
  });
  it("is the same all day and changes from day to day", () => {
    const rows = Array.from({ length: 30 }, (_, i) => row(`m${i}`, "2026-02-01"));
    const a = pickResurface(rows, {}, TODAY)!.id;
    expect(pickResurface(rows, {}, TODAY)!.id).toBe(a);
    const others = new Set(["2026-10-23", "2026-10-24", "2026-10-25", "2026-10-26", "2026-10-27"].map((d) => pickResurface(rows, {}, d)!.id));
    expect(others.size).toBeGreaterThan(1);
  });
  it("says how long ago", () => {
    expect(ago(21)).toBe("3 weeks ago");
    expect(ago(90)).toBe("3 months ago");
    expect(ago(14)).toBe("2 weeks ago");
  });
});
