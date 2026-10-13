import { NextResponse } from "next/server";
import { z } from "zod";
import { handle, parseBody } from "@/lib/api";
import { checkinContext, saveCheckin } from "@/lib/checkin";
import { db } from "@/lib/db";

export const maxDuration = 60;

/** Tonight's check-in: done yet?, unfinished reminders, open habits, recent moods. */
export const GET = handle(async () => NextResponse.json(await checkinContext(db())));

/** Save it: mood, a few words, and which unfinished reminders move to tomorrow. */
export const POST = handle(async (req: Request) => {
  const b = await parseBody(req, z.object({ mood: z.number().int().min(1).max(5), text: z.string().max(5000).default(""), move: z.array(z.string().max(64)).max(30).default([]) }));
  return NextResponse.json(await saveCheckin(db(), { mood: b.mood as 1 | 2 | 3 | 4 | 5, text: b.text, move: b.move }));
});
