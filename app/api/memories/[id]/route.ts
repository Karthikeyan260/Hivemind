import { NextResponse } from "next/server";
import { dbError, handle, parseBody, HttpError } from "@/lib/api";
import { db } from "@/lib/db";
import { MEMORY_COLUMNS, MemoryUpdate, updateMemory } from "@/lib/knowledge";

export const maxDuration = 30;
type Ctx = { params: Promise<{ id: string }> };

export const GET = handle(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  const supabase = db();
  const { data, error } = await supabase.from("memories").select(MEMORY_COLUMNS).eq("id", id).maybeSingle();
  dbError(error);
  if (!data) throw new HttpError(404, "Memory not found");
  return NextResponse.json(data);
});

export const PUT = handle(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const supabase = db();
  const patch = await parseBody(req, MemoryUpdate);
  return NextResponse.json(await updateMemory(supabase, id, patch));
});

export const DELETE = handle(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  const supabase = db();
  const { error } = await supabase.from("memories").delete().eq("id", id);
  dbError(error);
  return new NextResponse(null, { status: 204 });
});
