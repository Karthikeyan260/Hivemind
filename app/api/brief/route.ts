import { NextResponse } from "next/server";
import { z } from "zod";
import { handle, HttpError, parseBody } from "@/lib/api";
import { getBrief, getBriefSettings, listBriefDates, makeBrief, MAX_TOPICS, setBriefSettings } from "@/lib/brief";
import { db } from "@/lib/db";
import { HOME_TZ } from "@/lib/reminders";

export const maxDuration = 60;

const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: HOME_TZ }).format(new Date());
const DateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** A day's brief (the latest by default), the days that have one, and the topics. */
export const GET = handle(async (req: Request) => {
  const supabase = db();
  const [settings, dates] = await Promise.all([getBriefSettings(supabase), listBriefDates(supabase)]);
  const asked = new URL(req.url).searchParams.get("date");
  const date = asked && DateStr.safeParse(asked).success ? asked : (dates[0] ?? today());
  return NextResponse.json({ settings, dates, date, today: today(), brief: await getBrief(supabase, date) });
});

/** Make today's brief now. */
export const POST = handle(async () => {
  const b = await makeBrief(db(), today());
  if (!b) throw new HttpError(422, "Add a topic first.");
  return NextResponse.json({ brief: b });
});

export const PATCH = handle(async (req: Request) => {
  const patch = await parseBody(req, z.object({ enabled: z.boolean(), topics: z.array(z.string().max(80)).max(MAX_TOPICS) }).partial());
  return NextResponse.json({ settings: await setBriefSettings(db(), patch) });
});
