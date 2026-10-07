import { NextResponse } from "next/server";
import { z } from "zod";
import { handle, parseBody } from "@/lib/api";
import { db } from "@/lib/db";
import { claimKnock } from "@/lib/games/room";
import { notify } from "@/lib/push";

/**
 * Open to a friend with the game link (no password), like a call ring: tells the owner someone is
 * waiting to play. Only the owner's real game room can knock, at most every 30 seconds.
 */
export const POST = handle(async (req: Request) => {
  const { room, name } = await parseBody(req, z.object({ room: z.string().regex(/^[a-z0-9]{8,40}$/i), name: z.string().max(30).optional() }));
  const supabase = db();
  if (!(await claimKnock(supabase, room))) return NextResponse.json({ knocked: false });
  const who = name?.replace(/[^\p{L}\p{N} .'-]/gu, "").trim() || "A friend";
  const sent = await notify(supabase, { title: `🎮 ${who} wants to play Draw & Guess`, body: "Tap to open the game: they're waiting.", url: "/games/draw", tag: "game-knock", sticky: true });
  return NextResponse.json({ knocked: sent > 0 });
});
