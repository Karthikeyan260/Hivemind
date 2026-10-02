import { after, NextResponse } from "next/server";
import { z } from "zod";
import { handle, HttpError, parseBody } from "@/lib/api";
import { db } from "@/lib/db";
import { runTask } from "@/lib/web-agent/runner";
import { steelConfigured } from "@/lib/web-agent/steel";
import { createTask, listTasks } from "@/lib/web-agent/store";

export const maxDuration = 60;

/** Web tasks, newest first (the session's live-view link only goes to the owner's own app). */
export const GET = handle(async () => NextResponse.json({ configured: steelConfigured(), tasks: await listTasks(db()) }));

const Body = z.object({ goal: z.string().trim().min(3).max(1000), start_url: z.url().optional() });

/** New task: answers at once, then starts driving the browser after the response. */
export const POST = handle(async (req: Request) => {
  if (!steelConfigured()) throw new HttpError(503, "Add STEEL_API_KEY to use the web agent.");
  const supabase = db();
  const { goal, start_url } = await parseBody(req, Body);
  const task = await createTask(supabase, goal, start_url);
  const origin = process.env.APP_URL || new URL(req.url).origin;
  after(() => runTask(db(), task.id, origin));
  return NextResponse.json(task, { status: 201 });
});
