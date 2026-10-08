import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { generateWithFallback, parseJson } from "@/lib/ai/providers";
import { unlocksAction } from "@/lib/agents/intent";
import { runAgent } from "@/lib/agents/orchestrator";
import type { Agent, RunContext } from "@/lib/agents/types";
import { logActivity } from "@/lib/activity";
import { upcomingBirthdays } from "@/lib/birthdays";
import { CAREER_SOURCE } from "@/lib/career";
import { habitsWithStats } from "@/lib/habits";
import { getPrefs, languageRule } from "@/lib/prefs";
import { readJSON, writeJSON } from "@/lib/private-store";
import { getProfile, profileForPrompt } from "@/lib/profile";
import { notify, pushConfigured } from "@/lib/push";
import { agenda, agendaForPrompt, localParts, nowForPrompt } from "@/lib/reminders";

/**
 * Autopilot: HIVEMIND working on its own. A few times a day (and on "Run now") it reads a snapshot
 * of the owner's whole brain, connects the dots with read-only tools (web, jobs, products, brain),
 * and writes a short feed of insights, each with a link or a one-tap request for HIVEMIND. The most
 * urgent ones are pushed to the phone. It never deletes or changes anything by itself.
 */

const STATE_KEY = "autopilot";
const SETTINGS_KEY = "autopilot-settings";
const KEEP = 60;
const PUSHES_PER_DAY = 3;
// Gemini gets this long; the no-tools fallback must still fit in the 60 s function limit.
const RUN_BUDGET_MS = 35_000;

export const KINDS = ["career", "learning", "project", "people", "health", "plan", "shopping", "world", "other"] as const;

export type Insight = {
  id: string;
  key: string;
  kind: (typeof KINDS)[number];
  priority: 1 | 2 | 3;
  title: string;
  body: string;
  link?: { label: string; url: string };
  ask?: string;
  created_at: string;
  status: "new" | "done" | "dismissed";
  pushed?: boolean;
};
export type RunLog = { at: string; ms: number; found: number; manual: boolean; error?: string };
type State = { items: Insight[]; runs: RunLog[]; running?: string; lastRun?: string; lastJobSearch?: string; pushes?: { date: string; count: number } };
export type AutopilotSettings = { enabled: boolean; every_hours: number; start_hour: number; end_hour: number; push: boolean };

const DEFAULTS: AutopilotSettings = { enabled: true, every_hours: 4, start_hour: 8, end_hour: 21, push: true };

export const SettingsInput = z.object({
  enabled: z.boolean().optional(),
  every_hours: z.number().int().min(1).max(24).optional(),
  start_hour: z.number().int().min(0).max(23).optional(),
  end_hour: z.number().int().min(1).max(24).optional(),
  push: z.boolean().optional(),
});

export const getSettings = async (supabase: SupabaseClient): Promise<AutopilotSettings> => ({ ...DEFAULTS, ...(await readJSON<Partial<AutopilotSettings>>(supabase, SETTINGS_KEY, {})) });
export async function saveSettings(supabase: SupabaseClient, patch: z.infer<typeof SettingsInput>) {
  const next = { ...(await getSettings(supabase)), ...patch };
  await writeJSON(supabase, SETTINGS_KEY, next);
  return next;
}

const readState = (supabase: SupabaseClient) => readJSON<State>(supabase, STATE_KEY, { items: [], runs: [] });

export async function getFeed(supabase: SupabaseClient) {
  const [state, settings] = await Promise.all([readState(supabase), getSettings(supabase)]);
  return { settings, items: state.items, runs: state.runs.slice(0, 10), lastRun: state.lastRun ?? null, running: isRunning(state) };
}

export async function setInsightStatus(supabase: SupabaseClient, id: string, status: Insight["status"]) {
  const state = await readState(supabase);
  const item = state.items.find((i) => i.id === id);
  if (!item) return null;
  item.status = status;
  await writeJSON(supabase, STATE_KEY, state);
  return item;
}

const isRunning = (s: State) => !!s.running && Date.now() - +new Date(s.running) < 3 * 60_000;

