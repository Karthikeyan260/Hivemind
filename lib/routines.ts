import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readJSON, writeJSON } from "@/lib/private-store";

/**
 * Routines: one phrase ("good morning", "gym mode") runs several things HIVEMIND can already do.
 * Steps are plain commands in the owner's words; chat runs each through the agents, live voice runs
 * them with its own tools. Steps never delete, send or approve anything: those still need the owner
 * to ask separately (the owner-intent guard sees only what they said this turn).
 */
export type Routine = { id: string; name: string; triggers: string[]; steps: string[]; created_at: string; last_run?: string; runs?: number };
type Store = { items: Routine[]; seeded?: boolean };

const KEY = "routines";
const MAX_STEPS = 8;

const STARTER: Omit<Routine, "id" | "created_at"> = {
  name: "Good morning",
  triggers: ["good morning", "morning routine"],
  steps: ["What's the weather today?", "What's on my schedule today?", "How are my habits and streaks?", "Play a relaxing Tamil melody"],
};

async function load(supabase: SupabaseClient): Promise<Store> {
  const s = await readJSON<Store>(supabase, KEY, { items: [] });
  // A starter routine the first time, so the owner sees how it works (deleting it keeps it gone).
  if (!s.seeded) {
    s.items.unshift({ ...STARTER, id: crypto.randomUUID(), created_at: new Date().toISOString() });
    s.seeded = true;
    await writeJSON(supabase, KEY, s);
  }
  return s;
}

export const listRoutines = async (supabase: SupabaseClient) => (await load(supabase)).items;

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, " ").replace(/\s+/g, " ").trim();

function clean(r: { name?: string; triggers?: unknown; steps?: unknown }) {
  const name = String(r.name ?? "").trim().slice(0, 60);
  const steps = (Array.isArray(r.steps) ? r.steps : String(r.steps ?? "").split(/\n|;/))
    .map((x) => String(x).trim().replace(/^[-*\d.)\s]+/, ""))
    .filter(Boolean)
    .slice(0, MAX_STEPS)
    .map((x) => x.slice(0, 200));
  const triggers = [...new Set([name, ...(Array.isArray(r.triggers) ? r.triggers : String(r.triggers ?? "").split(/,|\n/))].map((x) => norm(String(x))).filter((x) => x.length >= 2))].slice(0, 6);
  return { name, steps, triggers };
}

/** Finds a routine by its name, one of its trigger phrases, or words from them. */
export function matchRoutine(items: Routine[], words: string) {
  const w = norm(words).replace(/\b(run|start|do|my|the|routine|please)\b/g, " ").replace(/\s+/g, " ").trim();
  if (!w) return null;
  return (
    items.find((r) => r.triggers.includes(w) || norm(r.name) === w) ??
    items.find((r) => r.triggers.some((t) => w.includes(t) || t.includes(w))) ??
    items.find((r) => norm(r.name).includes(w)) ??
    null
  );
}

/** The routine a whole chat message starts: exactly one of its phrases, or "run my X routine". */
export function triggeredRoutine(items: Routine[], message: string) {
  const m = norm(message);
  if (m.length > 80) return null;
  const exact = items.find((r) => r.triggers.includes(m) || norm(r.name) === m);
  if (exact) return exact;
  const run = /^(please )?(run|start|do)( my| the)? (.+?)( routine)?$/.exec(m);
  return run && /routine/.test(m) ? matchRoutine(items, run[4]) : null;
}

export async function saveRoutine(supabase: SupabaseClient, input: { id?: string; name?: string; triggers?: unknown; steps?: unknown }) {
  const s = await load(supabase);
  const { name, steps, triggers } = clean(input);
  if (!name) throw new Error("Give the routine a name.");
  if (!steps.length) throw new Error("Add at least one step.");
  const existing = input.id ? s.items.find((r) => r.id === input.id) : s.items.find((r) => norm(r.name) === norm(name));
  if (existing) Object.assign(existing, { name, steps, triggers });
  else s.items.push({ id: crypto.randomUUID(), name, triggers, steps, created_at: new Date().toISOString() });
  if (s.items.length > 30) throw new Error("That's a lot of routines: delete one first.");
  await writeJSON(supabase, KEY, s);
  return existing ?? s.items[s.items.length - 1];
}

export async function deleteRoutine(supabase: SupabaseClient, id: string) {
  const s = await load(supabase);
  const r = s.items.find((x) => x.id === id);
  s.items = s.items.filter((x) => x.id !== id);
  await writeJSON(supabase, KEY, s);
  return r ?? null;
}

export async function markRun(supabase: SupabaseClient, id: string) {
  const s = await load(supabase);
  const r = s.items.find((x) => x.id === id);
  if (!r) return;
  r.last_run = new Date().toISOString();
  r.runs = (r.runs ?? 0) + 1;
  await writeJSON(supabase, KEY, s);
}

/** For the voice prompt: the phrases that start each routine. */
export const routinesForPrompt = (items: Routine[]) =>
  items.length ? items.map((r) => `"${r.name}" (said as: ${r.triggers.map((t) => `"${t}"`).join(", ")})`).join("; ") : "(none yet)";
