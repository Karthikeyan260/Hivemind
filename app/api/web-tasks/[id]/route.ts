import { after, NextResponse } from "next/server";
import { z } from "zod";
import { handle, HttpError, parseBody } from "@/lib/api";
import { db } from "@/lib/db";
import { decideTask, runTask } from "@/lib/web-agent/runner";
import { getTask } from "@/lib/web-agent/store";

export const maxDuration = 60;
type Ctx = { params: Promise<{ id: string }> };

export const GET = handle(async (_req: Request, { params }: Ctx) => {
  const task = await getTask(db(), (await params).id);
  if (!task) throw new HttpError(404, "Task not found");
  return NextResponse.json(task);
});

const Body = z.object({ decision: z.enum(["approve", "reject", "continue", "cancel", "retry"]) });

/** The owner's answer: approve / reject a risky step, continue after taking over, cancel, retry. */
export const POST = handle(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const { decision } = await parseBody(req, Body);
  const r = await decideTask(db(), id, decision);
  if (!r) throw new HttpError(404, "Task not found");
  if (r.run) {
    const origin = process.env.APP_URL || new URL(req.url).origin;
    after(() => runTask(db(), id, origin));
  }
  return NextResponse.json(r.task);
});