/** Called by the scheduler every few minutes: time for another run? */
export async function autopilotDue(supabase: SupabaseClient, now = new Date()) {
  const [state, settings] = await Promise.all([readState(supabase), getSettings(supabase)]);
  if (!settings.enabled || isRunning(state)) return false;
  const { hour } = localParts(now);
  if (hour < settings.start_hour || hour >= settings.end_hour) return false;
  return !state.lastRun || now.getTime() - +new Date(state.lastRun) >= settings.every_hours * 3_600_000;
}

// ---------- snapshot: everything Autopilot looks at, gathered without AI ----------

async function snapshot(supabase: SupabaseClient, state: State) {
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const [ag, habits, bdays, projects, mem, notes, recent, jobs, profile] = await Promise.all([
    agenda(supabase, 3),
    habitsWithStats(supabase).catch(() => []),
    upcomingBirthdays(supabase, 14).catch(() => []),
    supabase.from("projects").select("id, name, status, updated_at").eq("status", "active"),
    supabase.from("memories").select("project_id, updated_at").not("project_id", "is", null).order("updated_at", { ascending: false }).limit(1000),
    supabase.from("notes").select("project_id, updated_at").not("project_id", "is", null).order("updated_at", { ascending: false }).limit(1000),
    supabase.from("memories").select("title, memory_type, created_at").gte("created_at", since).order("created_at", { ascending: false }).limit(12),
    supabase.from("memories").select("created_at, metadata").eq("metadata->>source", CAREER_SOURCE).order("created_at", { ascending: false }).limit(5),
    getProfile(supabase),
  ]);

  // When each active project was last touched (its newest memory or note).
  const touched = new Map<string, string>();
  for (const r of [...(mem.data ?? []), ...(notes.data ?? [])]) {
    if (r.updated_at > (touched.get(r.project_id) ?? "")) touched.set(r.project_id, r.updated_at);
  }
  const days = (iso: string) => Math.floor((Date.now() - +new Date(iso)) / 86_400_000);
  const projectLines = (projects.data ?? []).map((p) => {
    const last = touched.get(p.id) ?? p.updated_at;
    return `- ${p.name}: last activity ${days(last)} days ago`;
  });

  const habitLines = habits.map(
    (h) => `- ${h.emoji} ${h.name}: streak ${h.streak} (best ${h.best}), ${h.dueToday ? (h.doneToday ? "done today" : "NOT done yet today") : "not scheduled today"}, 30-day rate ${h.rate ?? "n/a"}%`,
  );
  const bdayLines = bdays.map((b) => `- ${b.name}${b.relation ? ` (${b.relation})` : ""}: ${b.kind} ${b.label}, in ${b.days} days${b.turning ? `, turning ${b.turning}` : ""}`);
  const jobLines = (jobs.data ?? []).map((m) => {
    const a = (m.metadata as { analysis?: { role?: string; company?: string; fit_score?: number; gaps?: { gap: string }[]; learning_plan?: { skill: string }[] }; tailored_resume?: unknown })?.analysis ?? {};
    const gaps = [...(a.gaps ?? []).map((g) => g.gap), ...(a.learning_plan ?? []).map((l) => l.skill)].slice(0, 6).join(", ");
    return `- ${a.role ?? "Role"} @ ${a.company ?? "?"}: fit ${a.fit_score ?? "?"}%, ${days(m.created_at)} days ago${gaps ? `; gaps: ${gaps}` : ""}`;
  });
  const recentLines = (recent.data ?? []).map((m) => `- ${m.title} (${m.memory_type}, ${days(m.created_at)}d ago)`);

  const twoWeeks = Date.now() - 14 * 86_400_000;
  const earlier = state.items.filter((i) => +new Date(i.created_at) > twoWeeks);
  const earlierLines = earlier.map((i) => `- [${i.status === "dismissed" ? "DISMISSED by owner: don't suggest anything like this again" : i.status}] ${i.key}: ${i.title}`);
  const jobSearchedRecently = !!state.lastJobSearch && Date.now() - +new Date(state.lastJobSearch) < 20 * 3_600_000;

  return [
    `Now: ${nowForPrompt()}`,
    `## Owner\n${profileForPrompt(profile)}`,
    `## Schedule\n${agendaForPrompt(ag)}${ag.later.length ? `\nLater: ${ag.later.map((r) => `${r.title} (${r.when})`).join("; ")}` : ""}`,
    `## Habits\n${habitLines.join("\n") || "none"}`,
    `## Birthdays & anniversaries in the next 14 days\n${bdayLines.join("\n") || "none"}`,
    `## Active projects\n${projectLines.join("\n") || "none"}`,
    `## Job applications analysed\n${jobLines.join("\n") || "none yet"}`,
    `## Saved in the last 7 days\n${recentLines.join("\n") || "nothing"}`,
    `## Insights you gave in the last 14 days (never repeat these; reuse the key if it's the same topic)\n${earlierLines.join("\n") || "none"}`,
    jobSearchedRecently ? "Job search already ran in the last 20 hours: do NOT call search_jobs." : "You may call search_jobs once if a fresh job lead would help.",
  ].join("\n\n");
}

