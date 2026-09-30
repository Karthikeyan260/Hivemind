import { NextResponse } from "next/server";
import { z } from "zod";
import { handle, parseBody } from "@/lib/api";
import { db } from "@/lib/db";
import { researchAndSave, webSearch } from "@/lib/external/web";

export const maxDuration = 60;

/** Web search with Google grounding. save=true researches in depth and files it as a note. */
export const POST = handle(async (req: Request) => {
  const { query, save } = await parseBody(req, z.object({ query: z.string().trim().min(2).max(500), save: z.boolean().optional() }));
  if (!save) return NextResponse.json(await webSearch(query));
  const { note, result } = await researchAndSave(db(), query);
  return NextResponse.json({ ...result, saved: { id: note.id, title: note.title } }, { status: 201 });
});
