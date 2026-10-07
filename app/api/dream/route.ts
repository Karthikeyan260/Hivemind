import { NextResponse } from "next/server";
import { z } from "zod";
import { handle, HttpError, parseBody } from "@/lib/api";
import { db } from "@/lib/db";
import { dream, getDream, getDreamSettings, listDreamDates, setDreamSettings, undoDreamChange } from "@/lib/dream";
import { HOME_TZ } from "@/lib/reminders";

export const maxDuration = 60;

const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: HOME_TZ }).format(new Date());
const DateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** A night's dream report (the latest by default), the nights that have one, and the settings. */
export const GET = handle(async (req: Request) => {
  const supabase = db();
  const [settings, dates] = await Promise.all([getDreamSettings(supabase), listDreamDates(supabase)]);
  const asked = new URL(req.url).searchParams.get("date");
  const date = asked && DateStr.safeParse(asked).success ? asked : (dates[0] ?? today());
  return NextResponse.json({ settings, dates, date, dream: await getDream(supabase, date) });
});

const Post = z.union([z.object({ now: z.literal(true) }), z.object({ undo: z.number().int().min(0).max(50), date: DateStr })]);

/** "Dream now", or undo one change of a report. */
export const POST = handle(async (req: Request) => {
  const body = await parseBody(req, Post);
  const supabase = db();
  if ("now" in body) return NextResponse.json({ dream: await dream(supabase, today()) });
  const d = await undoDreamChange(supabase, body.date, body.undo);
  if (!d) throw new HttpError(404, "No such change.");
  return NextResponse.json({ dream: d });
});

export const PATCH = handle(async (req: Request) => {
  const patch = await parseBody(req, z.object({ enabled: z.boolean(), hour: z.number().int().min(0).max(6) }).partial());
  return NextResponse.json({ settings: await setDreamSettings(db(), patch) });
});
