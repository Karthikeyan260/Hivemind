import { NextResponse } from "next/server";
import { z } from "zod";
import { handle, parseBody } from "@/lib/api";
import { db } from "@/lib/db";
import { actOnReminder } from "@/lib/reminders";

/** Cancel / complete / reschedule a reminder identified by a phrase (used by voice). */
export const POST = handle(async (req: Request) => {
  const b = await parseBody(
    req,
    z.object({ action: z.enum(["cancel", "complete", "reschedule"]), which: z.string().trim().min(1).max(200), date: z.string().max(40).optional(), time: z.string().max(20).optional(), in_minutes: z.number().int().min(1).optional() }),
  );
  return NextResponse.json(await actOnReminder(db(), b.action, b.which, { date: b.date, time: b.time, in_minutes: b.in_minutes }));
});
