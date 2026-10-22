import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/rag/retrieval", () => ({ searchKnowledge: async () => [], sourceHref: () => "" }));
vi.mock("@/lib/knowledge", () => ({}));
vi.mock("@/lib/ai/embeddings", () => ({ embedOne: async () => [] }));
vi.mock("@/lib/ai/metadata", () => ({ extractMetadata: async () => ({}) }));
vi.mock("@/lib/origin", () => ({ originOf: async () => null }));
vi.mock("@/lib/activity", () => ({ logActivity: async () => {} }));

import { NOT_CAREER_FILTER } from "@/lib/career";
import { brain } from "@/lib/agents/tools/brain";

describe("leaving out job analyses", () => {
  it("keeps memories that have no source at all (a plain NOT IN drops every one of them)", () => {
    expect(NOT_CAREER_FILTER).toContain("metadata->>source.is.null");
    expect(NOT_CAREER_FILTER).toContain("not.in.(career,resume-master)");
  });
  it("recent_memories uses it, and never the NULL-dropping form", async () => {
    const calls: string[] = [];
    const q: Record<string, unknown> = {};
    for (const m of ["select", "order", "limit"]) q[m] = () => q;
    q.not = (...a: unknown[]) => (calls.push(`not:${a.join("|")}`), q);
    q.or = (f: string) => (calls.push(`or:${f}`), q);
    q.then = (res: (v: unknown) => void) => res({ data: [], error: null });
    await brain.recent_memories.run({}, { supabase: { from: () => q } } as never);
    expect(calls).toEqual([`or:${NOT_CAREER_FILTER}`]);
  });
});
