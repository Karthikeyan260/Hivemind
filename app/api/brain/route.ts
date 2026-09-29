import { NextResponse } from "next/server";
import { z } from "zod";
import { undoActivity } from "@/lib/activity";
import { dbError, handle, parseBody } from "@/lib/api";
import { db } from "@/lib/db";
import { organizeEverything } from "@/lib/organizer";
import { getProfile, rebuildProfile } from "@/lib/profile";

export const maxDuration = 60;

/** Everything the HUD needs in one call: understanding, projects, activity, counts. */
export const GET = handle(async () => {
  const supabase = db();
  const count = (t: string) => supabase.from(t).select("id", { count: "exact", head: true });
  const [profile, projects, activity, notes, memories, documents, memByProject, notesByProject, docsByProject] = await Promise.all([
    getProfile(supabase),
    supabase.from("projects").select("id, name, description, status, metadata, updated_at").order("updated_at", { ascending: false }),
    supabase.from("activity").select("id, kind, message, payload, undone, created_at").order("created_at", { ascending: false }).limit(25),
    count("notes"),
    count("memories"),
    count("documents"),
    supabase.from("memories").select("project_id").not("project_id", "is", null),
    supabase.from("notes").select("project_id").not("project_id", "is", null),
    supabase.from("documents").select("project_id").not("project_id", "is", null),
  ]);
  dbError(projects.error);
  dbError(activity.error);

  const linked = new Map<string, number>();
  for (const r of [...(memByProject.data ?? []), ...(notesByProject.data ?? []), ...(docsByProject.data ?? [])]) {
    linked.set(r.project_id, (linked.get(r.project_id) ?? 0) + 1);
  }

  return NextResponse.json({
    profile,
    projects: (projects.data ?? []).map((p) => ({ ...p, items: linked.get(p.id) ?? 0 })),
    activity: (activity.data ?? []).map((a) => ({ ...a, undoable: !a.undone && ["project_created", "linked"].includes((a.payload as { type: string }).type) })),
    counts: { notes: notes.count ?? 0, memories: memories.count ?? 0, documents: documents.count ?? 0, projects: projects.data?.length ?? 0 },
  });
});

const Action = z.discriminatedUnion("action", [
  z.object({ action: z.literal("organize") }),
  z.object({ action: z.literal("rebuild-profile") }),
  z.object({ action: z.literal("undo"), id: z.uuid() }),
]);

export const POST = handle(async (req: Request) => {
  const supabase = db();
  const body = await parseBody(req, Action);
  if (body.action === "organize") return NextResponse.json(await organizeEverything(supabase));
  if (body.action === "rebuild-profile") return NextResponse.json({ profile: await rebuildProfile(supabase) });
  await undoActivity(supabase, body.id);
  return NextResponse.json({ ok: true });
});
