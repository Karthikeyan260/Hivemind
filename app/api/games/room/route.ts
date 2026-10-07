import { NextResponse } from "next/server";
import { z } from "zod";
import { handle, parseBody } from "@/lib/api";
import { db } from "@/lib/db";
import { gameRoom } from "@/lib/games/room";
import { getProfile } from "@/lib/profile";

async function out(req: Request, reset: boolean) {
  const supabase = db();
  const [r, p] = await Promise.all([gameRoom(supabase, reset), getProfile(supabase).catch(() => null)]);
  const name = p?.name?.split(" ")[0] || "HIVEMIND";
  const origin = process.env.APP_URL || new URL(req.url).origin;
  return NextResponse.json({ room: r.room, name, link: `${origin}/play/${r.room}?from=${encodeURIComponent(name)}` });
}

/** The owner's permanent game link. */
export const GET = handle(async (req: Request) => out(req, false));

/** A new link (the old one stops working). */
export const PATCH = handle(async (req: Request) => {
  await parseBody(req, z.object({ reset: z.literal(true) }));
  return out(req, true);
});
