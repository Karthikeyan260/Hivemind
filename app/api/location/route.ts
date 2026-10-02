import { NextResponse } from "next/server";
import { z } from "zod";
import { handle, parseBody } from "@/lib/api";
import { db } from "@/lib/db";
import { forgetDevice, listDevices, saveFix } from "@/lib/device-location";

/** The owner's devices and where each one last was. */
export const GET = handle(async () => NextResponse.json({ devices: await listDevices(db()) }));

const Fix = z.object({
  id: z.string().min(8).max(64),
  name: z.string().trim().min(1).max(60),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracy: z.number().min(0).max(100_000),
});

/** A device reports where it is (only while its location sharing is on). */
export const POST = handle(async (req: Request) => {
  const f = await parseBody(req, Fix);
  await saveFix(db(), { ...f, accuracy: Math.round(f.accuracy), at: new Date().toISOString() });
  return NextResponse.json({ ok: true });
});

/** Sharing switched off on a device: forget its last spot. */
export const DELETE = handle(async (req: Request) => {
  const id = new URL(req.url).searchParams.get("id");
  if (id) await forgetDevice(db(), id);
  return new NextResponse(null, { status: 204 });
});