// ---------- the agent ----------

const AUTOPILOT: Agent = {
  id: "core",
  name: "Autopilot",
  role: "Works for the owner in the background: notices what matters across their whole brain and acts on it before they ask.",
  instructions: `You run on your own a few times a day; the owner is NOT in the conversation. You get a snapshot of their brain.
Your job: find the 0 to 4 most useful things to tell them RIGHT NOW, the kind a brilliant chief of staff would notice by connecting dots. Examples:
- a birthday in 3 days and no gift reminder → find a fitting gift (find_product) and give the link
- an interview or deadline tomorrow → suggest a prep step, with an "ask" HIVEMIND can run (e.g. "Give me likely interview questions for <role> at <company>")
- skill gaps that keep showing up in job analyses → one concrete learning step, with a good free resource (web_search)
- an active project untouched for weeks → nudge with a tiny next step
- a habit streak at risk tonight, but only if the streak is worth saving (3+)
- fresh job openings matching their profile (search_jobs) with the apply link
- news or releases that directly affect their projects or skills (web_search)
Rules:
- Quality over quantity. If nothing is genuinely useful, return an empty list. Never filler, never generic advice.
- Reminder alerts, birthday alerts, habit reminders and the morning brief are already sent by other systems: don't just repeat them; add something new (a link, a plan, a connection).
- Never repeat an earlier insight (see the list). Same person, event, job or project as an earlier insight = a repeat, however you word it: skip it, or if you truly have something NEW about it (a gift link, a deadline moved), reuse that insight's exact key. Never suggest anything like one the owner DISMISSED.
- Links must be exact URLs returned by a tool in this run, or an in-app path ("/career", "/habits", "/projects", "/memories", "/notes"). Never invent a URL.
- "ask" is a request the owner can send to HIVEMIND with one tap, written as the owner would say it ("Tailor my resume for the Zoho ML Engineer job"). Only when it helps.
- Use tools to verify and enrich (search_brain, web_search, search_jobs, find_product, etc.). You cannot change or delete anything.
Finish with ONLY this JSON, no other text:
{"insights":[{"key":"short-stable-slug","kind":"${KINDS.join("|")}","priority":1|2|3,"title":"max 70 chars","body":"1-3 short sentences, specific, addressed to the owner as you","link":{"label":"short","url":"https://… or /path"},"ask":"optional one-tap request"}]}
priority 3 = act today (time-sensitive), 2 = useful this week, 1 = nice to know. link and ask are optional.`,
  tools: ["search_brain", "recent_memories", "web_search", "get_weather", "search_jobs", "job_analyses", "find_product", "upcoming_birthdays", "habits_status", "list_reminders", "list_projects", "project_details", "get_profile"],
};

const cut = (n: number) => z.string().trim().transform((s) => (s.length > n ? `${s.slice(0, n - 1)}…` : s));
const Item = z.object({
  key: z.string().trim().min(1),
  kind: z.string().catch("other").transform((k) => ((KINDS as readonly string[]).includes(k) ? (k as Insight["kind"]) : "other")),
  priority: z.coerce.number().int().min(1).max(3).catch(1),
  title: cut(120).pipe(z.string().min(1)),
  body: cut(600).catch(""),
  link: z.object({ label: cut(60).catch("Open"), url: z.string().trim() }).nullish().catch(null),
  ask: cut(300).nullish().catch(null),
});
/** A malformed item is dropped on its own instead of losing the whole run. */
const Output = z.object({
  insights: z
    .array(z.unknown())
    .catch([])
    .transform((list) => list.flatMap((x) => {
      const r = Item.safeParse(x);
      return r.success ? [r.data] : [];
    }).slice(0, 5)),
});

