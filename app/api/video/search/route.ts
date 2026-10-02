import { NextResponse } from "next/server";
import { handle, HttpError } from "@/lib/api";
import { searchVideos } from "@/lib/video";

/** Videos for the video player: ?q=what to watch&n=how many. */
export const GET = handle(async (req: Request) => {
  const p = new URL(req.url).searchParams;
  const q = (p.get("q") ?? "").trim().slice(0, 120);
  if (!q) throw new HttpError(400, "Say what to watch.");
  return NextResponse.json({ videos: await searchVideos(q, Number(p.get("n")) || 12) });
});
