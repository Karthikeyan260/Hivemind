import "server-only";

/**
 * Songs for HIVEMIND's own music player, from JioSaavn (big Tamil / Indian catalogue, full songs,
 * no ads). Uses the same JSON API JioSaavn's apps call (unofficial: owner-only, may change).
 * Search runs here; the owner's browser then plays the audio file directly.
 */
const API = "https://www.jiosaavn.com/api.php";
const UA = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36" };

export type Song = {
  id: string;
  title: string;
  artists: string;
  album: string;
  image: string;
  duration: number;
  language: string;
  year: string;
  /** JioSaavn's encrypted media id: exchanged for a fresh, playable link right before playing. */
  media: string;
};

const unescape = (s: unknown) =>
  String(s ?? "")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();

async function call<T>(params: Record<string, string>): Promise<T> {
  const qs = new URLSearchParams({ _format: "json", _marker: "0", api_version: "4", ...params });
  const res = await fetch(`${API}?${qs}`, { headers: UA, signal: AbortSignal.timeout(12_000), cache: "no-store" });
  if (!res.ok) throw new Error(`Music search failed (${res.status})`);
  return (await res.json()) as T;
}

type Raw = {
  id: string;
  title: string;
  language?: string;
  year?: string;
  image?: string;
  subtitle?: string;
  more_info?: {
    album?: string;
    duration?: string;
    encrypted_media_url?: string;
    music?: string;
    artistMap?: { primary_artists?: { name: string }[] };
  };
};

const toSong = (r: Raw): Song | null => {
  const m = r.more_info ?? {};
  if (!m.encrypted_media_url) return null;
  const artists = (m.artistMap?.primary_artists ?? []).map((a) => a.name).join(", ") || m.music || r.subtitle || "";
  return {
    id: r.id,
    title: unescape(r.title),
    artists: unescape(artists),
    album: unescape(m.album),
    // Bigger cover art than the 150 px default.
    image: (r.image ?? "").replace(/-?\d+x\d+(?=\.(jpg|png|webp))/, "-500x500"),
    duration: Number(m.duration ?? 0),
    language: r.language ?? "",
    year: r.year ?? "",
    media: m.encrypted_media_url,
  };
};

/** Songs matching a request: a title ("Vibe Venuma"), an artist ("Anirudh songs"), a mood ("Tamil melody"). */
export async function searchSongs(query: string, count = 20): Promise<Song[]> {
  const r = await call<{ results?: Raw[] }>({ __call: "search.getResults", ctx: "web6dot0", q: query, n: String(Math.min(50, count)), p: "1" });
  // Same song uploaded twice (single + film release): keep one.
  const seen = new Set<string>();
  const key = (s: Song) => `${s.title.toLowerCase().replace(/\s*\(.*?\)\s*/g, "")}|${s.artists.split(",")[0].toLowerCase()}`;
  const songs = (r.results ?? []).map(toSong).filter((s): s is Song => !!s && !seen.has(key(s)) && !!seen.add(key(s)));
  // The owner listens in Tamil: Tamil first unless the request names another language.
  const named = LANGUAGES.find((l) => new RegExp(`\\b${l}\\b`, "i").test(query));
  const prefer = named ?? (process.env.MUSIC_LANGUAGE || "tamil");
  return songs.map((s, i) => ({ s, i })).sort((a, b) => Number(b.s.language === prefer) - Number(a.s.language === prefer) || a.i - b.i).map((x) => x.s);
}

const LANGUAGES = ["tamil", "telugu", "hindi", "malayalam", "kannada", "english", "punjabi", "bengali", "marathi"];

/**
 * A fresh link to the full song (320 kbps when available). The app route's links play from any site;
 * the website's need a jiosaavn.com referrer. Links expire after a few hours, so fetch at play time.
 */
export async function streamUrl(media: string) {
  const r = await call<{ status?: string; auth_url?: string }>({ __call: "song.generateAuthToken", ctx: "android", bitrate: "320", url: media });
  if (r.status !== "success" || !r.auth_url) throw new Error("This song can't be played right now.");
  return r.auth_url.replace(/^http:/, "https:");
}
