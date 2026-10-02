import { NextResponse } from "next/server";
import { z } from "zod";
import { handle, HttpError, parseBody } from "@/lib/api";
import { getApp, readData, writeData } from "@/lib/apps";
import { db } from "@/lib/db";

type Ctx = { params: Promise<{ id: string }> };
const MAX = 512 * 1024; // each app keeps up to 512 KB of its own data

/** The app's saved data (whatever it stored with hive.set). */
export const GET = handle(async (_req: Request, { params }: Ctx) => NextResponse.json(await readData(db(), (await params).id)));

/** Replace the app's saved data. */
export const PUT = handle(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  if (!(await getApp(db(), id))) throw new HttpError(404, "App not found");
  const { data } = await parseBody(req, z.object({ data: z.record(z.string().max(200), z.unknown()) }));
  if (JSON.stringify(data).length > MAX) throw new HttpError(413, "This app's data is over 512 KB.");
  await writeData(db(), id, data);
  return NextResponse.json({ ok: true });
});

/** Same as PUT: the page saves its last change this way when you leave it (sendBeacon can only POST). */
export const POST = PUT;
