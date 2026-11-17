import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

/**
 * Runs the real scripts/restore-backup.mjs against a tiny fake Supabase (REST + storage) on localhost, so what it does
 * is checked without ever touching a real database.
 */
const SCRIPT = join(process.cwd(), "scripts", "restore-backup.mjs");
const TABLES = ["projects", "notes", "memories", "memory_versions", "documents", "document_chunks", "conversations", "messages"];

type Row = { id: string; [k: string]: unknown };
const db: Record<string, Row[]> = {};
const storage = new Map<string, string>();
const calls: string[] = [];
let failUpsertFor: string | null = null;

let server: http.Server;
let base = "";
let dir = "";

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "restore-test-"));
  server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      const json = (status: number, v: unknown) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(v));
      };
      const rest = /^\/rest\/v1\/(\w+)$/.exec(url.pathname);
      if (rest) {
        const table = rest[1];
        db[table] ??= [];
        if (req.method === "GET") {
          const offset = Number(url.searchParams.get("offset") ?? 0);
          const limit = Number(url.searchParams.get("limit") ?? 1000);
          return json(200, db[table].slice(offset, offset + limit).map((r) => ({ id: r.id })));
        }
        if (req.method === "POST") {
          calls.push(`upsert ${table} ${req.headers.prefer ?? ""}`);
          if (failUpsertFor === table) return json(400, { message: "constraint violated", code: "23503" });
          const ignore = /ignore-duplicates/.test(String(req.headers.prefer));
          for (const r of JSON.parse(body) as Row[]) {
            const i = db[table].findIndex((x) => x.id === r.id);
            if (i < 0) db[table].push(r);
            else if (!ignore) db[table][i] = r;
          }
          res.writeHead(201);
          return res.end();
        }
      }
      const obj = /^\/storage\/v1\/object\/(?:authenticated\/|public\/)?hivemind-private\/(.+)$/.exec(url.pathname);
      if (obj) {
        const key = decodeURIComponent(obj[1]);
        if (req.method === "GET") {
          if (!storage.has(key)) return json(404, { statusCode: "404", error: "not_found", message: "Object not found" });
          res.writeHead(200, { "content-type": "application/json" });
          return res.end(storage.get(key));
        }
        if (req.method === "POST" || req.method === "PUT") {
          calls.push(`file ${key}`);
          // supabase-js sends the Blob as multipart form data: keep the JSON inside it.
          // (The form also carries a cache-control field: the file is the part with a filename.)
          const part = body.split(/\r\n--/).find((p) => /filename=/.test(p));
          const m = part ? /\r\n\r\n([\s\S]*)$/.exec(part) : null;
          storage.set(key, m ? m[1].replace(/\r\n$/, "") : body);
          return json(200, { Key: key });
        }
      }
      return json(404, { message: `unhandled ${req.method} ${url.pathname}` });
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(() => void server?.close());

beforeEach(() => {
  for (const t of TABLES) db[t] = [];
  storage.clear();
  calls.length = 0;
  failUpsertFor = null;
});

function backup(extra: Record<string, unknown> = {}, name = "backup.json") {
  const file = join(dir, name);
  writeFileSync(
    file,
    JSON.stringify({
      exported_at: "2026-11-01T00:00:00Z",
      version: 2,
      projects: [{ id: "p1", name: "Backup project" }],
      notes: [{ id: "n1", title: "from backup" }, { id: "n2", title: "from backup 2" }],
      memories: [{ id: "m1", title: "mem" }],
      private: { habits: { items: ["backup habit"] }, "auth/sessions": [{ id: "secret" }], "push-subscriptions": [{ endpoint: "x" }], pet: null },
      ...extra,
    }),
  );
  return file;
}

function run(args: string[], env: Record<string, string | undefined> = {}) {
  return new Promise<{ code: number | null; out: string }>((resolve) => {
    const child = spawn(process.execPath, [SCRIPT, ...args], { env: { ...process.env, SUPABASE_URL: base, SUPABASE_SECRET_KEY: "sb_secret_test", ...env } as NodeJS.ProcessEnv, cwd: dir });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("close", (code) => resolve({ code, out }));
  });
}

