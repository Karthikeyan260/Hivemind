import { NextResponse } from "next/server";
import { handle, HttpError } from "@/lib/api";
import { searchSongs } from "@/lib/music";

/** Songs for the music player: ?q=what to play&n=how many. */
export const GET = handle(async (req: Request) => {
  const p = new URL(req.url).searchParams;
  const q = (p.get("q") ?? "").trim().slice(0, 120);
  if (!q) throw new HttpError(400, "Say what to play.");
  return NextResponse.json({ songs: await searchSongs(q, Number(p.get("n")) || 20) });
});
