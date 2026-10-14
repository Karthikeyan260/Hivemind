import { NextResponse } from "next/server";
import { z } from "zod";
import { handle, HttpError } from "@/lib/api";
import { db } from "@/lib/db";
import { getPet, renamePet } from "@/lib/pet";

/** The pet's state: name, stage, growth, mood and what fed it today. */
export const GET = handle(async () => NextResponse.json({ pet: await getPet(db()) }));

/** Rename the pet: { name }. */
export const PATCH = handle(async (req: Request) => {
  const body = z.object({ name: z.string().max(60) }).safeParse(await req.json().catch(() => null));
  if (!body.success) throw new HttpError(400, "Send a name.");
  const name = await renamePet(db(), body.data.name).catch((e) => {
    throw new HttpError(400, e instanceof Error ? e.message : "Couldn't rename it.");
  });
  return NextResponse.json({ name, pet: await getPet(db()) });
});
