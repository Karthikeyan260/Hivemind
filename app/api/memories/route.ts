import { NextResponse } from "next/server";
import { z } from "zod";
import { dbError, handle, parseBody } from "@/lib/api";
import { db } from "@/lib/db";
import { createMemory, MEMORY_COLUMNS, MemoryInput } from "@/lib/knowledge";

export const maxDuration = 30;

export const GET = handle(async (req: Request) => {
  const supabase = db();
  const params = new URL(req.url).searchParams;
  let q = supabase.from("memories").select(MEMORY_COLUMNS).order("updated_at", { ascending: false }).limit(200);
  const type = params.get("type");
  const project = params.get("project");
  if (type) q = q.eq("memory_type", type);
  if (project) q = q.eq("project_id", project);
  const { data, error } = await q;
  dbError(error);
  return NextResponse.json(data);
});

// A create sent from the offline outbox carries an id of its own: if the first try did reach us and only the reply was lost, the retry gets the same memory back instead of making a second one.
const ClientId = z.string().regex(/^local-[0-9a-f-]{36}$/).optional();

export const POST = handle(async (req: Request) => {
  const supabase = db();
  const { client_id, ...input } = await parseBody(req, MemoryInput.extend({ client_id: ClientId }));
  if (client_id) {
    const { data: dup } = await supabase.from("memories").select(MEMORY_COLUMNS).eq("metadata->>client_id", client_id).limit(1);
    if (dup?.[0]) return NextResponse.json(dup[0], { status: 200 });
  }
  const memory = await createMemory(supabase, input);
  if (client_id && memory) {
    const { data: cur } = await supabase.from("memories").select("metadata").eq("id", memory.id).single();
    await supabase.from("memories").update({ metadata: { ...((cur?.metadata as object) ?? {}), client_id } }).eq("id", memory.id);
  }
  return NextResponse.json(memory, { status: 201 });
});
