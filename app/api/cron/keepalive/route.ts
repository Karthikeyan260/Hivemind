import { NextResponse } from "next/server";
import { safeEqual } from "@/lib/session";
import { db } from "@/lib/db";
import { alertFailure, SCHEDULER_STALE_MS } from "@/lib/alerts";
import { readJSON } from "@/lib/private-store";

// Supabase pauses free projects after ~7 days idle. Vercel Cron hits this once a day.
export async function GET(req: Request) {
  if (!process.env.CRON_SECRET || !safeEqual(req.headers.get("authorization") ?? "", `Bearer ${process.env.CRON_SECRET}`)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const supabase = db();
  const { data, error } = await supabase.rpc("keepalive");
  if (error) return NextResponse.json({ ok: false }, { status: 500 });
  // Watchdog: the every-few-minutes scheduler (cron-job.org) stopped calling in, so reminders and
  // the brief won't arrive. This runs on Vercel's own cron, so it still can say so.
  const state = await readJSON<{ lastRun?: string }>(supabase, "notify-state", {}).catch(() => ({}) as { lastRun?: string });
  const quietFor = state.lastRun ? Date.now() - +new Date(state.lastRun) : Infinity;
  const stale = quietFor > SCHEDULER_STALE_MS;
  if (stale)
    await alertFailure(
      supabase,
      "scheduler",
      state.lastRun ? `The scheduler hasn't run for ${Math.round(quietFor / 3_600_000)} hours, so reminders and the brief won't arrive. Check the job on cron-job.org.` : "The scheduler has never run: set up the job on cron-job.org (see README).",
    );
  return NextResponse.json({ ok: true, at: data, scheduler: stale ? "stale" : "ok" });
}
