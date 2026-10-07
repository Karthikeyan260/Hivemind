import { NextResponse } from "next/server";
import { z } from "zod";
import { handle, HttpError, parseBody } from "@/lib/api";
import { db } from "@/lib/db";
import { deleteRoutine, listRoutines, saveRoutine } from "@/lib/routines";

export const GET = handle(async () => NextResponse.json({ routines: await listRoutines(db()) }));

const Body = z.object({
  id: z.uuid().optional(),
  name: z.string().trim().min(1).max(60),
  triggers: z.array(z.string().max(60)).max(6).default([]),
  steps: z.array(z.string().max(200)).min(1).max(8),
});

export const POST = handle(async (req: Request) => {
  const body = await parseBody(req, Body);
  try {
    return NextResponse.json({ routine: await saveRoutine(db(), body) });
  } catch (err) {
    throw new HttpError(400, err instanceof Error ? err.message : "Couldn't save.");
  }
});

export const DELETE = handle(async (req: Request) => {
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!z.uuid().safeParse(id).success) throw new HttpError(400, "Which routine?");
  return NextResponse.json({ deleted: (await deleteRoutine(db(), id))?.name ?? null });
});
