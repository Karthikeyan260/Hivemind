import { after, NextResponse } from "next/server";
import { autopilotDue, runAutopilot } from "@/lib/autopilot";
import { safeEqual } from "@/lib/session";
import { birthdaysToday, runBirthdayAlerts } from "@/lib/birthdays";
import { briefHeadline, getBriefSettings, makeBrief } from "@/lib/brief";
import { dream, getDream, getDreamSettings } from "@/lib/dream";
import { db } from "@/lib/db";
import { getWeather, HOME_CITY } from "@/lib/external/weather";
import { runHabitAlerts } from "@/lib/habits";
import { readJSON, writeJSON } from "@/lib/private-store";
import { notify, pushConfigured } from "@/lib/push";
import { agenda, dueAlerts, HOME_TZ } from "@/lib/reminders";
import { resumeStalled } from "@/lib/web-agent/runner";
import { ACTIVE, listTasks } from "@/lib/web-agent/store";

// Autopilot runs after the response (see below) and needs the extra time.
export const maxDuration = 60;

const BRIEF_HOUR = Number(process.env.BRIEF_HOUR ?? 8);

/**
 * Called every few minutes by an external scheduler (cron-job.org: Vercel's free plan only runs
 * its own cron once a day). Pushes reminders that just came due, and the morning brief once a day,
 * and starts an Autopilot run every few hours.
 * Auth: "Authorization: Bearer <CRON_SECRET>" or ?key=<CRON_SECRET>.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const given = req.headers.get("authorization")?.replace(/^Bearer /, "") ?? new URL(req.url).searchParams.get("key");
  if (!secret || !given || !safeEqual(given, secret)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!pushConfigured()) return NextResponse.json({ error: "VAPID keys missing" }, { status: 503 });
  const supabase = db();

  // 1. Reminders whose alert time has arrived (each is handed out once, here or to an open tab).
  const due = await dueAlerts(supabase);
  for (const r of due) {
    await notify(supabase, { title: `⏰ ${r.title}`, body: [r.when, r.details].filter(Boolean).join(" · "), url: "/", tag: `reminder-${r.id}` });
  }

  // 2. Morning brief, once a day after BRIEF_HOUR local time.
  const now = new Date();
  const [date, hour] = [
    new Intl.DateTimeFormat("en-CA", { timeZone: HOME_TZ }).format(now),
    Number(new Intl.DateTimeFormat("en-GB", { timeZone: HOME_TZ, hour: "2-digit", hourCycle: "h23" }).format(now)),
  ];
  const state = await readJSON<{ brief?: string; lastRun?: string; lastSent?: number; dream?: string; news?: string }>(supabase, "notify-state", {});
  let brief = false;
  // Morning window only, so enabling this in the afternoon doesn't send a "good morning".
  if (hour >= BRIEF_HOUR && hour < 12 && state.brief !== date) {
    const [a, w, bdays] = await Promise.all([agenda(supabase, 2), getWeather(HOME_CITY).catch(() => null), birthdaysToday(supabase).catch(() => [])]);
    const items = [...a.overdue.map((r) => `${r.title} (overdue)`), ...a.today.map((r) => `${r.title}, ${r.when.replace(/^Today,?\s*/i, "")}`)];
    const weather = w ? `${w.place}: ${Math.round(w.current.temp_c)}°C, ${w.current.condition}${w.days[0] ? `, rain ${w.days[0].rain_chance_pct}%` : ""}.` : "";
    // What Dream mode did last night, in one line.
    const night = await getDream(supabase, date).catch(() => null);
    const counts = night ? (["merged", "updated", "learned"] as const).map((k) => [k, night.changes.filter((c) => c.kind === k).length] as const).filter(([, n]) => n) : [];
    const dreamLine = counts.length ? `💤 Last night I ${counts.map(([k, n]) => `${k} ${n}`).join(", ")} memories.` : "";
    const plan = items.length ? `Today: ${items.slice(0, 4).join("; ")}${items.length > 4 ? ` +${items.length - 4} more` : ""}.` : "Nothing scheduled today.";
    // Only counts as sent once a device actually got it (so subscribing later today still gets one).
    brief = (await notify(supabase, { title: "Good morning ☀️", body: [bdays.join(" · "), plan, weather, dreamLine].filter(Boolean).join(" "), url: "/", tag: "brief" })) > 0;
  }
  // 3. Birthdays (week / eve / day) and habits (times, snoozes, 8 pm nudge, Sunday summary).
  const [birthdays, habits] = await Promise.all([runBirthdayAlerts(supabase, now).catch(() => 0), runHabitAlerts(supabase, now).catch(() => 0)]);

  // Dream mode: once a night, from its hour until 7 am (marked first, so later checks don't start it again).
  const dreamSet = await getDreamSettings(supabase).catch(() => null);
  const dreaming = !!dreamSet?.enabled && hour >= dreamSet.hour && hour < 7 && state.dream !== date;
  // The news brief: once each morning, after the "good morning" window opens, if topics are set.
  const briefSet = await getBriefSettings(supabase).catch(() => null);
  const news = !!briefSet?.enabled && !!briefSet.topics.length && hour >= BRIEF_HOUR && hour < 12 && state.news !== date;

  // Settings shows "scheduler last checked …", so a stopped cron-job.org is visible.
  await writeJSON(supabase, "notify-state", { ...state, ...(brief ? { brief: date } : {}), ...(dreaming ? { dream: date } : {}), ...(news ? { news: date } : {}), lastRun: now.toISOString(), lastSent: due.length });
  if (dreaming) after(() => dream(db(), date).then(() => undefined, (e) => console.warn("dream:", e)));
  if (news)
    after(async () => {
      const b = await makeBrief(db(), date).catch((e) => (console.warn("brief:", e), null));
      if (b) await notify(db(), { title: "📰 Your morning brief", body: briefHeadline(b), url: "/brief", tag: "news-brief" }).catch(() => 0);
    });

  // 4. Autopilot: after the response, so the scheduler's request stays fast.
  const autopilot = await autopilotDue(supabase, now).catch(() => false);
  if (autopilot) after(() => runAutopilot(db(), { origin: new URL(req.url).origin }).then(() => undefined, (e) => console.warn("autopilot:", e)));

  // 5. Web tasks: restart any whose driver stopped; close out pauses the browser didn't outlive.
  const active = (await listTasks(supabase).catch(() => [])).filter((t) => ACTIVE.includes(t.status));
  const web = active.length ? await resumeStalled(supabase, active, process.env.APP_URL || new URL(req.url).origin).catch(() => 0) : 0;

  return NextResponse.json({ ok: true, reminders: due.length, brief, birthdays, habits, autopilot, web, dreaming, news });
}
