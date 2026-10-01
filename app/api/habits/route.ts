import { NextResponse } from "next/server";
import { z } from "zod";
import { handle, parseBody } from "@/lib/api";
import { db } from "@/lib/db";
import { addHabit, everyHours, habitsWithStats } from "@/lib/habits";

export const GET = handle(async () => NextResponse.json(await habitsWithStats(db())));

const Body = z.object({
  name: z.string().trim().min(1).max(60),
  emoji: z.string().max(8).optional(),
  times: z.array(z.string()).max(24).optional(),
  every_hours: z.number().min(0.5).max(12).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  days: z.array(z.number().int().min(0).max(6)).max(7).optional(),
});

export const POST = handle(async (req: Request) => {
  const b = await parseBody(req, Body);
  const times = b.every_hours ? everyHours(b.every_hours, b.from, b.to) : (b.times ?? []);
  return NextResponse.json(await addHabit(db(), { name: b.name, emoji: b.emoji, times, days: b.days }), { status: 201 });
});
