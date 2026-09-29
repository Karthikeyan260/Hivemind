import { NextResponse } from "next/server";
import { dbError, handle, parseBody } from "@/lib/api";
import { db } from "@/lib/db";
import { createNote, NOTE_COLUMNS, NoteInput } from "@/lib/knowledge";

export const maxDuration = 30;

export const GET = handle(async (req: Request) => {
  const supabase = db();
  const projectId = new URL(req.url).searchParams.get("project");
  let q = supabase.from("notes").select(NOTE_COLUMNS).order("updated_at", { ascending: false }).limit(200);
  if (projectId) q = q.eq("project_id", projectId);
  const { data, error } = await q;
  dbError(error);
  return NextResponse.json(data);
});

export const POST = handle(async (req: Request) => {
  const supabase = db();
  const input = await parseBody(req, NoteInput);
  return NextResponse.json(await createNote(supabase, input), { status: 201 });
});
