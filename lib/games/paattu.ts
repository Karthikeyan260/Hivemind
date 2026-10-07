import "server-only";
import { searchSongs, type Song } from "@/lib/music";

/**
 * Paattu Quiz: ten songs a round, each played for a few seconds; guess the film, the hero, the
 * singer or the year. Every round is different: the AI picks songs from a random angle of the theme
 * ("Anirudh: early hits 2012-2016", "Ilaiyaraaja: SPB duets"), avoids songs already played, and the
 * question types are mixed. Clips come from the music player's catalogue, so every song is real.
 */
export const THEMES: Record<string, { label: string; queries: string[]; angles: string[] }> = {
  mix: {
    label: "Tamil hits mix",
    queries: ["tamil hit songs", "tamil superhit songs 2010s", "tamil movie songs"],
    angles: ["superhits from the 2000s", "superhits from the 2010s", "songs from the 2020s", "90s hits", "college / friendship songs", "rain and love songs", "folk-flavoured hits", "songs everyone sings at weddings", "Sid Sriram songs", "SPB classics", "Harris Jayaraj hits", "Yuvan Shankar Raja hits", "G. V. Prakash hits", "D. Imman hits", "Vidyasagar hits"],
  },
  anirudh: {
    label: "Anirudh",
    queries: ["anirudh ravichander hits", "anirudh songs", "anirudh movie songs"],
    angles: ["early hits 2012-2016", "recent blockbusters 2019-2025", "mass intro songs", "melodies and love songs", "songs Anirudh sang himself", "duets", "songs for Dhanush films", "songs for Sivakarthikeyan films", "songs for Rajinikanth, Vijay and Kamal films", "lesser-known gems"],
  },
  arr: {
    label: "A. R. Rahman",
    queries: ["a r rahman tamil hits", "rahman tamil melody", "a r rahman tamil movie songs"],
    angles: ["90s classics", "2000s hits", "2010s and later", "Mani Ratnam films", "Shankar films", "melodies", "dance numbers", "songs sung by Rahman himself", "Hariharan and Chithra songs", "lesser-known gems"],
  },
  ilaiyaraaja: {
    label: "Ilaiyaraaja",
    queries: ["ilaiyaraaja hits", "ilayaraja 80s tamil songs", "ilaiyaraaja tamil movie songs"],
    angles: ["80s village songs", "SPB and Janaki duets", "Mani Ratnam films", "Kamal Haasan films", "Rajinikanth films", "Yesudas songs", "romantic melodies", "90s hits", "Ilaiyaraaja's own voice", "lesser-known gems"],
  },
  vijay: {
    label: "Vijay songs",
    queries: ["vijay tamil songs", "thalapathy vijay hits", "vijay movie songs"],
    angles: ["90s and early 2000s", "2005-2012 hits", "2013 onwards", "intro / mass songs", "melodies and duets", "songs Vijay sang himself", "dance numbers", "lesser-known gems"],
  },
  melody: {
    label: "Melodies",
    queries: ["tamil melody songs", "tamil love melody", "tamil romantic movie songs"],
    angles: ["90s melodies", "2000s melodies", "2010s melodies", "recent melodies", "sad / breakup songs", "rain songs", "amma / family sentiment songs", "female solo melodies", "male solo melodies", "lesser-known gems"],
  },
  kuthu: {
    label: "Kuthu & gaana",
    queries: ["tamil kuthu songs", "gaana songs tamil", "tamil dance movie songs"],
    angles: ["2000s kuthu hits", "2010s kuthu hits", "recent dance hits", "gaana songs from films", "item / party numbers", "festival and marriage dance songs", "lesser-known bangers"],
  },
  latest: {
    label: "Latest",
    queries: ["latest tamil songs", "new tamil hits", "tamil movie songs 2025"],
    angles: ["biggest hits of the last two years", "recent melodies", "recent mass songs", "recent duets", "recent hits by new composers", "recent hits from small films"],
  },
};

export type Kind = "film" | "hero" | "singer" | "year" | "song";
export type Question = {
  kind: Kind;
  options: string[];
  answer: number;
  /** Where the clip starts (seconds), around the chorus. */
  start: number;
  song: Pick<Song, "title" | "artists" | "album" | "image" | "year" | "media" | "duration"> & { hero?: string };
};

