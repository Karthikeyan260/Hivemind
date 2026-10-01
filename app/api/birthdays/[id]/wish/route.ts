import { NextResponse } from "next/server";
import { handle } from "@/lib/api";
import { birthdayWish } from "@/lib/birthdays";
import { db } from "@/lib/db";

type Ctx = { params: Promise<{ id: string }> };

/** An AI-written wish (editable) and a WhatsApp link when the person's number is saved. */
export const POST = handle(async (_req: Request, { params }: Ctx) => NextResponse.json(await birthdayWish(db(), (await params).id)));
