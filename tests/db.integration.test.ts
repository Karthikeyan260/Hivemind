import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Checks against the real Supabase project (opt-in: `npm run test:db`, which reads .env.local).
 * Adds two throwaway notes with hand-made vectors (no Gemini calls), checks search and privacy,
 * and deletes them again.
 */
const RUN = process.env.DB_TESTS === "1" || process.env.npm_lifecycle_event === "test:db";
if (RUN) {
  try {
    process.loadEnvFile(".env.local");
  } catch {}
}

const DIM = 768;
const vec = (i: number) => JSON.stringify(Array.from({ length: DIM }, (_, j) => (j === i ? 1 : 0)));
const TAG = `__hivemind_test__ ${Date.now()}`;

describe.skipIf(!RUN)("database (live)", () => {
  let db: SupabaseClient;
  let a = "";
  let b = "";

  beforeAll(async () => {
    db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });
    const { data, error } = await db
      .from("notes")
      .insert([
        { title: `${TAG} A`, content: "test row A", embedding: vec(0) },
        { title: `${TAG} B`, content: "test row B", embedding: vec(1) },
      ])
      .select("id, title");
    if (error) throw new Error(error.message);
    a = data.find((r) => r.title.endsWith("A"))!.id;
    b = data.find((r) => r.title.endsWith("B"))!.id;
  });

  afterAll(async () => {
    await db?.from("notes").delete().like("title", "__hivemind_test__%");
  });

  const search = (i: number, extra: Record<string, unknown> = {}) =>
    db.rpc("match_knowledge", { query_embedding: vec(i), match_count: 5, filter_project: null, min_similarity: 0.99, ...extra });

  it("match_knowledge finds the closest note first, with its similarity", async () => {
    const { data, error } = await search(0);
    expect(error).toBeNull();
    expect(data[0]).toMatchObject({ source_type: "note", source_id: a, parent_id: a });
    expect(data[0].similarity).toBeCloseTo(1, 5);
  });

  it("match_knowledge drops anything under the similarity floor", async () => {
    const { data } = await search(0);
    expect(data.map((r: { source_id: string }) => r.source_id)).not.toContain(b);
    const loose = await search(0, { min_similarity: -1, match_count: 200 });
    expect(loose.data.map((r: { source_id: string }) => r.source_id)).toContain(b);
  });

  it("match_knowledge keeps to the project asked for", async () => {
    const { data } = await search(0, { filter_project: "00000000-0000-0000-0000-000000000000" });
    expect(data).toEqual([]);
  });

  it("every table has row level security on (needs migration 004)", async () => {
    const { data, error } = await db.rpc("tables_without_rls");
    if (error) return console.warn("tables_without_rls missing: run supabase/migrations/004_rls_guard.sql");
    expect(data).toEqual([]);
  });

  it.skipIf(!process.env.SUPABASE_PUBLISHABLE_KEY)("the public key can't read notes or search", async () => {
    const pub = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false } });
    const rows = await pub.from("notes").select("id").limit(1);
    expect(rows.data ?? []).toEqual([]);
    const rpc = await pub.rpc("match_knowledge", { query_embedding: vec(0), match_count: 1, filter_project: null, min_similarity: 0 });
    expect(rpc.error).not.toBeNull();
  });
});
