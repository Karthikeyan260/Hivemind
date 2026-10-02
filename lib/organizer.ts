import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { logActivity } from "@/lib/activity";
import { dbError } from "@/lib/api";
import { generateWithFallback, parseJson } from "@/lib/ai/providers";

type Table = "notes" | "memories" | "documents";
type Item = { table: Table; id: string; title: string; content: string };
type Project = { id: string; name: string; description: string | null };

const RULES = `You file items in a personal knowledge base into projects.
- Use an EXISTING project name (exact spelling) when the item is clearly about it.
- Use a NEW project name only when the item is clearly about a specific named piece of work
  (an app, product, research, client engagement, side project) that has no existing project.
- Use null for anything general: skills, certifications, contact details, education, personal facts,
  generic learnings, pages that cover many projects.
Respond in JSON only.`;

export async function listProjects(supabase: SupabaseClient): Promise<Project[]> {
  const { data, error } = await supabase.from("projects").select("id, name, description").order("name");
  dbError(error);
  return data ?? [];
}

async function findOrCreateProject(supabase: SupabaseClient, projects: Project[], name: string, reason: string) {
  const existing = projects.find((p) => p.name.toLowerCase() === name.toLowerCase());
  if (existing) return { project: existing, created: false };
  const { data, error } = await supabase
    .from("projects")
    .insert({ name: name.slice(0, 120), metadata: { auto: true, reason } })
    .select("id, name, description")
    .single();
  if (error) {
    // Unique-name race or duplicate: re-read instead of failing the save.
    const { data: again } = await supabase.from("projects").select("id, name, description").ilike("name", name).maybeSingle();
    if (again) return { project: again as Project, created: false };
    dbError(error);
  }
  projects.push(data!);
  await logActivity(supabase, "project_created", `Created project “${data!.name}” (${reason})`, {
    type: "project_created",
    project_id: data!.id,
  });
  return { project: data as Project, created: true };
}

async function link(supabase: SupabaseClient, item: Item, project: Project) {
  const { data: prev } = await supabase.from(item.table).select("project_id").eq("id", item.id).maybeSingle();
  if (prev?.project_id === project.id) return;
  const { error } = await supabase.from(item.table).update({ project_id: project.id }).eq("id", item.id);
  dbError(error);
  await logActivity(supabase, "linked", `Filed “${item.title.slice(0, 60)}” under ${project.name}`, {
    type: "linked",
    table: item.table,
    id: item.id,
    prev_project_id: prev?.project_id ?? null,
  });
}

const Assign = z.object({
  assignments: z.array(z.object({ i: z.coerce.number().int(), project: z.string().min(1).max(120).nullable() })).default([]),
});

/** Files a batch of items into projects with one LLM call. Never throws: organizing is best-effort. */
export async function organizeItems(supabase: SupabaseClient, items: Item[]) {
  const result = { filed: 0, created: 0 };
  if (items.length === 0) return result;
  try {
    const projects = await listProjects(supabase);
    const prompt = `Existing projects:\n${projects.map((p) => `- ${p.name}${p.description ? `: ${p.description.slice(0, 120)}` : ""}`).join("\n") || "(none)"}

Items:
${items.map((it, i) => `[${i}] (${it.table}) ${it.title}\n${it.content.slice(0, 600)}`).join("\n\n")}

Return JSON {"assignments":[{"i":0,"project":"Name" or null}, ...]} with one entry per item.`;
    const res = await generateWithFallback([{ role: "user", content: prompt }], {
      system: RULES,
      json: true,
      temperature: 0,
      maxTokens: 1500,
      order: ["groq", "openrouter", "gemini", "nvidia"],
    });
    const parsed = parseJson(res.text, Assign);
    if (!parsed) return result;

    for (const a of parsed.assignments) {
      const item = items[a.i];
      if (!item || !a.project) continue;
      const { project, created } = await findOrCreateProject(supabase, projects, a.project.trim(), `from “${item.title.slice(0, 40)}”`);
      if (created) result.created++;
      await link(supabase, item, project);
      result.filed++;
    }
  } catch (err) {
    console.warn("organizer failed:", err instanceof Error ? err.message : err);
  }
  return result;
}

export const organizeItem = (supabase: SupabaseClient, item: Item) => organizeItems(supabase, [item]);

/** Files everything that has no project yet, in batches. */
export async function organizeEverything(supabase: SupabaseClient) {
  const total = { filed: 0, created: 0, scanned: 0 };
  const [notes, memories, docs] = await Promise.all([
    supabase.from("notes").select("id, title, content").is("project_id", null).limit(200),
    supabase
      .from("memories")
      .select("id, title, content, memory_type")
      .is("project_id", null)
      .in("memory_type", ["experience", "decision", "idea", "project_context", "learning", "knowledge"])
      .limit(200),
    supabase.from("documents").select("id, filename, summary").is("project_id", null).eq("status", "ready").limit(100),
  ]);
  const items: Item[] = [
    ...(notes.data ?? []).map((n) => ({ table: "notes" as const, id: n.id, title: n.title, content: n.content })),
    ...(memories.data ?? []).map((m) => ({ table: "memories" as const, id: m.id, title: m.title, content: m.content })),
    ...(docs.data ?? []).map((d) => ({ table: "documents" as const, id: d.id, title: d.filename, content: d.summary ?? "" })),
  ];
  total.scanned = items.length;
  for (let i = 0; i < items.length; i += 25) {
    const r = await organizeItems(supabase, items.slice(i, i + 25));
    total.filed += r.filed;
    total.created += r.created;
  }
  await logActivity(supabase, "organized", `Organized brain: scanned ${total.scanned}, filed ${total.filed}, new projects ${total.created}`);
  return total;
}
