import { NextResponse } from "next/server";
import { z } from "zod";
import { handle, parseBody } from "@/lib/api";
import { db } from "@/lib/db";
import { claimKnock } from "@/lib/games/room";
import { addMarker, countMarkers } from "@/lib/private-store";
import { notify } from "@/lib/push";

/**
 * Open to a friend with the game link (no password), like a call ring: tells the owner someone is
 * waiting to play. Only the owner's real game room can knock, at most every 30 seconds.
 */
export const POST = handle(async (req: Request) => {
  const { room, name, game } = await parseBody(req, z.object({ room: z.string().regex(/^[a-z0-9]{8,40}$/i), name: z.string().max(30).optional(), game: z.enum(["draw", "ludo", "cards", "chess", "dots"]).default("draw") }));
  const supabase = db();
  // At most 10 knocks an hour (counted only for the real room, after the claim checks it).
  const cap = `ratelimit/knock-${room}`;
  if ((await countMarkers(supabase, cap, Date.now() - 3600_000)) >= 10) return NextResponse.json({ knocked: false });
  if (!(await claimKnock(supabase, room))) return NextResponse.json({ knocked: false });
  await addMarker(supabase, cap);
  const who = name?.replace(/[^\p{L}\p{N} .'-]/gu, "").trim() || "A friend";
  const sent = await notify(supabase, { title: `🎮 ${who} wants to play ${game === "ludo" ? "Ludo" : game === "cards" ? "Colour Clash" : game === "chess" ? "chess" : game === "dots" ? "Dots and Boxes" : "Draw & Guess"}`, body: "Tap to open the game: they're waiting.", url: `/games/${game}?friend=1`, tag: "game-knock", sticky: true });
  return NextResponse.json({ knocked: sent > 0 });
});
