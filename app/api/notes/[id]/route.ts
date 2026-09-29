import { NextResponse } from "next/server";
import { embedOne } from "@/lib/ai/embeddings";
import { extractMetadata } from "@/lib/ai/metadata";
import { dbError, handle, parseBody, toVector, HttpError } from "@/lib/api";
import { db } from "@/lib/db";
import { NOTE_COLUMNS, NoteInput } from "@/lib/knowledge";

export const maxDuration = 30;
type Ctx = { params: Promise<{ id: string }> };

export const GET = handle(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  const supabase = db();
  const { data, error } = await supabase.from("notes").select(NOTE_COLUMNS).eq("id", id).maybeSingle();
  dbError(error);
  if (!data) throw new HttpError(404, "Note not found");
  return NextResponse.json(data);
});

export const PUT = handle(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const supabase = db();
  const input = await parseBody(req, NoteInput.partial());

  const { data: current, error: getErr } = await supabase
    .from("notes")
    .select("title, content")
    .eq("id", id)
    .maybeSingle();
  dbError(getErr);
  if (!current) throw new HttpError(404, "Note not found");

  const title = input.title || current.title;
  const content = input.content ?? current.content;
  const update: Record<string, unknown> = {
    title,
    content,
    updated_at: new Date().toISOString(),
  };
  if ("project_id" in input) update.project_id = input.project_id ?? null;
  if (input.tags) update.tags = input.tags;

  if (content !== current.content || title !== current.title) {
    const meta = await extractMetadata(content);
    update.summary = meta.summary;
    update.category = meta.category;
    if (!input.tags) update.tags = meta.tags;
    update.embedding = toVector(await embedOne(`${title}\n\n${content}`));
  }

  const { data, error } = await supabase.from("notes").update(update).eq("id", id).select(NOTE_COLUMNS).single();
  dbError(error);
  return NextResponse.json(data);
});

export const DELETE = handle(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  const supabase = db();
  const { error } = await supabase.from("notes").delete().eq("id", id);
  dbError(error);
  return new NextResponse(null, { status: 204 });
});