/** One-tap requests that must never come from Autopilot (it reads web pages that could plant them). */
const UNSAFE_ASK =
  /\b(delete|remove|erase|forget|clear|wipe|send|message|text|whatsapp|email|mail|call|ring|pay|transfer|buy|order|book|approve|submit|share|post|publish|password|otp|lock|unlock|reset)\b|அழி|நீக்கு|அனுப்பு/i;

/** Provider errors arrive as raw JSON; the feed shows a short sentence. */
function plainError(err: unknown) {
  const m = err instanceof Error ? err.message : String(err);
  if (/429|RESOURCE_EXHAUSTED|quota/i.test(m)) return "AI free limit reached for now; will try again on the next run";
  if (/timed? ?out|ran out of time/i.test(m)) return "Ran out of time; will try again on the next run";
  return m.length > 160 ? `${m.slice(0, 160)}…` : m;
}

/** An answer cut off mid-JSON (output limit): keep every insight object that did close. */
function salvage(text: string): z.infer<typeof Output> | null {
  const start = text.indexOf("[", text.indexOf('"insights"'));
  if (start < 0) return null;
  const found: unknown[] = [];
  let depth = 0;
  let from = -1;
  let inString = false;
  for (let i = start + 1; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (c === "\\") i++;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === "{" && depth++ === 0) from = i;
    else if (c === "}" && --depth === 0) {
      try {
        found.push(JSON.parse(text.slice(from, i + 1)));
      } catch {}
    } else if (c === "]" && depth === 0) break;
  }
  const out = Output.safeParse({ insights: found });
  return out.success && out.data.insights.length ? out.data : null;
}

