import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { GoogleGenAI } from "@google/genai";
import { readJSON, removeFiles, writeJSON } from "@/lib/private-store";

/**
 * HIVEMIND apps: small tools the owner asks for in words ("an app to track my petrol expenses").
 * Gemini writes one self-contained HTML page; it runs in a sealed sandbox (no network, no access to
 * HIVEMIND) and keeps its data through a tiny bridge (window.hive) the host page provides.
 */
export type AppMeta = { id: string; name: string; emoji: string; description: string; status: "building" | "ready" | "failed"; error?: string; created_at: string; updated_at: string; version: number };
export type AppDoc = AppMeta & { html: string; history: { version: number; at: string; request: string; html: string }[]; /** What to build or change next (read by the background build). */ pending?: string; /** When the current build started, and how many times it was (re)started. */ building_since?: string; attempts?: number };

const INDEX = "apps/index";
const docKey = (id: string) => `apps/${id}`;
const dataKey = (id: string) => `apps/${id}.data`;
const KEEP_VERSIONS = 8;

export const listApps = (supabase: SupabaseClient) => readJSON<AppMeta[]>(supabase, INDEX, []);
export const getApp = (supabase: SupabaseClient, id: string) => readJSON<AppDoc | null>(supabase, docKey(id), null);

async function saveApp(supabase: SupabaseClient, app: AppDoc) {
  app.updated_at = new Date().toISOString();
  await writeJSON(supabase, docKey(app.id), app);
  const index = await listApps(supabase);
  const meta: AppMeta = { id: app.id, name: app.name, emoji: app.emoji, description: app.description, status: app.status, error: app.error, created_at: app.created_at, updated_at: app.updated_at, version: app.version };
  await writeJSON(supabase, INDEX, [meta, ...index.filter((a) => a.id !== app.id)]);
  return app;
}

/** A new app, saved as "building" right away; generate() fills it in. */
export async function startApp(supabase: SupabaseClient, request: string) {
  const now = new Date().toISOString();
  return saveApp(supabase, { id: crypto.randomUUID(), name: "New app", emoji: "🛠️", description: request.slice(0, 200), status: "building", created_at: now, updated_at: now, version: 0, html: "", history: [], pending: request, building_since: now, attempts: 0 });
}

export async function deleteApp(supabase: SupabaseClient, id: string) {
  const index = await listApps(supabase);
  await writeJSON(supabase, INDEX, index.filter((a) => a.id !== id));
  await removeFiles(supabase, [`${docKey(id)}.json`, `${dataKey(id)}.json`]).catch(() => {});
}

/** Find an app by words from its name ("petrol"). */
export async function findApp(supabase: SupabaseClient, words: string) {
  const q = words.toLowerCase().trim();
  const all = await listApps(supabase);
  return all.find((a) => a.name.toLowerCase() === q) ?? all.find((a) => `${a.name} ${a.description}`.toLowerCase().includes(q)) ?? all.find((a) => q.split(/\s+/).every((w) => `${a.name} ${a.description}`.toLowerCase().includes(w))) ?? null;
}

// ---------- the app's own data (key → JSON value) ----------
export const readData = (supabase: SupabaseClient, id: string) => readJSON<Record<string, unknown>>(supabase, dataKey(id), {});
export const writeData = (supabase: SupabaseClient, id: string, data: Record<string, unknown>) => writeJSON(supabase, dataKey(id), data);

