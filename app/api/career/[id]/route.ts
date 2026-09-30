import { NextResponse } from "next/server";
import { dbError, handle, HttpError } from "@/lib/api";
import { CAREER_SOURCE } from "@/lib/career";
import { db } from "@/lib/db";
import { deleteMemory } from "@/lib/knowledge";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handle(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  const { data, error } = await db()
    .from("memories")
    .select("id, created_at, metadata")
    .eq("id", id)
    .eq("metadata->>source", CAREER_SOURCE)
    .maybeSingle();
  dbError(error);
  if (!data) throw new HttpError(404, "Analysis not found");
  const md = data.metadata as { analysis: unknown; job_description?: string; model?: string };
  return NextResponse.json({ id: data.id, created_at: data.created_at, analysis: md.analysis, jobDescription: md.job_description ?? "", model: md.model });
});

export const DELETE = handle(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  const supabase = db();
  const { data, error } = await supabase.from("memories").select("id").eq("id", id).eq("metadata->>source", CAREER_SOURCE).maybeSingle();
  dbError(error);
  if (!data) throw new HttpError(404, "Analysis not found");
  // Same as memories: kept in the activity log so it can be undone.
  await deleteMemory(supabase, id);
  return new NextResponse(null, { status: 204 });
});
