import { NextResponse } from "next/server";
import { z } from "zod";
import { handle, parseBody } from "@/lib/api";
import { db } from "@/lib/db";
import { agenda, createReminder } from "@/lib/reminders";

/** Agenda: overdue, today, tomorrow and later (?days=7). */
export const GET = handle(async (req: Request) => {
  const days = Math.min(Number(new URL(req.url).searchParams.get("days")) || 7, 60);
  return NextResponse.json(await agenda(db(), days));
});

export const POST = handle(async (req: Request) => {
  const body = await parseBody(
    req,
    z.object({
      title: z.string().trim().min(1).max(200),
      when: z.string().min(4),
      all_day: z.boolean().optional(),
      details: z.string().max(4000).optional(),
      remind_before_min: z.number().int().min(0).max(1440).optional(),
    }),
  );
  return NextResponse.json(await createReminder(db(), body), { status: 201 });
});
