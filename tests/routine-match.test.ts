import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/private-store", () => ({ readJSON: async (_s: unknown, _k: string, f: unknown) => f, writeJSON: async () => {} }));
import { matchRoutine, norm, triggeredRoutine, type Routine } from "@/lib/routines";

const r = (name: string, triggers: string[]): Routine => ({ id: name, name, triggers: [...new Set([name, ...triggers].map(norm))], steps: ["x"], created_at: "2026-10-01" });

describe("routine phrases", () => {
  it("normalising keeps Tamil vowel signs, so different words stay different", () => {
    expect(norm("கல்")).not.toBe(norm("கால்"));
    expect(norm("காலை வணக்கம்!")).toBe("காலை வணக்கம்");
    expect(norm("  Good   MORNING!! ")).toBe("good morning");
  });
  it("a Tamil routine fires on its own words and not on a word that only differs in a vowel sign", () => {
    const items = [r("காலை வணக்கம்", ["கால்"])];
    expect(triggeredRoutine(items, "காலை வணக்கம்")?.name).toBe("காலை வணக்கம்");
    expect(triggeredRoutine(items, "கால்")?.name).toBe("காலை வணக்கம்");
    expect(triggeredRoutine(items, "கல்")).toBeNull();
  });
  it("only a whole message that is a trigger runs a routine", () => {
    const items = [r("Good morning", ["morning routine"]), r("Boring", ["boring"])];
    expect(triggeredRoutine(items, "good morning")?.name).toBe("Good morning");
    expect(triggeredRoutine(items, "Good morning!")?.name).toBe("Good morning");
    expect(triggeredRoutine(items, "good morning is overrated, tell me about boring things")).toBeNull();
    expect(triggeredRoutine(items, "run my boring routine")?.name).toBe("Boring");
    expect(triggeredRoutine(items, "")).toBeNull();
    expect(triggeredRoutine(items, "x".repeat(200))).toBeNull();
  });
  it("one or two letters never fuzzy-match a routine, but a real word does", () => {
    const items = [r("Good morning", ["morning routine"]), r("Evening wind down", ["wind down"])];
    expect(matchRoutine(items, "a")).toBeNull();
    expect(matchRoutine(items, "mo")).toBeNull();
    expect(matchRoutine(items, "run the e routine")).toBeNull();
    expect(matchRoutine(items, "wind")?.name).toBe("Evening wind down");
    expect(matchRoutine(items, "morning")?.name).toBe("Good morning");
    expect(matchRoutine(items, "please run my good morning routine")?.name).toBe("Good morning");
  });
});
