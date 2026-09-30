import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { logActivity } from "@/lib/activity";
import { embedOne } from "@/lib/ai/embeddings";
import { generateWithFallback, parseJson } from "@/lib/ai/providers";
import { dbError, HttpError, toVector } from "@/lib/api";
import { getProfile, profileForPrompt } from "@/lib/profile";
import { searchKnowledge } from "@/lib/rag/retrieval";

export const CAREER_SOURCE = "career";
const JOB_PROJECT = "Job Search";

/** Knowledge search that skips saved job analyses: they hold pasted job descriptions, not evidence about me. */
export async function searchEvidence(supabase: SupabaseClient, query: string, opts: { limit?: number; minSimilarity?: number } = {}) {
  const limit = opts.limit ?? 8;
  const [items, { data, error }] = await Promise.all([
    searchKnowledge(supabase, query, { ...opts, limit: limit + 8 }),
    supabase.from("memories").select("id").eq("metadata->>source", CAREER_SOURCE),
  ]);
  dbError(error);
  const jobs = new Set((data ?? []).map((r) => r.id as string));
  return items.filter((x) => !(x.source_type === "memory" && jobs.has(x.parent_id))).slice(0, limit);
}

const Analysis = z.object({
  role: z.string().default(""),
  company: z.string().default(""),
  fit_score: z.coerce.number().min(0).max(100).default(0),
  verdict: z.string().default(""),
  jd_keywords: z.array(z.string()).max(40).default([]),
  strengths: z.array(z.object({ point: z.string(), evidence: z.string().default("") })).max(8).default([]),
  gaps: z.array(z.object({ gap: z.string(), how_to_close: z.string().default("") })).max(8).default([]),
  tailored_summary: z.string().default(""),
  best_projects: z
    .array(z.object({ name: z.string(), why: z.string().default(""), bullets: z.array(z.string()).max(4).default([]) }))
    .max(4)
    .default([]),
  cover_letter: z.string().default(""),
  interview_questions: z.array(z.object({ q: z.string(), hint: z.string().default("") })).max(8).default([]),
  learning_plan: z.array(z.object({ skill: z.string(), action: z.string().default("") })).max(6).default([]),
});
export type JobAnalysis = z.infer<typeof Analysis> & {
  ats_score: number;
  matched_keywords: string[];
  missing_keywords: string[];
  evidence: { title: string; type: string; href: string }[];
};

const SYSTEM = `You are a senior technical recruiter and resume writer working for the candidate.
You get a job description and numbered EVIDENCE from the candidate's own records (resume, profile, projects, experience, skills, certifications, LinkedIn).
Rules:
- Use ONLY facts present in the evidence. Never invent employers, dates, metrics, degrees or skills. If something is missing, list it as a gap.
- Resume bullets: start with a strong verb, be concrete, reuse real metrics from the evidence, mirror the job's wording where truthful.
- tailored_summary: 3-4 sentences, first person implied (no "I"), written for this specific role.
- cover_letter: under 170 words, warm and specific, no placeholders like [Company] (use the given company or "your team").
- fit_score: honest 0-100 estimate of how well the evidence matches the must-have requirements.
- jd_keywords: 12-30 concrete skills/tools/qualifications from the job description (short, lowercase, e.g. "langgraph", "rag", "aws", "fastapi").
Respond with JSON only, using exactly these keys:
role, company, fit_score, verdict (one sentence), jd_keywords, strengths [{point, evidence}], gaps [{gap, how_to_close}],
tailored_summary, best_projects [{name, why, bullets}], cover_letter, interview_questions [{q, hint}], learning_plan [{skill, action}].`;

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9+#.]+/g, " ").trim();

/** Keyword presence in the candidate's real text: deterministic, not an LLM guess. */
function atsMatch(keywords: string[], haystack: string) {
  const h = ` ${norm(haystack)} `;
  const uniq = [...new Set(keywords.map((k) => k.trim()).filter(Boolean))];
  const matched = uniq.filter((k) => {
    const n = norm(k);
    if (!n) return false;
    if (h.includes(` ${n} `) || h.includes(n)) return true;
    // multi-word keywords: all parts present
    const parts = n.split(" ").filter((p) => p.length > 2);
    return parts.length > 1 && parts.every((p) => h.includes(p));
  });
  const missing = uniq.filter((k) => !matched.includes(k));
  return { score: uniq.length ? Math.round((matched.length / uniq.length) * 100) : 0, matched, missing };
}

async function gatherEvidence(supabase: SupabaseClient, jd: string) {
  // Two angles: the whole JD, and a skills-focused slice of it.
  const [a, b, resume, skills] = await Promise.all([
    searchEvidence(supabase, jd.slice(0, 6000), { limit: 12, minSimilarity: 0.2 }),
    searchEvidence(supabase, `skills experience projects required: ${jd.slice(0, 1500)}`, { limit: 8, minSimilarity: 0.2 }),
    supabase.from("documents").select("id").ilike("filename", "%resume%").limit(1),
    supabase.from("memories").select("id, title, content").eq("category", "Skills").limit(10),
  ]);
  const seen = new Set<string>();
  const items = [...a, ...b].filter((x) => (seen.has(x.source_id) ? false : (seen.add(x.source_id), true)));

  let resumeText = "";
  const resumeId = resume.data?.[0]?.id;
  if (resumeId) {
    const { data } = await supabase.from("document_chunks").select("content").eq("document_id", resumeId).order("chunk_index");
    resumeText = (data ?? []).map((c) => c.content).join("\n");
  }
  const skillsText = (skills.data ?? []).map((m) => `${m.title}\n${m.content}`).join("\n\n");
  return { items, resumeText, skillsText };
}

