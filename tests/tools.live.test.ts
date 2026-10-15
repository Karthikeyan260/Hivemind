import { afterAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Every HIVEMIND tool, for real, against the owner's own data (opt-in: TOOLS_LIVE=1, reads
 * .env.local). Read-only tools run as they are. Tools that change something run as
 * create → change → delete with names starting "HMTEST", and anything left over is removed at the
 * end. Expensive or outward-facing tools (building apps, the cloud browser, Autopilot runs,
 * re-writing the profile) are only checked to fail safely, not run.
 */
const RUN = process.env.TOOLS_LIVE === "1";
if (RUN) {
  try {
    process.loadEnvFile(".env.local");
  } catch {}
}
const TAG = `HMTEST ${Date.now().toString(36)}`;
type R = Record<string, unknown>;
const results: { tool: string; ok: boolean; ms: number; note: string }[] = [];

describe.skipIf(!RUN)("every tool, live", () => {
  let supabase: SupabaseClient;
  let TOOLS: Record<string, { run: (a: R, c: never) => Promise<R> }>;
  const ctx = (): R => ({
    supabase,
    projectId: null,
    conversationId: "00000000-0000-0000-0000-000000000000",
    origin: "https://hivemind-kk.vercel.app",
    sources: [],
    actions: [],
    changed: false,
    jobs: null,
    pendingDelete: null,
    location: { lat: 13.0827, lng: 80.2707, accuracy: 30, device: "test" },
    emit: () => {},
  });
  let shared: R; // one context for multi-step flows (delete → confirm, search → pick), made once connected

  /** Run a tool; `expectError` = an error is the right answer (bad input, nothing to act on). */
  async function run(tool: string, args: R = {}, opts: { c?: R; expectError?: boolean } = {}) {
    const t = Date.now();
    let out: R;
    try {
      out = await TOOLS[tool].run(args, (opts.c ?? ctx()) as never);
    } catch (e) {
      out = { thrown: e instanceof Error ? e.message : String(e) };
    }
    const ms = Date.now() - t;
    const failed = "thrown" in out || (typeof out.error === "string" && !opts.expectError);
    const note = JSON.stringify(out).replace(/\s+/g, " ").slice(0, 150);
    results.push({ tool, ok: !failed, ms, note });
    return out;
  }

  /**
   * A delete the safe way: turn 1 names it (nothing deleted; calling with confirm=true straight away
   * must NOT delete), turn 2 is the owner's yes. Also checks the one-step shortcut is refused.
   */
  async function twoStep(tool: string, args: R) {
    const c1 = ctx();
    const asked = await run(tool, { ...args, confirm: true }, { c: c1 });
    if (asked.error) return asked;
    const refused = !("deleted_note" in asked || "deleted_project" in asked || "deleted" in asked || "deleted_document" in asked);
    results.push({ tool: `${tool} (one-step refused)`, ok: refused, ms: 0, note: refused ? "needs a later yes" : "DELETED IN ONE STEP" });
    const c2 = { ...ctx(), carried: { pendingDelete: c1.pendingDelete } };
    return run(tool, { ...args, confirm: true }, { c: c2 });
  }

  it("loads", async () => {
    supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });
    TOOLS = (await import("@/lib/agents/tools")).TOOLS as never;
    expect(Object.keys(TOOLS).length).toBeGreaterThan(80);
    shared = ctx();
  });

  it("knowledge, notes, documents, photos", async () => {
    await run("search_brain", { query: "what projects have I built with RAG" });
    await run("find_photos", { query: "Ooty trip" });
    await run("recent_memories", { limit: 3 });
    await run("list_notes", {});
    await run("list_documents", {});
    await run("open_source", {}, { expectError: true });
    // memory: remember → update → delete → confirm
    await run("remember", { content: `${TAG} memory: my test locker code is 4321` });
    await run("update_memory", { which: `${TAG} locker code`, new_content: `${TAG} memory: my test locker code is 9876` });
    await run("delete_memory", { which: `${TAG} locker code` }, { c: shared });
    await run("confirm_delete_memory", {}, { c: { ...ctx(), carried: { pendingDelete: shared.pendingDelete } } });
    // note: create → update → delete
    await run("create_note", { title: `${TAG} note`, content: "A throwaway note from the tool test." });
    await run("update_note", { which: `${TAG} note`, append: "Appended line." });
    await twoStep("delete_note", { which: `${TAG} note` });
  }, 240_000);

  it("projects", async () => {
    const list = await run("list_projects", {});
    const first = ((list.projects as { name: string }[] | undefined) ?? [])[0]?.name;
    if (first) await run("project_details", { name: first });
    await run("create_project", { name: `${TAG} project`, description: "Throwaway project from the tool test." });
    await run("update_project", { which: `${TAG} project`, status: "paused" });
    await twoStep("delete_project", { which: `${TAG} project` });
  }, 180_000);

  it("schedule: reminders, birthdays, habits", async () => {
    await run("list_reminders", { days: 7 });
    await run("create_reminder", { title: `${TAG} reminder A`, in_minutes: 600 });
    await run("reschedule_reminder", { which: `${TAG} reminder A`, in_minutes: 720 });
    await run("complete_reminder", { which: `${TAG} reminder A` });
    await run("create_reminder", { title: `${TAG} reminder B`, in_minutes: 600 });
    await run("cancel_reminder", { which: `${TAG} reminder B` });
    await run("upcoming_birthdays", { days: 30 });
    await run("add_birthday", { name: `${TAG} Person`, month: 1, day: 2, kind: "birthday" });
    await run("birthday_wish", { who: `${TAG} Person` });
    await run("remove_birthday", { which: `${TAG} Person` });
    await run("habits_status", {});
    await run("add_habit", { name: `${TAG} habit`, times: ["23:59"] });
    await run("log_habit", { which: `${TAG} habit` });
    await run("snooze_habit", { which: `${TAG} habit`, minutes: 30 });
    await run("remove_habit", { which: `${TAG} habit` });
  }, 240_000);

  it("research, web, places, media", async () => {
    await run("get_weather", {});
    await run("web_search", { query: "Chennai metro phase 2 news" });
    await run("find_product", { query: "boAt Airdopes 141" });
    await run("open_link", { url: "https://example.com", label: "Example" });
    await run("open_link", { url: "javascript:alert(1)" }, { expectError: true });
    await run("where_am_i", {});
    await run("places_nearby", { what: "coffee", radius_km: 2 });
    await run("directions", { to: "Marina Beach", mode: "car" });
    await run("device_locations", {});
    await run("play_music", { action: "play", query: "Anirudh hits" });
    await run("play_video", { action: "play", query: "Leo trailer" });
    await run("research_and_save", { topic: `${TAG} what retrieval-augmented generation is` });
    // research_and_save keeps it as a note.
    await twoStep("delete_note", { which: `Research: ${TAG}` });
  }, 300_000);

  it("career", async () => {
    await run("job_analyses", {});
    await run("search_jobs", { role: "AI engineer", location: "Chennai" }, { c: shared });
    await run("analyze_job", {
      job_description: `${TAG}: We need a GenAI engineer in Chennai with Python, LangGraph, RAG pipelines, vector databases and 1-3 years of experience building LLM agents. Nice to have: FastAPI, Supabase, evaluation of LLM outputs.`,
      role: `${TAG} GenAI Engineer`,
      company: "Test Co",
    });
    await run("tailor_resume", {});
    await run("delete_job_analysis", { which: `${TAG} GenAI Engineer` });
  }, 300_000);

  it("contacts, calls, profile, language", async () => {
    await run("save_contact", { name: `${TAG} Contact`, phone: "+91 90000 00000" });
    await run("call_contact", { who: `${TAG} Contact` });
    await run("message_contact", { who: `${TAG} Contact`, text: "test", via: "whatsapp" });
    await run("screened_calls", {});
    await run("call_screening", {});
    await run("get_profile", {});
    const { getPrefs } = await import("@/lib/prefs");
    const lang = ((await getPrefs(supabase)) as { language?: string }).language ?? "auto";
    await run("set_language", { language: lang }); // set to what it already is
  }, 180_000);

  it("routines, brief, kural, check-in context, games, apps, autopilot", async () => {
    await run("list_routines", {});
    await run("create_routine", { name: `${TAG} routine`, steps: ["What's the weather?"], triggers: [`${TAG} go`] });
    await twoStep("delete_routine", { which: `${TAG} routine` });
    await run("morning_brief", {});
    await run("brief_topics", {});
    await run("dream_report", {});
    await run("day_comic", {});
    await run("kitchen_mode", {});
    await run("todays_kural", {});
    await run("todays_kural", { topic: "anger" });
    await run("todays_kural", { number: 391 });
    await run("game_record", {});
    await run("my_pet", {});
    await run("my_wrapped", {});
    await run("list_apps", {});
    await run("open_app", { which: `${TAG} no such app` }, { expectError: true });
    await run("autopilot_feed", {});
    await run("web_tasks_status", {});
    await run("web_task_answer", { decision: "cancel", which: `${TAG} no such task` }, { expectError: true });
    await run("web_task_delete", { which: `${TAG} no such task` }, { expectError: true });
    await run("change_app", { which: `${TAG} no such app`, change: "x" }, { expectError: true });
    await run("delete_app", { which: `${TAG} no such app`, confirm: true }, { expectError: true });
  }, 300_000);

  afterAll(async () => {
    if (!RUN || !supabase) return;
    // Anything named HMTEST that a failed step left behind.
    const left: string[] = [];
    for (const table of ["notes", "memories", "documents", "projects"] as const) {
      const col = table === "projects" ? "name" : table === "documents" ? "filename" : "title";
      const { data } = await supabase.from(table).select(`id, ${col}`).ilike(col, `%${TAG}%`);
      for (const row of (data ?? []) as unknown as R[]) {
        await supabase.from(table).delete().eq("id", row.id as string);
        left.push(`${table}:${row[col]}`);
      }
    }
    const { data: mem } = await supabase.from("memories").select("id, content").ilike("content", `%${TAG}%`);
    for (const m of mem ?? []) {
      await supabase.from("memories").delete().eq("id", m.id);
      left.push(`memories:${String(m.content).slice(0, 40)}`);
    }
    const { data: ja } = await supabase.from("job_analyses").select("id, role").ilike("role", `%${TAG}%`);
    for (const j of ja ?? []) {
      await supabase.from("job_analyses").delete().eq("id", j.id);
      left.push(`job_analyses:${j.role}`);
    }
    console.log("\nTOOL RESULTS\n" + results.map((r) => `${r.ok ? "OK  " : "FAIL"} ${r.tool.padEnd(22)} ${String(r.ms).padStart(6)}ms  ${r.note}`).join("\n"));
    console.log(`\n${results.filter((r) => r.ok).length}/${results.length} ok · cleaned up leftovers: ${left.length ? left.join(", ") : "none"}`);
    if (process.env.TOOLS_REPORT)
      (await import("node:fs")).writeFileSync(process.env.TOOLS_REPORT, results.map((r) => `${r.ok ? "OK  " : "FAIL"} ${r.tool.padEnd(22)} ${r.note}`).join("\n") + `\nleftovers: ${left.join(", ") || "none"}\n`);
  });
});
