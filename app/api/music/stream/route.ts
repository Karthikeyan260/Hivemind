import { NextResponse } from "next/server";
import { z } from "zod";
import { handle, parseBody } from "@/lib/api";
import { streamUrl } from "@/lib/music";

const Body = z.object({ media: z.string().min(8).max(400) });

/** A fresh, playable link for one song (links expire, so the player asks right before playing). */
export const POST = handle(async (req: Request) => {
  const { media } = await parseBody(req, Body);
  return NextResponse.json({ url: await streamUrl(media) });
});
