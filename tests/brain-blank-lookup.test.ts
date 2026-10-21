import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/rag/retrieval", () => ({ searchKnowledge: async () => [], sourceHref: () => "" }));
vi.mock("@/lib/knowledge", () => ({}));
vi.mock("@/lib/ai/embeddings", () => ({ embedOne: async () => [] }));
vi.mock("@/lib/ai/metadata", () => ({ extractMetadata: async () => ({}) }));
vi.mock("@/lib/origin", () => ({ originOf: async () => null }));
vi.mock("@/lib/activity", () => ({ logActivity: async () => {} }));

import { brain } from "@/lib/agents/tools/brain";

/** A table whose every query matches a row: what ilike '%%' does. */
const table = (row: Record<string, unknown>) => {
  const q: Record<string, unknown> = {};
  for (const m of ["select", "ilike", "limit", "eq", "order"]) q[m] = () => q;
  q.maybeSingle = async () => ({ data: row, error: null });
  q.delete = () => q;
  return q;
};
const ctx = (calls: string[]) =>
  ({ supabase: { from: (t: string) => (calls.push(t), table({ id: "1", filename: "cv.pdf", name: "Hive", description: "", status: "active" })) }, actions: [], sources: [], carried: {} }) as never;

describe("blank names find nothing", () => {
  it("delete_document '' does not pick the first document", async () => {
    const calls: string[] = [];
    const r = (await brain.delete_document.run({ which: "  " }, ctx(calls))) as { error?: string };
    expect(r.error).toBeTruthy();
    expect(calls).toEqual([]);
  });
  it("project_details '' does not open the first project", async () => {
    const calls: string[] = [];
    const r = (await brain.project_details.run({ name: "" }, ctx(calls))) as { error?: string };
    expect(r.error).toBeTruthy();
    expect(calls).toEqual([]);
  });
});
