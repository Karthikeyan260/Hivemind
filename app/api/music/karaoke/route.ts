import { NextResponse } from "next/server";
import { handle, HttpError } from "@/lib/api";
import { pickKaraokeTrack, type KaraokeTrack } from "@/lib/karaoke-track";
import { searchVideos } from "@/lib/video";

export const maxDuration = 30;

const cache = new Map<string, { at: number; track: KaraokeTrack | null }>();
const KEEP_MS = 6 * 60 * 60_000;

/**
 * The karaoke track (music only, no singer) for a song: ?title=&artists=&duration= (seconds).
 * A YouTube karaoke video of about the same length, or { track: null } when there isn't one.
 * Only the song's title and first artist are sent in the search.
 */
export const GET = handle(async (req: Request) => {
  const p = new URL(req.url).searchParams;
  const title = (p.get("title") ?? "")
    .replace(/\s*[([{].*$/, "")
    .trim()
    .slice(0, 120);
  if (!title) throw new HttpError(400, "Which song?");
  const artist = (p.get("artists") ?? "").split(",")[0].trim().slice(0, 60);
  const duration = Math.min(3600, Math.max(0, Number(p.get("duration")) || 0));
  const key = `${title}|${Math.round(duration)}`.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < KEEP_MS) return NextResponse.json({ track: hit.track });

  // Two wordings: the plain one finds most; the artist helps when a title is shared by several films.
  let track = pickKaraokeTrack(await searchVideos(`${title} tamil karaoke`, 15).catch(() => []), { duration });
  if (!track && artist) track = pickKaraokeTrack(await searchVideos(`${title} ${artist} karaoke`, 15).catch(() => []), { duration });
  if (cache.size > 300) cache.delete(cache.keys().next().value as string);
  // "None found" is kept only briefly (the search may have failed for a moment).
  cache.set(key, { at: track ? Date.now() : Date.now() - KEEP_MS + 5 * 60_000, track });
  return NextResponse.json({ track });
});
