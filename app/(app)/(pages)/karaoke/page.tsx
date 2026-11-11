"use client";

import { Loader2, MicVocal, Search } from "lucide-react";
import { useState } from "react";
import { canKaraoke, KARAOKE_EVENT } from "@/components/music/karaoke";
import { musicCommand, type Song } from "@/components/music/player";
import { Button, cx, Empty, ErrorText, Input, PageHeader } from "@/components/ui";
import { useVoiceActions } from "@/components/voice/provider";

const PICKS = ["Anirudh hits", "A.R. Rahman melodies", "Ilaiyaraaja classics", "Yuvan love songs", "Harris Jayaraj hits", "Kuthu songs", "90s Tamil melodies", "Latest Tamil hits"];
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/** Karaoke: pick a Tamil song, it plays, and its lyrics light up line by line to sing along with. */
export default function KaraokePage() {
  const [q, setQ] = useState("");
  const [songs, setSongs] = useState<Song[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState<string | null>(null);

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

  async function sing(song: Song) {
    setStarting(song.id);
    setError(null);
    const res = await musicCommand({ action: "play", song }).catch(() => ({ error: "Couldn't start that song." }));
    setStarting(null);
    if (res.error) return setError(String(res.error));
    window.dispatchEvent(new Event(KARAOKE_EVENT));
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
      <PageHeader eyebrow="Play" title="Karaoke" subtitle="Pick a Tamil song. It plays, and the lyrics light up line by line so you can sing along." />
      <form
        className="mb-4 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void find(q);
        }}
      >
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Song, film, singer or composer" aria-label="Search Tamil songs" />
        <Button type="submit" disabled={busy || !q.trim()}>
          {busy ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />} Search
        </Button>
      </form>
      <div className="mb-6 flex flex-wrap gap-2">
        {PICKS.map((p) => (
          <button key={p} type="button" onClick={() => void find(p)} className="border border-line px-3 py-1.5 text-xs text-soft hover:border-core hover:text-core">
            {p}
          </button>
        ))}
      </div>
      <ErrorText error={error} />

      {songs && !songs.length && !busy && <Empty>No Tamil songs found for that. Try a film or singer name.</Empty>}
      {songs && songs.length > 0 && (
        <ul className="grid gap-2 sm:grid-cols-2">
          {songs.map((s) => (
            <li key={s.id}>
              <button type="button" onClick={() => void sing(s)} disabled={!!starting} className={cx("group flex w-full items-center gap-3 border border-line bg-raised/40 p-2 text-left hover:border-core", starting === s.id && "border-core")}>
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
                {starting === s.id ? <Loader2 size={16} className="animate-spin text-core" /> : <MicVocal size={16} className="text-faint group-hover:text-core" />}
              </button>
            </li>
          ))}
        </ul>
      )}
      {!songs && !busy && <Empty>Search for a song, or tap one of the picks above.</Empty>}
    </>
  );
}
