import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { embedQuery } from "@/lib/ai/embeddings";
import { dbError, toVector } from "@/lib/api";

export type SourceType = "note" | "memory" | "document";

export type RetrievedItem = {
  source_type: SourceType;
  source_id: string;
  parent_id: string;
  title: string;
  content: string;
  similarity: number;
  created_at: string;
};

/**
 * Fallback when embeddings are unavailable: notes and memories whose title or text contain the
 * query's words (any script, Tamil included), ranked by how many of the words they contain.
 */
async function wordSearch(supabase: SupabaseClient, query: string, limit: number, projectId: string | null): Promise<RetrievedItem[]> {
  const words = [...new Set(query.toLowerCase().split(/[^\p{L}\p{M}\p{N}]+/u).filter((w) => w.length >= 3))].slice(0, 5);
  if (!words.length) return [];
  const or = words.flatMap((w) => [`title.ilike.%${w}%`, `content.ilike.%${w}%`]).join(",");
  const rows: RetrievedItem[] = [];
  for (const [table, type] of [
    ["notes", "note"],
    ["memories", "memory"],
  ] as const) {
    let q = supabase.from(table).select("id, title, content, created_at").or(or).limit(limit * 2);
    if (projectId) q = q.eq("project_id", projectId);
    const { data } = await q;
    for (const r of (data ?? []) as { id: string; title: string; content: string; created_at: string }[]) {
      const hay = `${r.title} ${r.content}`.toLowerCase();
      const hits = words.filter((w) => hay.includes(w)).length;
      rows.push({ source_type: type, source_id: r.id, parent_id: r.id, title: r.title, content: r.content.slice(0, 2000), similarity: hits / words.length, created_at: r.created_at });
    }
  }
  return rows.sort((a, b) => b.similarity - a.similarity).slice(0, limit);
}

export async function searchKnowledge(
  supabase: SupabaseClient,
  query: string,
  opts: { limit?: number; projectId?: string | null; minSimilarity?: number } = {},
): Promise<RetrievedItem[]> {
  let embedding: number[];
  try {
    embedding = await embedQuery(query);
  } catch (err) {
    // The embedding model is down (quota / outage): plain word search, so answers still find things.
    console.warn("search: embeddings unavailable, using word search:", err instanceof Error ? err.message.slice(0, 100) : err);
    return wordSearch(supabase, query, opts.limit ?? 8, opts.projectId ?? null);
  }
  const { data, error } = await supabase.rpc("match_knowledge", {
    query_embedding: toVector(embedding),
    match_count: opts.limit ?? 8,
    filter_project: opts.projectId ?? null,
    min_similarity: opts.minSimilarity ?? 0.35,
  });
  dbError(error);
  return (data ?? []) as RetrievedItem[];
}

export function sourceHref(item: Pick<RetrievedItem, "source_type" | "parent_id">) {
  if (item.source_type === "note") return `/notes?open=${item.parent_id}`;
  if (item.source_type === "memory") return `/memories?open=${item.parent_id}`;
  return `/documents?open=${item.parent_id}`;
}
