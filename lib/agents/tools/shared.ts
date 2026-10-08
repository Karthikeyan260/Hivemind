import "server-only";
import { dbError } from "@/lib/api";
import { CAREER_SOURCE } from "@/lib/career";
import { type Contact, findContacts, normalizePhone, pretty } from "@/lib/contacts";
import type { Job } from "@/lib/external/jobs";
import type { RunContext } from "../types";

/** Helpers shared by the tool domains (split out of the old single tools.ts). */
export const str = (v: unknown) => (v == null ? "" : String(v)).trim();
export const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required });
export const S = { type: "string" };
/** Location tools without a location: how to fix it. */
export const NO_LOCATION = "I don't have this device's location. Allow location for HIVEMIND on this device (the browser asks; or Settings → Location) and ask again.";

/** A note or project by id or by words from its name ("shopping" finds "Shopping list"). */
export async function findNote(ctx: RunContext, which: string) {
  const w = which.replace(/[%,()]/g, " ").trim();
  if (!w) return null;
  const { data } = await ctx.supabase.from("notes").select("id, title, content").ilike("title", `%${w}%`).order("updated_at", { ascending: false }).limit(1).maybeSingle();
  return data as { id: string; title: string; content: string } | null;
}
export async function findProject(ctx: RunContext, which: string) {
  const w = which.replace(/[%,()]/g, " ").trim();
  if (!w) return null;
  const { data } = await ctx.supabase.from("projects").select("id, name").ilike("name", `%${w}%`).limit(1).maybeSingle();
  return data as { id: string; name: string } | null;
}

/** Adds sources to the shared list and returns their citation numbers. */
export function cite(ctx: RunContext, items: { type: string; title: string; href: string; similarity: number }[]) {
  return items.map((s) => {
    const existing = ctx.sources.find((x) => x.href === s.href);
    if (existing) return existing.n;
    const n = ctx.sources.length + 1;
    ctx.sources.push({ n, ...s });
    return n;
  });
}

export async function latestAnalysisId(ctx: RunContext) {
  const { data, error } = await ctx.supabase.from("memories").select("id").eq("metadata->>source", CAREER_SOURCE).order("created_at", { ascending: false }).limit(1);
  dbError(error);
  return (data?.[0]?.id as string | undefined) ?? null;
}

/** A value the last assistant message in this conversation kept in its metadata (e.g. its job search or sources). */
export async function lastReply<T>(ctx: RunContext, key: string, onlyPrevious = false): Promise<T | null> {
  if (!ctx.conversationId) return null;
  let q = ctx.supabase.from("messages").select(`value:metadata->${key}`).eq("conversation_id", ctx.conversationId).eq("role", "assistant");
  if (!onlyPrevious) q = q.not(`metadata->${key}`, "is", null);
  const { data, error } = await q.order("created_at", { ascending: false }).limit(1);
  dbError(error);
  return ((data?.[0] as { value?: T | null } | undefined)?.value ?? null) || null;
}
export const lastJobSearch = (ctx: RunContext) => lastReply<Job[]>(ctx, "jobs");

export const ORDINALS = ["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth"];
export const FILLER = new Set(["the", "a", "at", "in", "one", "job", "role", "for", "and", "no", "number", "#", "last", "listing", "option"]);

/** "2", "#2", "the second one", "Quest Global", "react developer at TCS" → one listing. */
export function pickJob(jobs: Job[], pick: string): Job | null {
  const p = pick.toLowerCase().trim();
  const words = p.split(/[^a-z0-9+#.]+/).filter((w) => w && !FILLER.has(w) && !ORDINALS.includes(w));
  const num = Number(p.match(/\d+/)?.[0]) || ORDINALS.findIndex((o) => words.length === 0 && p.includes(o)) + 1 || (p.includes("last") ? jobs.length : 0);
  const byNumber = num >= 1 && num <= jobs.length ? jobs[num - 1] : null;
  if (byNumber && words.every((w) => /^\d+$/.test(w))) return byNumber;
  // Otherwise match words against company/role; the best overlap wins.
  let best: Job | null = null;
  let bestScore = 0;
  for (const j of jobs) {
    const hay = `${j.company} ${j.title} ${j.location}`.toLowerCase();
    const score = words.filter((w) => !/^\d+$/.test(w) && hay.includes(w)).length;
    if (score > bestScore) [best, bestScore] = [j, score];
  }
  return best ?? byNumber;
}

/** One person's number: an explicit phone wins, else the brain's single match (asks when there are several). */
export async function resolveContact(ctx: RunContext, who: string, phone: string): Promise<Contact | { error: string; matches?: string[] }> {
  if (phone) {
    const p = normalizePhone(phone);
    return p ? { name: who || pretty(p), phone: p, from: "given", memory_id: "" } : { error: "That doesn't look like a valid Indian phone number." };
  }
  const found = await findContacts(ctx.supabase, who);
  if (!found.length) return { error: `I don't have a number for ${who}. Tell me it ("${who}'s number is …") and I'll save it.` };
  if (found.length > 1) return { error: `I have several numbers for ${who}. Which one?`, matches: found.map((f) => `${pretty(f.phone)} (from "${f.from}")`) };
  return found[0];
}

export const jobDescriptionText = (j: Job) =>
  [
    j.description,
    ...Object.entries(j.highlights).map(([k, v]) => `${k}:\n${v.map((x) => `- ${x}`).join("\n")}`),
    j.location ? `Location: ${j.location}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
