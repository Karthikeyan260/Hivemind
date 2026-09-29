import { NextResponse } from "next/server";
import { dbError, handle } from "@/lib/api";
import { db } from "@/lib/db";

export type GalaxyNode = {
  id: string;
  kind: "memory" | "note" | "document";
  title: string;
  project_id: string | null;
  weight: number;
  subtype: string | null;
  href: string;
};
export type GalaxyProject = { id: string; name: string; status: string; cluster: string | null };

/** Everything in the brain as lightweight nodes for the 3D galaxy. */
export const GET = handle(async () => {
  const supabase = db();
  const [mem, notes, docs, projects] = await Promise.all([
    supabase.from("memories").select("id, title, project_id, importance, memory_type").limit(1000),
    supabase.from("notes").select("id, title, project_id").limit(1000),
    supabase.from("documents").select("id, filename, project_id, chunk_count").eq("status", "ready").limit(500),
    supabase.from("projects").select("id, name, status, metadata").order("name"),
  ]);
  dbError(mem.error);
  dbError(notes.error);
  dbError(docs.error);
  dbError(projects.error);

  const nodes: GalaxyNode[] = [
    ...(mem.data ?? []).map((m) => ({
      id: m.id,
      kind: "memory" as const,
      title: m.title,
      project_id: m.project_id,
      weight: m.importance ?? 5,
      subtype: m.memory_type,
      href: `/memories?open=${m.id}`,
    })),
    ...(notes.data ?? []).map((n) => ({ id: n.id, kind: "note" as const, title: n.title, project_id: n.project_id, weight: 6, subtype: null, href: `/notes?open=${n.id}` })),
    ...(docs.data ?? []).map((d) => ({
      id: d.id,
      kind: "document" as const,
      title: d.filename,
      project_id: d.project_id,
      weight: Math.min(10, 5 + Math.log2(1 + (d.chunk_count ?? 1))),
      subtype: null,
      href: `/documents?open=${d.id}`,
    })),
  ];
  const projectList: GalaxyProject[] = (projects.data ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    status: p.status,
    cluster: (p.metadata as { cluster?: string | null })?.cluster ?? null,
  }));
  return NextResponse.json({ nodes, projects: projectList });
});
