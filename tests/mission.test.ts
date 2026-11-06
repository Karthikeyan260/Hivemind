import { describe, expect, it } from "vitest";
import { ago, buildCrew, type MissionFacts, summary } from "@/lib/mission";

const NOW = Date.parse("2026-11-05T10:00:00Z");
const min = (m: number) => new Date(NOW - m * 60_000).toISOString();
const facts = (over: Partial<MissionFacts> = {}): MissionFacts => ({
  now: NOW,
  hour: 14,
  today: "2026-11-05",
  briefHour: 8,
  scheduler: { lastRun: min(3), staleMs: 2 * 3_600_000 },
  autopilot: { enabled: true, startHour: 8, endHour: 21, everyHours: 4, running: false, lastRun: min(90), lastFound: 3, lastError: null, fresh: 2 },
  web: { configured: true, tasks: [] },
  dream: { enabled: true, hour: 3, last: { date: "2026-11-05", at: min(600), changes: 4 } },
  brief: { enabled: true, topics: 2, lastDate: "2026-11-05" },
  reminders: { overdue: 0, today: 0, next: null },
  apps: [],
  ...over,
});
const by = (f: MissionFacts, id: string) => buildCrew(f).find((c) => c.id === id)!;

describe("buildCrew", () => {
  it("is calm when everything is fine", () => {
    const crew = buildCrew(facts());
    expect(crew.map((c) => c.id)).toEqual(["scheduler", "autopilot", "web", "dream", "brief", "reminders", "apps"]);
    expect(crew.filter((c) => c.state === "alert")).toEqual([]);
    expect(summary(crew)).toMatch(/quiet/i);
  });

  it("flags a scheduler that never ran or went quiet", () => {
    expect(by(facts({ scheduler: { lastRun: null, staleMs: 7_200_000 } }), "scheduler").state).toBe("alert");
    const stale = by(facts({ scheduler: { lastRun: min(5 * 60), staleMs: 7_200_000 } }), "scheduler");
    expect(stale.state).toBe("alert");
    expect(stale.line).toMatch(/5 h/);
  });

  it("puts Scout to sleep outside its hours or when off, and wakes it while running", () => {
    expect(by(facts({ hour: 23 }), "autopilot").state).toBe("sleeping");
    expect(by(facts({ autopilot: { ...facts().autopilot, enabled: false } }), "autopilot").state).toBe("sleeping");
    expect(by(facts({ autopilot: { ...facts().autopilot, running: true } }), "autopilot").state).toBe("working");
    expect(by(facts({ autopilot: { ...facts().autopilot, lastError: "quota" } }), "autopilot").state).toBe("alert");
  });

  it("shows Rover working on a task, and needing you when it waits", () => {
    const task = { goal: "Find flights", updated_at: min(1), lastDid: "clicked Search", question: null, error: null };
    const working = by(facts({ web: { configured: true, tasks: [{ ...task, status: "running" }] } }), "web");
    expect(working.state).toBe("working");
    expect(working.line).toBe("clicked Search");
    const waiting = by(facts({ web: { configured: true, tasks: [{ ...task, status: "needs_approval", question: "Pay ₹500?" }] } }), "web");
    expect(waiting.state).toBe("alert");
    expect(waiting.line).toContain("Pay ₹500?");
    expect(by(facts({ web: { configured: false, tasks: [] } }), "web").state).toBe("sleeping");
  });

  it("only treats a recent failure as an alert", () => {
    const failed = (m: number) => ({ goal: "x", status: "failed" as const, updated_at: min(m), lastDid: null, question: null, error: "timeout" });
    expect(by(facts({ web: { configured: true, tasks: [failed(30)] } }), "web").state).toBe("alert");
    expect(by(facts({ web: { configured: true, tasks: [failed(60 * 20)] } }), "web").state).toBe("idle");
  });

  it("lets the Night Owl sleep by day, and Scribe worry when the brief is late", () => {
    expect(by(facts({ hour: 14 }), "dream").state).toBe("sleeping");
    expect(by(facts({ hour: 2 }), "dream").state).toBe("idle");
    expect(by(facts({ brief: { enabled: true, topics: 2, lastDate: "2026-11-04" }, hour: 11 }), "brief").state).toBe("alert");
    expect(by(facts({ brief: { enabled: true, topics: 2, lastDate: "2026-11-04" }, hour: 7 }), "brief").state).toBe("idle");
    expect(by(facts({ brief: { enabled: true, topics: 0, lastDate: null } }), "brief").state).toBe("sleeping");
  });

  it("rings Bell for overdue and due reminders, and Maker while building", () => {
    expect(by(facts({ reminders: { overdue: 2, today: 0, next: null } }), "reminders").state).toBe("alert");
    expect(by(facts({ reminders: { overdue: 0, today: 1, next: "Call mum" } }), "reminders").state).toBe("working");
    expect(by(facts({ apps: [{ name: "Budget", status: "building", updated_at: min(1) }] }), "apps").state).toBe("working");
    expect(by(facts({ apps: [{ name: "Budget", status: "failed", updated_at: min(10) }] }), "apps").state).toBe("alert");
  });
});

describe("ago", () => {
  it("reads like a person", () => {
    expect(ago(null, NOW)).toBe("never");
    expect(ago(min(0), NOW)).toBe("just now");
    expect(ago(min(5), NOW)).toBe("5 min ago");
    expect(ago(min(180), NOW)).toBe("3 h ago");
    expect(ago(min(60 * 24 * 3), NOW)).toBe("3 days ago");
  });
});
