import { NextResponse } from "next/server";
import { handle } from "@/lib/api";
import { dayBrief } from "@/lib/day-brief";
import { db } from "@/lib/db";
import { getProfile } from "@/lib/profile";

/** "Your day": reminders, habits, birthdays and the news headline, with a short script to read aloud. */
export const GET = handle(async () => {
  const supabase = db();
  const name = (await getProfile(supabase).catch(() => null))?.name.split(" ")[0];
  return NextResponse.json(await dayBrief(supabase, name || undefined));
});
