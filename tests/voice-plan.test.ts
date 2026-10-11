import { describe, expect, it } from "vitest";
import { TOOLS } from "@/lib/agents/tools";
import { GROUPS, groupsFor, planFor } from "@/lib/voice/plan";

// The chat-agent tools voice can reach (the token route leaves out the ones voice covers itself).
const COVERED = new Set(["search_brain", "remember", "create_project", "get_weather", "web_search", "create_reminder", "list_reminders", "create_note", "analyze_job", "tailor_resume", "play_music", "play_video", "cancel_reminder", "reschedule_reminder", "complete_reminder"]);
const ALL = Object.keys(TOOLS).filter((t) => !COVERED.has(t));
const ctx = { routines: "good morning → weather, schedule" };

describe("voice session plan", () => {
  it("every tool voice can use is in exactly one group (none lost, none twice)", () => {
    const seen = new Map<string, string>();
    for (const [k, g] of Object.entries(GROUPS))
      for (const t of g.tools) {
        expect(seen.get(t), `${t} in ${k} and ${seen.get(t)}`).toBeUndefined();
        seen.set(t, k);
      }
    expect(ALL.filter((t) => !seen.has(t))).toEqual([]);
    expect([...seen.keys()].filter((t) => !(t in TOOLS))).toEqual([]);
  });

  it("loads core everywhere, plus the page's own groups", () => {
    expect(groupsFor("/settings")).toEqual(["core"]);
    expect(groupsFor("/")).toEqual(expect.arrayContaining(["core", "home", "brief", "autopilot"]));
    expect(groupsFor("/career")).toContain("career");
    expect(groupsFor("/apps/abc123")).toContain("apps");
    expect(groupsFor("/web")).toContain("web");
    expect(groupsFor("/web")).not.toContain("home");
  });

  it("everything not loaded is still reachable, with how-to for tool_help", () => {
    const p = planFor("/settings", ALL, ctx);
    for (const t of ALL) expect(p.loaded.has(t) || p.more.includes(t), t).toBe(true);
    expect(p.more).toContain("web_task");
    expect(p.howTo.web_task).toMatch(/Approve only when the owner clearly says so/);
    expect(p.instructions).toMatch(/call use_tool/);
    expect(p.instructions).toMatch(/Web tasks/);
  });

  it("is much smaller than loading everything", () => {
    const all = Object.values(GROUPS).flatMap((g) => g.guide.map((x) => (typeof x === "function" ? x(ctx) : x))).join("\n").length;
    const settings = planFor("/settings", ALL, ctx);
    expect(settings.loaded.size).toBeLessThan(ALL.length * 0.45);
    expect(settings.instructions.length).toBeLessThan(all * 0.85);
    // The routines line carries the owner's routines.
    expect(settings.instructions).toContain("good morning → weather, schedule");
  });
});
