import { describe, expect, it, vi } from "vitest";

const deleted: string[] = [];
const tasks = [
  { id: "t1", goal: "Find a cheap flight to Goa", status: "done" },
  { id: "t2", goal: "Book a train to Madurai", status: "running" },
];
vi.mock("@/lib/web-agent/store", () => ({
  listTasks: async () => tasks,
  deleteTasks: async (_s: unknown, ids: string[]) => {
    deleted.push(...ids);
    return ids.length;
  },
  ACTIVE: ["queued", "running", "needs_approval", "needs_you"],
}));
vi.mock("@/lib/web-agent/runner", () => ({ decideTask: async () => ({}) }));

import { web } from "@/lib/agents/tools/web";

const run = (which: string) => web.web_task_delete.run({ which }, { supabase: {}, actions: [], changed: false } as never);

describe("deleting a web task needs a real target", () => {
  it("a blank request deletes nothing (it used to pick the first task)", async () => {
    deleted.length = 0;
    const r = (await run("")) as { error?: string };
    expect(r.error).toBeTruthy();
    expect(await run("   ")).toHaveProperty("error");
    expect(deleted).toEqual([]);
  });
  it("words from the goal still find the task", async () => {
    deleted.length = 0;
    expect(await run("train")).toEqual({ deleted: "Book a train to Madurai" });
    expect(deleted).toEqual(["t2"]);
  });
  it("'finished' clears only the tasks that are done", async () => {
    deleted.length = 0;
    await run("finished");
    expect(deleted).toEqual(["t1"]);
  });
});
