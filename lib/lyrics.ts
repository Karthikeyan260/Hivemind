/**
 * Lyrics for the karaoke view. Time-synced lyrics (LRC: "[01:23.45] words") come from LRCLIB, a free
 * public lyrics database (no key). Only the song's title, artist and length are sent. Pure helpers
 * here are shared with tests; the fetch runs on the server only (see app/api/music/lyrics).
 */
export type LyricLine = { t: number; text: string };
export type Lyrics = {
  /** Timed lines, in order. Empty when only plain lyrics (or none) were found. */
  lines: LyricLine[];
  /** Untimed lyrics, shown as a static sheet when there is no timing we trust. */
  plain: string[];
  synced: boolean;
  /** Which recording the lyrics were matched to (shown small, so a wrong match is visible). */
  match?: { title: string; artist: string; duration: number };
};

type LrcRow = { trackName?: string; artistName?: string; duration?: number; instrumental?: boolean; plainLyrics?: string | null; syncedLyrics?: string | null };

/** "[01:23.45] words" lines → seconds + text. Lines with several stamps repeat; metadata tags are skipped. */
export function parseLrc(lrc: string): LyricLine[] {
  const out: LyricLine[] = [];
  for (const raw of lrc.split(/\r?\n/)) {
    const stamps = [...raw.matchAll(/\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g)];
    if (!stamps.length) continue;
    const text = raw.replace(/\[[^\]]*\]/g, "").replace(/<\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?>/g, "").trim();
    for (const m of stamps) {
      const frac = m[3] ? Number(m[3]) / 10 ** m[3].length : 0;
      out.push({ t: Number(m[1]) * 60 + Number(m[2]) + frac, text });
    }
  }
  return out.sort((a, b) => a.t - b.t);
}

/** A song title as a search key: no "(From "Film")", no "- Reprise", lower-case letters and digits only. */
export function cleanTitle(title: string) {
  return title
    .replace(/\s*[([{].*$/, "")
    .replace(/\s+-\s+.*$/, "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/**
 * True when the words are mostly in another Indian script (Telugu, Hindi, Malayalam, Kannada…): the dubbed
 * version of a Tamil song often has the same length, and its lyrics are not the ones to sing.
 * Tamil script and English letters (Tanglish) are both fine.
 */
export function otherScript(text: string) {
  const tamil = (text.match(/[஀-௿]/g) ?? []).length;
  const other = (text.match(/[ऀ-୿ఀ-ൿ]/g) ?? []).length;
  return other > 20 && other > tamil;
}

/** How far a recording's length may differ from ours and still share its timings. */
export const SYNC_TOLERANCE = 6;

/**
 * The best candidate for our song. Timings only fit the same recording, so a synced match must be
 * about the same length; otherwise we fall back to plain words (still useful to sing from).
 */
export function pickLyrics(rows: LrcRow[], want: { title: string; duration: number }): Lyrics {
  const key = cleanTitle(want.title);
  const usable = rows.filter((r) => !r.instrumental && !otherScript(r.syncedLyrics || r.plainLyrics || ""));
  const sameSong = usable.filter((r) => cleanTitle(r.trackName ?? "") === key);
  const pool = sameSong.length ? sameSong : usable.filter((r) => key && cleanTitle(r.trackName ?? "").includes(key));
  const off = (r: LrcRow) => Math.abs((r.duration ?? 0) - want.duration);
  const about = (r: LrcRow) => ({ title: r.trackName ?? "", artist: r.artistName ?? "", duration: Math.round(r.duration ?? 0) });

  const synced = pool
    .filter((r) => r.syncedLyrics && (!want.duration || off(r) <= SYNC_TOLERANCE))
    .sort((a, b) => off(a) - off(b))[0];
  if (synced) {
    const lines = parseLrc(synced.syncedLyrics!);
    if (lines.filter((l) => l.text).length >= 4) return { lines, plain: [], synced: true, match: about(synced) };
  }
  const withWords = pool.filter((r) => r.plainLyrics || r.syncedLyrics).sort((a, b) => off(a) - off(b))[0];
  if (withWords) {
    const plain = (withWords.plainLyrics || parseLrc(withWords.syncedLyrics ?? "").map((l) => l.text).join("\n")).split(/\r?\n/).map((s) => s.trim());
    return { lines: [], plain, synced: false, match: about(withWords) };
  }
  return { lines: [], plain: [], synced: false };
}

/** The line being sung at time `at` (seconds), or -1 before the first one. */
export function activeLine(lines: LyricLine[], at: number) {
  let lo = 0;
  let hi = lines.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].t <= at) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

const API = "https://lrclib.net/api/search";

/** Looks the song up (title + first artist, then title alone). Never throws: no lyrics is a normal answer. */
export async function findLyrics(song: { title: string; artists: string; duration: number }): Promise<Lyrics> {
  const title = song.title.replace(/\s*[([{].*$/, "").trim();
  const artist = song.artists.split(",")[0]?.trim() ?? "";
  const ask = async (params: Record<string, string>) => {
    try {
      const res = await fetch(`${API}?${new URLSearchParams(params)}`, { headers: { "User-Agent": "lyrics-client/1.0" }, signal: AbortSignal.timeout(8000) });
      return res.ok ? ((await res.json()) as LrcRow[]) : [];
    } catch {
      return [];
    }
  };
  const want = { title, duration: song.duration };
  const first = pickLyrics(await ask(artist ? { track_name: title, artist_name: artist } : { track_name: title }), want);
  if (first.synced) return first;
  // Film songs are often filed under the composer or another singer: try the title alone.
  const second = pickLyrics(await ask({ track_name: title }), want);
  if (second.synced || (!first.plain.length && second.plain.length)) return second;
  return first.plain.length ? first : second;
}
