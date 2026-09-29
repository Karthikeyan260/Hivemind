import { NextResponse } from "next/server";
import { dbError, handle, HttpError } from "@/lib/api";
import { db } from "@/lib/db";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handle(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  const supabase = db();
  const { data: doc, error } = await supabase
    .from("documents")
    .select("id, filename, file_type, status, summary, chunk_count, error, created_at")
    .eq("id", id)
    .maybeSingle();
  dbError(error);
  if (!doc) throw new HttpError(404, "Document not found");
  const { data: chunks, error: cErr } = await supabase
    .from("document_chunks")
    .select("chunk_index, content, metadata")
    .eq("document_id", id)
    .order("chunk_index");
  dbError(cErr);
  return NextResponse.json({ ...doc, chunks });
});

export const DELETE = handle(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  const supabase = db();
  const { error } = await supabase.from("documents").delete().eq("id", id);
  dbError(error);
  return new NextResponse(null, { status: 204 });
});
