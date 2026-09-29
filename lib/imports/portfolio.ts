import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { embedMany } from "@/lib/ai/embeddings";
import { dbError, HttpError, toVector } from "@/lib/api";
import { logActivity } from "@/lib/activity";
import { storeDocument } from "@/lib/documents/store";
import { rebuildProfile } from "@/lib/profile";
import { chunkText } from "@/lib/rag/chunker";

export const PORTFOLIO_SOURCE = "portfolio-mcp";
const REPO = process.env.PORTFOLIO_DATA_REPO || "Karthikeyan260/Portfolio-mcp";
const RESOURCES = ["profile", "experience", "projects", "skills", "certifications", "education", "contact"] as const;
type Name = (typeof RESOURCES)[number];
type Json = Record<string, unknown>;

/** Reads portfolio://*.json resources via the MCP server (JSON-RPC over HTTP). */
async function fromMcp(endpoint: string): Promise<Record<string, string>> {
  const uris = [...RESOURCES.map((n) => `portfolio://${n}.json`), "portfolio://resume.md"];
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify([
      {
        jsonrpc: "2.0",
        id: "init",
        method: "initialize",
        params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "second-brain", version: "1.0" } },
      },
      ...uris.map((uri, i) => ({ jsonrpc: "2.0", id: i, method: "resources/read", params: { uri } })),
    ]),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`MCP HTTP ${res.status}`);
  const replies = (await res.json()) as { id: unknown; result?: { contents?: { text?: string }[] }; error?: { message: string } }[];
  const out: Record<string, string> = {};
  uris.forEach((uri, i) => {
    const r = replies.find((x) => x.id === i);
    const text = r?.result?.contents?.[0]?.text;
    if (!text) throw new Error(`MCP could not read ${uri}: ${r?.error?.message ?? "no content"}`);
    out[uri.replace("portfolio://", "")] = text;
  });
  return out;
}

/** Fallback: the MCP's own data files straight from GitHub. */
async function fromGitHub(): Promise<Record<string, string>> {
  const files = [...RESOURCES.map((n) => `${n}.json`), "resume.md"];
  const out: Record<string, string> = {};
  await Promise.all(
    files.map(async (f) => {
      const res = await fetch(`https://raw.githubusercontent.com/${REPO}/main/data/${f}`, { signal: AbortSignal.timeout(15_000) });
      if (!res.ok) throw new Error(`GitHub ${f}: HTTP ${res.status}`);
      out[f] = await res.text();
    }),
  );
  return out;
}

const str = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v));

/** Turns any JSON value into readable "Key: value" text for embedding and display. */
function toText(value: unknown, indent = ""): string {
  if (value == null || value === "") return "";
  if (Array.isArray(value)) {
    if (value.every((v) => typeof v !== "object" || v === null)) return value.filter((v) => v != null).join(", ");
    return value.map((v) => `${indent}- ${toText(v, indent + "  ").trimStart()}`).join("\n");
  }
  if (typeof value === "object") {
    return Object.entries(value as Json)
      .filter(([k, v]) => v != null && v !== "" && k !== "id" && !(Array.isArray(v) && v.length === 0))
      .map(([k, v]) => {
        const label = k.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());
        const t = toText(v, indent + "  ");
        return typeof v === "object" && !(Array.isArray(v) && v.every((x) => typeof x !== "object"))
          ? `${indent}${label}:\n${t}`
          : `${indent}${label}: ${t}`;
      })
      .join("\n");
  }
  return str(value);
}

type Item = { title: string; content: string; memory_type: string; category: string; importance: number; tags: string[]; key: string };

function buildItems(files: Record<string, string>): Item[] {
  const parse = (n: Name) => JSON.parse(files[`${n}.json`]) as unknown;
  const items: Item[] = [];
  const add = (key: string, title: string, data: unknown, memory_type: string, category: string, importance: number, tags: string[]) =>
    items.push({ key, title: title.slice(0, 200), content: toText(data).slice(0, 20000), memory_type, category, importance, tags: [...new Set(["portfolio", ...tags])] });

  const profile = parse("profile") as Json;
  add("profile", `About me — ${str(profile.name)}, ${str(profile.headline)}`, profile, "fact", "Profile", 10, ["profile", "about me"]);

  for (const e of parse("experience") as Json[]) {
    add(`experience:${str(e.id)}`, `${str(e.title)} at ${str(e.company)}`, e, "experience", "Career", 9, ["experience", "work", str(e.company).toLowerCase()]);
  }
  for (const p of parse("projects") as Json[]) {
    add(`project:${str(p.id)}`, `Project: ${str(p.name)}`, p, "project_context", "Projects", p.featured ? 8 : 7, ["project", str(p.cluster).toLowerCase()].filter(Boolean));
  }
  const skills = parse("skills") as Json[];
  for (const s of skills) {
    add(`skills:${str(s.category)}`, `Skills — ${str(s.category)}`, s, "knowledge", "Skills", 7, ["skills", str(s.category).toLowerCase()]);
  }
  const certs = parse("certifications") as Json[];
  const byGroup = new Map<string, Json[]>();
  for (const c of certs) byGroup.set(str(c.group) || "Certifications", [...(byGroup.get(str(c.group) || "Certifications") ?? []), c]);
  for (const [group, list] of byGroup) {
    add(`certs:${group}`, `${group} (${list.length})`, list, "learning", "Certifications", 6, ["certifications", group.toLowerCase()]);
  }
  for (const ed of parse("education") as Json[]) {
    add(`education:${str(ed.id)}`, `Education: ${str(ed.degree)} — ${str(ed.institution)}`, ed, "fact", "Education", 7, ["education"]);
  }
  add("contact", "My contact details and social links", parse("contact"), "fact", "Profile", 6, ["contact", "links"]);
  return items;
}

