import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { embedMany } from "@/lib/ai/embeddings";
import { extractMetadata } from "@/lib/ai/metadata";
import { dbError, HttpError, toVector } from "@/lib/api";
import type { ParsedChunk } from "./parse";

export const DOC_COLUMNS = "id, project_id, filename, file_type, source_url, status, summary, chunk_count, error, created_at";
const MAX_CHUNKS = 400;

/**
 * Creates a document row, embeds its chunks and stores them. When sourceUrl is given,
 * any earlier import of the same source is replaced so re-syncing never duplicates.
 */
export async function storeDocument(
  supabase: SupabaseClient,
  doc: { filename: string; fileType: string; projectId?: string | null; sourceUrl?: string | null },
  chunks: ParsedChunk[],
) {
  if (chunks.length === 0) throw new HttpError(422, "No readable text found (scanned PDFs are not supported)");
  if (chunks.length > MAX_CHUNKS) throw new HttpError(413, `Too long (${chunks.length} chunks, max ${MAX_CHUNKS})`);

  const { data: row, error } = await supabase
    .from("documents")
    .insert({
      filename: doc.filename.slice(0, 200),
      file_type: doc.fileType,
      project_id: doc.projectId ?? null,
      source_url: doc.sourceUrl ?? null,
    })
    .select("id")
    .single();
  dbError(error);
  const id = row!.id as string;

  try {
    const [meta, embeddings] = await Promise.all([
      extractMetadata(chunks.slice(0, 8).map((c) => c.content).join("\n\n")),
      embedMany(chunks.map((c) => `${doc.filename}\n\n${c.content}`)),
    ]);
    const rows = chunks.map((c, i) => ({
      document_id: id,
      chunk_index: i,
      content: c.content,
      metadata: c.metadata,
      embedding: toVector(embeddings[i]),
    }));
    for (let i = 0; i < rows.length; i += 100) {
      const { error: insErr } = await supabase.from("document_chunks").insert(rows.slice(i, i + 100));
      dbError(insErr);
    }
    const { data: ready, error: updErr } = await supabase
      .from("documents")
      .update({ status: "ready", summary: meta.summary, chunk_count: rows.length })
      .eq("id", id)
      .select(DOC_COLUMNS)
      .single();
    dbError(updErr);

    if (doc.sourceUrl) {
      await supabase.from("documents").delete().eq("source_url", doc.sourceUrl).neq("id", id);
    }
    return ready;
  } catch (err) {
    const message = err instanceof HttpError ? err.message : "Processing failed";
    await supabase.from("document_chunks").delete().eq("document_id", id);
    await supabase.from("documents").update({ status: "failed", error: message }).eq("id", id);
    throw err;
  }
}
