import "server-only";
import { logActivity } from "@/lib/activity";
import { dbError, HttpError } from "@/lib/api";
import { analyzeJob, CAREER_SOURCE } from "@/lib/career";
import { getWeather, HOME_CITY } from "@/lib/external/weather";
import { researchAndSave, webSearch } from "@/lib/external/web";
import { createMemory, updateMemory } from "@/lib/knowledge";
import { getProfile, rebuildProfile } from "@/lib/profile";
import { searchKnowledge, sourceHref } from "@/lib/rag/retrieval";
import { tailorResume } from "@/lib/resume/tailor";
import type { RunContext, Tool } from "./types";

const str = (v: unknown) => (v == null ? "" : String(v)).trim();
const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required });
const S = { type: "string" };

/** Adds sources to the shared list and returns their citation numbers. */
function cite(ctx: RunContext, items: { type: string; title: string; href: string; similarity: number }[]) {
  return items.map((s) => {
    const existing = ctx.sources.find((x) => x.href === s.href);
    if (existing) return existing.n;
    const n = ctx.sources.length + 1;
    ctx.sources.push({ n, ...s });
    return n;
  });
}

async function latestAnalysisId(ctx: RunContext) {
  const { data, error } = await ctx.supabase.from("memories").select("id").eq("metadata->>source", CAREER_SOURCE).order("created_at", { ascending: false }).limit(1);
  dbError(error);
  return (data?.[0]?.id as string | undefined) ?? null;
}

