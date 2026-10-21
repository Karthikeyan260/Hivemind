import { beforeEach, describe, expect, it, vi } from "vitest";

const files = new Map<string, unknown>();
vi.mock("@/lib/private-store", () => ({
  readJSON: async (_s: unknown, key: string, fallback: unknown) => (files.has(key) ? structuredClone(files.get(key)) : fallback),
  writeJSON: async (_s: unknown, key: string, value: unknown) => void files.set(key, JSON.parse(JSON.stringify(value))),
}));
// What the AI "decides": one urgent insight.
vi.mock("@/lib/agents/orchestrator", () => ({
  runAgent: async () => ({ text: JSON.stringify({ insights: [{ key: "gift-priya", kind: "people", priority: 3, title: "Gift for Priya", body: "Her birthday is close.", link: null }] }) }),
}));
vi.mock("@/lib/ai/providers", () => ({
  generateWithFallback: async () => ({ text: "" }),
  parseJson: (text: string, schema: { safeParse: (v: unknown) => { success: boolean; data?: unknown } }) => {
    try {
      const r = schema.safeParse(JSON.parse(text));
      return r.success ? r.data : null;
    } catch {
      return null;
    }
  },
}));
vi.mock("@/lib/activity", () => ({ logActivity: async () => {} }));
vi.mock("@/lib/birthdays", () => ({ upcomingBirthdays: async () => [] }));
vi.mock("@/lib/career", () => ({ CAREER_SOURCE: "career" }));
vi.mock("@/lib/habits", () => ({ habitsWithStats: async () => [] }));
vi.mock("@/lib/prefs", () => ({ getPrefs: async () => ({ language: "english" }), languageRule: () => "" }));
vi.mock("@/lib/profile", () => ({ getProfile: async () => ({}), profileForPrompt: () => "" }));
vi.mock("@/lib/reminders", () => ({
  agenda: async () => ({ today: [], tomorrow: [], overdue: [], later: [] }),
  agendaForPrompt: () => "",
  localParts: () => ({ date: "2026-10-21", hour: 10 }),
  nowForPrompt: () => "now",
}));
// Sending the push takes a moment: the window in which the owner dismisses something.
let whileSending: () => Promise<void> = async () => {};
vi.mock("@/lib/push", () => ({
  pushConfigured: () => true,
  notify: async () => {
    await whileSending();
    return 1;
  },
}));

import { getFeed, runAutopilot, setInsightStatus } from "@/lib/autopilot";

// A stand-in database: every query answers "no rows".
const chain: unknown = new Proxy(function () {}, {
  get: (_t, p) => (p === "then" ? (res: (v: unknown) => void) => res({ data: [], error: null }) : chain),
  apply: () => chain,
});
const supabase = { from: () => chain } as never;

const old = { id: "old-id", key: "old-topic", kind: "other", priority: 1, title: "An older insight", body: "x", created_at: "2026-10-20T08:00:00.000Z", status: "new" };

describe("Autopilot: a dismiss made while it's sending pushes isn't undone", () => {
  beforeEach(() => {
    files.clear();
    whileSending = async () => {};
  });

  it("the new insight is saved and pushed", async () => {
    files.set("autopilot", { items: [old], runs: [] });
    const r = await runAutopilot(supabase, { manual: false });
    expect(r.insights.map((i) => i.title)).toEqual(["Gift for Priya"]);
    const feed = await getFeed(supabase);
    expect(feed.items.map((i) => i.key)).toEqual(["gift-priya", "old-topic"]);
    expect(feed.items[0].pushed).toBe(true);
  });

  it("dismissing an older insight during the push stays dismissed", async () => {
    files.set("autopilot", { items: [old], runs: [] });
    whileSending = async () => {
      await setInsightStatus(supabase, "old-id", "dismissed");
    };
    await runAutopilot(supabase, { manual: false });
    const feed = await getFeed(supabase);
    expect(feed.items.find((i) => i.key === "old-topic")?.status).toBe("dismissed");
    expect(feed.items.find((i) => i.key === "gift-priya")).toBeTruthy();
  });
});