const clean = (s: string) => s.replace(/\s*\((original motion picture soundtrack|from [^)]*|tamil|ost)\)\s*/gi, " ").replace(/\s+/g, " ").trim();
// Albums that aren't a film (compilations, playlists): guess the song title instead.
const NOT_FILM = /\b(hits|collection|single|best of|playlist|vol\.?|volume|songs|album|top|jukebox|unplugged|cover|remix|devotional|rewind|trending|retro|mashup|medley|lofi|lo-fi|reprise|non[- ]film|independent|radio|hour|classics?|golden|evergreen|essentials|special|tribute|celebrat\w*|kondattam|notes|this is|best|melodies|love songs|duets?|magic|moods?|sad|romance|vibes|storm|nights?|party|instrumentals?)\b/i;
// Tracks that aren't sung songs.
const NOT_SONG = /\b(theme|bgm|instrumental|karaoke|score|interlude|dialogue|promo|teaser|reprise|remix|lofi|lo-fi|version)\b/i;

// Plausible wrong answers when a round's own songs don't give enough.
const HEROES = ["Vijay", "Ajith Kumar", "Rajinikanth", "Kamal Haasan", "Suriya", "Dhanush", "Sivakarthikeyan", "Vikram", "Karthi", "Silambarasan", "Vijay Sethupathi", "Jayam Ravi", "Arya", "Madhavan", "Prabhu Deva", "Vishal"];
const SINGERS = ["S. P. Balasubrahmanyam", "K. J. Yesudas", "K. S. Chithra", "S. Janaki", "Hariharan", "Shreya Ghoshal", "Sid Sriram", "Anirudh Ravichander", "Shankar Mahadevan", "Karthik", "Haricharan", "Chinmayi", "Benny Dayal", "Dhee", "Shweta Mohan", "Unni Krishnan", "Vijay Yesudas", "Andrea Jeremiah"];

