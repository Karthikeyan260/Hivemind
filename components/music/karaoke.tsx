"use client";

import {
  ChevronDown,
  Loader2,
  Minus,
  Pause,
  Play,
  Plus,
  SkipBack,
  SkipForward,
} from "lucide-react";
import { type RefObject, useEffect, useRef, useState } from "react";
import { MascotFrame, type MascotFrameName } from "@/components/mascot";
import { cx } from "@/components/ui";
import * as beat from "@/lib/beat";
import { activeLine, type Lyrics } from "@/lib/lyrics";

export const KARAOKE_EVENT = "hivemind:karaoke";
/** Karaoke is for Tamil songs. */
export const canKaraoke = (s: { language: string } | null | undefined) =>
  (s?.language ?? "").toLowerCase() === "tamil";

type Song = {
  id: string;
  title: string;
  artists: string;
  image: string;
  duration: number;
};
const OFFSET_KEY = (id: string) => `hm-lyric-offset-${id}`;
// A sung line rarely lasts longer than this: after it, the line stays lit while the music plays on.
const MAX_LINE_S = 9;
const DANCE: MascotFrameName[] = [
  "delighted",
  "sparkle",
  "starstruck",
  "heart",
];

/**
 * The karaoke view: the song that is playing, full screen, with its lyrics lighting up in time.
 * It reads the music player's own audio element, so pausing, seeking and the next song all just work.
 * Mount it with key={song.id}: each song starts from a clean state.
 */
