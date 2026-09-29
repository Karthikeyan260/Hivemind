import { NextResponse } from "next/server";
import { z } from "zod";
import { dbError, handle, parseBody, HttpError } from "@/lib/api";
import { db } from "@/lib/db";
import { updateMemory } from "@/lib/knowledge";

export const maxDuration = 30;
type Ctx = { params: Promise<{ id: string }> };

export const GET = handle(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  const supabase = db();
  const { data, error } = await supabase
    .from("memory_versions")
    .select("id, version_number, title, content, change_reason, created_at")
    .eq("memory_id", id)
    .order("version_number", { ascending: false });
  dbError(error);
  return NextResponse.json(data);
});

/** Restore: the current content becomes a new version, then the old version is applied. */
export const POST = handle(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const supabase = db();
  const { version_id } = await parseBody(req, z.object({ version_id: z.uuid() }));
  const { data: v, error } = await supabase
    .from("memory_versions")
    .select("version_number, title, content")
    .eq("id", version_id)
    .eq("memory_id", id)
    .maybeSingle();
  dbError(error);
  if (!v) throw new HttpError(404, "Version not found");
  const restored = await updateMemory(supabase, id, {
    title: v.title,
    content: v.content,
    change_reason: `restored version ${v.version_number}`,
  });
  return NextResponse.json(restored);
});
