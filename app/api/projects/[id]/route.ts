import { NextResponse } from "next/server";
import { z } from "zod";
import { dbError, handle, HttpError, parseBody } from "@/lib/api";
import { db } from "@/lib/db";

type Ctx = { params: Promise<{ id: string }> };
const COLUMNS = "id, name, description, status, metadata, created_at, updated_at";

/** Project with everything filed under it. */
export const GET = handle(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  const supabase = db();
  const [project, memories, notes, documents] = await Promise.all([
    supabase.from("projects").select(COLUMNS).eq("id", id).maybeSingle(),
    supabase.from("memories").select("id, title, content, memory_type, updated_at").eq("project_id", id).order("updated_at", { ascending: false }),
    supabase.from("notes").select("id, title, summary, updated_at").eq("project_id", id).order("updated_at", { ascending: false }),
    supabase.from("documents").select("id, filename, summary, chunk_count, created_at").eq("project_id", id).order("created_at", { ascending: false }),
  ]);
  dbError(project.error);
  if (!project.data) throw new HttpError(404, "Project not found");
  return NextResponse.json({ ...project.data, memories: memories.data ?? [], notes: notes.data ?? [], documents: documents.data ?? [] });
});

export const PUT = handle(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const input = await parseBody(
    req,
    z.object({
      name: z.string().trim().min(1).max(120).optional(),
      description: z.string().trim().max(2000).optional(),
      status: z.enum(["active", "paused", "done"]).optional(),
    }),
  );
  const { data, error } = await db()
    .from("projects")
    .update({ ...input, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select(COLUMNS)
    .single();
  dbError(error);
  return NextResponse.json(data);
});

export const DELETE = handle(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  const { error } = await db().from("projects").delete().eq("id", id);
  dbError(error);
  return new NextResponse(null, { status: 204 });
});