// ---------- writing the app ----------
const RULES = `You build small, polished, single-page web apps that run inside HIVEMIND, the owner's personal AI app (dark theme, mobile-first).

Output format, exactly:
Line 1: <!-- app: {"name":"Short Name","emoji":"⛽","description":"one sentence"} -->
Then ONE complete HTML document (<!doctype html> … </html>) with all CSS in <style> and all JS in <script>. Nothing else, no markdown fences.

Hard rules:
- No external resources at all: no CDN scripts or fonts, no fetch/XHR/WebSocket, no images from URLs (network is blocked). Draw charts yourself with inline SVG or <canvas>.
- Save EVERYTHING the user enters with the provided async storage, never localStorage:
    await hive.get(key) → value or null;  await hive.set(key, value);  await hive.remove(key);  await hive.keys()
  Load saved data on start; save after every change. Values are any JSON.
- Register 2-5 voice actions for the app's main operations so the owner can use it by voice:
    hive.action("add_expense", "Add a petrol expense. input: amount in rupees and optional note", async (input) => { …; return { added: …, total: … }; });
  input is a plain string from speech: parse numbers/words leniently. Return a small JSON result (what changed / the answer).
- Use these CSS variables (already defined by the host): --bg --panel --raised --line --text --soft --accent --accent-ink --ok --alert; font is inherited. Rounded cards, generous spacing, big tap targets, works at 360px width.
- Indian context: currency ₹ with Indian digit grouping (toLocaleString("en-IN")), dates as 2 Oct 2026, km/litres.
- No alert()/confirm()/prompt(); show inline messages. Handle empty states nicely. Keep the code tidy and under ~400 lines.`;

// Writing a whole app takes longer than a chat reply: its own client with a longer wait.
let client: GoogleGenAI | null = null;
const gemini = () => (client ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY, httpOptions: { timeout: 50_000 } }));

// Fast model first: a build must finish inside one 60-second server call. It writes good apps;
// the bigger models are the backup (often busy, and slow to start).
const FAST = process.env.GEMINI_APP_MODEL || "gemini-3.5-flash-lite";
const MODELS = [FAST, FAST, "gemini-3.5-flash", "gemini-2.5-flash"];

function parse(text: string) {
  const raw = text.replace(/^\s*```(?:html)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
  const meta = raw.match(/<!--\s*app:\s*(\{[\s\S]*?\})\s*-->/);
  let info: { name?: string; emoji?: string; description?: string } = {};
  try {
    info = meta ? JSON.parse(meta[1]) : {};
  } catch {}
  const start = raw.search(/<!doctype html|<html/i);
  const end = raw.toLowerCase().lastIndexOf("</html>");
  // Cut off mid-way (no </html>), or it doesn't save its data: not usable. Anything after </html> is dropped.
  if (start < 0 || end < start) return null;
  const html = raw.slice(start, end + "</html>".length);
  if (!/hive\.(get|set)/.test(html)) return null;
  return { html, name: (info.name ?? "My app").slice(0, 40), emoji: (info.emoji ?? "🛠️").slice(0, 4), description: (info.description ?? "").slice(0, 200) };
}

// The whole build must end inside one 60-second server call: every try shares this budget, so a
// stalled model can't leave the app stuck on "building" when the call is cut off.
const BUDGET_MS = 48_000;

async function write(prompt: string) {
  let lastErr: unknown;
  const deadline = Date.now() + BUDGET_MS;
  for (const model of MODELS) {
    const left = deadline - Date.now();
    if (left < 8_000) break;
    try {
      const r = await gemini().models.generateContent({
        model,
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        config: { systemInstruction: RULES, temperature: 0.4, maxOutputTokens: 16000, abortSignal: AbortSignal.timeout(left) },
      });
      const out = parse(r.text ?? "");
      if (out) return out;
      console.warn(`apps: ${model} gave an unusable app (${(r.text ?? "").length} chars, ends: ${JSON.stringify((r.text ?? "").slice(-60))})`);
      lastErr = new Error("The app came back incomplete.");
    } catch (err) {
      lastErr = err;
      console.warn(`apps: ${model} failed:`, err instanceof Error ? err.message.slice(0, 120) : err);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("Couldn't build the app.");
}

/** Builds a new app, or changes an existing one ("add a field for km driven"). */
export async function generate(supabase: SupabaseClient, id: string, request: string) {
  const app = await getApp(supabase, id);
  if (!app) return;
  const changing = !!app.html;
  try {
    const out = await write(
      changing
        ? `Here is the current app:\n\n${app.html}\n\nChange it as the owner asks, keeping all existing features and the SAME storage keys (their saved data must keep working): ${request}\n\nReturn the full updated app in the same format.`
        : `Build this app: ${request}`,
    );
    if (changing) app.history = [{ version: app.version, at: app.updated_at, request: app.description, html: app.html }, ...app.history].slice(0, KEEP_VERSIONS);
    Object.assign(app, { ...out, description: changing ? app.description : out.description || request.slice(0, 200), status: "ready", error: undefined, version: app.version + 1 });
    if (changing) app.name = out.name || app.name;
    app.pending = undefined;
    app.building_since = undefined;
  } catch (err) {
    const m = err instanceof Error ? err.message : String(err);
    Object.assign(app, { pending: undefined, building_since: undefined, status: changing ? "ready" : "failed", error: /429|quota|RESOURCE_EXHAUSTED/i.test(m) ? "AI free limit reached; try again later." : `Couldn't ${changing ? "change" : "build"} it: ${m.slice(0, 140)}` });
  }
  // Deleted while it was being written: don't bring it back.
  if (!(await listApps(supabase)).some((a) => a.id === id)) return;
  await saveApp(supabase, app);
}

