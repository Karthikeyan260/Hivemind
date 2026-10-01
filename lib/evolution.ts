import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { generateWithFallback, parseJson } from "@/lib/ai/providers";
import { dbError } from "@/lib/api";
import { readJSON, writeJSON } from "@/lib/private-store";

/**
 * "Project Evolution": projects in the order they were really built (GitHub repo creation dates),
 * what each one learned (new tech) and reused (tech carried over), and the technologies that run
 * through many projects as persistent threads.
 */
const GITHUB_USER = process.env.GITHUB_USER || "Karthikeyan260";
const CACHE_KEY = "github-repos";
const CACHE_MS = 12 * 3600_000;

type Repo = { name: string; created_at: string; html_url: string; homepage?: string | null; language: string | null; description: string | null; fork: boolean };

/** Real screenshots of the live projects, saved in public/projects/<slug>.webp. */
const SHOTS = new Set([
  "address-ner",
  "ai-consulting-system",
  "ai-job-application-assistant",
  "chess-game",
  "hivemind",
  "karthikeyan-portfolio",
  "memory-card-game",
  "nutrifyai",
  "pdf-rag-chatbot",
  "snake-game",
  "text-to-speech",
  "tic-tac-toe",
  "weather-dashboard",
]);
const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const shot = (name: string) => (SHOTS.has(slug(name)) ? `/projects/${slug(name)}.webp` : null);
/** Live demo, when the repo has one that works (GitHub profile links and dead deploys excluded). */
const BROKEN_DEMOS = new Set(["Netflix-clone", "Hivemind"]);
const liveOf = (r?: Repo) => (r?.homepage && !/github.com/.test(r.homepage) && !BROKEN_DEMOS.has(r.name) ? r.homepage : null);
export type EvoNode = {
  id: string;
  name: string;
  date: string;
  kind: "project" | "repo";
  description: string | null;
  stack: string[];
  learned: string[];
  reused: { tech: string; from: string }[];
  repo: string | null;
  href: string | null;
  /** GitHub's preview card for the repo (a picture of the project's repo). */
  image: string | null;
  /** Live demo URL. */
  live: string | null;
};
export type EvoThread = { tech: string; count: number; first: string; last: string };
export type EvoChapter = { title: string; start: number; story: string };
export type Evolution = { nodes: EvoNode[]; threads: EvoThread[]; chapters: EvoChapter[]; user: string };

const Chapters = z.object({ chapters: z.array(z.object({ title: z.string(), start: z.coerce.number(), story: z.string() })).min(1).max(7) });

/**
 * The story in chapters ("First steps into AI"…), written once by the model from the real order and
 * cached until the list of projects changes. Falls back to one chapter per year.
 */
async function chapters(supabase: SupabaseClient, nodes: EvoNode[]): Promise<EvoChapter[]> {
  const key = nodes.map((n) => n.name).join("|");
  const cached = await readJSON<{ key: string; chapters: EvoChapter[] } | null>(supabase, "evolution-chapters", null);
  if (cached?.key === key) return cached.chapters;
  const byYear = (): EvoChapter[] =>
    nodes
      .map((n, i) => ({ y: n.date.slice(0, 4), i }))
      .filter((x, i, a) => i === 0 || x.y !== a[i - 1].y)
      .map((x) => ({ title: x.y, start: x.i, story: "" }));
  try {
    const list = nodes.map((n, i) => `${i}. ${n.date.slice(0, 7)} ${n.name}: learned ${n.learned.join(", ") || "-"}; reused ${n.reused.map((r) => r.tech).join(", ") || "-"}`).join("\n");
    const res = await generateWithFallback(
      [{ role: "user", content: `A developer's projects in build order:\n${list}` }],
      {
        system:
          'Split this developer journey into 3-6 chapters of consecutive projects (a new chapter where the direction clearly changes). For each: "start" = index of its first project, a short evocative "title" (max 5 words, no "Chapter" prefix), and a one-sentence "story" (max 25 words, second person "you", concrete about what changed). First chapter starts at 0. JSON only: {"chapters":[{"title","start","story"}]}.',
        json: true,
        temperature: 0.4,
        maxTokens: 700,
      },
    );
    const parsed = parseJson(res.text, Chapters);
    if (!parsed) throw new Error("bad chapters");
    const out = parsed.chapters
      .map((c) => ({ ...c, start: Math.max(0, Math.min(nodes.length - 1, Math.round(c.start))) }))
      .sort((a, b) => a.start - b.start)
      .filter((c, i, a) => i === 0 || c.start !== a[i - 1].start);
    out[0].start = 0;
    await writeJSON(supabase, "evolution-chapters", { key, chapters: out });
    return out;
  } catch {
    return byYear();
  }
}

/** Repos that aren't projects but still belong in the story (they lead somewhere). */
const EXTRA_REPOS = ["Pdf_Rag_Chatbot", "Portfolio-mcp", "health-monitor-system", "Karthikeyan-portfolio"];
const SKIP = /^(test|hello-world|project1|karthik260404|karthikeyan260|softskills?|softskills-app)$/i;

/** One name per technology, and the many CSS flavours folded into "CSS". */
function canon(raw: string) {
  const t = raw.replace(/\(.*?\)/g, "").replace(/\s+/g, " ").trim().replace(/[.;]+$/, "");
  if (/^gemini\b/i.test(t)) return "Gemini";
  if (/^next\.?js\b/i.test(t)) return "Next.js";
  if (/^(css\d?|css grid|flexbox|css animations)$/i.test(t)) return "CSS";
  if (/^html\d?( canvas)?$/i.test(t)) return /canvas/i.test(t) ? "Canvas" : "HTML";
  if (/^(js|javascript)$/i.test(t)) return "JavaScript";
  if (/^(ts|typescript)$/i.test(t)) return "TypeScript";
  if (/^hugging ?face/i.test(t)) return "Hugging Face";
  if (/^(multimodal llm|llm pipelines|llm)$/i.test(t)) return "LLMs";
  if (/^spacy$/i.test(t)) return "spaCy";
  return t;
}
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

