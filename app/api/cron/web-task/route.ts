import { after, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { safeEqual } from "@/lib/session";
import { runTask } from "@/lib/web-agent/runner";

export const maxDuration = 60;

/**
 * Next leg of a web task. Called by the task itself when its 60-second call runs out, and by the
 * scheduler for stalled tasks. Answers at once and drives after the response.
 * Auth: "Authorization: Bearer <CRON_SECRET>" (this path skips the password gate, like the scheduler).
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const given = req.headers.get("authorization")?.replace(/^Bearer /, "");
  if (!secret || !given || !safeEqual(given, secret)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id");
  if (!id || !/^[0-9a-f-]{36}$/.test(id)) return NextResponse.json({ error: "Bad id" }, { status: 400 });
  const origin = process.env.APP_URL || new URL(req.url).origin;
  after(() => runTask(db(), id, origin));
  return NextResponse.json({ ok: true }, { status: 202 });
}
