import { after, NextResponse } from "next/server";
import { z } from "zod";
import { handle, HttpError, parseBody } from "@/lib/api";
import { deleteApp, generate, getApp, markBuilding, restoreVersion } from "@/lib/apps";
import { db } from "@/lib/db";

export const maxDuration = 60;
type Ctx = { params: Promise<{ id: string }> };

/** One app: its code, and its version history (without the old code). */
export const GET = handle(async (_req: Request, { params }: Ctx) => {
  const app = await getApp(db(), (await params).id);
  if (!app) throw new HttpError(404, "App not found");
  return NextResponse.json({ ...app, history: app.history.map(({ version, at, request }) => ({ version, at, request })) });
});

const Patch = z.union([z.object({ change: z.string().trim().min(3).max(1500) }), z.object({ restore: z.number().int().min(0) })]);

/** Change the app ("add a field for km driven"), or undo to an earlier version. */
export const PATCH = handle(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const body = await parseBody(req, Patch);
  if ("restore" in body) {
    const app = await restoreVersion(db(), id, body.restore);
    if (!app) throw new HttpError(404, "That version isn't there.");
    return NextResponse.json({ ok: true, version: app.version });
  }
  const app = await markBuilding(db(), id);
  if (!app) throw new HttpError(404, "App not found");
  after(() => generate(db(), id, body.change));
  return NextResponse.json({ ok: true, status: "building" }, { status: 202 });
});

/** Delete the app and everything it saved. */
export const DELETE = handle(async (_req: Request, { params }: Ctx) => {
  await deleteApp(db(), (await params).id);
  return new NextResponse(null, { status: 204 });
});
