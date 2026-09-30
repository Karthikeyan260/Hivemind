import "server-only";
import { HttpError } from "@/lib/api";

// Live job listings through JSearch (RapidAPI): Google for Jobs results from LinkedIn, Indeed, Naukri,
// Foundit, company career sites… with the real apply link and the full description. Free plan: 200 requests/month.
const HOST = "jsearch.p.rapidapi.com";
const key = () => process.env.RAPIDAPI_KEY || process.env.RAPIDAPI_SECRET || "";

export type Job = {
  id: string;
  title: string;
  company: string;
  logo: string | null;
  location: string;
  remote: boolean;
  employment_type: string;
  posted: string;
  salary: string;
  publisher: string;
  apply_link: string;
  apply_is_direct: boolean;
  description: string;
  highlights: Record<string, string[]>;
};

type Raw = {
  job_id: string;
  job_title?: string;
  employer_name?: string;
  employer_logo?: string | null;
  job_publisher?: string;
  job_employment_type?: string;
  job_apply_link?: string;
  job_apply_is_direct?: boolean;
  job_description?: string;
  job_is_remote?: boolean;
  job_posted_at?: string | null;
  job_location?: string;
  job_city?: string | null;
  job_state?: string | null;
  job_country?: string | null;
  job_salary_string?: string | null;
  job_highlights?: Record<string, string[]> | null;
};

const toJob = (r: Raw): Job => ({
  id: r.job_id,
  title: r.job_title?.trim() || "Untitled role",
  company: r.employer_name?.trim() || "Unknown company",
  logo: r.employer_logo || null,
  location: r.job_location || [r.job_city, r.job_state, r.job_country].filter(Boolean).join(", ") || (r.job_is_remote ? "Remote" : ""),
  remote: !!r.job_is_remote,
  employment_type: r.job_employment_type ?? "",
  posted: r.job_posted_at ?? "",
  salary: r.job_salary_string ?? "",
  publisher: r.job_publisher ?? "",
  apply_link: r.job_apply_link ?? "",
  apply_is_direct: !!r.job_apply_is_direct,
  description: (r.job_description ?? "").trim(),
  highlights: r.job_highlights ?? {},
});

async function call<T>(path: string, params: Record<string, string>) {
  if (!key()) throw new HttpError(503, "Job search isn't set up: add RAPIDAPI_KEY (JSearch on RapidAPI) to the environment.");
  const res = await fetch(`https://${HOST}/${path}?${new URLSearchParams(params)}`, {
    headers: { "x-rapidapi-key": key(), "x-rapidapi-host": HOST },
    signal: AbortSignal.timeout(25_000),
  });
  if (res.status === 429) throw new HttpError(429, "The monthly job-search quota is used up. It resets at the start of the next billing month.");
  if (res.status === 401 || res.status === 403) throw new HttpError(503, "The job-search key was rejected. Check RAPIDAPI_KEY and that you're subscribed to JSearch.");
  if (!res.ok) throw new HttpError(502, "Job search is unavailable right now. Try again in a minute.");
  return (await res.json()) as T;
}

export type JobQuery = {
  role: string;
  location?: string;
  /** ISO 3166-1 alpha-2, e.g. "in", "us". */
  country?: string;
  remote?: boolean;
  date_posted?: "all" | "today" | "3days" | "week" | "month";
  limit?: number;
};

export async function searchJobs(q: JobQuery): Promise<Job[]> {
  const query = [q.role.trim(), q.location?.trim() ? `in ${q.location.trim()}` : ""].filter(Boolean).join(" ");
  const params: Record<string, string> = { query, page: "1", num_pages: "1", country: (q.country || "in").toLowerCase(), date_posted: q.date_posted || "month" };
  if (q.remote) params.work_from_home = "true";
  const r = await call<{ data?: { jobs?: Raw[] } }>("search-v2", params);
  const seen = new Set<string>();
  return (r.data?.jobs ?? [])
    .map(toJob)
    // The same posting often appears on several boards: keep the first.
    .filter((j) => {
      const k = `${j.title}|${j.company}`.toLowerCase();
      return seen.has(k) ? false : (seen.add(k), true);
    })
    .slice(0, q.limit ?? 10);
}

export async function jobDetails(id: string, country = "in"): Promise<Job | null> {
  const r = await call<{ data?: Raw[] }>("job-details", { job_id: id, country });
  return r.data?.[0] ? toJob(r.data[0]) : null;
}
