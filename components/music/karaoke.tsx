"use client";

import { ChevronDown, Loader2, MicVocal, Minus, Music2, Pause, Play, Plus } from "lucide-react";
import { type RefObject, useCallback, useEffect, useRef, useState } from "react";
import { MascotFrame, type MascotFrameName } from "@/components/mascot";
import { cx } from "@/components/ui";
import { loadApi } from "@/components/video/player";
import { MEDIA_START_EVENT } from "@/lib/client-api";
import type { KaraokeTrack } from "@/lib/karaoke-track";
import { activeLine, type Lyrics } from "@/lib/lyrics";

export const KARAOKE_EVENT = "hivemind:karaoke";
/** Karaoke is for Tamil songs. */
export const canKaraoke = (s: { language: string } | null | undefined) => (s?.language ?? "").toLowerCase() === "tamil";

export type KaraokeSong = { id: string; title: string; artists: string; image: string; duration: number };
/** "bgm": the karaoke track, music only (the default). "song": the full song, with the singer. */
type Mode = "bgm" | "song";
type Player = { playVideo(): void; pauseVideo(): void; stopVideo(): void; seekTo(s: number, allow: boolean): void; getCurrentTime(): number; getPlayerState(): number; destroy(): void };

const MODE_KEY = "hm-karaoke-mode";
const OFFSET_KEY = (id: string, mode: Mode) => `hm-lyric-offset-${id}${mode === "bgm" ? "-bgm" : ""}`;
// A sung line rarely lasts longer than this: after it, the line stays lit while the music plays on.
const MAX_LINE_S = 9;
const DANCE: MascotFrameName[] = ["delighted", "sparkle", "starstruck", "heart"];
const readOffset = (id: string, mode: Mode) => {
  try {
    return Number(localStorage.getItem(OFFSET_KEY(id, mode))) || 0;
  } catch {
    return 0;
  }
};

/**
 * The karaoke view: a song's lyrics lighting up in time, full screen.
 * By default it plays the song's KARAOKE TRACK (music only, from YouTube) so the owner is the singer;
 * "With singer" plays the full song through the music player instead. Mount with key={song.id}.
 */
