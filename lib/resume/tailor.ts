import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { embedOne } from "@/lib/ai/embeddings";
import { generateWithFallback, parseJson } from "@/lib/ai/providers";
import { dbError, HttpError, toVector } from "@/lib/api";
import { CAREER_SOURCE, type JobAnalysis, searchEvidence } from "@/lib/career";
import { parseLatex, type Resume, resumeText, type Section } from "./model";

export const MASTER_SOURCE = "resume-master";

export async function getMaster(supabase: SupabaseClient) {
  const { data, error } = await supabase
    .from("memories")
    .select("id, updated_at, metadata")
    .eq("metadata->>source", MASTER_SOURCE)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  dbError(error);
  if (!data) return null;
  const md = data.metadata as { resume: Resume; latex: string };
  return { id: data.id as string, updated_at: data.updated_at as string, resume: md.resume, latex: md.latex };
}

/** Stores the owner's LaTeX resume as the master (also searchable, so answers and ATS use it). */
export async function saveMaster(supabase: SupabaseClient, latex: string) {
  const resume = parseLatex(latex);
  const sectionCount = resume.sections.length;
  if (!resume.name || sectionCount < 2) throw new HttpError(422, "Couldn't read that LaTeX. Paste the full resume source, from \\documentclass to \\end{document}.");
  const text = resumeText(resume);
  const embedding = toVector(await embedOne(`Master resume\n\n${text.slice(0, 7000)}`));
  const existing = await getMaster(supabase);
  const row = {
    title: `Master resume (${resume.name})`,
    content: text.slice(0, 20000),
    memory_type: "fact",
    category: "Career",
    importance: 9,
    confidence: 1,
    tags: ["resume", "career"],
    metadata: { source: MASTER_SOURCE, latex, resume },
    embedding,
    updated_at: new Date().toISOString(),
  };
  const q = existing ? supabase.from("memories").update(row).eq("id", existing.id) : supabase.from("memories").insert(row);
  const { error } = await q;
  dbError(error);
  return resume;
}

const Tailored = z.object({
  headline: z.string(),
  sections: z.array(z.unknown()),
  changes: z.array(z.string()).max(30).default([]),
  keywords_added: z.array(z.string()).max(30).default([]),
});

const SYSTEM = `You tailor the candidate's resume to one job, as an honest expert resume writer.
You receive: the master resume as JSON, the job analysis (keywords matched/missing), and EXTRA EVIDENCE from the candidate's records.
Hard rules:
- Return the SAME JSON structure: same sections (same titles, kinds, columns, order), same entries/projects (same titles, dates, organisations). Never add or remove jobs, degrees, dates, employers or projects.
- You MAY: rewrite the professional summary for this role; rephrase bullets to mirror the job's wording; reorder bullets and skills so the most relevant come first; add a job keyword to skills or bullets ONLY if the master resume or the EXTRA EVIDENCE shows the candidate actually has it; adjust the headline wording (keep it truthful).
- NEVER invent metrics, numbers, tools, certifications or responsibilities. Keep every number exactly as in the master.
- A keyword may go into a specific job's or project's bullets ONLY if the evidence is about that same job/project. Evidence from a different project (e.g. a personal side project) supports adding the keyword to Skills or the Summary only, never to another job's bullets.
- Headline: build it only from titles already in the master headline plus the target role title. Never claim an industry, domain or seniority (e.g. "FinTech", "Senior") the evidence doesn't show.
- Tailoring is REQUIRED even when no keywords are missing. Always: (1) rewrite the professional summary so it opens with the target role and foregrounds the job's most important keywords the candidate already matches, in the job's own wording; (2) rephrase the 3-6 most relevant bullets to use the job's terminology for things the candidate already did; (3) order skills within each row so job-relevant ones come first. Wording changes only, the facts stay the same.
- Keep length similar (it must still fit one page): at most one extra bullet per entry, bullets under ~30 words.
Respond with JSON only: {"headline": string, "sections": [...same shape as input...], "changes": ["short human-readable description of each change"], "keywords_added": ["job keywords you worked in"]}`;

const numbers = (t: string) => new Set((t.match(/\d[\d.,]*\+?%?/g) ?? []).map((n) => n.replace(/[.,]$/, "")));

/** Same skeleton as the master, else reject: the model may reword, never restructure. */
function sameSkeleton(master: Resume, sections: Section[]) {
  if (sections.length !== master.sections.length) return false;
  return master.sections.every((m, i) => {
    const t = sections[i] as Section;
    if (!t || t.kind !== m.kind || t.title !== m.title) return false;
    if (m.kind === "entries" && t.kind === "entries") return t.entries.length === m.entries.length && m.entries.every((e, k) => t.entries[k]?.title === e.title && t.entries[k]?.dates === e.dates);
    if (m.kind === "skills" && t.kind === "skills") return t.rows.length === m.rows.length;
    if (m.kind === "projects" && t.kind === "projects") return t.projects.length === m.projects.length && m.projects.every((p, k) => t.projects[k]?.name === p.name);
    return true;
  });
}