export function Karaoke({
  song,
  audio,
  playing,
  onToggle,
  onSeek,
  onNext,
  onPrevious,
  onClose,
}: {
  song: Song;
  audio: RefObject<HTMLAudioElement | null>;
  playing: boolean;
  onToggle: () => void;
  onSeek: (seconds: number) => void;
  onNext: () => void;
  onPrevious: () => void;
  onClose: () => void;
}) {
  const [lyrics, setLyrics] = useState<Lyrics | null>(null);
  const [failed, setFailed] = useState(false);
  const [at, setAt] = useState(-1);
  const [frame, setFrame] = useState(0);
  // Seconds added to the song's clock: + shows lines earlier (lyrics were late), - later.
  const [offset, setOffset] = useState(() => {
    try {
      return Number(localStorage.getItem(OFFSET_KEY(song.id))) || 0;
    } catch {
      return 0;
    }
  });
  const list = useRef<HTMLOListElement | null>(null);
  const face = useRef<HTMLDivElement | null>(null);
  const live = useRef({ offset, lines: lyrics?.lines ?? [] });
  useEffect(() => {
    live.current = { offset, lines: lyrics?.lines ?? [] };
  }, [offset, lyrics]);

  useEffect(() => {
    let gone = false;
    fetch(
      `/api/music/lyrics?${new URLSearchParams({ title: song.title, artists: song.artists, duration: String(song.duration || 0) })}`,
    )
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("lyrics"))))
      .then((l: Lyrics) => !gone && setLyrics(l))
      .catch(() => !gone && setFailed(true));
    return () => {
      gone = true;
    };
  }, [song.title, song.artists, song.duration]);

  // The clock: which line is being sung, and how far through it (painted straight onto the line, no re-render).
  useEffect(() => {
    let raf = 0;
    let shown = -2;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const el = audio.current;
      const { lines, offset: off } = live.current;
      if (!el || !lines.length) return;
      const now = el.currentTime + off;
      const i = activeLine(lines, now);
      if (i !== shown) {
        shown = i;
        setAt(i);
      }
      const node =
        i >= 0
          ? (list.current?.children[i] as HTMLElement | undefined)
          : undefined;
      if (node) {
        const end = Math.min(
          lines[i + 1]?.t ?? lines[i].t + MAX_LINE_S,
          lines[i].t + MAX_LINE_S,
        );
        node.style.setProperty(
          "--p",
          `${Math.min(100, Math.max(0, ((now - lines[i].t) / Math.max(0.4, end - lines[i].t)) * 100)).toFixed(1)}%`,
        );
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [audio]);

  // Keep the line being sung in the middle.
  useEffect(() => {
    const node = list.current?.children[Math.max(0, at)] as
      HTMLElement | undefined;
    node?.scrollIntoView({
      block: "center",
      behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
    });
  }, [at, lyrics]);

  // The mascot bops on the beat and changes its face every few beats.
  useEffect(() => {
    let n = 0;
    return beat.onBeat(() => {
      face.current?.animate(
        [
          { transform: "translateY(0) scale(1)" },
          { transform: "translateY(-10px) scale(1.06, 0.95)" },
          { transform: "translateY(0) scale(1)" },
        ],
        { duration: 260, easing: "ease-out" },
      );
      if (++n % 8 === 0) setFrame((f) => (f + 1) % DANCE.length);
    });
  }, []);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose]);

  const nudge = (d: number) => {
    const v = Math.round((offset + d) * 10) / 10;
    setOffset(v);
    try {
      if (v) localStorage.setItem(OFFSET_KEY(song.id), String(v));
      else localStorage.removeItem(OFFSET_KEY(song.id));
    } catch {}
  };
  const seekTo = (t: number) => {
    onSeek(Math.max(0, t - offset));
  };

  const lines = lyrics?.lines ?? [];
  const plain = lyrics?.plain ?? [];
  // Before the first word: the dots count down the intro.
  const intro = lines.length > 0 && at < 0;

  return (
    <section
      aria-label="Karaoke"
      className="fixed inset-0 z-[70] flex flex-col overflow-hidden bg-[#06090d] text-fg"
    >
      {/* The cover, blurred, with the music lights' colour glowing behind the words. */}
      {song.image && (
        // eslint-disable-next-line @next/next/no-img-element -- remote cover art
        <img
          src={song.image}
          alt=""
          aria-hidden
          className="pointer-events-none absolute inset-0 h-full w-full scale-125 object-cover opacity-25 blur-3xl"
        />
      )}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(60% 45% at 50% 50%, rgb(var(--beat-rgb, 245 185 80) / 0.16), transparent 70%), linear-gradient(#06090d 0%, transparent 18%, transparent 78%, #06090d 100%)",
        }}
      />

      <header className="relative z-10 flex items-center gap-3 px-4 pt-4">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close karaoke"
          className="p-2 text-soft hover:text-fg"
        >
          <ChevronDown size={22} />
        </button>
        <div className="min-w-0 flex-1 text-center">
          <div className="truncate text-sm font-medium">{song.title}</div>
          <div className="truncate text-xs text-soft">{song.artists}</div>
        </div>
        <span className="w-9" />
      </header>

      <div className="relative z-10 min-h-0 flex-1 overflow-hidden">
        {!lyrics && !failed && (
          <p className="flex h-full items-center justify-center gap-2 text-sm text-soft">
            <Loader2 size={16} className="animate-spin" /> Finding the lyrics…
          </p>
        )}
        {(failed || (lyrics && !lines.length && !plain.length)) && (
          <p className="flex h-full flex-col items-center justify-center gap-1 px-8 text-center text-soft">
            <span className="text-lg text-fg">No lyrics for this song yet</span>
            <span className="text-sm">Hum along, or try another song.</span>
          </p>
        )}

        {lines.length > 0 && (
          <ol
            ref={list}
            className="karaoke-lines h-full overflow-y-auto [mask-image:linear-gradient(transparent,black_12%,black_88%,transparent)] px-6 py-[42vh] text-center [scrollbar-width:none]"
          >
            {lines.map((l, i) => (
              <li
                key={`${l.t}-${i}`}
                className={cx(
                  "karaoke-line mx-auto max-w-3xl cursor-pointer py-2.5 font-semibold leading-snug transition-[opacity,transform,filter] duration-300",
                  i === at
                    ? "is-live scale-100 text-[1.7rem] opacity-100 sm:text-4xl"
                    : i < at
                      ? "scale-95 text-xl opacity-25 sm:text-2xl"
                      : "scale-95 text-xl opacity-45 sm:text-2xl",
                )}
                onClick={() => seekTo(l.t)}
              >
                {l.text || (
                  <span className="tracking-[0.5em] text-soft">♪ ♪ ♪</span>
                )}
              </li>
            ))}
          </ol>
        )}
        {intro && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-[30vh] flex justify-center gap-3"
          >
            {[0, 1, 2].map((d) => (
              <span
                key={d}
                className="h-2.5 w-2.5 animate-pulse rounded-full bg-core"
                style={{ animationDelay: `${d * 0.25}s` }}
              />
            ))}
          </div>
        )}

        {!lines.length && plain.length > 0 && (
          <div className="h-full overflow-y-auto px-6 py-8 text-center">
            <p className="mb-6 text-xs text-faint">
              Words only: no timing was found for this recording.
            </p>
            {plain.map((t, i) => (
              <p
                key={i}
                className={cx(
                  "mx-auto max-w-2xl text-lg leading-relaxed",
                  !t && "h-5",
                )}
              >
                {t}
              </p>
            ))}
          </div>
        )}

        {/* The mascot, singing along. */}
        <div
          ref={face}
          className={cx(
            "pointer-events-none absolute bottom-1 right-2 origin-bottom-right scale-[0.6] sm:bottom-2 sm:right-3 sm:scale-100",
            !playing && "opacity-60",
          )}
        >
          <MascotFrame frame={playing ? DANCE[frame] : "sleepy"} size={92} />
        </div>
      </div>

      <footer className="relative z-10 flex flex-col items-center gap-2 px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-2 sm:pt-3">
        {lines.length > 0 && (
          <div
            className="flex items-center gap-1 text-xs text-soft sm:absolute sm:bottom-8 sm:left-4"
            title="Lyrics early or late? Shift them."
          >
            <button
              type="button"
              onClick={() => nudge(-0.5)}
              aria-label="Lyrics later"
              className="p-1.5 hover:text-fg"
            >
              <Minus size={14} />
            </button>
            <span className="w-12 text-center font-mono">
              {offset
                ? `${offset > 0 ? "+" : ""}${offset.toFixed(1)}s`
                : "sync"}
            </span>
            <button
              type="button"
              onClick={() => nudge(0.5)}
              aria-label="Lyrics earlier"
              className="p-1.5 hover:text-fg"
            >
              <Plus size={14} />
            </button>
          </div>
        )}
        <div className="flex items-center justify-center gap-5">
          <button
            type="button"
            onClick={onPrevious}
            aria-label="Previous song"
            className="p-2 text-soft hover:text-fg"
          >
            <SkipBack size={22} />
          </button>
          <button
            type="button"
            onClick={onToggle}
            aria-label={playing ? "Pause" : "Play"}
            className="flex h-14 w-14 items-center justify-center rounded-full bg-core text-core-ink hover:bg-core/85"
          >
            {playing ? (
              <Pause size={24} />
            ) : (
              <Play size={24} className="translate-x-px" />
            )}
          </button>
          <button
            type="button"
            onClick={onNext}
            aria-label="Next song"
            className="p-2 text-soft hover:text-fg"
          >
            <SkipForward size={22} />
          </button>
        </div>
      </footer>
    </section>
  );
}