const shuffle = <T,>(a: T[]) => {
  const b = [...a];
  for (let i = b.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [b[i], b[j]] = [b[j], b[i]];
  }
  return b;
};
const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];
const norm = (s: string) => s.toLowerCase().replace(/\(.*?\)|[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
/**
 * Tamil written in English letters has many spellings ("Poongatru" / "Poongaatru", "Mouna Ragam" /
 * "Mouna Raagam", "Mudhal" / "Muthal"): fold them to one form so the same song matches.
 */
const loose = (s: string) =>
  norm(s)
    .replace(/ /g, "")
    .replace(/zh/g, "l")
    .replace(/([bdgjkpst])h/g, "$1")
    .replace(/aa|ah/g, "a")
    .replace(/ee|ii/g, "i")
    .replace(/oo|uu/g, "u")
    .replace(/y/g, "i")
    .replace(/w/g, "v")
    .replace(/(.)\1+/g, "$1")
    .replace(/d/g, "t");
const sameText = (a: string, b: string) => {
  const x = loose(a);
  const y = loose(b);
  return !!x && !!y && (x === y || x.startsWith(y) || y.startsWith(x));
};
const clipStart = (d: number) => Math.max(15, Math.min(d - 20, Math.round(d * (0.22 + Math.random() * 0.28))));

type Pickd = { song: Song; film: string; year: string; hero: string; singer: string };

/**
 * Songs from one angle of the theme, named by the AI (it knows Tamil cinema far better than the
 * catalogue's album tags), each found on JioSaavn so the clip plays. The AI's details are the answers.
 */
async function aiPicks(label: string, angle: string, avoid: string[], hard: boolean): Promise<Pickd[]> {
  const { generateWithFallback, parseJson } = await import("@/lib/ai/providers");
  const { z } = await import("zod");
  const r = await generateWithFallback([{ role: "user", content: `Theme: ${label}. This round's angle: ${angle}.${avoid.length ? `\nAlready played recently, do NOT use: ${avoid.slice(-60).join("; ")}` : ""}` }], {
    system: `You know Tamil film music very well. List 16 real, sung Tamil FILM songs for the theme and angle (no BGMs, theme tracks, albums or independent singles), each from a DIFFERENT film. ${hard ? "Make it HARD: well-liked but less obvious songs, not the top 20 everyone knows." : "Make it fun: songs people recognise, but not only the most famous ones; vary the years."} Give the film's name exactly as released, the year, the lead actor (hero) on screen, and the main singer(s). Only songs you are sure about. JSON only: {"songs":[{"title":"","film":"","year":"","hero":"","singer":""}]}`,
    json: true,
    temperature: 1,
    maxTokens: 3500,
    order: ["gemini", "github", "openrouter", "nvidia"],
  });
  const S = z.object({ title: z.string(), film: z.string(), year: z.coerce.string().optional().default(""), hero: z.string().optional().default(""), singer: z.string().optional().default("") });
  const out = parseJson(r.text, z.object({ songs: z.array(S).max(30) }));
  if (!out) {
    console.warn(`paattu: ${r.provider} gave no usable list for "${label} / ${angle}" (${r.text.length} chars)`);
    return [];
  }
  const skip = new Set(avoid.map(norm));
  const found = await Promise.all(
    out.songs
      .filter((t) => !skip.has(norm(t.title)))
      .map(async (t): Promise<Pickd | null> => {
        const hits = await searchSongs(`${t.title} ${t.film}`, 6).catch(() => [] as Song[]);
        const want = norm(t.title);
        const film = norm(t.film);
        // The catalogue is the referee: the same title, on an album that IS that film. The AI
        // sometimes misnames a film ("Madras Cafe" for Madras) or the song isn't from it at all.
        const real = (h: Song) => (norm(h.title).startsWith(want) || sameText(clean(h.title), t.title)) && !!norm(clean(h.album)) && !NOT_FILM.test(h.album) && !NOT_SONG.test(h.title) && !!h.media && h.duration >= 90;
        // The album must be the film the AI named (spacing and spelling vary: "Alai Payuthey" /
        // "Alaipayuthey", "Madras" / "Madras Cafe"). A same-titled song on another album is a
        // different song, so it never counts: a quiz with a wrong answer is worse than a shorter one.
        const sameFilm = (h: Song) => {
          const album = norm(clean(h.album));
          const a = album.replace(/ /g, "");
          const f = film.replace(/ /g, "");
          if (!a || !f) return false;
          if (a === f || a.startsWith(f) || f.startsWith(a) || sameText(album, film)) return true;
          const words = new Set(film.split(" ").filter((w) => w.length >= 4));
          return album.split(" ").filter((w) => w.length >= 4 && words.has(w)).length >= Math.min(2, words.size);
        };
        const hit = hits.find((h) => real(h) && sameFilm(h));
        if (!hit) return null;
        const singer = t.singer.split(/,|&| and /)[0].trim();
        const credited = singer && norm(hit.artists).includes(norm(singer).split(" ").filter((w) => w.length > 2).pop() ?? "~");
        return {
          song: hit,
          // The catalogue's spelling of the film (it's the released title).
          film: clean(hit.album),
          // Old films are re-released (the catalogue's year can be decades late) and the AI can be
          // off too: a year question only when both agree (within a year).
          year: /^(19|20)\d\d$/.test(hit.year) && /^(19|20)\d\d$/.test(t.year.trim()) && Math.abs(Number(hit.year) - Number(t.year.trim())) <= 1 ? t.year.trim() : "",
          hero: t.hero.trim(),
          // Only a singer the catalogue also credits.
          singer: credited ? singer : "",
        };
      }),
  );
  const seen = new Set<string>();
  const kept = found.filter((x): x is Pickd => !!x && !seen.has(norm(x.film)) && !!seen.add(norm(x.film)));
  console.info(`paattu: "${label} / ${angle}" ${r.provider}: ${out.songs.length} named, ${kept.length} playable`);
  return kept;
}

/** Four options: the right one plus three different ones (from this round first, then the fallback list). */
function optionsFor(right: string, pool: string[], extra: string[] = []) {
  const others = shuffle([...new Set([...pool, ...extra].filter((x) => x && norm(x) !== norm(right)))]);
  const opts = shuffle([right, ...others.slice(0, 3)]);
  return opts.length === 4 ? { options: opts, answer: opts.indexOf(right) } : null;
}

function question(p: Pickd, all: Pickd[], theme: string): Question {
  const s = p.song;
  const song = { title: clean(s.title), artists: s.artists, album: p.film, image: s.image, year: p.year, media: s.media, duration: s.duration, hero: p.hero || undefined };
  // Mostly "which film?", with heroes, singers and years mixed in when they make a fair question.
  // A song named after its film ("Ethir Neechal") would give the film answer away.
  const giveaway = norm(song.title).includes(norm(p.film)) || norm(p.film).includes(norm(song.title));
  const kinds: Kind[] = giveaway ? [] : ["film", "film", "film"];
  if (p.hero && theme !== "vijay") kinds.push("hero");
  if (p.singer) kinds.push("singer");
  if (/^(19|20)\d\d$/.test(song.year)) kinds.push("year");
  for (const kind of shuffle(kinds)) {
    const o =
      kind === "film"
        ? optionsFor(p.film, all.map((x) => x.film))
        : kind === "hero"
          ? optionsFor(p.hero, all.map((x) => x.hero), HEROES)
          : kind === "singer"
            ? optionsFor(p.singer, all.map((x) => x.singer), SINGERS)
            : optionsFor(
                song.year,
                shuffle([-6, -4, -3, -2, 2, 3, 4, 6]).map((d) => String(Number(song.year) + d)).filter((y) => Number(y) <= new Date().getFullYear()),
              );
    if (o) return { kind, ...o, start: clipStart(s.duration), song };
  }
  const o = optionsFor(p.film, all.map((x) => x.film))!;
  return { kind: "film", ...o, start: clipStart(s.duration), song };
}

export async function buildQuiz(theme: string, opts: { count?: number; hard?: boolean; avoid?: string[] } = {}) {
  const count = opts.count ?? 10;
  const t = THEMES[theme] ?? THEMES.mix;
  // A new angle each round; if one turns up too few playable songs, try another before giving up.
  let angle = pick(t.angles);
  let picks = await aiPicks(t.label, angle, opts.avoid ?? [], !!opts.hard).catch(() => [] as Pickd[]);
  if (picks.length < 7) {
    // Two more angles at once (old songs are often thinly tagged in the catalogue).
    const others = shuffle(t.angles.filter((a) => a !== angle)).slice(0, 2);
    const avoid = [...(opts.avoid ?? []), ...picks.map((p) => p.song.title)];
    const more = (await Promise.all(others.map((a) => aiPicks(t.label, a, avoid, !!opts.hard).catch(() => [] as Pickd[])))).flat();
    const films = new Set(picks.map((p) => norm(p.film)));
    picks = [...picks, ...more.filter((p) => !films.has(norm(p.film)) && !!films.add(norm(p.film)))];
    if (picks.length > 0 && others.length) angle = `${angle} + more`;
  }
  if (picks.length >= 4) {
    const chosen = shuffle(picks).slice(0, count);
    return { theme, label: t.label, angle, questions: chosen.map((p) => question(p, picks, theme)) };
  }

  // The AI is busy: fall back to the catalogue's own tags (stricter, fewer songs, films only).
  const found = (await Promise.all(t.queries.map((q) => searchSongs(q, 50).catch(() => [])))).flat();
  const base = (x: string) => clean(x).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const skip = new Set((opts.avoid ?? []).map(norm));
  const byFilm = new Map<string, Song>();
  for (const s of shuffle(found)) {
    if (s.language && s.language !== "tamil") continue;
    if (!s.media || s.duration < 90 || skip.has(norm(clean(s.title)))) continue;
    const film = clean(s.album);
    if (!film || NOT_FILM.test(film) || NOT_SONG.test(s.title)) continue;
    if (base(film) === base(s.title) || base(s.title).startsWith(base(film)) || base(film).startsWith(base(s.title))) continue;
    if (!byFilm.has(film.toLowerCase())) byFilm.set(film.toLowerCase(), s);
  }
  const pool = [...byFilm.values()].map((s): Pickd => ({ song: s, film: clean(s.album), year: s.year, hero: "", singer: "" }));
  if (pool.length < 5) throw new Error("Couldn't find enough songs for that theme right now. Try another one.");
  return { theme, label: t.label, angle: "", questions: pool.slice(0, count).map((p) => question(p, pool, theme)) };
}
