import { NextResponse } from "next/server";
import { z } from "zod";
import { handle, parseBody } from "@/lib/api";
import { after } from "next/server";
import { streamUrl } from "@/lib/music";
import { db } from "@/lib/db";
import { logPlay } from "@/lib/plays";

const Body = z.object({
  media: z.string().min(8).max(400),
  // What is being played, for Wrapped's top songs (optional: older players don't send it).
  title: z.string().max(200).optional(),
  artists: z.string().max(300).optional(),
  image: z.string().max(500).optional(), // shown only as an img src on the owner's Wrapped
});

/** A fresh, playable link for one song (links expire, so the player asks right before playing). */
export const POST = handle(async (req: Request) => {
  const { media, title, artists, image } = await parseBody(req, Body);
  const url = await streamUrl(media);
  if (title) after(() => logPlay(db(), { title, artists: artists ?? "", image }).catch(() => {}));
  return NextResponse.json({ url });
});
