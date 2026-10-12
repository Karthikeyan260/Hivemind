import { NextResponse } from "next/server";
import { z } from "zod";
import { handle, HttpError, parseBody } from "@/lib/api";
import { db } from "@/lib/db";
import { addFinder, listFinder, publicView, rekeyFinder, removeFinder, updateFinder } from "@/lib/finder";
import { listSubscriptions } from "@/lib/push";

/** The address a device's helper app calls (its key is in it; shown when created or re-keyed). */
const pingUrl = (req: Request, key: string) => `${process.env.APP_URL || new URL(req.url).origin}/api/finder/ping?k=${key}`;

/** Find my devices: the devices, and the browsers that can ring by notification. */
export const GET = handle(async () => {
  const supabase = db();
  const [devices, subs] = await Promise.all([listFinder(supabase), listSubscriptions(supabase)]);
  return NextResponse.json({ devices: devices.map(publicView), browsers: subs.map((s) => ({ endpoint: s.endpoint, device: s.device ?? "Browser", added: s.added })) });
});

export const POST = handle(async (req: Request) => {
  const { name } = await parseBody(req, z.object({ name: z.string().min(1).max(40) }));
  try {
    const { device, key } = await addFinder(db(), name);
    return NextResponse.json({ device: publicView(device), url: pingUrl(req, key) }, { status: 201 });
  } catch (e) {
    throw new HttpError(400, e instanceof Error ? e.message : "Couldn't add it.");
  }
});

const Patch = z.object({
  id: z.uuid(),
  name: z.string().max(40).optional(),
  ringUrl: z.string().max(300).nullable().optional(),
  pushEndpoint: z.string().max(1000).nullable().optional(),
  lost: z.object({ message: z.string().max(200) }).nullable().optional(),
  rekey: z.boolean().optional(),
});
export const PATCH = handle(async (req: Request) => {
  const { id, rekey, ...patch } = await parseBody(req, Patch);
  const supabase = db();
  if (rekey) {
    const key = await rekeyFinder(supabase, id);
    if (!key) throw new HttpError(404, "No such device.");
    return NextResponse.json({ url: pingUrl(req, key) });
  }
  try {
    const d = await updateFinder(supabase, id, patch);
    if (!d) throw new HttpError(404, "No such device.");
    return NextResponse.json({ device: publicView(d) });
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(400, e instanceof Error ? e.message : "Couldn't save.");
  }
});

export const DELETE = handle(async (req: Request) => {
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!z.uuid().safeParse(id).success) throw new HttpError(400, "Which device?");
  await removeFinder(db(), id);
  return new NextResponse(null, { status: 204 });
});