export const TOOLS: Record<string, Tool> = {
  /* ───── knowledge (RAG) ───── */
  search_brain: {
    name: "search_brain",
    description: "Semantic search over the owner's memories, notes, documents and resume. Returns numbered results to cite as [n].",
    parameters: obj({ query: S }, ["query"]),
    async run(args, ctx) {
      const hits = await searchKnowledge(ctx.supabase, str(args.query), { projectId: ctx.projectId, limit: 8 });
      const ns = cite(
        ctx,
        hits.map((h) => ({ type: h.source_type, title: h.title, href: sourceHref(h), similarity: Math.round(h.similarity * 100) / 100 })),
      );
      if (!hits.length) return { results: [], note: "Nothing relevant in the brain." };
      return { results: hits.map((h, i) => ({ cite: `[${ns[i]}]`, type: h.source_type, title: h.title, content: h.content.slice(0, 1500) })) };
    },
  },

  /* ───── memory ───── */
  remember: {
    name: "remember",
    description: "Save a new memory (fact, idea, decision, preference) exactly as the owner stated it. It is filed into the right project automatically.",
    parameters: obj({ content: S }, ["content"]),
    async run(args, ctx) {
      const m = await createMemory(ctx.supabase, { content: str(args.content), project_id: ctx.projectId });
      ctx.changed = true;
      ctx.actions.push({ label: "Open memory", href: `/memories?open=${m!.id}` });
      return { saved: true, title: m!.title, type: m!.memory_type };
    },
  },
  update_memory: {
    name: "update_memory",
    description: "Correct or update an existing memory. Finds the closest memory to 'which' and replaces its content with 'new_content'.",
    parameters: obj({ which: S, new_content: S }, ["which", "new_content"]),
    async run(args, ctx) {
      const hits = (await searchKnowledge(ctx.supabase, str(args.which), { limit: 5 })).filter((h) => h.source_type === "memory");
      const target = hits[0];
      if (!target) return { error: "No matching memory found." };
      const m = await updateMemory(ctx.supabase, target.parent_id, { content: str(args.new_content), change_reason: "Updated by the owner via chat" });
      ctx.changed = true;
      ctx.actions.push({ label: "Open memory", href: `/memories?open=${target.parent_id}` });
      return { updated: true, title: (m as { title?: string } | null)?.title ?? target.title };
    },
  },
  recent_memories: {
    name: "recent_memories",
    description: "List the most recently saved memories.",
    parameters: obj({ limit: { type: "number" } }),
    async run(args, ctx) {
      const { data, error } = await ctx.supabase
        .from("memories")
        .select("title, memory_type, created_at")
        .not("metadata->>source", "in", `(${CAREER_SOURCE},resume-master)`)
        .order("created_at", { ascending: false })
        .limit(Math.min(Number(args.limit) || 8, 20));
      dbError(error);
      return { memories: data ?? [] };
    },
  },

  /* ───── research (outside world) ───── */
  web_search: {
    name: "web_search",
    description: "Search the internet (Google) for current or outside-world information: news, prices, releases, events, public facts.",
    parameters: obj({ query: S }, ["query"]),
    async run(args, ctx) {
      const r = await webSearch(str(args.query));
      const ns = cite(ctx, r.sources.map((s) => ({ type: "web", title: s.title, href: s.url, similarity: 1 })));
      return { answer: r.answer, sources: r.sources.map((s, i) => `[${ns[i]}] ${s.title}`) };
    },
  },
  get_weather: {
    name: "get_weather",
    description: `Live weather and 4-day forecast for a place (default ${HOME_CITY}).`,
    parameters: obj({ place: S }),
    async run(args, ctx) {
      const w = await getWeather(str(args.place) || HOME_CITY);
      cite(ctx, [{ type: "web", title: `Open-Meteo · ${w.place}`, href: "https://open-meteo.com", similarity: 1 }]);
      return w;
    },
  },
  research_and_save: {
    name: "research_and_save",
    description: "Research a topic in depth on the web and save the brief (with sources) as a note in the brain.",
    parameters: obj({ topic: S }, ["topic"]),
    async run(args, ctx) {
      const { note, result } = await researchAndSave(ctx.supabase, str(args.topic), ctx.projectId);
      cite(ctx, result.sources.map((s) => ({ type: "web", title: s.title, href: s.url, similarity: 1 })));
      ctx.changed = true;
      ctx.actions.push({ label: "Open note", href: `/notes?open=${note.id}` });
      return { saved_note: note.title, brief: result.answer.slice(0, 4000), source_count: result.sources.length };
    },
  },

  /* ───── career ───── */
  analyze_job: {
    name: "analyze_job",
    description: "Analyse a job description against the owner's profile: fit score, ATS keyword match, strengths, gaps, cover letter.",
    parameters: obj({ job_description: S, role: S, company: S }, ["job_description"]),
    async run(args, ctx) {
      const jd = str(args.job_description);
      if (jd.length < 80) return { error: "Need the full job description text (paste it into the message or the Career page)." };
      const r = await analyzeJob(ctx.supabase, { jobDescription: jd, role: str(args.role) || undefined, company: str(args.company) || undefined });
      ctx.changed = true;
      ctx.actions.push({ label: "Open analysis", href: `/career?open=${r.id}` });
      const a = r.analysis;
      return { analysis_id: r.id, role: a.role, company: a.company, fit: a.fit_score, ats_percent: a.ats_score, verdict: a.verdict, missing_keywords: a.missing_keywords, gaps: a.gaps.slice(0, 4) };
    },
  },
  tailor_resume: {
    name: "tailor_resume",
    description: "Generate the tailored resume PDF for a job analysis (default: the most recent one).",
    parameters: obj({ analysis_id: S }),
    async run(args, ctx) {
      const id = str(args.analysis_id) || (await latestAnalysisId(ctx));
      if (!id) return { error: "No job analysis yet. Analyse a job description first." };
      const t = await tailorResume(ctx.supabase, id);
      ctx.actions.push({ label: "Open tailored resume", href: `/career?open=${id}` }, { label: "Download PDF", href: `/api/career/${id}/resume?format=pdf-download` });
      return { keywords_added: t.keywords_added, left_out_no_evidence: t.not_added, changes: t.changes.slice(0, 8) };
    },
  },
  job_analyses: {
    name: "job_analyses",
    description: "List past job analyses with fit and ATS scores.",
    parameters: obj({}),
    async run(_args, ctx) {
      const { data, error } = await ctx.supabase.from("memories").select("id, created_at, metadata").eq("metadata->>source", CAREER_SOURCE).order("created_at", { ascending: false }).limit(15);
      dbError(error);
      return {
        analyses: (data ?? []).map((m) => {
          const a = (m.metadata as { analysis?: { role?: string; company?: string; fit_score?: number; ats_score?: number }; tailored_resume?: unknown }) ?? {};
          return { id: m.id, role: a.analysis?.role, company: a.analysis?.company, fit: a.analysis?.fit_score, ats: a.analysis?.ats_score, has_tailored_resume: !!a.tailored_resume, date: m.created_at };
        }),
      };
    },
  },

  /* ───── projects ───── */
  list_projects: {
    name: "list_projects",
    description: "List the owner's projects with status and how many memories/notes each holds.",
    parameters: obj({}),
    async run(_args, ctx) {
      const [p, m, n] = await Promise.all([
        ctx.supabase.from("projects").select("id, name, description, status").order("name"),
        ctx.supabase.from("memories").select("project_id"),
        ctx.supabase.from("notes").select("project_id"),
      ]);
      dbError(p.error);
      const count = (rows: { project_id: string | null }[] | null, id: string) => (rows ?? []).filter((r) => r.project_id === id).length;
      return { projects: (p.data ?? []).map((x) => ({ name: x.name, status: x.status, description: x.description, memories: count(m.data, x.id), notes: count(n.data, x.id) })) };
    },
  },
  project_details: {
    name: "project_details",
    description: "Everything filed under one project: description plus its memories and notes.",
    parameters: obj({ name: S }, ["name"]),
    async run(args, ctx) {
      const { data: p, error } = await ctx.supabase.from("projects").select("id, name, description, status").ilike("name", `%${str(args.name)}%`).limit(1).maybeSingle();
      dbError(error);
      if (!p) return { error: `No project matching "${str(args.name)}".` };
      const [m, n] = await Promise.all([
        ctx.supabase.from("memories").select("title, content").eq("project_id", p.id).limit(15),
        ctx.supabase.from("notes").select("title, summary").eq("project_id", p.id).limit(10),
      ]);
      ctx.actions.push({ label: `Open ${p.name}`, href: `/projects/${p.id}` });
      return { ...p, memories: (m.data ?? []).map((x) => ({ title: x.title, content: x.content.slice(0, 400) })), notes: n.data ?? [] };
    },
  },
  create_project: {
    name: "create_project",
    description: "Create a new project.",
    parameters: obj({ name: S, description: S }, ["name"]),
    async run(args, ctx) {
      const name = str(args.name).slice(0, 120);
      if (!name) return { error: "Project needs a name." };
      const { data: existing } = await ctx.supabase.from("projects").select("id, name").ilike("name", name).maybeSingle();
      if (existing) {
        ctx.actions.push({ label: "Open project", href: `/projects/${existing.id}` });
        return { already_exists: true, name: existing.name };
      }
      const { data: p, error } = await ctx.supabase
        .from("projects")
        .insert({ name, description: str(args.description) || null, metadata: { created_by: "hivemind" } })
        .select("id, name")
        .single();
      dbError(error);
      await logActivity(ctx.supabase, "project_created", `Created project “${p!.name}” on your request`, { type: "project_created", project_id: p!.id });
      ctx.changed = true;
      ctx.actions.push({ label: "Open project", href: `/projects/${p!.id}` });
      return { created: true, name: p!.name };
    },
  },

  /* ───── profile ───── */
  get_profile: {
    name: "get_profile",
    description: "HIVEMIND's current understanding of the owner: role, location, summary, skills, focus areas, goals.",
    parameters: obj({}),
    async run(_args, ctx) {
      return (await getProfile(ctx.supabase)) ?? { note: "No profile yet." };
    },
  },
  refresh_profile: {
    name: "refresh_profile",
    description: "Re-read the whole brain and rebuild the owner's profile (use when they say their info changed or ask to refresh).",
    parameters: obj({}),
    async run(_args, ctx) {
      await rebuildProfile(ctx.supabase);
      ctx.changed = true;
      return { refreshed: true, profile: await getProfile(ctx.supabase) };
    },
  },
};

export function toolOrThrow(name: string) {
  const t = TOOLS[name];
  if (!t) throw new HttpError(500, `Unknown tool ${name}`);
  return t;
}
