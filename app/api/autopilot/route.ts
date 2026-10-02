import { NextResponse } from "next/server";
import { z } from "zod";
import { handle, HttpError, parseBody } from "@/lib/api";
import { getFeed, runAutopilot, saveSettings, setInsightStatus, SettingsInput } from "@/lib/autopilot";
import { db } from "@/lib/db";

export const maxDuration = 60;

/** The Autopilot feed, settings and recent runs. */
export const GET = handle(async () => NextResponse.json(await getFeed(db())));

/** "Run now": one pass while the owner watches (nothing is pushed). */
export const POST = handle(async (req: Request) => {
  const supabase = db();
  const r = await runAutopilot(supabase, { manual: true, origin: new URL(req.url).origin });
  if ("skipped" in r) throw new HttpError(409, "Autopilot is already running. Try again in a minute.");
  return NextResponse.json({ ...r, feed: await getFeed(supabase) });
});

const Patch = z.union([
  z.object({ id: z.uuid(), status: z.enum(["new", "done", "dismissed"]) }),
  z.object({ settings: SettingsInput }),
]);

/** Mark an insight done / dismissed, or change settings. */
export const PATCH = handle(async (req: Request) => {
  const supabase = db();
  const body = await parseBody(req, Patch);
  if ("settings" in body) return NextResponse.json({ settings: await saveSettings(supabase, body.settings) });
  const item = await setInsightStatus(supabase, body.id, body.status);
  if (!item) throw new HttpError(404, "Insight not found");
  return NextResponse.json(item);
});
