import { NextResponse } from "next/server";
import { z } from "zod";
import { handle, parseBody } from "@/lib/api";
import { db } from "@/lib/db";
import { deleteReminder, rescheduleReminder, setReminderStatus } from "@/lib/reminders";

type Ctx = { params: Promise<{ id: string }> };

/** Mark done / pending, or move to a new time ({ when, all_day }). */
export const PATCH = handle(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const body = await parseBody(req, z.object({
      status: z.enum(["pending", "done"]).optional(),
      date: z.string().max(40).optional(),
      time: z.string().max(20).optional(),
      in_minutes: z.number().int().min(1).optional(),
      when: z.string().max(40).optional(),
      all_day: z.boolean().optional(),
    }));
  const { status, ...when } = body;
  if (when.date || when.time || when.in_minutes || when.when) return NextResponse.json(await rescheduleReminder(db(), id, when));
  return NextResponse.json(await setReminderStatus(db(), id, status ?? "done"));
});

/** Cancel: removes the reminder note. */
export const DELETE = handle(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  await deleteReminder(db(), id);
  return new Response(null, { status: 204 });
});
