"use client";

import { Maximize2, X } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import * as beat from "@/lib/beat";
import { MUSIC_STATE_EVENT, useFetch } from "@/lib/client-api";
import { type Garden, layout } from "@/lib/garden-layout";
import { isPublicPage } from "@/lib/public-paths";
import type { GardenScene } from "./garden-scene";
import { phaseNow } from "./phase";

/**
 * While a song plays anywhere in HIVEMIND, a small live view of Nova's garden dancing to it sits in a
 * corner (above the music player). A tap opens the full garden; × hides it until the next song. Not on
 * the garden itself, nor on friends' pages. It goes away a few seconds after the music stops (so the
 * gap between songs doesn't flicker it) and frees the graphics memory when it does.
 */
const HIDE_AFTER_MS = 4000;

export function MiniConcert() {
  const path = usePathname();
  const router = useRouter();
  const [playing, setPlaying] = useState(false);
  const [closed, setClosed] = useState(false);
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- a song may already be playing when this mounts
    setPlaying(document.documentElement.classList.contains("music-live"));
    const on = (e: Event) => {
      const p = !!(e as CustomEvent<{ playing: boolean }>).detail?.playing;
      clearTimeout(t);
      if (p) setPlaying(true);
      else t = setTimeout(() => setPlaying(false), HIDE_AFTER_MS);
    };
    window.addEventListener(MUSIC_STATE_EVENT, on);
    return () => {
      clearTimeout(t);
      window.removeEventListener(MUSIC_STATE_EVENT, on);
    };
  }, []);
  // A new song after the owner closed it: show it again.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reopens when the music stops and starts again
    if (!playing) setClosed(false);
  }, [playing]);

  const show = playing && !closed && !path.startsWith("/garden") && !isPublicPage(path);
  if (!show) return null;
  return (
    <div className="fixed right-3 bottom-[calc(var(--tabbar-h)+4.75rem)] z-40 overflow-hidden rounded-2xl border border-line bg-[#0b1016] shadow-2xl md:right-5" style={{ width: "min(46vw, 220px)", aspectRatio: "4 / 3" }}>
      <button type="button" onClick={() => router.push("/garden")} aria-label="Open Nova's garden" className="absolute inset-0 block">
        <MiniScene />
      </button>
      <span className="pointer-events-none absolute top-1.5 left-2 flex items-center gap-1 rounded-full bg-black/50 px-2 py-0.5 text-[10px] font-semibold text-white">
        <span className="size-1.5 animate-pulse rounded-full" style={{ background: "rgb(var(--beat-rgb))" }} /> Garden concert
      </span>
      <span className="pointer-events-none absolute right-2 bottom-1.5 text-white/70">
        <Maximize2 size={12} />
      </span>
      <button type="button" onClick={() => setClosed(true)} aria-label="Hide the garden concert" className="absolute top-1 right-1 flex size-6 items-center justify-center rounded-full bg-black/50 text-white hover:bg-black/70">
        <X size={12} />
      </button>
    </div>
  );
}

function MiniScene() {
  const feed = useFetch<{ garden: Garden }>("/api/pet/garden");
  const g = feed.data?.garden;
  const host = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!g) return;
    let alive = true;
    let scene: GardenScene | null = null;
    let ro: ResizeObserver | null = null;
    let cv: HTMLCanvasElement | null = null;
    const offs: (() => void)[] = [];
    void (async () => {
      let mod: typeof import("./garden-scene");
      try {
        mod = await import("./garden-scene");
      } catch {
        if (alive) setFailed(true);
        return;
      }
      if (!alive || !host.current) return;
      cv = document.createElement("canvas");
      cv.className = "absolute inset-0 h-full w-full";
      cv.setAttribute("aria-hidden", "true");
      host.current.appendChild(cv);
      try {
        const phase = phaseNow();
        scene = new mod.GardenScene(cv, layout(g.items), { n: g.items.length, phase, wet: false, butterflies: g.butterflies, lit: phase === "night", mini: true }, { onPick: () => {}, onFrame: () => {} });
      } catch {
        cv.remove();
        if (alive) setFailed(true);
        return;
      }
      const s = scene;
      s.resize(cv.clientWidth, cv.clientHeight);
      ro = new ResizeObserver(() => cv && s.resize(cv.clientWidth, cv.clientHeight));
      ro.observe(host.current);
      // The same show as the full garden: the beat, the song's loudness, the drop, the colour.
      const paint = () => s.setMusic(document.documentElement.classList.contains("music-live") ? beat.currentRgb() : null);
      paint();
      offs.push(beat.onBeat(() => s.musicBeat()));
      offs.push(beat.onDrop(() => s.musicDrop()));
      const lv = setInterval(() => s.setMusicLevel(beat.level()), 120);
      offs.push(() => clearInterval(lv));
      let late: ReturnType<typeof setTimeout> | undefined;
      const state = () => {
        clearTimeout(late);
        late = setTimeout(paint, 50);
      };
      offs.push(() => clearTimeout(late));
      window.addEventListener(MUSIC_STATE_EVENT, state);
      window.addEventListener(beat.COLOR_EVENT, paint);
      offs.push(() => window.removeEventListener(MUSIC_STATE_EVENT, state));
      offs.push(() => window.removeEventListener(beat.COLOR_EVENT, paint));
      if (process.env.NODE_ENV === "development") (window as unknown as { __hmMini?: unknown }).__hmMini = { beat: () => s.musicBeat(), drop: () => s.musicDrop(), music: (rgb: [number, number, number] | null) => s.setMusic(rgb), level: (v: number) => s.setMusicLevel(v) };
    })();
    return () => {
      alive = false;
      offs.forEach((f) => f());
      ro?.disconnect();
      scene?.dispose();
      cv?.remove();
      if (process.env.NODE_ENV === "development") delete (window as unknown as { __hmMini?: unknown }).__hmMini;
    };
  }, [g]);

  if (failed) return <span className="flex h-full items-center justify-center text-3xl">🌱🎶</span>;
  return <div ref={host} className="relative h-full w-full" />;
}
