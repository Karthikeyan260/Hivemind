import { NextResponse } from "next/server";
import { z } from "zod";
import { handle, parseBody } from "@/lib/api";
import { addBirthday, upcomingBirthdays } from "@/lib/birthdays";
import { db } from "@/lib/db";

/** Everyone's next birthday/anniversary, soonest first. */
export const GET = handle(async () => NextResponse.json(await upcomingBirthdays(db(), 366)));

const Body = z.object({
  name: z.string().trim().min(1).max(80),
  month: z.number().int().min(1).max(12),
  day: z.number().int().min(1).max(31),
  year: z.number().int().min(1900).max(2100).optional(),
  kind: z.enum(["birthday", "anniversary"]).default("birthday"),
  relation: z.string().max(40).optional(),
});

export const POST = handle(async (req: Request) => NextResponse.json(await addBirthday(db(), await parseBody(req, Body)), { status: 201 }));
