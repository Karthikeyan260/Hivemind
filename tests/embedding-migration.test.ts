import { beforeEach, describe, expect, it, vi } from "vitest";

// The private store and the embedding model, faked in memory.
const store = new Map<string, unknown>();
vi.mock("@/lib/private-store", () => ({
  readJSON: async (_s: unknown, k: string, fb: unknown) => (store.has(k) ? structuredClone(store.get(k)) : fb),
  writeJSON: async (_s: unknown, k: string, v: unknown) => void store.set(k, structuredClone(v)),
}));
let failAfter = Infinity;
const embedCalls: { model: string; texts: string[] }[] = [];
vi.mock("@/lib/ai/embeddings", () => ({
  CONFIGURED_MODEL: "model-new",
  EMBED_DIM: 768,
  MARKER_KEY: "embedding-model",
  forgetMarker: () => {},
  getMarker: async () => store.get("embedding-model") ?? { model: "model-old", dim: 768 },
  embedMany: async (texts: string[], _t: string, model: string) => {
    if (embedCalls.length >= failAfter) throw new Error("429 quota");
    embedCalls.push({ model, texts });
    return texts.map(() => [model === "model-new" ? 1 : 0]);
  },
}));

const { startMigration, migrationStep, cancelMigration, embeddingStatus } = await import("@/lib/embedding-migration");

type Row = { id: string; title?: string; content: string; document_id?: string; embedding: string | null };
let tables: Record<string, Row[]>;

/** Supabase client subset: select (+count/head), is, order, gt, limit, update().eq(). */
function fakeDb() {
  return {
    from(t: string) {
      let rows = [...tables[t]].sort((a, b) => a.id.localeCompare(b.id));
      let count = false;
      let lim = Infinity;
      const q = {
        select: (_cols: string, o?: { count?: string; head?: boolean }) => ((count = !!o?.head), q),
        is: (col: string, v: null) => ((rows = rows.filter((r) => (r as Record<string, unknown>)[col] === v)), q),
        order: () => q,
        gt: (_c: string, v: string) => ((rows = rows.filter((r) => r.id > v)), q),
        limit: (n: number) => ((lim = n), q),
        update: (patch: Partial<Row>) => ({
          eq: async (_c: string, id: string) => {
            Object.assign(tables[t].find((r) => r.id === id)!, patch);
            return { error: null };
          },
        }),
        then: (res: (v: unknown) => void) =>
          res(
            count
              ? { count: rows.length, error: null }
              : { data: rows.slice(0, lim).map((r) => ({ ...r, documents: r.document_id ? { filename: "cv.pdf" } : undefined })), error: null },
          ),
      };
      return q;
    },
  } as never;
}

const rows = (n: number, p: string) => Array.from({ length: n }, (_, i) => ({ id: `${p}${String(i).padStart(3, "0")}`, title: `T${i}`, content: `C${i}`, embedding: "[0]" }));

describe("re-embedding everything", () => {
  beforeEach(() => {
    store.clear();
    embedCalls.length = 0;
    failAfter = Infinity;
    tables = { notes: rows(120, "n"), memories: rows(7, "m"), document_chunks: rows(3, "c").map((r) => ({ ...r, document_id: "d1" })) };
  });

  it("redoes every row in every table, then switches searches to the new model", async () => {
    await startMigration(fakeDb(), "model-new");
    expect(store.get("embedding-model")).toMatchObject({ model: "model-old", target: "model-new" });
    const job = await migrationStep(fakeDb());
    expect(job?.finished).toBeTruthy();
    expect(job?.done).toBe(130);
    for (const t of Object.values(tables)) for (const r of t) expect(r.embedding).toBe("[1]");
    expect(store.get("embedding-model")).toEqual({ model: "model-new", dim: 768 });
  });

  it("embeds chunks with their document's name, like the importer does", async () => {
    await startMigration(fakeDb(), "model-new");
    await migrationStep(fakeDb());
    expect(embedCalls.flatMap((c) => c.texts)).toContain("cv.pdf\n\nC0");
    expect(embedCalls.flatMap((c) => c.texts)).toContain("T0\n\nC0");
  });

  it("carries on where it stopped after a quota error", async () => {
    await startMigration(fakeDb(), "model-new"); // 1 test call
    failAfter = 3; // the test call + 2 pages of notes, then quota
    const first = await migrationStep(fakeDb());
    expect(first?.finished).toBeUndefined();
    expect(first?.done).toBe(100);
    expect(first?.note).toMatch(/quota/);
    expect(store.get("embedding-model")).toMatchObject({ model: "model-old" }); // searches unchanged so far
    failAfter = Infinity;
    const second = await migrationStep(fakeDb());
    expect(second?.finished).toBeTruthy();
    expect(second?.done).toBe(130);
    // No page was done twice.
    expect(embedCalls.slice(1).reduce((n, c) => n + c.texts.length, 0)).toBe(130);
  });

  it("refuses a model that doesn't work, before touching anything", async () => {
    failAfter = 0;
    await expect(startMigration(fakeDb(), "model-new")).rejects.toThrow(/quota/);
    expect(store.has("embedding-migration")).toBe(false);
    expect(tables.notes[0].embedding).toBe("[0]");
  });

  it("cancel keeps searches on the old model", async () => {
    await startMigration(fakeDb(), "model-new");
    await cancelMigration(fakeDb());
    expect(store.get("embedding-model")).toEqual({ model: "model-old", dim: 768 });
    expect((await migrationStep(fakeDb()))?.done).toBe(0);
  });

  it("reports rows and missing vectors per table", async () => {
    tables.memories[0].embedding = null;
    const s = await embeddingStatus(fakeDb());
    expect(s.tables.notes).toEqual({ rows: 120, missing: 0 });
    expect(s.tables.memories).toEqual({ rows: 7, missing: 1 });
    expect(s.model).toBe("model-old");
    expect(s.configured).toBe("model-new");
  });
});
