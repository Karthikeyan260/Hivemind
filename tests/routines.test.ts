import { describe, expect, it, vi } from "vitest";

// Only the pure matchers are tested; storage is never touched.
vi.mock("@/lib/private-store", () => ({ readJSON: vi.fn(), writeJSON: vi.fn() }));

import { matchRoutine, triggeredRoutine, type Routine } from "@/lib/routines";

const at = "2026-10-01T00:00:00.000Z";
const items: Routine[] = [
  { id: "r1", name: "Good morning", triggers: ["good morning", "morning routine"], steps: ["What's the weather today?"], created_at: at },
  { id: "r2", name: "Gym mode", triggers: ["gym mode", "workout time"], steps: ["Play workout songs", "I did my exercise"], created_at: at },
];

describe("triggeredRoutine", () => {
  it("matches an exact phrase (case and punctuation ignored)", () => {
    expect(triggeredRoutine(items, "Good morning!")?.id).toBe("r1");
    expect(triggeredRoutine(items, "workout time")?.id).toBe("r2");
  });
  it("matches 'run my X routine'", () => {
    expect(triggeredRoutine(items, "run my gym mode routine")?.id).toBe("r2");
  });
  it("ignores unrelated text and 'run X' without the word routine", () => {
    expect(triggeredRoutine(items, "play some gym songs")).toBeNull();
    expect(triggeredRoutine(items, "run gym mode")).toBeNull();
  });
});

describe("matchRoutine", () => {
  it("finds by name, trigger or part of one", () => {
    expect(matchRoutine(items, "gym mode")?.id).toBe("r2");
    expect(matchRoutine(items, "workout")?.id).toBe("r2");
    expect(matchRoutine(items, "run my morning routine")?.id).toBe("r1");
  });
  it("returns null for unrelated or empty words", () => {
    expect(matchRoutine(items, "tax filing")).toBeNull();
    expect(matchRoutine(items, "the routine")).toBeNull();
  });
});
