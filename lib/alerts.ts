import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readJSON, writeJSON } from "@/lib/private-store";
import { notify } from "@/lib/push";
import { HOME_TZ } from "@/lib/reminders";

/**
 * A push when something HIVEMIND does on its own fails (instead of silence): the morning brief,
 * Dream mode, Autopilot, or the scheduler itself stopping. At most once a day per job, so a job that
 * keeps failing doesn't flood the phone.
 */
export type Job = "brief" | "dream" | "autopilot" | "scheduler";
const LABEL: Record<Job, { title: string; url: string }> = {
  brief: { title: "Morning brief failed", url: "/brief" },
  dream: { title: "Dream mode failed", url: "/dream" },
  autopilot: { title: "Autopilot failed", url: "/autopilot" },
  scheduler: { title: "Scheduler stopped", url: "/settings" },
};
const KEY = "alert-state";

const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: HOME_TZ }).format(new Date());

/** A short, readable reason (no stack traces or keys). */
export function reasonOf(err: unknown) {
  const m = err instanceof Error ? err.message : String(err ?? "unknown error");
  if (/quota|429|rate.?limit|resource.?exhausted/i.test(m)) return "The AI's free quota ran out. It'll try again next time.";
  if (/timeout|timed out|out of time|aborted/i.test(m)) return "It took too long and was stopped. It'll try again next time.";
  if (/fetch failed|network|ENOTFOUND|ECONN/i.test(m)) return "A network problem. It'll try again next time.";
  return m.replace(/\s+/g, " ").replace(/(key|token|secret)=\S+/gi, "$1=…").slice(0, 140);
}

/** Tells the owner a job failed (once a day per job). Returns whether a push went out. */
export async function alertFailure(supabase: SupabaseClient, job: Job, err: unknown): Promise<boolean> {
  const day = today();
  const state = await readJSON<Partial<Record<Job, string>>>(supabase, KEY, {}).catch(() => ({}) as Partial<Record<Job, string>>);
  if (state[job] === day) return false;
  await writeJSON(supabase, KEY, { ...state, [job]: day }).catch(() => {});
  const l = LABEL[job];
  const sent = await notify(supabase, { title: `⚠️ ${l.title}`, body: typeof err === "string" ? err : reasonOf(err), url: l.url, tag: `fail-${job}` }).catch(() => 0);
  console.warn(`${job} failed:`, err instanceof Error ? err.message : err);
  return sent > 0;
}

/** The scheduler (cron-job.org) hasn't checked in for this long: reminders won't arrive. */
export const SCHEDULER_STALE_MS = 2 * 60 * 60_000;
