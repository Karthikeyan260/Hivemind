/**
 * Finding a song's karaoke track (the music without the singer) among YouTube results.
 * Pure helpers, shared with tests; the search itself runs on the server (app/api/music/karaoke).
 */
export type TrackCandidate = { id: string; title: string; channel?: string; duration: string };
export type KaraokeTrack = { id: string; title: string; channel: string; seconds: number };

/** "4:33" or "1:02:10" → seconds (0 when unknown). */
export function clockSeconds(d: string) {
  if (!/^\d+(:\d{1,2}){1,2}$/.test(d.trim())) return 0;
  return d
    .trim()
    .split(":")
    .map(Number)
    .reduce((a, b) => a * 60 + b, 0);
}

const IS_KARAOKE = /karaoke|no vocals?|without vocals?|minus one|instrumental|backing track/i;
// Not what we want to sing over: reaction videos, shorts-style clips, covers with a singer, lessons.
const NOT_A_TRACK = /reaction|cover by|sung by|singing|tutorial|lesson|how to|#shorts|status|teaser|promo|live performance|practice with vocals|with vocals/i;

/** A karaoke track of about the song's own length keeps the lyric timings usable. */
export const TRACK_TOLERANCE = 25;

/**
 * The best karaoke track for a song of `duration` seconds. Length is the strongest sign that a video is the
 * same arrangement (titles are spelt a dozen ways: Kannaana Kanney / Kannana Kanne), so the closest length
 * wins, and search order breaks ties. Returns null when nothing fits.
 */
export function pickKaraokeTrack(videos: TrackCandidate[], song: { duration: number }): KaraokeTrack | null {
  const pool = videos.map((v, rank) => ({ v, rank, s: clockSeconds(v.duration) })).filter(({ v }) => IS_KARAOKE.test(v.title) && !NOT_A_TRACK.test(v.title));
  if (!pool.length) return null;
  const about = ({ v, s }: (typeof pool)[number]): KaraokeTrack => ({ id: v.id, title: v.title, channel: v.channel ?? "", seconds: s });
  // Lengths unknown (search by API key gives none): trust the search order.
  if (!song.duration || pool.every((p) => !p.s)) return about(pool[0]);
  const fits = pool.filter((p) => p.s && Math.abs(p.s - song.duration) <= TRACK_TOLERANCE).sort((a, b) => Math.abs(a.s - song.duration) - Math.abs(b.s - song.duration) || a.rank - b.rank);
  return fits.length ? about(fits[0]) : null;
}
