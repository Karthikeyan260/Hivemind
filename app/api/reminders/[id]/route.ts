import { NextResponse } from "next/server";
import { z } from "zod";
import { handle, parseBody } from "@/lib/api";
import { db } from "@/lib/db";
import { setReminderStatus } from "@/lib/reminders";

type Ctx = { params: Promise<{ id: string }> };

/** Mark a reminder done (or back to pending). */
export const PATCH = handle(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const { status } = await parseBody(req, z.object({ status: z.enum(["pending", "done"]) }));
  return NextResponse.json(await setReminderStatus(db(), id, status));
});
