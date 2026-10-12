import { NextResponse } from "next/server";
import { z } from "zod";
import { handle, HttpError, parseBody } from "@/lib/api";
import { db } from "@/lib/db";
import { ringDevice } from "@/lib/finder";

/** Ring a device: a push notification, or the helper app's loud alarm. */
export const POST = handle(async (req: Request) => {
  const { id, how } = await parseBody(req, z.object({ id: z.uuid(), how: z.enum(["push", "loud"]).default("push") }));
  try {
    return NextResponse.json(await ringDevice(db(), id, how));
  } catch (e) {
    throw new HttpError(400, e instanceof Error ? e.message : "Couldn't ring it.");
  }
});