export type TailoredResume = { resume: Resume; changes: string[]; keywords_added: string[]; not_added: string[]; warnings: string[]; created_at: string };

export async function tailorResume(supabase: SupabaseClient, analysisId: string): Promise<TailoredResume> {
  const master = await getMaster(supabase);
  if (!master) throw new HttpError(409, "Add your master resume first (paste your LaTeX on the Career page).");
  const { data: row, error } = await supabase.from("memories").select("id, metadata").eq("id", analysisId).eq("metadata->>source", CAREER_SOURCE).maybeSingle();
  dbError(error);
  if (!row) throw new HttpError(404, "Analysis not found");
  const md = row.metadata as { analysis: JobAnalysis; job_description?: string };
  const a = md.analysis;

  // Evidence for the job's missing keywords: only these may be added beyond the master resume.
  const extra = a.missing_keywords.length
    ? await searchEvidence(supabase, `experience with ${a.missing_keywords.join(", ")}`, { limit: 8, minSimilarity: 0.3 })
    : [];
  const evidenceText = extra.map((x, i) => `[E${i + 1}] ${x.title}: ${x.content.slice(0, 700)}`).join("\n\n");

  const prompt = `JOB: ${a.role}${a.company ? ` at ${a.company}` : ""}
Keywords the candidate already matches: ${a.matched_keywords.join(", ") || "-"}
Keywords missing from the resume: ${a.missing_keywords.join(", ") || "-"}
Job description (excerpt):
${(md.job_description ?? "").slice(0, 5000)}

EXTRA EVIDENCE (only source for adding missing keywords):
${evidenceText || "(none)"}

MASTER RESUME JSON:
${JSON.stringify({ headline: master.resume.headline, sections: master.resume.sections })}`;

  const res = await generateWithFallback([{ role: "user", content: prompt }], { system: SYSTEM, json: true, temperature: 0.2, maxTokens: 6000, order: ["gemini", "nvidia", "openrouter"] });
  const out = parseJson(res.text, Tailored);
  if (!out) throw new HttpError(502, "The model returned an unreadable resume. Try again.");
  const sections = out.sections as Section[];
  if (!sameSkeleton(master.resume, sections)) throw new HttpError(502, "The tailored draft changed the resume's structure, so it was rejected. Try again.");

  // Guardrail: a job's/project's bullets may not gain a new keyword unless the evidence is about that job/project.
  // Otherwise the whole block reverts to the owner's original wording.
  const reverted: string[] = [];
  const newKeywords = a.missing_keywords.map((k) => k.toLowerCase());
  const mentions = (bullets: string[], k: string) => bullets.some((b) => b.toLowerCase().includes(k));
  const supportedFor = (name: string, k: string) =>
    extra.some((x) => (x.title + " " + x.content).toLowerCase().includes(name.toLowerCase().split(/[–-]/)[0].trim()) && (x.title + " " + x.content).toLowerCase().includes(k));
  const fixed: Section[] = sections.map((sec, i) => {
    const m = master.resume.sections[i];
    if (sec.kind === "entries" && m.kind === "entries") {
      return {
        ...sec,
        entries: sec.entries.map((e, k) => {
          const orig = m.entries[k];
          const bad = newKeywords.filter((kw) => mentions(e.bullets, kw) && !mentions(orig.bullets, kw) && !supportedFor(`${orig.title} ${orig.subtitle}`, kw));
          if (!bad.length) return e;
          reverted.push(`Kept your original bullets for “${orig.title}” (unsupported there: ${bad.join(", ")})`);
          return { ...e, bullets: orig.bullets, footer: orig.footer };
        }),
      };
    }
    if (sec.kind === "projects" && m.kind === "projects") {
      return {
        ...sec,
        projects: sec.projects.map((p, k) => {
          const orig = m.projects[k];
          const bad = newKeywords.filter((kw) => mentions(p.bullets, kw) && !mentions(orig.bullets, kw) && !supportedFor(orig.name, kw));
          if (!bad.length) return p;
          reverted.push(`Kept your original bullets for “${orig.name}” (unsupported there: ${bad.join(", ")})`);
          return { ...p, bullets: orig.bullets };
        }),
      };
    }
    return sec;
  });

  // Guardrail: a missing keyword with no evidence at all may not appear anywhere (headline, summary, skills, lists).
  const escRe = (k: string) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const hasWord = (text: string, k: string) => new RegExp(`(^|[^a-z0-9])${escRe(k.toLowerCase())}([^a-z0-9]|$)`).test(text.toLowerCase());
  const masterText = resumeText(master.resume);
  const unsupported = newKeywords.filter((k) => !hasWord(evidenceText, k) && !hasWord(masterText, k));
  const offending = (text: string, orig: string) => unsupported.filter((k) => hasWord(text, k) && !hasWord(orig, k));
  const clean: Section[] = fixed.map((sec, i) => {
    const m = master.resume.sections[i];
    if (sec.kind === "text" && m.kind === "text") {
      const bad = offending(sec.text, m.text);
      if (!bad.length) return sec;
      // Drop only the sentences that make the unsupported claim; keep the rest of the rewrite.
      const kept = (sec.text.match(/[^.!?]+[.!?]+(\s|$)|[^.!?]+$/g) ?? [sec.text]).filter((x) => !offending(x, m.text).length);
      reverted.push(`Removed a “${m.title}” sentence claiming ${bad.join(", ")} (no evidence)`);
      const text = kept.join("").trim();
      return { ...sec, text: text.length > m.text.length * 0.4 ? text : m.text };
    }
    if (sec.kind === "skills" && m.kind === "skills") {
      return {
        ...sec,
        rows: sec.rows.map((row, j) => {
          // Row labels are the master's; only the items may change.
          const r = { ...row, label: m.rows[j]?.label ?? row.label };
          const orig = m.rows[j]?.items ?? "";
          const kept = r.items.split(/,\s*/).filter((item) => !offending(item, orig).length);
          const dropped = r.items.split(/,\s*/).length - kept.length;
          if (dropped) reverted.push(`Removed ${dropped} unsupported skill${dropped > 1 ? "s" : ""} from “${r.label}”`);
          // Job-matched skills lead each row (stable order otherwise).
          const rank = (item: string) => (a.matched_keywords.some((k) => hasWord(item, k) || hasWord(k, item)) ? 0 : 1);
          return { ...r, items: kept.map((item, n) => ({ item, n })).sort((x, y) => rank(x.item) - rank(y.item) || x.n - y.n).map((x) => x.item).join(", ") };
        }),
      };
    }
    if (sec.kind === "list" && m.kind === "list") {
      return { ...sec, items: sec.items.filter((it) => m.items.includes(it) || !offending(it, "").length) };
    }
    return sec;
  });
  const headlineBad = offending(out.headline ?? "", master.resume.headline);
  const headline = out.headline && !headlineBad.length ? out.headline : master.resume.headline;

  const tailored: Resume = { ...master.resume, headline, sections: clean };

  // Guardrail: any number that isn't in the master or the evidence is flagged.
  const allowed = new Set([...numbers(resumeText(master.resume)), ...numbers(evidenceText)]);
  const invented = [...numbers(resumeText(tailored))].filter((n) => !allowed.has(n));
  const warnings = [...reverted, ...(invented.length ? [`Check these numbers, they are not in your master resume: ${invented.join(", ")}`] : [])];

  // Change log from a real diff against the master, not from the model's claims.
  const diff: string[] = [];
  if (headline !== master.resume.headline) diff.push(`Headline → “${headline}”`);
  clean.forEach((sec, i) => {
    const m = master.resume.sections[i];
    if (sec.kind === "text" && m.kind === "text" && sec.text !== m.text) diff.push(`Rewrote “${m.title}” for ${a.role}`);
    if (sec.kind === "skills" && m.kind === "skills")
      sec.rows.forEach((r, j) => {
        if (r.items === m.rows[j]?.items) return;
        const lead = r.items.split(/,\s*/).slice(0, 3).join(", ");
        diff.push(`${r.label}: now leads with ${lead}`);
      });
    if (sec.kind === "entries" && m.kind === "entries")
      sec.entries.forEach((e, k) => {
        const n = e.bullets.filter((b, x) => b !== m.entries[k].bullets[x]).length;
        if (n) diff.push(`${e.title}: reworded ${n} bullet${n > 1 ? "s" : ""} toward the job's wording`);
      });
    if (sec.kind === "projects" && m.kind === "projects")
      sec.projects.forEach((p, k) => {
        const n = p.bullets.filter((b, x) => b !== m.projects[k].bullets[x]).length;
        if (n) diff.push(`${p.name}: reworded ${n} bullet${n > 1 ? "s" : ""}`);
      });
  });

  // Report what actually happened, not what the model claims.
  const finalText = resumeText(tailored);
  const added = a.missing_keywords.filter((k) => hasWord(finalText, k) && !hasWord(masterText, k));
  const notAdded = a.missing_keywords.filter((k) => !added.includes(k));
  const result: TailoredResume = {
    resume: tailored,
    changes: diff,
    keywords_added: added,
    not_added: notAdded,
    warnings,
    created_at: new Date().toISOString(),
  };

  const { error: upErr } = await supabase
    .from("memories")
    .update({ metadata: { ...md, tailored_resume: result } })
    .eq("id", analysisId);
  dbError(upErr);
  return result;
}

export async function getTailored(supabase: SupabaseClient, analysisId: string) {
  const { data, error } = await supabase.from("memories").select("metadata").eq("id", analysisId).eq("metadata->>source", CAREER_SOURCE).maybeSingle();
  dbError(error);
  if (!data) throw new HttpError(404, "Analysis not found");
  const md = data.metadata as { tailored_resume?: TailoredResume; analysis: JobAnalysis };
  return { tailored: md.tailored_resume ?? null, analysis: md.analysis };
}
