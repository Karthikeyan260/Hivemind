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

// ---------- understanding the request ("amma sentiment", "gana", "90s melody") ----------

/** Words that describe a mood, theme or genre rather than name a song. */
const MOOD =
  /\b(sentiment(al)?|emotional|sad|pain|breakup|love|romantic|melody|melodies|gana|kuthu|folk|devotional|bhakti|amma|appa|mother|father|friend(ship)?|motivational|inspir\w*|workout|gym|party|dance|mass|rain|night|sleep|lullaby|wedding|marriage|festival|happy|feel ?good|chill|relax\w*|calm|soothing|old|classic|evergreen|retro|vintage|\d0s|\d{4}s|bgm|instrumental|trending|viral|latest|new releases?|top|hits)\b/i;
const FILLER = new Set(["song", "songs", "music", "track", "tracks", "play", "some", "the", "a", "an", "of", "for", "me", "my", "any", "good", "best", "nice", "please", "pls", "list", "playlist", "video", ...["tamil", "telugu", "hindi", "malayalam", "kannada", "english", "punjabi", "bengali", "marathi"]]);
const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9஀-௿ ]+/g, " ").split(/\s+/).filter((w) => w.length > 1 && !FILLER.has(w));

type Pick = { songs: Song[]; how: "search" | "playlist" | "ai"; label?: string };

/**
 * What to play for a request. A song or artist name plays as found; a mood or theme ("amma
 * sentiment", "gana", "90s melody") plays a matching JioSaavn editors' playlist, or songs the AI
 * knows fit (each one checked against JioSaavn, so only real, playable songs are queued).
 */
export async function smartSongs(query: string): Promise<Pick> {
  const topic = words(query);
  const language = LANGUAGES.find((l) => new RegExp(`\\b${l}\\b`, "i").test(query)) ?? (process.env.MUSIC_LANGUAGE || "tamil");
  const direct = await searchSongs(query).catch(() => [] as Song[]);
  // Named a song / artist / film: every topic word shows up in the top results.
  const hay = (s: Song) => `${s.title} ${s.artists} ${s.album}`.toLowerCase();
  const named = direct.slice(0, 3).some((s) => topic.length > 0 && topic.every((w) => hay(s).includes(w)));
  if (!MOOD.test(query) && (named || !topic.length) && direct.length) return { songs: direct, how: "search" };

  // Only the meaningful words: JioSaavn's playlist search gets lost on "song", "play", "some".
  const list = await moodPlaylist(`${topic.join(" ")} ${language}`.trim(), topic, language).catch(() => null);
  if (list && list.songs.length >= 5) return list;

  const ai = await aiSongs(query, language).catch(() => [] as Song[]);
  if (ai.length >= 3) return { songs: ai, how: "ai" };
  return { songs: list?.songs.length ? list.songs : direct, how: list?.songs.length ? "playlist" : "search", label: list?.label };
}

/** The best JioSaavn editors' playlist whose name shares a word with the request. */
async function moodPlaylist(query: string, topic: string[], language: string): Promise<Pick | null> {
  const r = await call<{ results?: { id: string; title: string; more_info?: { language?: string; song_count?: string; firstname?: string } }[] }>({ __call: "search.getPlaylistResults", ctx: "web6dot0", q: query, n: "10", p: "1" });
  const scored = (r.results ?? [])
    .map((p) => {
      const name = words(unescape(p.title));
      // The same word counts most ("Amma Amma" for amma); a close one less ("Amman", a devotional list).
      const exact = topic.filter((w) => name.includes(w)).length;
      const close = topic.filter((w) => !name.includes(w) && name.some((n) => n.startsWith(w.slice(0, 5)) || w.startsWith(n.slice(0, 5)))).length;
      const lang = (p.more_info?.language ?? "").toLowerCase();
      return { p, score: exact * 10 + close * 6 + (lang === language ? 3 : 0) + (p.more_info?.firstname === "JioSaavn" ? 2 : 0) };
    })
    .filter((x) => x.score >= 6) // at least one word of the request (or a close form) in the playlist's name
    .sort((a, b) => b.score - a.score);
  const best = scored[0]?.p;
  if (!best) return null;
  const d = await call<{ list?: Raw[] }>({ __call: "playlist.getDetails", ctx: "web6dot0", listid: best.id, n: "40", p: "1" });
  const songs = (d.list ?? []).map(toSong).filter((s): s is Song => !!s);
  // A different order each time, so "play amma songs" doesn't always start the same way.
  for (let i = songs.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [songs[i], songs[j]] = [songs[j], songs[i]];
  }
  return { songs, how: "playlist", label: unescape(best.title) };
}

/** Songs the AI knows fit the mood, kept only if JioSaavn really has them. */
async function aiSongs(query: string, language: string): Promise<Song[]> {
  const { generateWithFallback, parseJson } = await import("@/lib/ai/providers");
  const { z } = await import("zod");
  const r = await generateWithFallback(
    [{ role: "user", content: `Request: "${query}"` }],
    {
      system: `You know Indian film and independent music very well. List 12 real, well-known ${language} songs that best match the request (mood, theme, genre or era). Only songs you are sure exist; prefer popular ones. JSON only: {"songs":[{"title":"","film":"","artist":""}]}`,
      json: true,
      temperature: 0.4,
      maxTokens: 900,
      // Knowing real Tamil film songs takes a well-read model: the small fast ones invent titles.
      order: ["gemini", "github", "openrouter", "nvidia"],
    },
  );
  const out = parseJson(r.text, z.object({ songs: z.array(z.object({ title: z.string(), film: z.string().optional().default(""), artist: z.string().optional().default("") })).max(15) }));
  if (!out) return [];
  const norm = (s: string) => s.toLowerCase().replace(/\(.*?\)|[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  const found = await Promise.all(
    out.songs.map(async (t) => {
      const hits = await searchSongs(`${t.title} ${t.film}`.trim(), 5).catch(() => [] as Song[]);
      const want = norm(t.title);
      const film = norm(t.film).split(" ")[0] ?? "";
      const artist = norm(t.artist).split(" ").find((w) => w.length > 3) ?? "";
      // The full title, and (when the AI named them) the film or the artist too: no look-alikes.
      return (
        hits.find((h) => {
          if (!norm(h.title).startsWith(want)) return false;
          if (!film && !artist) return true;
          const where = `${norm(h.album)} ${norm(h.artists)}`;
          return (!!film && where.includes(film)) || (!!artist && where.includes(artist));
        }) ?? null
      );
    }),
  );
  const seen = new Set<string>();
  return found.filter((s): s is Song => !!s && !seen.has(s.id) && !!seen.add(s.id));
}

/**
 * A fresh link to the full song (320 kbps when available). The app route's links play from any site;
 * the website's need a jiosaavn.com referrer. Links expire after a few hours, so fetch at play time.
 */
export async function streamUrl(media: string) {
  const r = await call<{ status?: string; auth_url?: string }>({ __call: "song.generateAuthToken", ctx: "android", bitrate: "320", url: media });
  if (r.status !== "success" || !r.auth_url) throw new Error("This song can't be played right now.");
  return r.auth_url.replace(/^http:/, "https:");
}
