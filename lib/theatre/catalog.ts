import { COMMONS_FILMS } from "./commons-films";
import { ANIME_EPISODES } from "./anime-films";
import { DUBBED_FILMS } from "./dubbed-films";
import { KIDS_EPISODES } from "./kids-films";
import { YOUTUBE_FILMS } from "./youtube-films";
import { GENRE_OF, type Genre } from "./genres";

export { GENRE_LIST, type Genre } from "./genres";

/**
 * Friends Theatre catalogue, newest first. Two sources, both legal to watch:
 *  - YouTube: full-length Tamil films that the studios' own channels (Ayngaran, Rajshri Tamil, Eros...) put up for free.
 *    They play in YouTube's own player, so the channel's ads, rules and any country limits still apply.
 *  - Wikimedia Commons: classics (1960 and earlier) listed as public domain, streamed straight from Commons.
 * Nothing is stored or re-hosted by HIVEMIND.
 */
export type Quality = { label: string; src: string };
/** What kind of film: Tamil originals, or something dubbed into Tamil. */
export type Group = "tamil" | "hollywood" | "korean" | "indian" | "world" | "anime" | "kids";
export const GROUPS: Array<{ id: Group | "all"; label: string }> = [
  { id: "all", label: "All" },
  { id: "tamil", label: "Tamil films" },
  { id: "hollywood", label: "Hollywood in Tamil" },
  { id: "korean", label: "Korean in Tamil" },
  { id: "indian", label: "Other Indian languages" },
  { id: "world", label: "World cinema" },
  { id: "anime", label: "Anime series" },
  { id: "kids", label: "Kids cartoons" },
];

export type Movie = {
  id: string;
  title: string;
  year: number | null;
  minutes: number;
  mb: number;
  poster: string;
  qualities: Quality[];
  about: string;
  page: string;
  /** The YouTube video id when it plays in YouTube's player, otherwise null (a file from Commons). */
  yt: string | null;
  /** The YouTube channel it comes from. */
  channel: string | null;
  group: Group;
  /** For an episode of a series: the series name and the episode number. */
  series: string | null;
  ep: number | null;
  /** false when YouTube will not play it outside YouTube (Sony Pictures' own films): it opens on YouTube instead, started together with a countdown. */
  embed: boolean;
  /** What the film is about (love, comedy, action...), primary first. Only films have it: no series or cartoons. */
  genres?: Genre[];
};

const newestFirst = (a: Movie, b: Movie) => (b.year ?? 0) - (a.year ?? 0) || b.minutes - a.minutes;
export const MOVIES: Movie[] = [...YOUTUBE_FILMS, ...DUBBED_FILMS, ...ANIME_EPISODES, ...KIDS_EPISODES, ...COMMONS_FILMS].map((m) => (GENRE_OF[m.id] ? { ...m, genres: GENRE_OF[m.id] } : m)).sort(newestFirst);

export const movieById = (id: string | null | undefined) => MOVIES.find((m) => m.id === id) ?? null;

export { runtime } from "./format";
