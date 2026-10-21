import { describe, expect, it, vi } from "vitest";

const files = new Map<string, unknown>();
vi.mock("server-only", () => ({}));
vi.mock("@/lib/private-store", () => ({
  readJSON: async (_s: unknown, key: string, fallback: unknown) => (files.has(key) ? structuredClone(files.get(key)) : fallback),
  writeJSON: async (_s: unknown, key: string, value: unknown) => void files.set(key, structuredClone(value)),
}));

import { saveRoutine } from "@/lib/routines";

describe("routine steps", () => {
  it("keep a leading number that is part of the step, drop list markers", async () => {
    const r = await saveRoutine({} as never, { name: "Gym", steps: ["10 min stretch", "1. Play workout songs", "- 2) log my exercise", "5k run"] });
    expect(r.steps).toEqual(["10 min stretch", "Play workout songs", "log my exercise", "5k run"]);
  });
});
