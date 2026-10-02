import { NextResponse } from "next/server";
import { handle, HttpError } from "@/lib/api";
import { searchSongs, smartSongs } from "@/lib/music";

/**
 * Songs for the music player: ?q=what to play. A song or artist name is searched as is; a mood or
 * theme ("amma sentiment", "gana") is understood first. &raw=1 skips that (plain search).
 */
export const GET = handle(async (req: Request) => {
  const p = new URL(req.url).searchParams;
  const q = (p.get("q") ?? "").trim().slice(0, 120);
  if (!q) throw new HttpError(400, "Say what to play.");
  if (p.get("raw") === "1") return NextResponse.json({ songs: await searchSongs(q, Number(p.get("n")) || 20), how: "search" });
  return NextResponse.json(await smartSongs(q));
});
