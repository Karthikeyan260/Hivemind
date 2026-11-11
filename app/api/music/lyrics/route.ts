import { NextResponse } from "next/server";
import { handle, HttpError } from "@/lib/api";
import { findLyrics, type Lyrics } from "@/lib/lyrics";

export const maxDuration = 30;

// Lyrics don't change: remember them for this server instance (small, bounded).
const cache = new Map<string, { at: number; lyrics: Lyrics }>();
const KEEP_MS = 6 * 60 * 60_000;

/**
 * Lyrics for the karaoke view: ?title=&artists=&duration= (seconds). Time-synced lines when a recording
 * of the same length is found, otherwise plain words, otherwise empty. Only the song's title, artist and
 * length leave the server.
 */
export const GET = handle(async (req: Request) => {
  const p = new URL(req.url).searchParams;
  const title = (p.get("title") ?? "").trim().slice(0, 200);
  if (!title) throw new HttpError(400, "Which song?");
  const artists = (p.get("artists") ?? "").trim().slice(0, 300);
  const duration = Math.min(3600, Math.max(0, Number(p.get("duration")) || 0));
  const key = `${title}|${artists}|${Math.round(duration)}`.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < KEEP_MS) return NextResponse.json(hit.lyrics);
  const lyrics = await findLyrics({ title, artists, duration });
  // "Nothing found" is kept only briefly: the lookup may simply have timed out.
  if (lyrics.lines.length || lyrics.plain.length) {
    if (cache.size > 300) cache.delete(cache.keys().next().value as string);
    cache.set(key, { at: Date.now(), lyrics });
  }
  return NextResponse.json(lyrics);
});
