import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { CONFIGURED_MODEL, EMBED_DIM, embedMany, forgetMarker, getMarker, MARKER_KEY, type EmbedMarker } from "@/lib/ai/embeddings";
import { toVector } from "@/lib/api";
import { readJSON, writeJSON } from "@/lib/private-store";

/**
 * Re-embedding everything, for moving to another embedding model (or rebuilding the vectors).
 * It runs in steps of under a minute (from Settings, and from the cron if a step was left
 * unfinished), remembering where it got to, so any size of brain gets through on serverless.
 * While it runs, new rows already use the new model; when every row is done the database is marked
 * as holding the new model and searches switch to it.
 */
type Table = "notes" | "memories" | "document_chunks";
const TABLES: Table[] = ["notes", "memories", "document_chunks"];
const PAGE = 50;
const JOB_KEY = "embedding-migration";

export type MigrationJob = {
  target: string;
  started: string;
  table: number;
  /** The last id done in the current table (rows go in id order). */
  after: string | null;
  done: number;
  total: number;
  error?: string;
  /** Why the last step stopped early (it carries on next time). */
  note?: string;
  finished?: string;
};

const text = (t: Table, r: Row) => (t === "document_chunks" ? `${r.documents?.filename ?? ""}\n\n${r.content}` : `${r.title}\n\n${r.content}`);
type Row = { id: string; title?: string; content: string; documents?: { filename: string } | null };

async function counts(supabase: SupabaseClient) {
  const out: Record<Table, { rows: number; missing: number }> = { notes: { rows: 0, missing: 0 }, memories: { rows: 0, missing: 0 }, document_chunks: { rows: 0, missing: 0 } };
  await Promise.all(
    TABLES.map(async (t) => {
      const [all, miss] = await Promise.all([
        supabase.from(t).select("id", { count: "exact", head: true }),
        supabase.from(t).select("id", { count: "exact", head: true }).is("embedding", null),
      ]);
      out[t] = { rows: all.count ?? 0, missing: miss.count ?? 0 };
    }),
  );
  return out;
}

export async function embeddingStatus(supabase: SupabaseClient) {
  const [marker, job, tables] = await Promise.all([getMarker(), readJSON<MigrationJob | null>(supabase, JOB_KEY, null), counts(supabase)]);
  return { model: marker.model, configured: CONFIGURED_MODEL, dim: EMBED_DIM, running: !!marker.target, job, tables };
}

/** Starts moving every vector to `target` (default: the configured model). */
export async function startMigration(supabase: SupabaseClient, target = CONFIGURED_MODEL) {
  target = target.trim();
  if (!/^[\w.\-/]{3,80}$/.test(target)) throw new Error("That isn't a model name.");
  // Fail now, not halfway: the model must exist and give vectors of the database's size.
  await embedMany(["test"], "RETRIEVAL_DOCUMENT", target);
  const tables = await counts(supabase);
  const job: MigrationJob = { target, started: new Date().toISOString(), table: 0, after: null, done: 0, total: TABLES.reduce((n, t) => n + tables[t].rows, 0) };
  const marker = await getMarker();
  await writeJSON(supabase, JOB_KEY, job);
  await writeJSON(supabase, MARKER_KEY, { ...marker, target, since: job.started } satisfies EmbedMarker);
  forgetMarker();
  return job;
}

export async function cancelMigration(supabase: SupabaseClient) {
  const marker = await getMarker();
  // Rows already moved are in the new model's space: searches would miss them. Keep the old model
  // as the truth and let those rows be redone by the next run (or re-embed with the old model).
  await writeJSON(supabase, MARKER_KEY, { model: marker.model, dim: marker.dim } satisfies EmbedMarker);
  forgetMarker();
  const job = await readJSON<MigrationJob | null>(supabase, JOB_KEY, null);
  if (job && !job.finished) await writeJSON(supabase, JOB_KEY, { ...job, error: "Cancelled. Some rows use the new model: run it again to finish." });
}

/** Works through rows for up to `budgetMs`. Returns the job (finished when every table is done). */
export async function migrationStep(supabase: SupabaseClient, budgetMs = 40_000): Promise<MigrationJob | null> {
  const job = await readJSON<MigrationJob | null>(supabase, JOB_KEY, null);
  if (!job || job.finished || job.error) return job;
  const end = Date.now() + budgetMs;
  try {
    while (job.table < TABLES.length && Date.now() < end) {
      const t = TABLES[job.table];
      let q = supabase
        .from(t)
        .select(t === "document_chunks" ? "id, content, documents(filename)" : "id, title, content")
        .order("id")
        .limit(PAGE);
      if (job.after) q = q.gt("id", job.after);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as unknown as Row[];
      if (!rows.length) {
        job.table++;
        job.after = null;
        continue;
      }
      const vectors = await embedMany(
        rows.map((r) => text(t, r)),
        "RETRIEVAL_DOCUMENT",
        job.target,
      );
      // One update per row (each has its own vector), 10 at a time.
      for (let i = 0; i < rows.length; i += 10) {
        const results = await Promise.all(rows.slice(i, i + 10).map((r, k) => supabase.from(t).update({ embedding: toVector(vectors[i + k]) }).eq("id", r.id)));
        const failed = results.find((x) => x.error);
        if (failed?.error) throw new Error(failed.error.message);
      }
      job.after = rows[rows.length - 1].id;
      job.done += rows.length;
      job.note = undefined;
      // A short page was the table's last.
      if (rows.length < PAGE) {
        job.table++;
        job.after = null;
      }
      await writeJSON(supabase, JOB_KEY, job);
    }
    if (job.table >= TABLES.length) {
      job.finished = new Date().toISOString();
      await writeJSON(supabase, MARKER_KEY, { model: job.target, dim: EMBED_DIM } satisfies EmbedMarker);
      forgetMarker();
    }
  } catch (e) {
    // Usually the free-tier quota: the next step carries on from the last saved page.
    job.note = e instanceof Error ? e.message.slice(0, 160) : String(e);
    console.warn("re-embed:", job.note);
    if (Date.now() - +new Date(job.started) > 3 * 24 * 3600_000) job.error = `Stopped after 3 days: ${e instanceof Error ? e.message.slice(0, 160) : e}`;
  }
  await writeJSON(supabase, JOB_KEY, job);
  return job;
}