describe("scripts/restore-backup.mjs", () => {
  it("a dry run reports what would be restored and writes nothing", async () => {
    const r = await run([backup()]);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/dry run \(nothing is written\)/);
    expect(r.out).toMatch(/notes\s+in backup\s+2 \| already there\s+0 \| missing\s+2/);
    expect(r.out).toMatch(/Nothing was written/);
    expect(calls).toEqual([]);
    expect(db.notes).toHaveLength(0);
    expect(storage.size).toBe(0);
  });

  it("--apply puts back only what is missing and never replaces what is there", async () => {
    db.notes = [{ id: "n1", title: "KEPT, newer than the backup" }];
    const r = await run([backup(), "--apply"]);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/APPLY, only what is missing/);
    expect(db.notes.map((n) => n.id).sort()).toEqual(["n1", "n2"]);
    expect(db.notes.find((n) => n.id === "n1")?.title).toBe("KEPT, newer than the backup");
    expect(db.projects).toHaveLength(1);
    expect(db.memories).toHaveLength(1);
    expect(calls.filter((c) => c.startsWith("upsert")).every((c) => /ignore-duplicates/.test(c))).toBe(true);
    expect(r.out).toMatch(/Done\./);
  });

  it("--apply --overwrite also replaces rows that exist with the file's copy", async () => {
    db.notes = [{ id: "n1", title: "old" }];
    const r = await run([backup(), "--apply", "--overwrite"]);
    expect(r.code).toBe(0);
    expect(db.notes.find((n) => n.id === "n1")?.title).toBe("from backup");
  });

  it("restores the app's own state files but never secrets, push addresses or empty entries", async () => {
    const r = await run([backup(), "--apply"]);
    expect(r.code).toBe(0);
    expect([...storage.keys()].sort()).toEqual(["habits.json"]);
    expect(JSON.parse(storage.get("habits.json")!)).toEqual({ items: ["backup habit"] });
    expect(r.out).toMatch(/skipped \(secrets or empty\) 3/);
    // A private file that already exists is left alone unless --overwrite.
    storage.set("habits.json", JSON.stringify({ items: ["current"] }));
    calls.length = 0;
    await run([backup(), "--apply"]);
    expect(JSON.parse(storage.get("habits.json")!)).toEqual({ items: ["current"] });
    await run([backup(), "--apply", "--overwrite"]);
    expect(JSON.parse(storage.get("habits.json")!)).toEqual({ items: ["backup habit"] });
  });

  it("restores parents before children, so foreign keys exist", async () => {
    await run([backup(), "--apply"]);
    const order = calls.filter((c) => c.startsWith("upsert")).map((c) => c.split(" ")[1]);
    expect(order).toEqual(["projects", "notes", "memories"]);
  });

  it("reports a failed batch and exits with code 2", async () => {
    failUpsertFor = "notes";
    const r = await run([backup(), "--apply"]);
    expect(r.code).toBe(2);
    expect(r.out).toMatch(/notes: batch 1 failed/);
    expect(r.out).toMatch(/problem\(s\)/);
    // The other tables were still restored.
    expect(db.projects).toHaveLength(1);
  });

  it("refuses a file that is not an export, a missing file, missing credentials, and no arguments", async () => {
    const notExport = join(dir, "other.json");
    writeFileSync(notExport, JSON.stringify({ hello: "world" }));
    const a = await run([notExport, "--apply"]);
    expect(a.code).toBe(1);
    expect(a.out).toMatch(/doesn't look like an export file/);

    const b = await run([join(dir, "does-not-exist.json")]);
    expect(b.code).toBe(1);
    expect(b.out).toMatch(/no such file/);
    const damaged = join(dir, "damaged.json");
    writeFileSync(damaged, '{"exported_at": "2026-11-01", "notes": [{"id": "n1"');
    const e = await run([damaged, "--apply"]);
    expect(e.code).toBe(1);
    expect(e.out).toMatch(/not valid JSON/);

    const c = await run([backup()], { SUPABASE_URL: "", SUPABASE_SECRET_KEY: "" });
    expect(c.code).toBe(1);
    expect(c.out).toMatch(/not found/);

    const d = await run([]);
    expect(d.code).toBe(1);
    expect(d.out).toMatch(/Usage/);
    expect(db.notes).toHaveLength(0);
  });

  it("a backup with a table missing still restores the rest", async () => {
    const r = await run([backup({ notes: undefined, memories: "not an array" }), "--apply"]);
    expect(r.code).toBe(0);
    expect(db.projects).toHaveLength(1);
    expect(db.notes).toHaveLength(0);
    expect(db.memories).toHaveLength(0);
  });

  it("rows without an id are skipped, not written", async () => {
    await run([backup({ notes: [{ title: "no id" }, { id: "n9", title: "ok" }] }), "--apply"]);
    expect(db.notes.map((n) => n.id)).toEqual(["n9"]);
  });
});
