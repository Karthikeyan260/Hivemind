import { NextResponse } from "next/server";
import { dbError, handle } from "@/lib/api";
import { db } from "@/lib/db";
import { readAllJSON } from "@/lib/private-store";

export const maxDuration = 60;

const PAGE = 1000;

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

  const out: Record<string, unknown> = { exported_at: new Date().toISOString(), version: 2 };
  // The tables are fetched side by side (each one page by page), and the private files with them.
  // The database returns at most 1000 rows per request, so a plain select quietly cuts a big table short
  // (the chat messages alone were over 3000): fetch page by page, in a fixed order, until a short page.
  const SECRET = /^(auth|ratelimit|unlock-fails|unlock-fails-all|web-tasks)(\/|$)/;
  const KEYS = new Set(["push-subscriptions.json", "call-rooms.json", "device-locations.json"]);
  const [rowsByTable, priv] = await Promise.all([
    Promise.all(
      Object.entries(tables).map(async ([table, cols]) => {
        const rows: unknown[] = [];
        for (let from = 0; ; from += PAGE) {
          const { data, error } = await supabase.from(table).select(cols).order("id").range(from, from + PAGE - 1);
          dbError(error);
          rows.push(...(data ?? []));
          if ((data?.length ?? 0) < PAGE) break;
        }
        return [table, rows] as const;
      }),
    ),
    // The app's own state kept outside the database tables (habits, pet, routines, briefs, check-ins, dreams, comics, game history…).
    // Left out: anything that works like a key (login secrets, push addresses, call room links), where the owner has been, and web task logs.
    readAllJSON(supabase, (path) => SECRET.test(path) || KEYS.has(path)),
  ]);
  for (const [table, rows] of rowsByTable) out[table] = rows;
  out.private = priv;
  out.version = 2;
  return new NextResponse(JSON.stringify(out, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="second-brain-${new Date().toISOString().slice(0, 10)}.json"`,
    },
  });
});
