import { NextResponse } from "next/server";
import { dbError, handle } from "@/lib/api";
import { db } from "@/lib/db";

export const maxDuration = 30;

/** "Export Brain": everything except embeddings (those can be regenerated). */
export const GET = handle(async () => {
  const supabase = db();
  const tables = {
    projects: "*",
    notes: "id, project_id, title, content, summary, category, tags, metadata, created_at, updated_at",
    memories:
      "id, project_id, title, content, memory_type, category, importance, confidence, tags, metadata, created_at, updated_at",
    memory_versions: "*",
    documents: "*",
    document_chunks: "id, document_id, chunk_index, content, metadata, created_at",
    conversations: "*",
    messages: "*",
  } as const;

  const out: Record<string, unknown> = { exported_at: new Date().toISOString(), version: 1 };
  for (const [table, cols] of Object.entries(tables)) {
    const { data, error } = await supabase.from(table).select(cols);
    dbError(error);
    out[table] = data;
  }
  return new NextResponse(JSON.stringify(out, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="second-brain-${new Date().toISOString().slice(0, 10)}.json"`,
    },
  });
});
