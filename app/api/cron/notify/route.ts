import { after, NextResponse } from "next/server";
import { autopilotDue, runAutopilot } from "@/lib/autopilot";
import { safeEqual } from "@/lib/session";
import { recoverStuckBuilds } from "@/lib/apps";
import { reembedMissing } from "@/lib/knowledge";
import { getMarker } from "@/lib/ai/embeddings";
import { alertFailure } from "@/lib/alerts";
import { migrationStep } from "@/lib/embedding-migration";
import { openTables } from "@/lib/health";
import { birthdaysToday, runBirthdayAlerts } from "@/lib/birthdays";
import { briefHeadline, getBriefSettings, makeBrief } from "@/lib/brief";
import { dream, getDream, getDreamSettings } from "@/lib/dream";
import { db } from "@/lib/db";
import { getWeather, HOME_CITY } from "@/lib/external/weather";
import { runHabitAlerts } from "@/lib/habits";
import { runPetNudges } from "@/lib/pet";
import { listCheckins, nudgeDue } from "@/lib/checkin";
import { todaysKural } from "@/lib/kural";
import { monthWrapped } from "@/lib/wrapped";
import { readJSON, writeJSON } from "@/lib/private-store";
import { notify, pushConfigured } from "@/lib/push";
import { agenda, dueAlerts, HOME_TZ, releaseAlert } from "@/lib/reminders";
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
    const sent = await notify(supabase, { title: `⏰ ${r.title}`, body: [r.when, r.details].filter(Boolean).join(" · "), url: "/", tag: `reminder-${r.id}` }).catch(() => 0);
    // No device took it: hand it back so the next run (or an open tab) can still show it.
    if (!sent) await releaseAlert(supabase, r.id).catch(() => {});
  }

  // 2. Morning brief, once a day after BRIEF_HOUR local time.
  const now = new Date();
  const [date, hour] = [
    new Intl.DateTimeFormat("en-CA", { timeZone: HOME_TZ }).format(now),
    Number(new Intl.DateTimeFormat("en-GB", { timeZone: HOME_TZ, hour: "2-digit", hourCycle: "h23" }).format(now)),
  ];
  const state = await readJSON<{ brief?: string; lastRun?: string; lastSent?: number; dream?: string; news?: string; rls?: string; checkin?: string; wrapped?: string; newsTry?: { date: string; n: number; at: number } }>(supabase, "notify-state", {});
  let brief = false;
  // Morning window only, so enabling this in the afternoon doesn't send a "good morning".
  if (hour >= BRIEF_HOUR && hour < 12 && state.brief !== date) {
    // Today's kural is chosen now (from last night's check-in), so it's ready when the app opens.
    const [a, w, bdays, kural] = await Promise.all([
      agenda(supabase, 2),
      getWeather(HOME_CITY).catch(() => null),
      birthdaysToday(supabase).catch(() => []),
      Promise.race([todaysKural(supabase, date), new Promise<null>((r) => setTimeout(() => r(null), 25_000))]).catch(() => null),
    ]);
    const items = [...a.overdue.map((r) => `${r.title} (overdue)`), ...a.today.map((r) => `${r.title}, ${r.when.replace(/^Today,?\s*/i, "")}`)];
    const weather = w ? `${w.place}: ${Math.round(w.current.temp_c)}°C, ${w.current.condition}${w.days[0] ? `, rain ${w.days[0].rain_chance_pct}%` : ""}.` : "";
    // What Dream mode did last night, in one line.
    const night = await getDream(supabase, date).catch(() => null);
    const counts = night ? (["merged", "updated", "learned"] as const).map((k) => [k, night.changes.filter((c) => c.kind === k).length] as const).filter(([, n]) => n) : [];
    const dreamLine = counts.length ? `💤 Last night I ${counts.map(([k, n]) => `${k} ${n}`).join(", ")} memories.` : "";
    const plan = items.length ? `Today: ${items.slice(0, 4).join("; ")}${items.length > 4 ? ` +${items.length - 4} more` : ""}.` : "Nothing scheduled today.";
    // Only counts as sent once a device actually got it (so subscribing later today still gets one).
    brief = (await notify(supabase, { title: "Good morning ☀️", body: [bdays.join(" · "), plan, weather, dreamLine, kural ? `📜 Kural ${kural.num}: ${kural.en || kural.pope}` : ""].filter(Boolean).join(" "), url: "/", tag: "brief" })) > 0;
  }
  // 3. Birthdays (week / eve / day) and habits (times, snoozes, 8 pm nudge, Sunday summary).
  const [birthdays, habits] = await Promise.all([runBirthdayAlerts(supabase, now).catch(() => 0), runHabitAlerts(supabase, now).catch(() => 0), runPetNudges(supabase, now).catch(() => 0)]);

  // My Wrapped: on the 1st, from 9 am, last month's story cards are ready (made now, so they open at once).
  let wrapped = false;
  const lastMonth = (() => {
    const [y, mo] = date.split("-").map(Number);
    return mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, "0")}`;
  })();
  if (date.endsWith("-01") && hour >= 9 && hour < 21 && state.wrapped !== lastMonth) {
    const w = await monthWrapped(supabase, lastMonth).catch(() => null);
    if (w) wrapped = (await notify(supabase, { title: `🎉 Your ${w.label} Wrapped is ready`, body: w.headline, url: `/wrapped?m=${lastMonth}`, tag: "wrapped" }).catch(() => 0)) > 0;
  }

  // Night check-in: one nudge at 9 pm if tonight's isn't done yet.
  let checkin = false;
  if (hour >= 21 && hour < 23 && state.checkin !== date) {
    const done = (await listCheckins(supabase).catch(() => [])).some((c) => c.date === date);
    checkin = !nudgeDue(hour, date, state.checkin, done) || (await notify(supabase, { title: "🌙 How was your day?", body: "A 30-second check-in: your mood, a few words, and what moves to tomorrow.", url: "/?checkin=1", tag: "checkin" }).catch(() => 0)) > 0;
  }

  // Dream mode: once a night, from its hour until 7 am (marked first, so later checks don't start it again).
  const dreamSet = await getDreamSettings(supabase).catch(() => null);
  const dreaming = !!dreamSet?.enabled && hour >= dreamSet.hour && hour < 7 && state.dream !== date;
  // The news brief: once each morning, after the "good morning" window opens, if topics are set.
  const briefSet = await getBriefSettings(supabase).catch(() => null);
  // Tried up to 3 times a morning, 10 minutes apart; it counts as done only once the brief is saved (see below), so one failure doesn't cost the day.
  const tries = state.newsTry?.date === date ? state.newsTry : { date, n: 0, at: 0 };
  const news = !!briefSet?.enabled && !!briefSet.topics.length && hour >= BRIEF_HOUR && hour < 12 && state.news !== date && tries.n < 3 && now.getTime() - tries.at > 10 * 60_000;

  // Settings shows "scheduler last checked …", so a stopped cron-job.org is visible.
  // Merged into what is stored right now, not the copy read at the start: a brief or dream that finished meanwhile must keep its "done" mark.
  const fresh = await readJSON<typeof state>(supabase, "notify-state", state).catch(() => state);
  await writeJSON(supabase, "notify-state", { ...fresh, ...(brief ? { brief: date } : {}), ...(dreaming ? { dream: date } : {}), ...(news ? { newsTry: { date, n: tries.n + 1, at: now.getTime() } } : {}), ...(checkin ? { checkin: date } : {}), ...(wrapped ? { wrapped: lastMonth } : {}), lastRun: now.toISOString(), lastSent: due.length });
  // The jobs that run on their own: a failure becomes a push (once a day each), never silence.
  if (dreaming)
    after(() =>
      dream(db(), date).then(
        (d) => (/couldn.t think/i.test(d.note ?? "") ? alertFailure(db(), "dream", "Dream mode couldn't think it through tonight (the AI didn't answer). Your memories are unchanged.") : undefined),
        (e) => alertFailure(db(), "dream", e),
      ),
    );
  if (news)
    after(async () => {
      try {
        const b = await makeBrief(db(), date);
        if (!b) return;
        if (!b.items.some((i) => i.points.length)) return void (await alertFailure(db(), "brief", "None of your brief topics could be researched this morning (web search or AI failed). Try Refresh on the Brief page."));
        // Saved with something in it: today's brief is done (no more tries).
        const cur = await readJSON<Record<string, unknown>>(db(), "notify-state", {});
        await writeJSON(db(), "notify-state", { ...cur, news: date });
        await notify(db(), { title: "📰 Your morning brief", body: briefHeadline(b), url: "/brief", tag: "news-brief" }).catch(() => 0);
      } catch (e) {
        await alertFailure(db(), "brief", e);
      }
    });

  // 4. Autopilot: after the response, so the scheduler's request stays fast.
  const autopilot = await autopilotDue(supabase, now).catch(() => false);
  if (autopilot)
    after(() =>
      runAutopilot(db(), { origin: new URL(req.url).origin }).then(
        (r) => ("error" in r && r.error ? alertFailure(db(), "autopilot", r.error) : undefined),
        (e) => alertFailure(db(), "autopilot", e),
      ),
    );

  // Notes / memories saved while embeddings were down: add their search vectors now.
  const reembedded = await reembedMissing(supabase).catch(() => 0);
  // A re-embed (Settings → Embeddings) left unfinished: carry on with it.
  const migrating = !!(await getMarker().catch(() => null))?.target;
  if (migrating) after(() => migrationStep(db(), 40_000).then(() => undefined, (e) => console.warn("re-embed:", e)));
  // Once a day: a table created without row level security would be open to the public key.
  if (state.rls !== date) {
    const open = await openTables(supabase).catch(() => null);
    if (open?.length) await notify(supabase, { title: "⚠️ Database table not private", body: `Row level security is off for: ${open.join(", ")}. Open Settings → System check.`, url: "/settings", tag: "rls" }).catch(() => 0);
    await writeJSON(supabase, "notify-state", { ...(await readJSON<Record<string, unknown>>(supabase, "notify-state", {})), rls: date }).catch(() => {});
  }
  // App builds that were cut off: start once more, or mark failed.
  const apps = await recoverStuckBuilds(supabase, process.env.APP_URL || new URL(req.url).origin).catch(() => 0);

  // 5. Web tasks: restart any whose driver stopped; close out pauses the browser didn't outlive.
  const active = (await listTasks(supabase).catch(() => [])).filter((t) => ACTIVE.includes(t.status));
  const web = active.length ? await resumeStalled(supabase, active, process.env.APP_URL || new URL(req.url).origin).catch(() => 0) : 0;

  return NextResponse.json({ ok: true, reminders: due.length, brief, birthdays, habits, autopilot, web, dreaming, news, apps, reembedded, migrating });
}