/** The AI sometimes re-words an earlier insight under a new key: compare titles too (last 14 days). */
const STOP_WORDS = new Set(["the", "a", "an", "is", "on", "in", "for", "to", "of", "your", "you", "and", "up", "coming", "with", "at"]);
const words = (s: string) => new Set(s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(" ").filter((w) => w.length > 1 && !STOP_WORDS.has(w)));
function similarToRecent(title: string, items: Insight[]) {
  const a = words(title);
  const since = Date.now() - 14 * 86_400_000;
  return items.some((i) => {
    if (+new Date(i.created_at) < since) return false;
    const b = words(i.title);
    const shared = [...a].filter((w) => b.has(w)).length;
    return shared / Math.max(1, Math.min(a.size, b.size)) >= 0.6;
  });
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
const safeUrl = (u: string) => /^https:\/\/[^\s]+$/.test(u) || /^\/[a-z0-9/?=&_-]*$/i.test(u);

/** One Autopilot pass. Returns the new insights (already saved; urgent ones pushed unless manual). */
export async function runAutopilot(supabase: SupabaseClient, opts: { manual?: boolean; origin?: string } = {}) {
  let state = await readState(supabase);
  if (isRunning(state)) return { skipped: "already running", insights: [] as Insight[] };
  const started = Date.now();
  await writeJSON(supabase, STATE_KEY, { ...state, running: new Date().toISOString() });

  const ctx: RunContext = {
    supabase,
    projectId: null,
    conversationId: "autopilot",
    origin: opts.origin ?? process.env.APP_URL ?? "",
    sources: [],
    actions: [],
    changed: false,
    jobs: null,
    pendingDelete: null,
    emit: () => {},
    // A hard stop: when time is up the run really ends (no tools keep going in the background).
    signal: AbortSignal.timeout(RUN_BUDGET_MS),
    toolBudget: { left: 12 },
  };
  let fresh: Insight[] = [];
  let error: string | undefined;
  try {
    const [brief, prefs] = await Promise.all([snapshot(supabase, state), getPrefs(supabase)]);
    const message = `Snapshot of the owner's brain:\n\n${brief}\n\nDecide what (if anything) to tell them now. End with the JSON.`;
    const persona = "You are HIVEMIND, the owner's personal AI and chief of staff.";
    const closing = `${languageRule(prefs.language)}\nThe JSON keys stay in English; titles and bodies follow the language rule.`;
    let text: string;
    try {
      const run = runAgent({ agentId: "core", agent: AUTOPILOT, message, history: [], persona, closing, ctx });
      run.catch(() => {}); // after a timeout it ends with "Stopped": already handled below
      const timeout = new Promise<never>((_, reject) => ctx.signal!.addEventListener("abort", () => reject(new Error("Autopilot ran out of time")), { once: true }));
      text = (await Promise.race([run, timeout])).text;
    } catch (err) {
      // Gemini out of quota or down: still think over the snapshot with NVIDIA/Groq, just without tools.
      console.warn("autopilot: Gemini unavailable, thinking without tools:", plainError(err));
      ctx.sources.length = 0;
      const system = `${persona}\n\n${AUTOPILOT.instructions}\n\nThis run has NO tools: work only from the snapshot. A link may only be an in-app path.\n\n${closing}`;
      text = (await generateWithFallback([{ role: "user", content: message }], { system, order: ["github", "openrouter", "nvidia", "groq"], temperature: 0.3, json: true, maxTokens: 4000 })).text;
    }
    const out = parseJson(text, Output) ?? salvage(text);
    if (!out) {
      console.warn("autopilot: unparseable answer:", text.slice(0, 1500));
      throw new Error("Autopilot didn't return a usable answer");
    }

    // Re-read: the owner may have dismissed something while this ran.
    state = await readState(supabase);
    const known = new Set(state.items.map((i) => i.key));
    const now = new Date().toISOString();
    fresh = out.insights
      .map((i) => ({ ...i, key: slug(i.key) || slug(i.title) }))
      .filter((i) => !known.has(i.key) && !similarToRecent(i.title, state.items))
      .map((i) => ({
        id: crypto.randomUUID(),
        key: i.key,
        kind: i.kind,
        priority: i.priority as Insight["priority"],
        title: i.title,
        body: i.body,
        ...(i.link?.url && safeUrl(i.link.url) ? { link: { label: i.link.label || "Open", url: i.link.url } } : {}),
        // A one-tap request is run as if the owner said it: never one that deletes, sends, calls,
        // pays, approves or shares (web text Autopilot read could have planted it).
        ...(i.ask && !UNSAFE_ASK.test(i.ask) && !unlocksAction(i.ask) ? { ask: i.ask } : {}),
        created_at: now,
        status: "new" as const,
      }));
  } catch (err) {
    error = plainError(err);
    console.warn("autopilot failed:", error);
    state = await readState(supabase);
  }

  // Push what can't wait (scheduled runs only; a manual run is watched on screen).
  const settings = await getSettings(supabase);
  const today = localParts().date;
  const pushes = state.pushes?.date === today ? state.pushes : { date: today, count: 0 };
  if (!opts.manual && settings.push && pushConfigured()) {
    const urgent = [...fresh].sort((a, b) => b.priority - a.priority).filter((i) => i.priority >= 2);
    for (const i of urgent.slice(0, 2)) {
      if (pushes.count >= PUSHES_PER_DAY) break;
      const sent = await notify(supabase, { title: `🧭 ${i.title}`, body: i.body, url: "/autopilot", tag: `autopilot-${i.key}` }).catch(() => 0);
      if (sent) {
        i.pushed = true;
        pushes.count++;
      }
    }
  }

  const ms = Date.now() - started;
  const ranJobs = ctx.jobs !== null;
  await writeJSON(supabase, STATE_KEY, {
    ...state,
    running: undefined,
    lastRun: new Date().toISOString(),
    ...(ranJobs ? { lastJobSearch: new Date().toISOString() } : {}),
    pushes,
    items: [...fresh, ...state.items].slice(0, KEEP),
    runs: [{ at: new Date().toISOString(), ms, found: fresh.length, manual: !!opts.manual, ...(error ? { error } : {}) }, ...state.runs].slice(0, 20),
  } satisfies State);
  if (fresh.length) await logActivity(supabase, "autopilot", `Autopilot noticed ${fresh.length} thing${fresh.length === 1 ? "" : "s"}: ${fresh.map((i) => i.title).join("; ")}`);
  return { insights: fresh, ms, ...(error ? { error } : {}) };
}
