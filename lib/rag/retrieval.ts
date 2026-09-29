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

export async function searchKnowledge(
  supabase: SupabaseClient,
  query: string,
  opts: { limit?: number; projectId?: string | null; minSimilarity?: number } = {},
): Promise<RetrievedItem[]> {
  const embedding = await embedQuery(query);
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
