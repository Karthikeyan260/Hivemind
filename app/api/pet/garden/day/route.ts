import { NextResponse } from "next/server";
import { handle } from "@/lib/api";
import { db } from "@/lib/db";
import { getGardenDay } from "@/lib/garden-day";

/** One day in the garden: what happened on the date a flower was planted (?date=2026-10-15). */
export const GET = handle(async (req: Request) => {
  const date = new URL(req.url).searchParams.get("date") ?? "";
  return NextResponse.json({ day: await getGardenDay(db(), date) });
});
