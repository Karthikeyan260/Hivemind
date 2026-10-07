import { NextResponse } from "next/server";
import { z } from "zod";
import { handle, HttpError, parseBody } from "@/lib/api";
import { getRoom } from "@/lib/call-rooms";
import { endScreen, screenTurn, startScreen } from "@/lib/call-screen";
import { db } from "@/lib/db";

export const maxDuration = 40;

// ~25 s of 16 kHz mono 16-bit WAV, base64.
const MAX_AUDIO = 1_200_000;

const Body = z.discriminatedUnion("op", [
  z.object({ op: z.literal("start"), room: z.string().regex(/^[a-z0-9]{8,40}$/i), name: z.string().max(40).optional() }),
  z.object({ op: z.literal("turn"), room: z.string().regex(/^[a-z0-9]{8,40}$/i), id: z.uuid(), audio: z.string().min(100).max(MAX_AUDIO) }),
  z.object({ op: z.literal("end"), room: z.string().regex(/^[a-z0-9]{8,40}$/i), id: z.uuid() }),
]);

/**
 * Open to the caller (no password), like the ring: HIVEMIND answering a call the owner didn't pick up.
 * Only for real call rooms; the screener sees nothing of the owner's data and has no tools.
 */
export const POST = handle(async (req: Request) => {
  const body = await parseBody(req, Body);
  const supabase = db();
  const room = await getRoom(supabase, body.room);
  if (!room) throw new HttpError(404, "This call link isn't active.");
  if (body.op === "start") {
    const r = await startScreen(supabase, room, body.name?.replace(/[^\p{L}\p{N} .'-]/gu, "").trim() ?? "");
    if (!r) throw new HttpError(409, "Call screening is off.");
    return NextResponse.json(r);
  }
  if (body.op === "end") {
    await endScreen(supabase, room, body.id);
    return NextResponse.json({ ok: true });
  }
  const r = await screenTurn(supabase, room, body.id, body.audio);
  if (!r) throw new HttpError(409, "This call has ended.");
  return NextResponse.json(r);
});
