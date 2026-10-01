import { NextResponse } from "next/server";
import { z } from "zod";
import { handle, HttpError, parseBody } from "@/lib/api";
import { db } from "@/lib/db";
import { addSubscription, listSubscriptions, pushConfigured, removeSubscription } from "@/lib/push";

const Sub = z.object({
  subscription: z.object({ endpoint: z.url(), keys: z.object({ p256dh: z.string(), auth: z.string() }) }),
  device: z.string().max(80).optional(),
});

/** Notification setup: the public key the browser needs, and how many devices are subscribed. */
export const GET = handle(async () => {
  const subs = pushConfigured() ? await listSubscriptions(db()) : [];
  return NextResponse.json({ configured: pushConfigured(), publicKey: process.env.VAPID_PUBLIC_KEY ?? null, devices: subs.map((s) => ({ endpoint: s.endpoint, device: s.device, added: s.added })) });
});

export const POST = handle(async (req: Request) => {
  if (!pushConfigured()) throw new HttpError(503, "Notifications aren't set up: add VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY to the environment.");
  const { subscription, device } = await parseBody(req, Sub);
  return NextResponse.json({ devices: await addSubscription(db(), subscription, device) });
});

export const DELETE = handle(async (req: Request) => {
  const { endpoint } = await parseBody(req, z.object({ endpoint: z.url() }));
  await removeSubscription(db(), endpoint);
  return new NextResponse(null, { status: 204 });
});
