import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

type Row = Record<string, unknown>;

/** A tiny in-memory stand-in for the three tables undo touches. */
function fakeDb(initial: Record<string, Row[]>) {
  const tables: Record<string, Row[]> = JSON.parse(JSON.stringify(initial));
  const from = (name: string) => {
    const rows = (tables[name] ||= []);
    let filter: [string, unknown] | null = null;
    let op: "select" | "delete" | "insert" | "update" = "select";
    let patch: Row | null = null;
    const matches = () => rows.filter((r) => !filter || r[filter[0]] === filter[1]);
    const run = () => {
      if (op === "delete") {
        for (const r of matches()) rows.splice(rows.indexOf(r), 1);
        return { data: null, error: null };
      }
      if (op === "update") {
        for (const r of matches()) Object.assign(r, patch);
        return { data: null, error: null };
      }
      return { data: matches(), error: null };
    };
    const q: Record<string, unknown> = {
      select: () => q,
      delete: () => ((op = "delete"), q),
      update: (p: Row) => ((op = "update"), (patch = p), q),
      insert: (v: Row | Row[]) => {
        rows.push(...(Array.isArray(v) ? v : [v]).map((x) => ({ id: `${name}-${rows.length + 1}`, ...x })));
        const res = { data: { id: rows[rows.length - 1].id }, error: null };
        return Object.assign(Promise.resolve({ data: null, error: null }), { select: () => ({ single: async () => res }) });
      },
      eq: (c: string, v: unknown) => ((filter = [c, v]), q),
      maybeSingle: async () => ({ data: matches()[0] ?? null, error: null }),
      single: async () => ({ data: matches()[0] ?? null, error: null }),
      then: (res: (v: unknown) => unknown) => Promise.resolve(run()).then(res),
    };
    return q;
  };
  return { tables, client: { from } as never };
}

describe("deleting a memory and undoing it", () => {
  it("brings the version history back too", async () => {
    const { deleteMemory } = await import("@/lib/knowledge");
    const { undoActivity } = await import("@/lib/activity");
    const db = fakeDb({
      memories: [{ id: "m1", title: "Bike", content: "TN01" }],
      memory_versions: [
        { id: "v1", memory_id: "m1", version_number: 1, title: "Bike", content: "old" },
        { id: "v2", memory_id: "m1", version_number: 2, title: "Bike", content: "TN01" },
      ],
    });
    await deleteMemory(db.client, "m1");
    // Simulate the database cascade: versions go with the memory.
    db.tables.memory_versions = [];
    expect(db.tables.memories).toHaveLength(0);

    const log = db.tables.activity.find((a) => a.kind === "memory_deleted")!;
    expect((log.payload as { versions: Row[] }).versions).toHaveLength(2);

    await undoActivity(db.client, log.id as string);
    expect(db.tables.memories).toHaveLength(1);
    expect(db.tables.memory_versions.map((v) => v.version_number)).toEqual([1, 2]);
  });
});
