import { NextResponse } from "next/server";
import { z } from "zod";
import { handle } from "@/lib/api";
import { db } from "@/lib/db";
import { checkHabit } from "@/lib/habits";

type Ctx = { params: Promise<{ id: string }> };
const Body = z.object({ done: z.boolean().optional(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() });

/** Tick a habit for today (also used by the notification's "✓ Done" button, which sends no body). */
export const POST = handle(async (req: Request, { params }: Ctx) => {
  const body = Body.parse(await req.json().catch(() => ({})));
  return NextResponse.json(await checkHabit(db(), (await params).id, body));
});
