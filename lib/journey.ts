import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { dbError } from "@/lib/api";

// The owner's career as a git graph, built from the structured portfolio memories
// (experience:*, education:*, project:*, certs:*), so it updates whenever the portfolio syncs.

export const LANES = [
  { id: "main", label: "main", hint: "education" },
  { id: "experience", label: "completed_experience", hint: "internships" },
  { id: "projects", label: "projects", hint: "builds" },
  { id: "current", label: "current_work", hint: "now" },
] as const;
export type LaneId = (typeof LANES)[number]["id"];

export type Commit = {
  id: string;
  lane: LaneId;
  /** Sort key, "YYYY-MM". */
  at: string;
  period: string;
  title: string;
  subtitle?: string;
  description?: string;
  tags: string[];
  current?: boolean;
  /** This commit merges its lane back into main. */
  mergeFrom?: LaneId[];
  /** Branch point for these lanes. */
  branches?: LaneId[];
  memoryId?: string;
  kind: "education" | "work" | "project" | "milestone" | "now";
};

type Row = { id: string; title: string; content: string; key: string | null };

/** "Key: value" lines produced by the portfolio import. */
function fields(content: string) {
  const out: Record<string, string> = {};
  for (const line of content.split("\n")) {
    const m = line.match(/^([A-Za-z][A-Za-z ]{1,24}):\s*(.*)$/);
    if (m && !(m[1] in out)) out[m[1].toLowerCase()] = m[2].trim();
  }
  return out;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const ym = (s?: string) => {
  const m = s?.match(/^(\d{4})(?:-(\d{2}))?/);
  return m ? `${m[1]}-${m[2] ?? "01"}` : null;
};
const pretty = (s: string | null, withMonth = true) => {
  if (!s) return "";
  const [y, m] = s.split("-");
  return withMonth && m ? `${MONTHS[Number(m) - 1]} ${y}` : y;
};

export async function buildJourney(supabase: SupabaseClient) {
  const { data, error } = await supabase
    .from("memories")
    .select("id, title, content, metadata->>source_key")
    .or("metadata->>source_key.like.experience:%,metadata->>source_key.like.education:%,metadata->>source_key.like.project:%,metadata->>source_key.like.certs:%");
  dbError(error);
  const rows = ((data ?? []) as { id: string; title: string; content: string; source_key: string | null }[]).map((r): Row => ({ id: r.id, title: r.title, content: r.content, key: r.source_key }));
  const byPrefix = (p: string) => rows.filter((r) => r.key?.startsWith(p));
  const commits: Commit[] = [];

  // Education → main
  const edu = byPrefix("education:").map((r) => ({ r, f: fields(r.content) }));
  const degree = edu.find((e) => /b\.?tech|bachelor|degree/i.test(e.f.degree ?? "")) ?? null;
  for (const { r, f } of edu) {
    if (degree && r.id === degree.r.id) continue;
    const end = ym(f["end date"]);
    if (!end) continue;
    const short = /(HSC|SSLC)/.exec(f.degree ?? "")?.[1] ?? f.degree;
    commits.push({ id: r.id, lane: "main", at: end, period: pretty(end, false), title: `${short} completed`, subtitle: f.institution, description: f.details, tags: [], memoryId: r.id, kind: "education" });
  }
  if (degree) {
    const s = ym(degree.f["start date"]) ?? "2021-01";
    commits.push({
      id: `${degree.r.id}:start`,
      lane: "main",
      at: `${s.slice(0, 4)}-08`,
      period: pretty(s, false),
      title: `Started ${degree.f.degree?.replace(/,.*/, "") ?? "degree"}`,
      subtitle: `${degree.f.degree} · ${degree.f.institution}`,
      tags: [],
      branches: ["experience", "projects"],
      memoryId: degree.r.id,
      kind: "education",
    });
  }

  // Experience → completed_experience (ended) / current_work (current)
  for (const r of byPrefix("experience:")) {
    const f = fields(r.content);
    const start = ym(f["start date"]);
    if (!start) continue;
    const current = /true/i.test(f.current ?? "");
    const end = current ? null : ym(f["end date"]);
    commits.push({
      id: r.id,
      lane: current ? "current" : "experience",
      at: start,
      period: `${pretty(start)} – ${current ? "Present" : pretty(end)}`,
      title: f.title ?? r.title,
      subtitle: [f.company, f.location].filter(Boolean).join(" · "),
      description: f.description,
      tags: (f.tags ?? "").split(",").map((t) => t.trim()).filter(Boolean),
      current,
      memoryId: r.id,
      kind: "work",
    });
  }

  // Projects: featured ones as their own commits, the rest folded into one per year.
  const projects = byPrefix("project:").map((r) => ({ r, f: fields(r.content) }));
  const minor = new Map<string, string[]>();
  for (const { r, f } of projects) {
    const year = f.year?.match(/\d{4}/)?.[0];
    if (!year) continue;
    const name = f.name ?? r.title.replace(/^Project:\s*/, "");
    if (/true/i.test(f.featured ?? "")) {
      commits.push({
        id: r.id,
        lane: "projects",
        at: `${year}-10`,
        period: `${year}${f.status ? ` · ${f.status}` : ""}`,
        title: name,
        subtitle: f.type,
        description: f.description ?? f.summary,
        tags: [f.cluster, ...(f.tags ?? f.stack ?? "").split(",")].map((t) => t?.trim()).filter((t): t is string => !!t).slice(0, 6),
        memoryId: r.id,
        kind: "project",
      });
    } else minor.set(year, [...(minor.get(year) ?? []), name]);
  }
  for (const [year, names] of minor) {
    commits.push({ id: `minor:${year}`, lane: "projects", at: `${year}-11`, period: year, title: `${names.length} more build${names.length > 1 ? "s" : ""}`, subtitle: names.join(" · "), tags: [], kind: "project" });
  }

  // Certifications / publications / achievements → one milestone on the experience lane.
  const certs = byPrefix("certs:").map((r) => ({ group: r.key!.slice(6), n: Number(r.title.match(/\((\d+)\)/)?.[1] ?? 0) }));
  if (certs.length) {
    const lastEdu = degree ? ym(degree.f["end date"]) : null;
    commits.push({
      id: "certs",
      lane: "experience",
      at: lastEdu ? `${lastEdu.slice(0, 4)}-03` : "2025-03",
      period: "Throughout",
      title: `${certs.reduce((a, c) => a + c.n, 0)} certifications, courses & awards`,
      subtitle: certs.map((c) => `${c.n} ${c.group.toLowerCase()}`).join(" · "),
      tags: [],
      kind: "milestone",
    });
  }

  // Graduation merges the completed lanes back into main.
  if (degree) {
    const end = ym(degree.f["end date"]);
    if (end) {
      commits.push({
        id: `${degree.r.id}:end`,
        lane: "main",
        at: `${end.slice(0, 4)}-05`,
        period: pretty(end, false),
        title: `Graduated ${degree.f.degree?.replace(/,.*/, "") ?? ""}`.trim(),
        subtitle: degree.f.institution,
        description: degree.f.details,
        tags: [],
        mergeFrom: ["experience", "projects"],
        branches: ["current"],
        memoryId: degree.r.id,
        kind: "education",
      });
    }
  }

  commits.sort((a, b) => a.at.localeCompare(b.at) || LANES.findIndex((l) => l.id === a.lane) - LANES.findIndex((l) => l.id === b.lane));
  const now = new Date();
  commits.push({
    id: "now",
    lane: "current",
    at: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`,
    period: "Now",
    title: "HEAD",
    subtitle: "Building HIVEMIND and growing as an AI engineer",
    tags: [],
    kind: "now",
  });

  return { lanes: LANES, commits, sourced: rows.length };
}
