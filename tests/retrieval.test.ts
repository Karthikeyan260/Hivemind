import { beforeEach, describe, expect, it, vi } from "vitest";

// A plain function, swapped per test (a rejecting vi.fn fails the test even when the code catches it).
let embed: (q: string) => Promise<number[]> = async () => [];
const asked: string[] = [];
vi.mock("@/lib/ai/embeddings", () => ({ embedQuery: (q: string) => (asked.push(q), embed(q)) }));
const down = (msg: string) => (embed = async () => { throw new Error(msg); });

const { searchKnowledge, sourceHref } = await import("@/lib/rag/retrieval");

type Row = { id: string; title: string; content: string; created_at: string; project_id?: string };

/** Just enough of the Supabase client for retrieval: rpc() and from().select().or().limit().eq(). */
function fakeDb(tables: Record<string, Row[]>, rpcResult: unknown[] = []) {
  const rpc = vi.fn(async () => ({ data: rpcResult, error: null }));
  const from = (table: string) => {
    let rows = tables[table] ?? [];
    let words: string[] = [];
    const q = {
      select: () => q,
      or: (expr: string) => {
        words = [...expr.matchAll(/ilike\.%([^%]+)%/g)].map((m) => m[1]);
        return q;
      },
      limit: () => q,
      eq: (col: string, v: string) => {
        rows = rows.filter((r) => (r as Record<string, unknown>)[col] === v);
        return q;
      },
      then: (res: (v: { data: Row[] }) => void) => res({ data: rows.filter((r) => words.some((w) => `${r.title} ${r.content}`.toLowerCase().includes(w))) }),
    };
    return q;
  };
  return { rpc, from } as unknown as Parameters<typeof searchKnowledge>[0] & { rpc: typeof rpc };
}

const at = "2026-10-01T00:00:00Z";

describe("searchKnowledge", () => {
  beforeEach(() => {
    asked.length = 0;
    embed = async () => [];
  });

  it("asks match_knowledge with the query vector and the defaults", async () => {
    embed = async () => [0.1, 0.2];
    const hit = { source_type: "note", source_id: "n1", parent_id: "n1", title: "Kubernetes", content: "…", similarity: 0.8, created_at: at };
    const db = fakeDb({}, [hit]);
    expect(await searchKnowledge(db, "how do I scale pods")).toEqual([hit]);
    expect(asked).toEqual(["how do I scale pods"]);
    expect(db.rpc).toHaveBeenCalledWith("match_knowledge", { query_embedding: "[0.1,0.2]", match_count: 8, filter_project: null, min_similarity: 0.35 });
  });

  it("passes limit, project and threshold through", async () => {
    embed = async () => [1];
    const db = fakeDb({});
    await searchKnowledge(db, "x", { limit: 3, projectId: "p1", minSimilarity: 0.6 });
    expect(db.rpc).toHaveBeenCalledWith("match_knowledge", expect.objectContaining({ match_count: 3, filter_project: "p1", min_similarity: 0.6 }));
  });

  it("falls back to word search when embeddings are down, ranked by words matched", async () => {
    down("429 quota");
    const db = fakeDb({
      notes: [
        { id: "a", title: "Docker notes", content: "images and layers", created_at: at },
        { id: "b", title: "Docker compose", content: "compose networks and docker volumes", created_at: at },
      ],
      memories: [{ id: "m", title: "Lunch", content: "biryani", created_at: at }],
    });
    const out = await searchKnowledge(db, "docker compose volumes");
    expect(db.rpc).not.toHaveBeenCalled();
    expect(out.map((r) => r.source_id)).toEqual(["b", "a"]);
    expect(out[0].similarity).toBe(1);
    expect(out[0].source_type).toBe("note");
  });

  it("word search understands Tamil words", async () => {
    down("down");
    const db = fakeDb({ notes: [], memories: [{ id: "t", title: "அம்மா பிறந்தநாள்", content: "மார்ச் 3", created_at: at }] });
    const out = await searchKnowledge(db, "அம்மா பிறந்தநாள் எப்போது");
    expect(out[0]?.source_id).toBe("t");
  });

  it("word search keeps to the project when one is given", async () => {
    down("down");
    const db = fakeDb({
      notes: [
        { id: "in", title: "budget plan", content: "", created_at: at, project_id: "p1" },
        { id: "out", title: "budget plan", content: "", created_at: at, project_id: "p2" },
      ],
    });
    expect((await searchKnowledge(db, "budget plan", { projectId: "p1" })).map((r) => r.source_id)).toEqual(["in"]);
  });

  it("links each result to its page", () => {
    expect(sourceHref({ source_type: "note", parent_id: "1" })).toBe("/notes?open=1");
    expect(sourceHref({ source_type: "memory", parent_id: "2" })).toBe("/memories?open=2");
    expect(sourceHref({ source_type: "document", parent_id: "3" })).toBe("/documents?open=3");
  });
});