/** Marks a change as in progress (the page shows "updating…"). */
export async function markBuilding(supabase: SupabaseClient, id: string, request?: string) {
  const app = await getApp(supabase, id);
  if (!app) return null;
  app.status = "building";
  if (request) app.pending = request;
  app.error = undefined;
  app.building_since = new Date().toISOString();
  app.attempts = 0;
  return saveApp(supabase, app);
}

/** Undo: go back to an earlier version (the current one is kept in history too). */
export async function restoreVersion(supabase: SupabaseClient, id: string, version: number) {
  const app = await getApp(supabase, id);
  const old = app?.history.find((h) => h.version === version);
  if (!app || !old) return null;
  app.history = [{ version: app.version, at: app.updated_at, request: "before undo", html: app.html }, ...app.history.filter((h) => h.version !== version)].slice(0, KEEP_VERSIONS);
  app.html = old.html;
  app.version += 1;
  app.status = "ready";
  return saveApp(supabase, app);
}

/** Ask for a background build (voice / chat requests can't wait ~30 s in their own call). */
export async function kickBuild(origin: string, id: string) {
  const secret = process.env.CRON_SECRET;
  if (!secret || !origin) {
    // No scheduler secret: build in this request's background instead of silently never starting.
    console.warn("apps: CRON_SECRET is not set; building in the background of this request");
    const { after } = await import("next/server");
    const { db } = await import("@/lib/db");
    after(async () => {
      const app = await getApp(db(), id);
      if (app?.pending) await generate(db(), id, app.pending);
    });
    return;
  }
  await fetch(`${origin}/api/cron/app-build?id=${id}`, { headers: { authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(5000) }).catch(() => {});
}

/**
 * Builds cut off mid-way (the server call ended, a deploy restarted it): the scheduler finds apps
 * "building" for over 3 minutes, starts each once more, and after that marks it failed (a change
 * that never finished leaves the last working version in place).
 */
export async function recoverStuckBuilds(supabase: SupabaseClient, origin: string) {
  const stuck = (await listApps(supabase)).filter((a) => a.status === "building");
  let n = 0;
  for (const meta of stuck) {
    const app = await getApp(supabase, meta.id);
    if (!app || app.status !== "building") continue;
    const since = +new Date(app.building_since ?? app.updated_at);
    if (Date.now() - since < 3 * 60_000) continue;
    if (app.pending && (app.attempts ?? 0) < 1) {
      app.attempts = (app.attempts ?? 0) + 1;
      app.building_since = new Date().toISOString();
      await saveApp(supabase, app);
      await kickBuild(origin, app.id);
    } else {
      Object.assign(app, { status: app.html ? "ready" : "failed", pending: undefined, building_since: undefined, error: app.html ? "That change didn't finish; the app is as it was. Try again." : "The build didn't finish. Tap Try again." });
      await saveApp(supabase, app);
    }
    n++;
  }
  return n;
}
