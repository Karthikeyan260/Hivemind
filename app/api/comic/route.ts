import { NextResponse } from "next/server";
import { z } from "zod";
import { handle, HttpError, parseBody } from "@/lib/api";
import { getComic, listComicDates, makeComic, todayIST } from "@/lib/comic";
import { db } from "@/lib/db";
import { getProfile } from "@/lib/profile";

export const maxDuration = 60;

const DateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** A day's comic (today by default) and the days that have one. */
export const GET = handle(async (req: Request) => {
  const date = DateStr.catch(todayIST()).parse(new URL(req.url).searchParams.get("date") ?? todayIST());
  const supabase = db();
  const [comic, dates] = await Promise.all([getComic(supabase, date), listComicDates(supabase)]);
  return NextResponse.json({ date, today: todayIST(), comic, dates });
});

/** Draw (or redraw) a day's comic from what happened that day. */
export const POST = handle(async (req: Request) => {
  const { date } = await parseBody(req, z.object({ date: DateStr.optional() }));
  const supabase = db();
  const name = (await getProfile(supabase).catch(() => null))?.name?.split(" ")[0] || "the owner";
  const comic = await makeComic(supabase, date ?? todayIST(), name);
  if (!comic) throw new HttpError(422, "Not much happened that day yet: chat with HIVEMIND, tick a habit or save something, then try again.");
  return NextResponse.json({ comic });
});