export async function importPortfolio(supabase: SupabaseClient) {
  const endpoint = process.env.PORTFOLIO_MCP_URL;
  let files: Record<string, string>;
  let via: "mcp" | "github" = "github";
  if (endpoint) {
    try {
      files = await fromMcp(endpoint);
      via = "mcp";
    } catch (err) {
      console.warn("portfolio MCP failed, using GitHub data:", err instanceof Error ? err.message : err);
      files = await fromGitHub();
    }
  } else {
    files = await fromGitHub();
  }

  let items: Item[];
  try {
    items = buildItems(files);
  } catch {
    throw new HttpError(502, "Portfolio data has an unexpected format");
  }

  const projectIds = await syncProjects(supabase, JSON.parse(files["projects.json"]) as Json[]);
  const embeddings = await embedMany(items.map((it) => `${it.title}\n\n${it.content}`));
  const now = new Date().toISOString();

  // Replace the previous import so re-syncs mirror the portfolio exactly.
  const { error: delErr } = await supabase.from("memories").delete().eq("metadata->>source", PORTFOLIO_SOURCE);
  dbError(delErr);
  const { error: insErr } = await supabase.from("memories").insert(
    items.map((it, i) => ({
      title: it.title,
      content: it.content,
      memory_type: it.memory_type,
      category: it.category,
      importance: it.importance,
      confidence: 1,
      tags: it.tags,
      metadata: { source: PORTFOLIO_SOURCE, source_key: it.key, via, synced_at: now },
      embedding: toVector(embeddings[i]),
      project_id: projectIds.get(it.key) ?? null,
    })),
  );
  dbError(insErr);

  const resume = await storeDocument(
    supabase,
    { filename: "Resume (portfolio MCP)", fileType: "md", sourceUrl: `${PORTFOLIO_SOURCE}://resume.md` },
    chunkText(files["resume.md"]).map((content) => ({ content, metadata: {} })),
  );

  await logActivity(
    supabase,
    "import",
    `Synced portfolio via ${via === "mcp" ? "your MCP" : "GitHub"}: ${items.length} memories, ${projectIds.size} projects`,
  );
  const profile = await rebuildProfile(supabase).catch(() => null);

  return { via, memories: items.length, projects: projectIds.size, resumeChunks: resume?.chunk_count ?? 0, profile: !!profile, syncedAt: now };
}

const PROJECT_STATUS: Record<string, string> = { LIVE: "active", ACTIVE: "active", WIP: "active", ARCHIVED: "done", DONE: "done" };

/** Mirrors portfolio projects into the Projects table. Returns memory source_key → project id. */
async function syncProjects(supabase: SupabaseClient, list: Json[]) {
  const map = new Map<string, string>();
  const { data: existing, error } = await supabase.from("projects").select("id, name, source_key");
  dbError(error);

  for (const p of list) {
    const key = `portfolio:${str(p.id)}`;
    const fields = {
      name: str(p.name).slice(0, 120),
      description: str(p.mission || p.type).slice(0, 2000) || null,
      status: PROJECT_STATUS[str(p.status).toUpperCase()] ?? "done",
      source_key: key,
      metadata: { source: PORTFOLIO_SOURCE, cluster: p.cluster ?? null, year: p.year ?? null, featured: !!p.featured },
      updated_at: new Date().toISOString(),
    };
    const match =
      existing?.find((e) => e.source_key === key) ??
      existing?.find((e) => e.name.toLowerCase() === fields.name.toLowerCase());
    let id = match?.id as string | undefined;
    if (id) {
      const { error: uErr } = await supabase.from("projects").update(fields).eq("id", id);
      dbError(uErr);
    } else {
      const { data, error: iErr } = await supabase.from("projects").insert(fields).select("id").single();
      dbError(iErr);
      id = data!.id;
      await logActivity(supabase, "project_created", `Created project “${fields.name}” from your portfolio`, {
        type: "project_created",
        project_id: id!,
      });
    }
    map.set(`project:${str(p.id)}`, id!);
  }
  return map;
}
