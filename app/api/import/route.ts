import { NextResponse } from "next/server";
import { z } from "zod";
import { dbError, handle, parseBody } from "@/lib/api";
import { db } from "@/lib/db";
import { storeDocument } from "@/lib/documents/store";
import { importPortfolio, PORTFOLIO_SOURCE } from "@/lib/imports/portfolio";
import { fetchPageText } from "@/lib/imports/web";

export const maxDuration = 60;

const Body = z.discriminatedUnion("source", [
  z.object({ source: z.literal("portfolio") }),
  z.object({ source: z.literal("web"), url: z.url().max(2000), project_id: z.uuid().nullable().optional() }),
]);

/** Status of imported sources for the Sources page. */
export const GET = handle(async () => {
  const supabase = db();
  const [mem, docs] = await Promise.all([
    supabase.from("memories").select("metadata").eq("metadata->>source", PORTFOLIO_SOURCE).limit(1),
    supabase
      .from("documents")
      .select("id, filename, source_url, status, chunk_count, error, created_at")
      .not("source_url", "is", null)
      .order("created_at", { ascending: false }),
  ]);
  dbError(mem.error);
  dbError(docs.error);
  const { count } = await supabase
    .from("memories")
    .select("id", { count: "exact", head: true })
    .eq("metadata->>source", PORTFOLIO_SOURCE);
  return NextResponse.json({
    portfolio: {
      memories: count ?? 0,
      syncedAt: (mem.data?.[0]?.metadata as { synced_at?: string } | undefined)?.synced_at ?? null,
      via: (mem.data?.[0]?.metadata as { via?: string } | undefined)?.via ?? null,
      mcpConfigured: !!process.env.PORTFOLIO_MCP_URL,
    },
    pages: docs.data,
  });
});

export const POST = handle(async (req: Request) => {
  const body = await parseBody(req, Body);
  const supabase = db();
  if (body.source === "portfolio") {
    return NextResponse.json(await importPortfolio(supabase));
  }
  const page = await fetchPageText(body.url);
  const doc = await storeDocument(
    supabase,
    { filename: page.title, fileType: "web", sourceUrl: page.url, projectId: body.project_id },
    page.chunks,
  );
  return NextResponse.json(doc, { status: 201 });
});
