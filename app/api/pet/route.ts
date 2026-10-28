import { NextResponse } from "next/server";
import { z } from "zod";
import { handle, HttpError } from "@/lib/api";
import { db } from "@/lib/db";
import { getPet, logWalk, recordFireflies, renamePet, wearAccessory } from "@/lib/pet";
import { ACCESSORY_IDS } from "@/lib/pet-looks";

/** The pet's state: name, stage, growth, mood and what fed it today. */
export const GET = handle(async () => NextResponse.json({ pet: await getPet(db()) }));

/** Rename the pet: { name }, or put on an accessory: { wear }. */
export const PATCH = handle(async (req: Request) => {
  const raw = await req.json().catch(() => null);
  const wear = z.object({ wear: z.enum(["none", ...ACCESSORY_IDS]) }).safeParse(raw);
  if (wear.success) {
    const pet = await wearAccessory(db(), wear.data.wear).catch((e) => {
      throw new HttpError(400, e instanceof Error ? e.message : "Couldn't put it on.");
    });
    return NextResponse.json({ pet });
  }
  // A wear request that isn't an accessory is that, not a missing name.
  if (raw && typeof raw === "object" && "wear" in raw) throw new HttpError(400, "That isn't an accessory.");
  const body = z.object({ name: z.string().max(60) }).safeParse(raw);
  if (!body.success) throw new HttpError(400, "Send a name.");
  const name = await renamePet(db(), body.data.name).catch((e) => {
    throw new HttpError(400, e instanceof Error ? e.message : "Couldn't rename it.");
  });
  return NextResponse.json({ name, pet: await getPet(db()) });
});

/** A finished lantern walk (all sparks found): counts toward growth, 3 a day. Or a finished firefly round: { fireflies: score } keeps the best. */
export const POST = handle(async (req: Request) => {
  const raw = await req.json().catch(() => null);
  const fl = z.object({ fireflies: z.number().int().min(0).max(500) }).safeParse(raw);
  if (fl.success) {
    const r = await recordFireflies(db(), fl.data.fireflies);
    return NextResponse.json({ ...r, pet: await getPet(db()) });
  }
  const body = z.object({ walk: z.literal(true) }).safeParse(raw);
  if (!body.success) throw new HttpError(400, "Nothing to log.");
  const r = await logWalk(db());
  return NextResponse.json({ ...r, pet: await getPet(db()) });
});
