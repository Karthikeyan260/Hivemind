import { NextResponse } from "next/server";
import { handle } from "@/lib/api";
import { db } from "@/lib/db";
import { snoozeHabit } from "@/lib/habits";

type Ctx = { params: Promise<{ id: string }> };

export const POST = handle(async (_req: Request, { params }: Ctx) => NextResponse.json(await snoozeHabit(db(), (await params).id)));
