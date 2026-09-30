import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { embedQuery } from "@/lib/ai/embeddings";
import { dbError, HttpError, toVector } from "@/lib/api";
import { CAREER_SOURCE } from "@/lib/career";
import { MEMORY_COLUMNS } from "@/lib/knowledge";
import { searchKnowledge, sourceHref } from "@/lib/rag/retrieval";

// Records that live in the memories table but aren't memories about the owner.
const SYSTEM_SOURCES = [CAREER_SOURCE, "resume-master"];

type MemoryRow = {
  id: string;
  project_id: string | null;
  title: string;
  content: string;
  memory_type: string;
  category: string | null;
  importance: number;
  confidence: number;
  tags: string[];
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

/** Where a memory came from, in words. */
export function sourceLabel(meta: Record<string, unknown>) {
  const s = String(meta?.source ?? "");
  if (s === "portfolio-mcp") return { key: s, label: "Portfolio MCP import", detail: meta.via ? `via ${meta.via}` : undefined };
  if (s === CAREER_SOURCE) return { key: s, label: "Career analysis" };
  if (s === "resume-master") return { key: s, label: "Master resume" };
  if (s) return { key: s, label: s.replace(/[-_]/g, " ") };
  return { key: "hivemind", label: "Saved in HIVEMIND", detail: "chat, voice or this page" };
}

export type ListQuery = { q?: string; type?: string; category?: string; project?: string; source?: string; sort?: string; system?: boolean };

export async function listMemories(supabase: SupabaseClient, f: ListQuery) {
  const { data, error } = await supabase.from("memories").select(MEMORY_COLUMNS).order("updated_at", { ascending: false }).limit(500);
  dbError(error);
  let rows = (data ?? []) as MemoryRow[];
  if (!f.system) rows = rows.filter((m) => !SYSTEM_SOURCES.includes(String(m.metadata?.source ?? "")));

  // Facets are computed before filtering so the filter menus always show every option.
  const count = (key: (m: MemoryRow) => string | null) => {
    const out: Record<string, number> = {};
    for (const m of rows) {
      const k = key(m);
      if (k) out[k] = (out[k] ?? 0) + 1;
    }
    return out;
  };
  const facets = {
    total: rows.length,
    types: count((m) => m.memory_type),
    categories: count((m) => m.category),
    sources: count((m) => sourceLabel(m.metadata).key),
    projects: count((m) => m.project_id),
  };

  if (f.type) rows = rows.filter((m) => m.memory_type === f.type);
  if (f.category) rows = rows.filter((m) => m.category === f.category);
  if (f.project) rows = rows.filter((m) => (f.project === "none" ? !m.project_id : m.project_id === f.project));
  if (f.source) rows = rows.filter((m) => sourceLabel(m.metadata).key === f.source);

  // Search: meaning (embeddings) plus exact words, meaning-ranked first.
  let score = new Map<string, number>();
  const q = f.q?.trim();
  if (q) {
    const hits = await searchKnowledge(supabase, q, { limit: 40, minSimilarity: 0.45 }).catch(() => []);
    const semantic = new Map(hits.filter((h) => h.source_type === "memory").map((h) => [h.parent_id, h.similarity]));
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const textHit = (m: MemoryRow) => words.every((w) => `${m.title} ${m.content} ${m.category ?? ""} ${(m.tags ?? []).join(" ")}`.toLowerCase().includes(w));
    // Exact words beat vague meaning (one-word queries embed poorly); meaning-only hits must be close.
    const SEMANTIC_ONLY_MIN = 0.62;
    rows = rows.filter((m) => textHit(m) || (semantic.get(m.id) ?? 0) >= SEMANTIC_ONLY_MIN);
    score = new Map(rows.map((m) => [m.id, Math.min(1, (semantic.get(m.id) ?? 0.45) + (textHit(m) ? 0.35 : 0))]));
  }

  const sorters: Record<string, (a: MemoryRow, b: MemoryRow) => number> = {
    relevance: (a, b) => (score.get(b.id) ?? 0) - (score.get(a.id) ?? 0),
    updated: (a, b) => b.updated_at.localeCompare(a.updated_at),
    created: (a, b) => b.created_at.localeCompare(a.created_at),
    importance: (a, b) => b.importance - a.importance || b.updated_at.localeCompare(a.updated_at),
    confidence: (a, b) => b.confidence - a.confidence || b.updated_at.localeCompare(a.updated_at),
  };
  rows.sort(sorters[f.sort ?? (q ? "relevance" : "updated")] ?? sorters.updated);

  return {
    facets,
    items: rows.map((m) => ({
      id: m.id,
      title: m.title,
      snippet: m.content.slice(0, 180),
      memory_type: m.memory_type,
      category: m.category,
      importance: m.importance,
      confidence: m.confidence,
      project_id: m.project_id,
      source: sourceLabel(m.metadata).label,
      updated_at: m.updated_at,
      match: q ? Math.round((score.get(m.id) ?? 0) * 100) : undefined,
    })),
  };
}

export type TimelineEvent = { at: string; kind: "created" | "edited" | "restored" | "filed" | "updated"; label: string; detail?: string; version?: number };

/** Everything about one memory: fields, source, history, and what it connects to. */
export async function memoryDetail(supabase: SupabaseClient, id: string) {
  const { data, error } = await supabase.from("memories").select(`${MEMORY_COLUMNS}, embedding`).eq("id", id).maybeSingle();
  dbError(error);
  if (!data) throw new HttpError(404, "Memory not found");
  const { embedding, ...memory } = data as MemoryRow & { embedding: string | null };

  const [versions, activity, project] = await Promise.all([
    supabase.from("memory_versions").select("id, version_number, title, content, change_reason, created_at").eq("memory_id", id).order("version_number", { ascending: true }),
    supabase.from("activity").select("kind, message, created_at").eq("payload->>id", id).order("created_at"),
    memory.project_id ? supabase.from("projects").select("id, name, description").eq("id", memory.project_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
  ]);
  dbError(versions.error);

  // Related: nearest neighbours of this memory's own embedding (or its text, if it has none yet).
  const vector = embedding ?? toVector(await embedQuery(`${memory.title}\n${memory.content}`));
  const { data: near, error: nErr } = await supabase.rpc("match_knowledge", { query_embedding: vector, match_count: 14, filter_project: null, min_similarity: 0.55 });
  dbError(nErr);
  const neighbours = ((near ?? []) as { source_type: "note" | "memory" | "document"; parent_id: string; title: string; content: string; similarity: number }[])
    .filter((n) => n.parent_id !== id)
    .filter((n, i, all) => all.findIndex((x) => x.parent_id === n.parent_id) === i)
    .slice(0, 8);

  // Projects and skills that connect through those neighbours.
  const memIds = neighbours.filter((n) => n.source_type === "memory").map((n) => n.parent_id);
  const { data: relMems } = memIds.length
    ? await supabase.from("memories").select("id, project_id, category, memory_type, tags").in("id", memIds)
    : { data: [] as { id: string; project_id: string | null; category: string | null; memory_type: string; tags: string[] }[] };
  const projectIds = [...new Set([memory.project_id, ...(relMems ?? []).map((m) => m.project_id)].filter(Boolean))] as string[];
  const { data: projects } = projectIds.length ? await supabase.from("projects").select("id, name").in("id", projectIds) : { data: [] as { id: string; name: string }[] };
  // Skills: terms from the owner's own Skills memories that this memory (then its neighbours) mentions.
  const { data: skillMems } = await supabase.from("memories").select("title, content").ilike("category", "%skill%");
  // Section headings ("Skills — Engineering & Delivery", "Category: …") aren't skills themselves.
  const headings = new Set((skillMems ?? []).map((m) => String(m.title).replace(/^skills?\s*[—:-]\s*/i, "").trim().toLowerCase()));
  const vocabulary = [
    ...new Set(
      (skillMems ?? [])
        .flatMap((m) => (m.content as string).split(/[,;•|\n]|:\s/))
        .map((t) => t.replace(/\(.*?\)/g, "").replace(/^[-*\s]+|[.\s]+$/g, "").trim())
        .filter(
          (t) =>
            t.length >= 2 &&
            t.length <= 32 &&
            !headings.has(t.toLowerCase()) &&
            !/^(skills?|and|the|with|category|categories|level|tools?|languages?|frameworks?|other)$/i.test(t),
        ),
    ),
  ];
  const esc = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const mentions = (text: string) => {
    const lower = text.toLowerCase();
    return vocabulary.filter((t) => new RegExp(`(^|[^a-z0-9])${esc(t.toLowerCase())}([^a-z0-9]|$)`).test(lower));
  };
  const own = mentions(`${memory.title} ${memory.content} ${(memory.tags ?? []).join(" ")}`);
  const nearby = mentions(neighbours.map((n) => `${n.title} ${n.content}`).join("\n"));
  const skills = [...new Set([...own, ...nearby])].slice(0, 14).map((name) => ({ name, direct: own.includes(name) }));
  void relMems;

  const v = versions.data ?? [];
  const created: TimelineEvent = { at: memory.created_at, kind: "created", label: "Created", detail: sourceLabel(memory.metadata).label };
  const timeline: TimelineEvent[] = [
    created,
    ...v.map((x, i) => ({
      // A version row stores the text *before* that change, so the change happened when it was written.
      at: x.created_at,
      kind: (/restored/i.test(x.change_reason ?? "") ? "restored" : "edited") as TimelineEvent["kind"],
      label: /restored/i.test(x.change_reason ?? "") ? "Restored an earlier version" : `Edited (v${i + 1} → v${i + 2})`,
      detail: x.change_reason ?? undefined,
      version: x.version_number,
    })),
    ...(activity.data ?? []).filter((a) => a.kind === "linked").map((a) => ({ at: a.created_at, kind: "filed" as const, label: a.message })),
  ].sort((a, b) => a.at.localeCompare(b.at));
  if (!v.length && memory.updated_at.slice(0, 16) !== memory.created_at.slice(0, 16)) {
    const updated: TimelineEvent = { at: memory.updated_at, kind: "updated", label: "Details updated", detail: "type, importance, project or tags" };
    timeline.push(updated);
  }

  return {
    memory: { ...memory, source: sourceLabel(memory.metadata), has_embedding: !!embedding },
    project: project.data ?? null,
    versions: [...v].reverse(),
    current_version: v.length + 1,
    timeline,
    related: {
      items: neighbours.map((n) => ({ type: n.source_type, title: n.title, snippet: n.content.slice(0, 140), href: sourceHref(n), similarity: Math.round(n.similarity * 100) })),
      projects: (projects ?? []).map((p) => ({ id: p.id, name: p.name, own: p.id === memory.project_id })),
      skills,
    },
  };
}
