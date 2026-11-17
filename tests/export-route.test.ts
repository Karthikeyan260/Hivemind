import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const TABLES = ["projects", "notes", "memories", "memory_versions", "documents", "document_chunks", "conversations", "messages"];
const rows: Record<string, { id: string }[]> = {};
const selects: Record<string, string> = {};
const privateFiles: Record<string, unknown> = {};
let failTable: string | null = null;

vi.mock("@/lib/db", () => ({
  db: () => ({
    from: (table: string) => ({
      select: (cols: string) => {
        selects[table] = cols;
        return {
          order: () => ({
            range: async (from: number, to: number) => (failTable === table ? { data: null, error: { message: "boom", code: "XX000" } } : { data: (rows[table] ?? []).slice(from, to + 1), error: null }),
          }),
        };
      },
    }),
  }),
}));
// The real helper decides which private files are skipped: pass the caller's rule through to a fake file list.
vi.mock("@/lib/private-store", () => ({
  readAllJSON: async (_s: unknown, skip: (path: string) => boolean) => Object.fromEntries(Object.entries(privateFiles).filter(([k]) => !skip(k))),
}));

const run = async () => {
  const { GET } = await import("@/app/api/export/route");
  return GET();
};

beforeEach(() => {
  for (const t of TABLES) rows[t] = [];
  for (const k of Object.keys(privateFiles)) delete privateFiles[k];
  for (const k of Object.keys(selects)) delete selects[k];
  failTable = null;
});

describe("GET /api/export", () => {
  it("is a downloadable JSON file with every table and a version", async () => {
    rows.notes = [{ id: "n1" }];
    const res = await run();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/json");
    expect(res.headers.get("content-disposition")).toMatch(/^attachment; filename="second-brain-\d{4}-\d{2}-\d{2}\.json"$/);
    const body = JSON.parse(await res.text());
    expect(body.version).toBe(2);
    expect(new Date(body.exported_at).getTime()).not.toBeNaN();
    for (const t of TABLES) expect(Array.isArray(body[t]), t).toBe(true);
    expect(body.notes).toEqual([{ id: "n1" }]);
    expect(body.private).toEqual({});
  });

  it("reads past the database's 1000-row page limit (a big table is not cut short)", async () => {
    rows.messages = Array.from({ length: 3200 }, (_, i) => ({ id: `m${String(i).padStart(5, "0")}` }));
    rows.memories = Array.from({ length: 1000 }, (_, i) => ({ id: `x${i}` }));
    const body = JSON.parse(await (await run()).text());
    expect(body.messages).toHaveLength(3200);
    expect(body.messages.at(-1).id).toBe("m03199");
    // Exactly one full page: the next (empty) page ends it.
    expect(body.memories).toHaveLength(1000);
  });

  it("leaves embeddings out (they are rebuilt), asking only for the columns it needs", async () => {
    await run();
    for (const t of ["notes", "memories", "document_chunks"]) expect(selects[t], t).not.toMatch(/embedding/);
    expect(selects.notes).toMatch(/title, content/);
  });

  it("keeps the app's own state but never anything that works like a key", async () => {
    Object.assign(privateFiles, {
      habits: { items: [1] },
      pet: { name: "Nova" },
      "wrapped/2026-10": { ok: 1 },
      "plays/2026-11": [],
      "auth/sessions": [{ id: "secret" }],
      "auth/secrets": { session: "k" },
      "ratelimit/ring-abc": 1,
      "unlock-fails/abc/1-2": 1,
      "unlock-fails-all/1-2": 1,
      "web-tasks/t1": { steps: [] },
      "push-subscriptions.json": [{ endpoint: "https://push" }],
      "call-rooms.json": { rooms: [] },
      "device-locations.json": [{ lat: 1 }],
    });
    const body = JSON.parse(await (await run()).text());
    expect(Object.keys(body.private).sort()).toEqual(["habits", "pet", "plays/2026-11", "wrapped/2026-10"]);
    const text = JSON.stringify(body);
    for (const leak of ["secret", "https://push", "endpoint"]) expect(text, leak).not.toContain(leak);
  });

  it("a database failure is an error, never a quietly incomplete backup", async () => {
    failTable = "notes";
    const res = await run();
    expect(res.status).toBe(500);
    expect(res.headers.get("content-disposition")).toBeNull();
  });
});