export function Karaoke({ song, audio, songPlaying, onPlaySong, onPauseSong, onSeekSong, onClose }: { song: KaraokeSong; audio: RefObject<HTMLAudioElement | null>; /** the music player is playing THIS song */ songPlaying: boolean; onPlaySong: () => void; onPauseSong: () => void; onSeekSong: (seconds: number) => void; onClose: () => void }) {
  const [mode, setMode] = useState<Mode>(() => {
    try {
      return localStorage.getItem(MODE_KEY) === "song" ? "song" : "bgm";
    } catch {
      return "bgm";
    }
  });
  const [lyrics, setLyrics] = useState<Lyrics | null>(null);
  const [failed, setFailed] = useState(false);
  // undefined = still looking, null = this song has no karaoke track.
  const [track, setTrack] = useState<KaraokeTrack | null | undefined>(undefined);
  const [trackPlaying, setTrackPlaying] = useState(false);
  const [at, setAt] = useState(-1);
  const [frame, setFrame] = useState(0);
  // Seconds added to the clock: + shows lines earlier (lyrics were late), - later. Kept per song and per mode.
  const [offset, setOffset] = useState(() => readOffset(song.id, mode));
  const list = useRef<HTMLOListElement | null>(null);
  const face = useRef<HTMLDivElement | null>(null);
  const frameEl = useRef<HTMLDivElement | null>(null);
  const yt = useRef<Player | null>(null);
  const live = useRef({ offset, lines: lyrics?.lines ?? [], mode });
  useEffect(() => {
    live.current = { offset, lines: lyrics?.lines ?? [], mode };
  }, [offset, lyrics, mode]);
  const playing = mode === "bgm" ? trackPlaying : songPlaying;

  // Lyrics (timed to the original recording).
  useEffect(() => {
    let gone = false;
    fetch(`/api/music/lyrics?${new URLSearchParams({ title: song.title, artists: song.artists, duration: String(song.duration || 0) })}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("lyrics"))))
      .then((l: Lyrics) => !gone && setLyrics(l))
      .catch(() => !gone && setFailed(true));
    return () => {
      gone = true;
    };
  }, [song.title, song.artists, song.duration]);

  // The karaoke track for this song.
  useEffect(() => {
    let gone = false;
    fetch(`/api/music/karaoke?${new URLSearchParams({ title: song.title, artists: song.artists, duration: String(song.duration || 0) })}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("track"))))
      .then((d: { track: KaraokeTrack | null }) => !gone && setTrack(d.track))
      .catch(() => !gone && setTrack(null));
    return () => {
      gone = true;
    };
  }, [song.title, song.artists, song.duration]);

  // Music-only mode: the track plays in a small YouTube player; the full song stays quiet.
  const videoId = mode === "bgm" ? track?.id : undefined;
  useEffect(() => {
    if (!videoId || !frameEl.current) return;
    let gone = false;
    const holder = frameEl.current;
    const el = document.createElement("div");
    holder.appendChild(el);
    onPauseSong();
    void loadApi()
      .then((YT) => {
        if (gone) return;
        yt.current = new YT.Player(el, {
          videoId,
          width: "100%",
          height: "100%",
          playerVars: { autoplay: 1, playsinline: 1, rel: 0, modestbranding: 1, controls: 0, disablekb: 1, iv_load_policy: 3 },
          events: {
            onStateChange: (e: { data: number }) => {
              if (e.data === YT.PlayerState.PLAYING) {
                setTrackPlaying(true);
                // One thing plays at a time: the music player and the video window pause.
                window.dispatchEvent(new CustomEvent(MEDIA_START_EVENT, { detail: { source: "karaoke" } }));
              } else if (e.data === YT.PlayerState.PAUSED || e.data === YT.PlayerState.ENDED) setTrackPlaying(false);
            },
          },
        }) as unknown as Player;
      })
      .catch(() => !gone && setTrack(null));
    // Something else started (the full song, a video): the track stops.
    const other = (e: Event) => {
      if ((e as CustomEvent<{ source: string }>).detail?.source !== "karaoke") yt.current?.pauseVideo?.();
    };
    window.addEventListener(MEDIA_START_EVENT, other);
    return () => {
      gone = true;
      window.removeEventListener(MEDIA_START_EVENT, other);
      try {
        yt.current?.destroy();
      } catch {}
      yt.current = null;
      holder.replaceChildren();
      setTrackPlaying(false);
    };
    // onPauseSong is stable enough for this: re-running would restart the track.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoId]);

  // Opened in "With singer" (the choice remembered from last time): the full song starts.
  useEffect(() => {
    if (live.current.mode === "song") onPlaySong();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, when the view opens
  }, []);

  // The clock: which line is being sung, and how far through it (painted straight onto the line, no re-render).
  useEffect(() => {
    let raf = 0;
    let shown = -2;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const { lines, offset: off, mode: m } = live.current;
      if (!lines.length) return;
      let t: number | undefined;
      if (m === "bgm") {
        try {
          t = yt.current?.getCurrentTime?.();
        } catch {}
      } else t = audio.current?.currentTime;
      if (typeof t !== "number" || Number.isNaN(t)) return;
      const now = t + off;
      const i = activeLine(lines, now);
      if (i !== shown) {
        shown = i;
        setAt(i);
      }
      const node = i >= 0 ? (list.current?.children[i] as HTMLElement | undefined) : undefined;
      if (node) {
        const end = Math.min(lines[i + 1]?.t ?? lines[i].t + MAX_LINE_S, lines[i].t + MAX_LINE_S);
        node.style.setProperty("--p", `${Math.min(100, Math.max(0, ((now - lines[i].t) / Math.max(0.4, end - lines[i].t)) * 100)).toFixed(1)}%`);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [audio]);

  // Keep the line being sung in the middle.
  useEffect(() => {
    const node = list.current?.children[Math.max(0, at)] as HTMLElement | undefined;
    node?.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }, [at, lyrics]);

  // The mascot bops along while the music plays, and changes its face now and then.
  useEffect(() => {
    if (!playing) return;
    let n = 0;
    const id = setInterval(() => {
      face.current?.animate([{ transform: "translateY(0) scale(1)" }, { transform: "translateY(-10px) scale(1.06, 0.95)" }, { transform: "translateY(0) scale(1)" }], { duration: 260, easing: "ease-out" });
      if (++n % 8 === 0) setFrame((f) => (f + 1) % DANCE.length);
    }, 520);
    return () => clearInterval(id);
  }, [playing]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose]);

  const switchMode = useCallback(
    (m: Mode) => {
      if (m === mode) return;
      setMode(m);
      setOffset(readOffset(song.id, m));
      setAt(-1);
      try {
        localStorage.setItem(MODE_KEY, m);
      } catch {}
      // "With singer": the music player plays the full song (the track's player is removed by its effect).
      if (m === "song") onPlaySong();
    },
    [mode, song.id, onPlaySong],
  );

  const nudge = (d: number) => {
    const v = Math.round((offset + d) * 10) / 10;
    setOffset(v);
    try {
      if (v) localStorage.setItem(OFFSET_KEY(song.id, mode), String(v));
      else localStorage.removeItem(OFFSET_KEY(song.id, mode));
    } catch {}
  };
  const seekTo = (t: number) => {
    const s = Math.max(0, t - offset);
    if (mode === "bgm") {
      yt.current?.seekTo?.(s, true);
      yt.current?.playVideo?.();
    } else onSeekSong(s);
  };
  const toggle = () => {
    if (mode === "bgm") {
      if (trackPlaying) yt.current?.pauseVideo?.();
      else yt.current?.playVideo?.();
    } else if (songPlaying) onPauseSong();
    else onPlaySong();
  };

  const lines = lyrics?.lines ?? [];
  const plain = lyrics?.plain ?? [];
  // Before the first word: the dots count down the intro.
  const intro = lines.length > 0 && at < 0 && playing;
  const noTrack = mode === "bgm" && track === null;

  return (
    <section aria-label="Karaoke" className="fixed inset-0 z-[70] flex flex-col overflow-hidden bg-[#06090d] text-fg">
      {/* The cover, blurred, with the music lights' colour glowing behind the words. */}
      {song.image && (
        // eslint-disable-next-line @next/next/no-img-element -- remote cover art
        <img src={song.image} alt="" aria-hidden className="pointer-events-none absolute inset-0 h-full w-full scale-125 object-cover opacity-25 blur-3xl" />
      )}
      <div aria-hidden className="pointer-events-none absolute inset-0" style={{ background: "radial-gradient(60% 45% at 50% 50%, rgb(var(--beat-rgb, 245 185 80) / 0.16), transparent 70%), linear-gradient(#06090d 0%, transparent 18%, transparent 78%, #06090d 100%)" }} />

      <header className="relative z-10 flex items-center gap-3 px-4 pt-4">
        <button type="button" onClick={onClose} aria-label="Close karaoke" className="p-2 text-soft hover:text-fg">
          <ChevronDown size={22} />
        </button>
        <div className="min-w-0 flex-1 text-center">
          <div className="truncate text-sm font-medium">{song.title}</div>
          <div className="truncate text-xs text-soft">{song.artists}</div>
        </div>
        <span className="w-9" />
      </header>

      {/* Music only (the karaoke track) or with the singer. */}
      <div className="relative z-10 mt-2 flex justify-center" role="tablist" aria-label="What plays">
        {(
          [
            ["bgm", "Music only", Music2],
            ["song", "With singer", MicVocal],
          ] as const
        ).map(([m, name, Icon]) => (
          <button key={m} type="button" role="tab" aria-selected={mode === m} onClick={() => switchMode(m)} className={cx("flex items-center gap-1.5 border px-3 py-1.5 text-xs first:rounded-l-full last:rounded-r-full", mode === m ? "border-core bg-core/15 text-core" : "border-line text-soft hover:text-fg")}>
            <Icon size={13} /> {name}
          </button>
        ))}
      </div>

      <div className="relative z-10 min-h-0 flex-1 overflow-hidden">
        {/* The karaoke track's own player: small, in the corner (YouTube asks that its player stays visible). */}
        <div className={cx("absolute left-3 top-2 z-20 w-[136px] overflow-hidden rounded-md border border-line bg-black shadow-lg sm:w-[200px]", mode === "bgm" && track ? "block" : "hidden")}>
          <div ref={frameEl} className="aspect-video w-full [&>iframe]:h-full [&>iframe]:w-full" />
        </div>

        {mode === "bgm" && track === undefined && (
          <p className="absolute inset-x-0 top-3 z-10 flex items-center justify-center gap-2 text-xs text-soft">
            <Loader2 size={13} className="animate-spin" /> Finding the karaoke track…
          </p>
        )}
        {noTrack && (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
            <span className="text-lg">No karaoke track found for this song</span>
            <span className="text-sm text-soft">You can still sing along with the full song.</span>
            <button type="button" onClick={() => switchMode("song")} className="flex items-center gap-2 rounded-full bg-core px-4 py-2 text-sm font-semibold text-core-ink hover:bg-core/85">
              <MicVocal size={15} /> Play with singer
            </button>
          </div>
        )}

        {!noTrack && !lyrics && !failed && (
          <p className="flex h-full items-center justify-center gap-2 text-sm text-soft">
            <Loader2 size={16} className="animate-spin" /> Finding the lyrics…
          </p>
        )}
        {!noTrack && (failed || (lyrics && !lines.length && !plain.length)) && (
          <p className="flex h-full flex-col items-center justify-center gap-1 px-8 text-center text-soft">
            <span className="text-lg text-fg">No lyrics for this song yet</span>
            <span className="text-sm">Hum along, or try another song.</span>
          </p>
        )}

        {!noTrack && lines.length > 0 && (
          <ol ref={list} className="karaoke-lines h-full overflow-y-auto [mask-image:linear-gradient(transparent,black_12%,black_88%,transparent)] px-6 py-[42vh] text-center [scrollbar-width:none]">
            {lines.map((l, i) => (
              <li key={`${l.t}-${i}`} className={cx("karaoke-line mx-auto max-w-3xl cursor-pointer py-2.5 font-semibold leading-snug transition-[opacity,transform,filter] duration-300", i === at ? "is-live scale-100 text-[1.7rem] opacity-100 sm:text-4xl" : i < at ? "scale-95 text-xl opacity-25 sm:text-2xl" : "scale-95 text-xl opacity-45 sm:text-2xl")} onClick={() => seekTo(l.t)}>
                {l.text || <span className="tracking-[0.5em] text-soft">♪ ♪ ♪</span>}
              </li>
            ))}
          </ol>
        )}
        {intro && (
          <div aria-hidden className="pointer-events-none absolute inset-x-0 top-[30vh] flex justify-center gap-3">
            {[0, 1, 2].map((d) => (
              <span key={d} className="h-2.5 w-2.5 animate-pulse rounded-full bg-core" style={{ animationDelay: `${d * 0.25}s` }} />
            ))}
          </div>
        )}

        {!noTrack && !lines.length && plain.length > 0 && (
          <div className="h-full overflow-y-auto px-6 py-8 text-center">
            <p className="mb-6 text-xs text-faint">Words only: no timing was found for this recording.</p>
            {plain.map((t, i) => (
              <p key={i} className={cx("mx-auto max-w-2xl text-lg leading-relaxed", !t && "h-5")}>
                {t}
              </p>
            ))}
          </div>
        )}

        {/* The mascot, singing along. */}
        <div ref={face} className={cx("pointer-events-none absolute bottom-1 right-2 origin-bottom-right scale-[0.6] sm:bottom-2 sm:right-3 sm:scale-100", !playing && "opacity-60")}>
          <MascotFrame frame={playing ? DANCE[frame] : "sleepy"} size={92} />
        </div>
      </div>

      <footer className="relative z-10 flex flex-col items-center gap-2 px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-2 sm:pt-3">
        {lines.length > 0 && !noTrack && (
          <div className="flex items-center gap-1 text-xs text-soft sm:absolute sm:bottom-8 sm:left-4" title="Lyrics early or late? Shift them.">
            <button type="button" onClick={() => nudge(-0.5)} aria-label="Lyrics later" className="p-1.5 hover:text-fg">
              <Minus size={14} />
            </button>
            <span className="w-12 text-center font-mono">{offset ? `${offset > 0 ? "+" : ""}${offset.toFixed(1)}s` : "sync"}</span>
            <button type="button" onClick={() => nudge(0.5)} aria-label="Lyrics earlier" className="p-1.5 hover:text-fg">
              <Plus size={14} />
            </button>
          </div>
        )}
        <button type="button" onClick={toggle} disabled={noTrack || (mode === "bgm" && !track)} aria-label={playing ? "Pause" : "Play"} className="flex h-14 w-14 items-center justify-center rounded-full bg-core text-core-ink hover:bg-core/85 disabled:opacity-30">
          {playing ? <Pause size={24} /> : <Play size={24} className="translate-x-px" />}
        </button>
      </footer>
    </section>
  );
}
