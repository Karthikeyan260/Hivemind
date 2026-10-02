import { after, NextResponse } from "next/server";
import { generate, getApp } from "@/lib/apps";
import { db } from "@/lib/db";
import { safeEqual } from "@/lib/session";

export const maxDuration = 60;

/**
 * Builds (or changes) an app in the background, for requests made by voice or chat, whose own call
 * can't wait ~30 s. Auth: "Authorization: Bearer <CRON_SECRET>" (this path skips the password gate).
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const given = req.headers.get("authorization")?.replace(/^Bearer /, "");
  if (!secret || !given || !safeEqual(given, secret)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!/^[0-9a-f-]{36}$/.test(id)) return NextResponse.json({ error: "Bad id" }, { status: 400 });
  const app = await getApp(db(), id);
  if (!app?.pending) return NextResponse.json({ ok: true, nothing: true });
  const request = app.pending;
  after(() => generate(db(), id, request));
  return NextResponse.json({ ok: true }, { status: 202 });
}

