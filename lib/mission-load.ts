import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SCHEDULER_STALE_MS } from "@/lib/alerts";
import { listApps } from "@/lib/apps";
import { getFeed } from "@/lib/autopilot";
import { getBriefSettings, listBriefDates } from "@/lib/brief";
import { getDream, getDreamSettings, listDreamDates } from "@/lib/dream";
import { type CrewAgent, buildCrew, type MissionFacts, summary } from "@/lib/mission";
import { readJSON } from "@/lib/private-store";
import { agenda, HOME_TZ } from "@/lib/reminders";
import { steelConfigured } from "@/lib/web-agent/steel";
import { listTasks } from "@/lib/web-agent/store";

const BRIEF_HOUR = Number(process.env.BRIEF_HOUR ?? 8);

/** Gathers what each background job has been doing. A job whose data can't be read shows as quiet, never breaks the page. */
export async function loadMission(supabase: SupabaseClient): Promise<{ crew: CrewAgent[]; summary: string; at: string }> {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: HOME_TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const today = `${get("year")}-${get("month")}-${get("day")}`;
  const hour = Number(get("hour")) % 24;
  const safe = <T,>(p: Promise<T>, fallback: T) => p.catch(() => fallback);

  const [state, feed, tasks, dreamSet, dreamDates, briefSet, briefDates, cal, apps] = await Promise.all([
    safe(readJSON<{ lastRun?: string }>(supabase, "notify-state", {}), {} as { lastRun?: string }),
    safe(getFeed(supabase), null),
    safe(listTasks(supabase), []),
    safe(getDreamSettings(supabase), { enabled: true, hour: 3 }),
    safe(listDreamDates(supabase), [] as string[]),
    safe(getBriefSettings(supabase), { enabled: true, topics: [] as string[] }),
    safe(listBriefDates(supabase), [] as string[]),
    safe(agenda(supabase, 1), null),
    safe(listApps(supabase), []),
  ]);
  const lastDreamDate = [...dreamDates].sort().pop();
  const lastDream = lastDreamDate ? await safe(getDream(supabase, lastDreamDate), null) : null;
  const latestRun = feed?.runs[0];

  const facts: MissionFacts = {
    now: now.getTime(),
    hour,
    today,
    briefHour: BRIEF_HOUR,
    scheduler: { lastRun: state.lastRun ?? null, staleMs: SCHEDULER_STALE_MS },
    autopilot: {
      enabled: feed?.settings.enabled ?? false,
      startHour: feed?.settings.start_hour ?? 8,
      endHour: feed?.settings.end_hour ?? 21,
      everyHours: feed?.settings.every_hours ?? 4,
      running: feed?.running ?? false,
      lastRun: feed?.lastRun ?? null,
      lastFound: latestRun ? latestRun.found : null,
      lastError: latestRun?.error ?? null,
      fresh: feed?.items.filter((i) => i.status === "new").length ?? 0,
    },
    web: {
      configured: steelConfigured(),
      tasks: tasks.slice(0, 8).map((t) => ({ goal: t.goal, status: t.status, updated_at: t.updated_at, lastDid: t.steps.at(-1)?.did ?? null, question: t.question ?? t.pending?.label ?? null, error: t.error ?? null })),
    },
    dream: { enabled: dreamSet.enabled, hour: dreamSet.hour, last: lastDream ? { date: lastDream.date, at: lastDream.at, changes: lastDream.changes.length } : null },
    brief: { enabled: briefSet.enabled, topics: briefSet.topics.length, lastDate: [...briefDates].sort().pop() ?? null },
    reminders: { overdue: cal?.overdue.length ?? 0, today: cal?.today.filter((r) => r.status === "pending").length ?? 0, next: cal?.today.find((r) => r.status === "pending")?.title ?? null },
    apps: apps.map((a) => ({ name: a.name, status: a.status, updated_at: a.updated_at })),
  };
  const crew = buildCrew(facts);
  return { crew, summary: summary(crew), at: now.toISOString() };
}
