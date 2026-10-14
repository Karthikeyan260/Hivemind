import { NextResponse } from "next/server";
import { handle, HttpError } from "@/lib/api";
import { db } from "@/lib/db";
import { localParts } from "@/lib/reminders";
import { monthWrapped, recentMonths } from "@/lib/wrapped";

export const maxDuration = 60;

/** A month's Wrapped (?m=2026-10; default: this month so far) and the months to pick from. */
export const GET = handle(async (req: Request) => {
  const m = new URL(req.url).searchParams.get("m") || localParts().date.slice(0, 7);
  const w = await monthWrapped(db(), m).catch((e) => {
    throw new HttpError(400, e instanceof Error ? e.message : "Couldn't make that month.");
  });
  return NextResponse.json({ wrapped: w, months: recentMonths() });
});
