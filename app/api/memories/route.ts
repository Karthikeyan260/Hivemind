import { NextResponse } from "next/server";
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

export const POST = handle(async (req: Request) => {
  const supabase = db();
  const input = await parseBody(req, MemoryInput);
  return NextResponse.json(await createMemory(supabase, input), { status: 201 });
});
