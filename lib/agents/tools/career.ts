import "server-only";
import { dbError } from "@/lib/api";
import { analyzeJob, CAREER_SOURCE } from "@/lib/career";
import { jobDetails, type JobQuery, searchJobs } from "@/lib/external/jobs";
import { getProfile } from "@/lib/profile";
import { tailorResume } from "@/lib/resume/tailor";
import { FILLER, jobDescriptionText, lastJobSearch, latestAnalysisId, obj, pickJob, S, str } from "./shared";
import type { Tool } from "../types";

/** Job analysis, tailored resumes and job search. */
export const career: Record<string, Tool> = {
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
  search_jobs: {
    name: "search_jobs",
    description:
      "Search live job openings on the internet (LinkedIn, Indeed, Naukri, company career sites…). Returns numbered listings with company, role, location and apply link; the full descriptions are shown to the owner as cards. Leave role empty to search for roles that fit the owner's resume/profile.",
    parameters: obj({
      role: { type: "string", description: "Job title or skills, e.g. 'React developer'. Empty = based on the owner's profile." },
      location: { type: "string", description: "City/region, e.g. 'Bangalore'. Empty = anywhere in the country." },
      country: { type: "string", description: "2-letter country code, default 'in' (India)." },
      remote: { type: "boolean", description: "Only remote / work-from-home jobs." },
      date_posted: { type: "string", enum: ["all", "today", "3days", "week", "month"], description: "Default 'month'." },
    }),
    async run(args, ctx) {
      let role = str(args.role);
      if (!role) {
        const p = await getProfile(ctx.supabase);
        role = p?.current_role || p?.headline || p?.top_skills.slice(0, 3).join(" ") || "";
        if (!role) return { error: "Tell me which role to search for (your profile doesn't say yet)." };
      }
      const jobs = await searchJobs({
        role,
        location: str(args.location),
        country: str(args.country) || "in",
        remote: args.remote === true,
        date_posted: (str(args.date_posted) || "month") as JobQuery["date_posted"],
      });
      if (!jobs.length) return { searched_for: role, results: [], note: "No openings found. Try a broader role or another location." };
      ctx.jobs = jobs;
      return {
        searched_for: role,
        results: jobs.map((j, i) => ({
          n: i + 1,
          role: j.title,
          company: j.company,
          location: j.location,
          posted: j.posted,
          salary: j.salary || undefined,
          via: j.publisher,
          summary: j.description.replace(/\s+/g, " ").slice(0, 220),
        })),
        note: "The owner sees each job as a card with the full description and an Apply button. To check one, call check_listed_job with its number.",
      };
    },
  },
  check_listed_job: {
    name: "check_listed_job",
    description:
      "For one job from the latest search_jobs results: run the ATS / fit check against the owner's resume, save it to Career, and generate the tailored resume PDF. 'pick' is the listing number ('2') or words from the company/role ('Quest Global').",
    parameters: obj({ pick: S, make_resume: { type: "boolean", description: "Also generate the tailored resume (default true)." } }, ["pick"]),
    async run(args, ctx) {
      const jobs = ctx.jobs ?? ctx.carried?.jobs ?? (await lastJobSearch(ctx));
      if (!jobs?.length) return { error: "There's no job search to pick from yet. Search for jobs first." };
      const job = pickJob(jobs, str(args.pick));
      if (!job) return { error: `Couldn't tell which job "${str(args.pick)}" means. Use its number (1-${jobs.length}).`, jobs: jobs.map((j, i) => `${i + 1}. ${j.title} @ ${j.company}`) };

      let jd = jobDescriptionText(job);
      if (jd.length < 300) {
        const full = await jobDetails(job.id).catch(() => null);
        if (full && jobDescriptionText(full).length > jd.length) jd = jobDescriptionText(full);
      }
      const r = await analyzeJob(ctx.supabase, { jobDescription: jd, role: job.title, company: job.company, applyLink: job.apply_link, location: job.location });
      ctx.changed = true;
      ctx.actions.push({ label: "Open in Career", href: `/career?open=${r.id}` });
      if (job.apply_link) ctx.actions.push({ label: `Apply at ${job.publisher || job.company}`, href: job.apply_link });
      const a = r.analysis;
      const out: Record<string, unknown> = {
        analysis_id: r.id,
        role: a.role,
        company: a.company,
        fit: a.fit_score,
        ats_percent: a.ats_score,
        verdict: a.verdict,
        matched_keywords: a.matched_keywords.slice(0, 12),
        missing_keywords: a.missing_keywords,
        gaps: a.gaps.slice(0, 3).map((g) => g.gap),
        apply_link: job.apply_link,
      };
      if (args.make_resume !== false) {
        try {
          const t = await tailorResume(ctx.supabase, r.id);
          ctx.actions.push({ label: "Download tailored resume", href: `/api/career/${r.id}/resume?format=pdf-download` });
          out.resume = { generated: true, keywords_added: t.keywords_added, left_out_no_evidence: t.not_added };
        } catch (err) {
          out.resume = { generated: false, error: err instanceof Error ? err.message : "Resume generation failed." };
        }
      }
      return out;
    },
  },
  delete_job_analysis: {
    name: "delete_job_analysis",
    description:
      "Step 1 of deleting a saved job analysis (Career history): finds it by role/company words ('the clinical research one', 'Infosys'), 'latest', or its id, and asks the owner to confirm. It does NOT delete anything by itself; confirm_delete_memory does after they say yes.",
    parameters: obj({ which: S, id: S }),
    async run(args, ctx) {
      const { data, error } = await ctx.supabase.from("memories").select("id, title, created_at").eq("metadata->>source", CAREER_SOURCE).order("created_at", { ascending: false }).limit(30);
      dbError(error);
      const rows = data ?? [];
      if (!rows.length) return { error: "There are no saved job analyses." };
      const id = str(args.id);
      const words = str(args.which).toLowerCase().split(/[^a-z0-9+#.]+/).filter((w) => w.length > 1 && !FILLER.has(w) && !["latest", "last", "this", "that", "analysis", "delete"].includes(w));
      let target = id ? rows.find((r) => r.id === id) : undefined;
      if (!target && words.length) {
        const scored = rows.map((r) => ({ r, s: words.filter((w) => r.title.toLowerCase().includes(w)).length })).sort((a, b) => b.s - a.s);
        if (scored[0].s > 0) target = scored[0].r;
      }
      if (!target && !words.length) target = rows[0];
      if (!target) return { error: `No job analysis matches "${str(args.which)}".`, analyses: rows.slice(0, 8).map((r) => r.title.replace("Job analysis: ", "")) };
      ctx.pendingDelete = { id: target.id, title: target.title };
      return {
        needs_confirmation: true,
        analysis: target.title.replace("Job analysis: ", ""),
        saved: target.created_at,
        note: "Ask the owner to confirm deleting this analysis (and its tailored resume). Only after they say yes, call confirm_delete_memory.",
      };
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
};
