"use client";

import { Clock3, Loader2, MicVocal, Music2, Search, Sparkles, X } from "lucide-react";
import { useEffect, useState } from "react";
import { canKaraoke, KARAOKE_EVENT } from "@/components/music/karaoke";
import type { Song } from "@/components/music/player";
import { Empty, ErrorText, PageHeader } from "@/components/ui";
import { useVoiceActions } from "@/components/voice/provider";

const PICKS = ["Anirudh hits", "A.R. Rahman melodies", "Ilaiyaraaja classics", "Yuvan love songs", "Harris Jayaraj hits", "Kuthu songs", "90s Tamil melodies", "Latest Tamil hits"];
/** Each pick's tile colours (a gradient per mood, no artwork). */
const TILE = [
  "from-fuchsia-500/35 to-orange-400/20",
  "from-sky-500/35 to-indigo-500/20",
  "from-amber-500/35 to-rose-500/20",
  "from-rose-500/35 to-pink-400/20",
  "from-emerald-500/30 to-cyan-500/20",
  "from-orange-500/40 to-yellow-400/20",
  "from-violet-500/35 to-sky-400/20",
  "from-cyan-500/35 to-emerald-400/20",
];
const RECENT_KEY = "hm.karaoke.recent";
/** The songs sung on this device lately (a per-device convenience; it can be missing). */
function loadSung(): Song[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(v) ? (v as Song[]).filter((x) => x && typeof x.id === "string").slice(0, 8) : [];
  } catch {
    return [];
  }
}
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/** Karaoke: pick a Tamil song, it plays, and its lyrics light up line by line to sing along with. */
export default function KaraokePage() {
  const [q, setQ] = useState("");
  const [songs, setSongs] = useState<Song[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sung, setSung] = useState<Song[]>([]);
  useEffect(() => {
    const t = setTimeout(() => setSung(loadSung()));
    return () => clearTimeout(t);
  }, []);

  async function find(query: string) {
    const text = query.trim();
    if (!text) return;
    setQ(text);
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/music/search?q=${encodeURIComponent(/tamil/i.test(text) ? text : `${text} tamil`)}&n=30`);
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error ?? "Song search failed.");
      // Tamil songs only.
      setSongs(((data.songs ?? []) as Song[]).filter(canKaraoke));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Song search failed.");
    } finally {
      setBusy(false);
    }
  }

  /** Opens the karaoke view for this song. It plays the music-only track; the full song is not started. */
  function sing(song: Song) {
    setError(null);
    window.dispatchEvent(new CustomEvent(KARAOKE_EVENT, { detail: { song } }));
    const next = [song, ...sung.filter((x) => x.id !== song.id)].slice(0, 8);
    setSung(next);
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(next));
    } catch {}
  }

  useVoiceActions({
    karaoke_find: {
      description: "Karaoke page: search Tamil songs to sing along with. input: a song, film, singer or composer.",
      run: async ({ input }) => {
        const query = String(input ?? "").trim();
        if (!query) return { error: "Say which song, film or singer." };
        await find(query);
        return { searched: query };
      },
    },
  });

  return (
    <>
      <PageHeader eyebrow="Play" title="Karaoke" subtitle="Pick a Tamil song. Its music plays without the singer, and the lyrics light up line by line so you can sing it yourself." />
      <form
        className="mb-5 flex items-center gap-2 rounded-xl border border-line bg-panel p-1.5 pl-4 transition-colors focus-within:border-core/60"
        onSubmit={(e) => {
          e.preventDefault();
          void find(q);
        }}
      >
        {busy ? <Loader2 size={17} className="shrink-0 animate-spin text-core" /> : <Search size={17} className="shrink-0 text-faint" />}
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Song, film, singer or composer" aria-label="Search Tamil songs" className="h-10 min-w-0 flex-1 bg-transparent text-[15px] placeholder:text-faint focus:outline-none" />
        {q && (
          <button
            type="button"
            onClick={() => {
              setQ("");
              setSongs(null);
            }}
            aria-label="Clear"
            className="grid size-8 shrink-0 place-items-center rounded-full text-faint hover:bg-raised hover:text-fg"
          >
            <X size={15} />
          </button>
        )}
        <button type="submit" disabled={busy || !q.trim()} className="h-10 shrink-0 rounded-lg bg-core px-4 text-sm font-medium text-core-ink transition hover:brightness-110 active:scale-[0.97] disabled:bg-raised disabled:text-faint">
          Search
        </button>
      </form>

      {/* the picks: one tap searches that mood or composer */}
      <div className="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {PICKS.map((p, i) => (
          <button
            key={p}
            type="button"
            onClick={() => void find(p)}
            className={`group relative flex h-20 flex-col justify-end overflow-hidden rounded-xl border border-white/10 bg-gradient-to-br ${TILE[i % TILE.length]} p-3 text-left transition hover:-translate-y-0.5 hover:border-white/25 active:scale-[0.98] motion-reduce:hover:translate-y-0`}
          >
            <MicVocal size={34} className="absolute -top-1 -right-1 text-white/10 transition group-hover:text-white/20" aria-hidden />
            <span className="text-sm leading-tight font-semibold">{p}</span>
          </button>
        ))}
      </div>

      {/* sung on this device lately */}
      {sung.length > 0 && !songs && (
        <section className="mb-6">
          <h2 className="mb-2.5 flex items-center gap-2 font-mono text-[11px] tracking-[0.2em] text-core uppercase">
            <Clock3 size={12} /> Sung recently
          </h2>
          <ul className="flex gap-3 overflow-x-auto pb-1 [scrollbar-width:thin]">
            {sung.map((s) => (
              <li key={s.id} className="w-28 shrink-0">
                <button type="button" onClick={() => sing(s)} className="group block w-full text-left">
                  {s.image ? (
                    // eslint-disable-next-line @next/next/no-img-element -- remote cover art
                    <img src={s.image} alt="" className="aspect-square w-full rounded-lg object-cover ring-1 ring-white/10 transition group-hover:ring-core" />
                  ) : (
                    <span className="grid aspect-square w-full place-items-center rounded-lg bg-raised text-faint ring-1 ring-white/10 group-hover:ring-core">
                      <Music2 size={22} />
                    </span>
                  )}
                  <span className="mt-1.5 block truncate text-xs font-medium">{s.title}</span>
                  <span className="block truncate text-[11px] text-soft">{s.artists}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <ErrorText error={error} />

      {songs && !songs.length && !busy && <Empty>No Tamil songs found for that. Try a film or singer name.</Empty>}
      {songs && songs.length > 0 && (
        <ul className="list-in grid gap-2 sm:grid-cols-2">
          {songs.map((s) => (
            <li key={s.id}>
              <button type="button" onClick={() => void sing(s)} className="group flex w-full items-center gap-3 border border-line bg-raised/40 p-2 text-left hover:border-core">
                {s.image ? (
                  // eslint-disable-next-line @next/next/no-img-element -- remote cover art
                  <img src={s.image} alt="" className="h-12 w-12 shrink-0 object-cover" />
                ) : (
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center bg-raised text-faint">
                    <MicVocal size={18} />
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{s.title}</span>
                  <span className="block truncate text-xs text-soft">
                    {s.artists}
                    {s.album ? ` · ${s.album}` : ""}
                  </span>
                </span>
                <span className="font-mono text-[10.5px] text-faint">{fmt(s.duration)}</span>
                <MicVocal size={16} className="text-faint group-hover:text-core" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {!songs && !busy && (
        // before any search: how it works, in three steps
        <ol className="grid gap-2 sm:grid-cols-3">
          {[
            { icon: Search, title: "Pick a song", text: "Search, or tap a tile above" },
            { icon: Music2, title: "The music plays", text: "Without the singer's voice" },
            { icon: Sparkles, title: "Sing along", text: "Lyrics light up line by line" },
          ].map((x, i) => (
            <li key={x.title} className="flex items-center gap-3 rounded-xl border border-line bg-panel/60 p-3">
              <span className="grid size-9 shrink-0 place-items-center rounded-full border border-core/40 bg-core/10 text-core">
                <x.icon size={16} />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-medium">
                  {i + 1}. {x.title}
                </span>
                <span className="block text-xs text-soft">{x.text}</span>
              </span>
            </li>
          ))}
        </ol>
      )}
    </>
  );
}
