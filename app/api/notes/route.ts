import { NextResponse } from "next/server";
import { z } from "zod";
import { dbError, handle, HttpError, parseBody } from "@/lib/api";
import { db } from "@/lib/db";
import { createNote, NOTE_COLUMNS, NoteInput } from "@/lib/knowledge";

export const maxDuration = 30;

export const GET = handle(async (req: Request) => {
  const supabase = db();
  const projectId = new URL(req.url).searchParams.get("project");
  // A project is an id: anything else is a mistake in the request, not a database problem.
  if (projectId && !/^[0-9a-f-]{36}$/i.test(projectId)) throw new HttpError(400, "That isn't a project id.");
  let q = supabase.from("notes").select(NOTE_COLUMNS).order("updated_at", { ascending: false }).limit(200);
  if (projectId) q = q.eq("project_id", projectId);
  const { data, error } = await q;
  dbError(error);
  return NextResponse.json(data);
});

// A create sent from the offline outbox carries an id of its own: if the first try did reach us and only the reply was lost, the retry gets the same note back instead of making a second one.
const ClientId = z.string().regex(/^local-[0-9a-f-]{36}$/).optional();

export const POST = handle(async (req: Request) => {
  const supabase = db();
  const { client_id, ...input } = await parseBody(req, NoteInput.extend({ client_id: ClientId }));
  if (client_id) {
    const { data: dup } = await supabase.from("notes").select(NOTE_COLUMNS).eq("metadata->>client_id", client_id).limit(1);
    if (dup?.[0]) return NextResponse.json(dup[0], { status: 200 });
  }
  const note = await createNote(supabase, input);
  if (client_id) {
    const { data: cur } = await supabase.from("notes").select("metadata").eq("id", note.id).single();
    await supabase.from("notes").update({ metadata: { ...((cur?.metadata as object) ?? {}), client_id } }).eq("id", note.id);
  }
  return NextResponse.json(note, { status: 201 });
});