async function repos(supabase: SupabaseClient): Promise<Repo[]> {
  const cached = await readJSON<{ at: number; repos: Repo[] } | null>(supabase, CACHE_KEY, null);
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.repos;
  try {
    const r = await fetch(`https://api.github.com/users/${GITHUB_USER}/repos?per_page=100&sort=created&direction=asc`, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "HIVEMIND" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) throw new Error(String(r.status));
    const list = ((await r.json()) as Repo[]).map(({ name, created_at, html_url, homepage, language, description, fork }) => ({ name, created_at, html_url, homepage, language, description, fork }));
    await writeJSON(supabase, CACHE_KEY, { at: Date.now(), repos: list });
    return list;
  } catch {
    return cached?.repos ?? [];
  }
}

/** Best repo for a project: names compared without spaces/dashes ("NutrifyAI" ↔ "NutriLens" is set explicitly). */
const ALIAS: Record<string, string> = {
  nutrifyai: "nutrilens",
  todoapplication: "todolistusingreact",
  memorycardgame: "memorygame",
  aijobapplicationassistant: "aipoweredjobapplicationassistant",
};
function matchRepo(project: string, list: Repo[]) {
  const p = norm(project);
  const want = ALIAS[p] ?? p;
  return list.find((r) => norm(r.name) === want) ?? list.find((r) => norm(r.name).includes(want) || want.includes(norm(r.name).replace(/webpage|clone$/, "")));
}

export async function buildEvolution(supabase: SupabaseClient): Promise<Evolution> {
  const [proj, mem, list] = await Promise.all([
    supabase.from("projects").select("id, name, description, status, metadata"),
    supabase.from("memories").select("project_id, content").not("project_id", "is", null).limit(800),
    repos(supabase),
  ]);
  dbError(proj.error);
  dbError(mem.error);
  const own = list.filter((r) => !r.fork && !SKIP.test(r.name));

  // Stated stacks ("Stack: …" lines in portfolio memories), else the stack saved on the project.
  const stated = new Map<string, string[]>();
  for (const m of mem.data ?? []) {
    const line = String(m.content).match(/^\s*(?:stack|tech(?:nolog(?:y|ies))?|built with)\s*:\s*(.+)$/im)?.[1];
    if (line && m.project_id && !stated.has(m.project_id)) stated.set(m.project_id, line.split(/,|·|\|/).map(canon).filter(Boolean));
  }

  const used = new Set<string>();
  const nodes: EvoNode[] = [];
  for (const p of proj.data ?? []) {
    const md = (p.metadata ?? {}) as { auto?: boolean; tech?: string[]; year?: number };
    if (md.auto) continue; // e.g. the automatic "Job Search" folder
    const repo = matchRepo(p.name, own);
    if (repo) used.add(repo.name);
    const stack = [...new Set([...(stated.get(p.id) ?? (md.tech ?? []).map(canon)), ...(repo?.language ? [canon(repo.language)] : [])])];
    const date = repo?.created_at ?? (md.year ? `${md.year}-06-01T00:00:00Z` : new Date().toISOString());
    nodes.push({
      id: p.id,
      name: p.name,
      date,
      kind: "project",
      description: p.description,
      stack,
      learned: [],
      reused: [],
      repo: repo?.name ?? null,
      href: repo?.html_url ?? null,
      image: shot(p.name),
      live: liveOf(repo),
    });
  }
  for (const r of own) {
    if (used.has(r.name) || !EXTRA_REPOS.includes(r.name)) continue;
    const extra: Record<string, string[]> = { Pdf_Rag_Chatbot: ["Python", "RAG", "LLMs"], "Portfolio-mcp": ["TypeScript", "MCP"], "health-monitor-system": ["TypeScript"], "Karthikeyan-portfolio": ["HTML", "CSS", "JavaScript"] };
    nodes.push({
      id: `repo:${r.name}`,
      name: r.name.replace(/[_-]+/g, " "),
      date: r.created_at,
      kind: "repo",
      description: r.description,
      stack: [...new Set([...(extra[r.name] ?? []), ...(r.language ? [canon(r.language)] : [])])],
      learned: [],
      reused: [],
      repo: r.name,
      href: r.html_url,
      image: shot(r.name.replace(/[_-]+/g, " ")),
      live: liveOf(r),
    });
  }

  // Walk in time order: new tech is "learned", tech seen before is "reused" from its latest user.
  nodes.sort((a, b) => a.date.localeCompare(b.date));
  const lastUser = new Map<string, string>();
  for (const n of nodes) {
    for (const t of n.stack) {
      const from = lastUser.get(t);
      if (from) n.reused.push({ tech: t, from });
      else n.learned.push(t);
      lastUser.set(t, n.name);
    }
  }

  const threads = new Map<string, EvoThread>();
  for (const n of nodes)
    for (const t of n.stack) {
      const th = threads.get(t) ?? { tech: t, count: 0, first: n.name, last: n.name };
      th.count++;
      th.last = n.name;
      threads.set(t, th);
    }
  return {
    nodes,
    threads: [...threads.values()].filter((t) => t.count >= 2).sort((a, b) => b.count - a.count),
    chapters: await chapters(supabase, nodes),
    user: GITHUB_USER,
  };
}
