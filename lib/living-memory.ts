import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { dbError } from "@/lib/api";
import { getProfile } from "@/lib/profile";

/**
 * Data for the Projects "Living Memory" view: memories are the objects, projects are clusters,
 * skills are connection points, time decides where things sit, importance decides how bright.
 */
export type LivingMemory = {
  id: string;
  title: string;
  snippet: string;
  type: string;
  importance: number;
  project_id: string | null;
  /** Decimal year (2024.5 = mid 2024): where it sits on the time axis. */
  t: number;
  created_at: string;
  skills: string[];
  /** Most similar other memories (cosine on embeddings). */
  related: { id: string; score: number }[];
};
export type LivingProject = { id: string; name: string; status: string; year: number | null; cluster: string | null };
export type LivingSkill = { name: string; count: number };
export type LivingData = { memories: LivingMemory[]; projects: LivingProject[]; skills: LivingSkill[]; range: { min: number; max: number } };

const STACK = /^\s*(?:stack|tech(?:nolog(?:y|ies))?|tech stack|built with|tools)\s*:\s*(.+)$/im;
const YEAR = /\b(20[12]\d)\b/g;

const decimalYear = (iso: string) => {
  const d = new Date(iso);
  const y = d.getUTCFullYear();
  return y + (d.getTime() - Date.UTC(y, 0, 1)) / (365.25 * 86_400_000);
};

const clean = (s: string) => {
  const t = s.replace(/\(.*?\)/g, "").replace(/\s+\d+(\.\d+)*$/, "").replace(/\s+/g, " ").trim();
  // One name per technology ("Gemini 2.0 Flash", "Gemini API" → "Gemini").
  return /^gemini\b/i.test(t) ? "Gemini" : /^next\.?js\b/i.test(t) ? "Next.js" : /^hugging ?face/i.test(t) ? "Hugging Face" : t;
};
const NOISE = new Set(["machine learning", "llm pipelines", "prompt engineering", "css grid", "flexbox", "game ai"]);

function cosine(a: number[], b: number[]) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na * nb) || 1);
}

export async function buildLivingMemory(supabase: SupabaseClient): Promise<LivingData> {
  const [mem, proj, profile] = await Promise.all([
    supabase.from("memories").select("id, title, content, memory_type, importance, project_id, created_at, embedding").limit(600),
    supabase.from("projects").select("id, name, status, metadata"),
    getProfile(supabase).catch(() => null),
  ]);
  dbError(mem.error);
  dbError(proj.error);
  const rows = mem.data ?? [];

  const projects: LivingProject[] = (proj.data ?? []).map((p) => {
    const md = (p.metadata ?? {}) as { year?: number; cluster?: string };
    return { id: p.id, name: p.name, status: p.status, year: md.year ?? null, cluster: md.cluster ?? null };
  });
  const projectYear = new Map(projects.map((p) => [p.id, p.year]));

  // Skill vocabulary: every project's stated stack plus the profile's top skills.
  const vocab = new Map<string, string>();
  for (const r of rows) {
    const s = (r.content as string).match(STACK)?.[1];
    if (s) for (const t of s.split(/,|·|\|/).map(clean)) if (t.length > 1 && t.length < 30 && !NOISE.has(t.toLowerCase())) vocab.set(t.toLowerCase(), t);
  }
  for (const t of profile?.top_skills ?? []) vocab.set(clean(t).toLowerCase(), clean(t));

  const memories: LivingMemory[] = rows.map((r) => {
    const text = `${r.title}\n${r.content}`;
    const lower = text.toLowerCase();
    // Real time, not import time: the project's year, else the earliest year the memory mentions.
    const years = [...text.matchAll(YEAR)].map((m) => Number(m[1])).filter((y) => y >= 2015 && y <= new Date().getUTCFullYear());
    const py = r.project_id ? projectYear.get(r.project_id) : null;
    const base = py ?? (years.length ? Math.min(...years) : null);
    const t = base != null ? base + 0.15 + ((parseInt(String(r.id).slice(0, 4), 16) % 70) / 100) : decimalYear(r.created_at);
    const skills = [...vocab.entries()].filter(([k]) => (k.length <= 3 ? new RegExp(`\\b${k.replace(/[.+#]/g, "\\$&")}\\b`).test(lower) : lower.includes(k))).map(([, v]) => v);
    return {
      id: r.id,
      title: r.title,
      snippet: String(r.content).replace(/\s+/g, " ").slice(0, 220),
      type: r.memory_type,
      importance: r.importance ?? 5,
      project_id: r.project_id,
      t: Math.round(t * 100) / 100,
      created_at: r.created_at,
      skills,
      related: [],
    };
  });

  // Related memories: top 3 neighbours by meaning (embeddings), above a floor.
  const vecs = rows.map((r) => {
    try {
      return typeof r.embedding === "string" ? (JSON.parse(r.embedding) as number[]) : ((r.embedding as number[] | null) ?? null);
    } catch {
      return null;
    }
  });
  for (let i = 0; i < memories.length; i++) {
    const a = vecs[i];
    if (!a) continue;
    const scores: { id: string; score: number }[] = [];
    for (let j = 0; j < memories.length; j++) {
      const b = vecs[j];
      if (i === j || !b) continue;
      scores.push({ id: memories[j].id, score: cosine(a, b) });
    }
    memories[i].related = scores
      .filter((s) => s.score > 0.62)
      .sort((x, y) => y.score - x.score)
      .slice(0, 3)
      .map((s) => ({ id: s.id, score: Math.round(s.score * 100) / 100 }));
  }

  const counts = new Map<string, number>();
  for (const m of memories) for (const s of m.skills) counts.set(s, (counts.get(s) ?? 0) + 1);
  const skills = [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .filter((s) => s.count >= 2)
    .sort((a, b) => b.count - a.count)
    .slice(0, 18);
  const keep = new Set(skills.map((s) => s.name));
  for (const m of memories) m.skills = m.skills.filter((s) => keep.has(s));

  const ts = memories.map((m) => m.t);
  return { memories, projects, skills, range: { min: Math.floor(Math.min(...ts, new Date().getUTCFullYear())), max: Math.ceil(Math.max(...ts, new Date().getUTCFullYear()) + 0.01) } };
}
