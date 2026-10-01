import { NextResponse } from "next/server";
import { safeEqual } from "@/lib/session";
import { db } from "@/lib/db";

// Supabase pauses free projects after ~7 days idle. Vercel Cron hits this once a day.
export async function GET(req: Request) {
  if (!process.env.CRON_SECRET || !safeEqual(req.headers.get("authorization") ?? "", `Bearer ${process.env.CRON_SECRET}`)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { data, error } = await db().rpc("keepalive");
  if (error) return NextResponse.json({ ok: false }, { status: 500 });
  return NextResponse.json({ ok: true, at: data });
}
