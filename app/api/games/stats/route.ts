import { NextResponse } from "next/server";
import { handle, parseBody } from "@/lib/api";
import { db } from "@/lib/db";
import { addResult, GameResult, listResults } from "@/lib/games/stats";

/** The owner's finished games, newest first. */
export const GET = handle(async () => NextResponse.json({ results: (await listResults(db())).reverse() }));

/** A game just ended on the owner's device. */
export const POST = handle(async (req: Request) => {
  const r = await parseBody(req, GameResult);
  return NextResponse.json({ ok: true, count: await addResult(db(), r) });
});
