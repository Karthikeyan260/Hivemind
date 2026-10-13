import { NextResponse } from "next/server";
import { handle } from "@/lib/api";
import { db } from "@/lib/db";
import { kuralSpeech, todaysKural } from "@/lib/kural";

export const maxDuration = 60;

/** Today's kural (chosen from last night's check-in or chats the first time it's asked for each day). */
export const GET = handle(async () => {
  const k = await todaysKural(db());
  return NextResponse.json({ ...k, speech: kuralSpeech(k) });
});