async function jobProjectId(supabase: SupabaseClient) {
  const { data } = await supabase.from("projects").select("id").ilike("name", JOB_PROJECT).maybeSingle();
  if (data) return data.id as string;
  const { data: created, error } = await supabase
    .from("projects")
    .insert({ name: JOB_PROJECT, description: "Job descriptions analysed against my profile.", metadata: { auto: true, reason: "for job analyses" } })
    .select("id")
    .single();
  dbError(error);
  await logActivity(supabase, "project_created", `Created project “${JOB_PROJECT}” for your job analyses`, { type: "project_created", project_id: created!.id });
  return created!.id as string;
}

export async function analyzeJob(supabase: SupabaseClient, input: { jobDescription: string; role?: string; company?: string; applyLink?: string; location?: string }) {
  const jd = input.jobDescription.trim();
  const [profile, ev] = await Promise.all([getProfile(supabase), gatherEvidence(supabase, jd)]);
  if (!ev.items.length && !ev.resumeText) throw new HttpError(422, "Your brain has no profile data yet. Sync your portfolio in Sources first.");

  const evidence = [
    `[P] PROFILE\n${profileForPrompt(profile)}`,
    ev.resumeText ? `[R] RESUME\n${ev.resumeText.slice(0, 9000)}` : "",
    ev.skillsText ? `[S] SKILLS\n${ev.skillsText.slice(0, 4000)}` : "",
    ...ev.items.map((x, i) => `[${i + 1}] (${x.source_type}) ${x.title}\n${x.content.slice(0, 1200)}`),
  ]
    .filter(Boolean)
    .join("\n\n---\n\n");

  const prompt = `ROLE: ${input.role || "(infer from the job description)"}
COMPANY: ${input.company || "(infer if stated, else leave empty)"}

JOB DESCRIPTION:
${jd.slice(0, 12000)}

EVIDENCE:
${evidence}`;

  const res = await generateWithFallback([{ role: "user", content: prompt }], {
    system: SYSTEM,
    json: true,
    temperature: 0.25,
    maxTokens: 5000,
    order: ["gemini", "nvidia", "groq"],
  });
  const parsed = parseJson(res.text, Analysis);
  if (!parsed) throw new HttpError(502, "The model returned an unreadable analysis. Try again.");

  const haystack = [ev.resumeText, ev.skillsText, profileForPrompt(profile), ...ev.items.map((x) => `${x.title} ${x.content}`)].join("\n");
  const ats = atsMatch(parsed.jd_keywords, haystack);
  const href = (x: (typeof ev.items)[number]) =>
    `/${x.source_type === "note" ? "notes" : x.source_type === "memory" ? "memories" : "documents"}?open=${x.parent_id}`;
  const analysis: JobAnalysis = {
    ...parsed,
    role: parsed.role || input.role || "Role",
    company: parsed.company || input.company || "",
    ats_score: ats.score,
    matched_keywords: ats.matched,
    missing_keywords: ats.missing,
    evidence: ev.items.slice(0, 10).map((x) => ({ title: x.title, type: x.source_type, href: href(x) })),
  };

  // Save as a searchable memory under "Job Search" so HIVEMIND can recall it later (voice or chat).
  const title = `Job analysis: ${analysis.role}${analysis.company ? ` @ ${analysis.company}` : ""}`;
  const content = [
    `${title}. Fit ${analysis.fit_score}/100, ATS keyword match ${analysis.ats_score}%.`,
    analysis.verdict,
    analysis.matched_keywords.length ? `Matched: ${analysis.matched_keywords.join(", ")}.` : "",
    analysis.missing_keywords.length ? `Missing: ${analysis.missing_keywords.join(", ")}.` : "",
    analysis.gaps.length ? `Gaps: ${analysis.gaps.map((g) => g.gap).join("; ")}.` : "",
    `Tailored summary: ${analysis.tailored_summary}`,
  ]
    .filter(Boolean)
    .join("\n");
  const [projectId, vector] = await Promise.all([jobProjectId(supabase), embedOne(`${title}\n\n${content}`)]);
  const { data: saved, error } = await supabase
    .from("memories")
    .insert({
      title,
      content,
      memory_type: "decision",
      category: "Career",
      importance: 7,
      confidence: 1,
      tags: ["job", "career", ...analysis.matched_keywords.slice(0, 5)],
      metadata: { source: CAREER_SOURCE, job_description: jd.slice(0, 20000), analysis, model: res.model, apply_link: input.applyLink || null, location: input.location || null },
      embedding: toVector(vector),
      project_id: projectId,
    })
    .select("id, created_at")
    .single();
  dbError(error);
  await logActivity(supabase, "career", `Analysed “${title.replace("Job analysis: ", "")}” (fit ${analysis.fit_score}, ATS ${analysis.ats_score}%)`);
  return { id: saved!.id as string, created_at: saved!.created_at as string, analysis, model: res.model };
}
