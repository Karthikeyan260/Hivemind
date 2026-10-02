import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { logActivity } from "@/lib/activity";
import { dbError } from "@/lib/api";
import { generateWithFallback, parseJson } from "@/lib/ai/providers";

export const ProfileFacts = z.object({
  name: z.string().default(""),
  headline: z.string().default(""),
  current_role: z.string().default(""),
  location: z.string().default(""),
  summary: z.string().default(""),
  top_skills: z.array(z.string()).max(12).default([]),
  focus_areas: z.array(z.string()).max(8).default([]),
  goals: z.array(z.string()).max(8).default([]),
  working_style: z.string().default(""),
});
export type Profile = z.infer<typeof ProfileFacts> & { updated_at?: string };

const SYSTEM = `You are HIVEMIND, a personal AI. From the owner's own stored knowledge, write what you understand
about them. Be specific and factual, only use what the data supports. Respond in JSON only with keys:
name, headline, current_role, location, summary (3-4 sentences, second person "You are..."),
top_skills (<=10), focus_areas (<=6 themes they keep working on), goals (<=6, only if stated or clearly implied),
working_style (1 sentence, only if the data supports it, else "").`;

export async function getProfile(supabase: SupabaseClient): Promise<Profile | null> {
  const { data, error } = await supabase.from("brain_profile").select("facts, updated_at").eq("id", 1).maybeSingle();
  dbError(error);
  if (!data) return null;
  return { ...ProfileFacts.parse(data.facts), updated_at: data.updated_at };
}

/** Re-reads the most important knowledge and regenerates HIVEMIND's understanding of the owner. */
export async function rebuildProfile(supabase: SupabaseClient) {
  const [mems, projects, notes] = await Promise.all([
    supabase.from("memories").select("title, content, memory_type").order("importance", { ascending: false }).order("updated_at", { ascending: false }).limit(40),
    supabase.from("projects").select("name, description, status").limit(40),
    supabase.from("notes").select("title, summary").order("updated_at", { ascending: false }).limit(15),
  ]);
  dbError(mems.error);
  const corpus = [
    ...(mems.data ?? []).map((m) => `(${m.memory_type}) ${m.title}\n${m.content.slice(0, 700)}`),
    ...(projects.data ?? []).map((p) => `(project, ${p.status}) ${p.name}: ${p.description ?? ""}`),
    ...(notes.data ?? []).map((n) => `(note) ${n.title}: ${n.summary ?? ""}`),
  ].join("\n\n");
  if (!corpus.trim()) return null;

  const res = await generateWithFallback([{ role: "user", content: corpus.slice(0, 30000) }], {
    system: SYSTEM,
    json: true,
    temperature: 0.2,
    maxTokens: 1200,
    order: ["gemini", "nvidia", "openrouter", "groq"],
  });
  const facts = parseJson(res.text, ProfileFacts);
  if (!facts) return null;

  const { error } = await supabase
    .from("brain_profile")
    .upsert({ id: 1, summary: facts.summary, facts, updated_at: new Date().toISOString() });
  dbError(error);
  await logActivity(supabase, "profile_updated", "Updated my understanding of you");
  return facts;
}

export function profileForPrompt(p: Profile | null) {
  if (!p) return "(No profile yet.)";
  return [
    `${p.name}${p.headline ? `, ${p.headline}` : ""}${p.current_role ? ` (${p.current_role})` : ""}${p.location ? `, ${p.location}` : ""}`,
    p.summary,
    p.top_skills.length ? `Top skills: ${p.top_skills.join(", ")}` : "",
    p.focus_areas.length ? `Focus areas: ${p.focus_areas.join(", ")}` : "",
    p.goals.length ? `Goals: ${p.goals.join("; ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}
