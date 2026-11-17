import { NextResponse } from "next/server";
import { handle } from "@/lib/api";
import { db } from "@/lib/db";
import { weeklyReview } from "@/lib/weekly";

/** The last 7 days in numbers: habits per day, moods, notes, games. */
export const GET = handle(async () => NextResponse.json(await weeklyReview(db())));
