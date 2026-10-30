import { NextResponse } from "next/server";
import { z } from "zod";
import { handle, parseBody } from "@/lib/api";
import { db } from "@/lib/db";
import { getDiaryEntry, listDiaryDates, writeDiary } from "@/lib/nova-diary";
import { localParts } from "@/lib/reminders";

export const maxDuration = 30;

const DateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const PAGES = 21;

/** Nova's diary: the newest pages (with their text) and every date that has one. ?before=2026-10-01 pages further back. */
export const GET = handle(async (req: Request) => {
  const supabase = db();
  const dates = await listDiaryDates(supabase);
  const before = new URL(req.url).searchParams.get("before");
  const from = before && DateStr.safeParse(before).success ? dates.filter((d) => d < before) : dates;
  const entries = (await Promise.all(from.slice(0, PAGES).map((d) => getDiaryEntry(supabase, d)))).filter((e): e is NonNullable<typeof e> => !!e);
  return NextResponse.json({ today: localParts().date, dates, entries });
});

/** "Write today's page now" (or a day's, to redo it). */
export const POST = handle(async (req: Request) => {
  const { date } = await parseBody(req, z.object({ date: DateStr.optional() }));
  const today = localParts().date;
  // Only a day that has happened.
  const d = date && date <= today ? date : today;
  return NextResponse.json({ entry: await writeDiary(db(), d) });
});
