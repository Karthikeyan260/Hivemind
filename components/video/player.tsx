"use client";

import { ChevronDown, ChevronUp, ListVideo, Maximize, Maximize2, Minimize2, Pause, Play, SkipBack, SkipForward, Video, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { cx } from "@/components/ui";
import { useVoice } from "@/components/voice/provider";
import { MEDIA_START_EVENT, VIDEO_EVENT } from "@/lib/client-api";
import { isPublicPage } from "@/lib/public-paths";

/**
 * HIVEMIND's video player: YouTube's official embedded player in a floating window on every page,
 * with a queue and voice control ("play the Leo trailer", "next video", "full screen"). Free; YouTube
 * may show its own ads (none with YouTube Premium signed in on this browser). Music pauses while a
 * video plays, and the video goes quiet while the voice talks.
 */
export type VideoItem = { id: string; title: string; channel: string; duration: string; thumb: string };
export type VideoCommand = {
  action: "play" | "add" | "pause" | "resume" | "next" | "previous" | "stop" | "fullscreen" | "expand" | "minimize" | "hide" | "show" | "now_playing" | "queue" | "jump" | "volume_up" | "volume_down";
  query?: string;
  position?: number;
};
type Result = Record<string, unknown>;

let control: ((c: VideoCommand) => Promise<Result>) | null = null;
/** The YouTube player's "ended / can't play" events move on to the next video through this. */
let advance: (() => void) | null = null;
/** Voice / chat entry point; works from any page while the player is mounted. */
export function videoCommand(c: VideoCommand): Promise<Result> {
  return control ? control(c) : Promise.resolve({ error: "The video player isn't available on this page." });
}

// The bits of YouTube's IFrame API this uses.
type YTPlayer = {
  loadVideoById(id: string): void;
  playVideo(): void;
  pauseVideo(): void;
  stopVideo(): void;
  getPlayerState(): number;
  getVolume(): number;
  setVolume(v: number): void;
  destroy(): void;
};
type YTApi = { Player: new (el: HTMLElement, opts: Record<string, unknown>) => YTPlayer; PlayerState: { ENDED: number; PLAYING: number; PAUSED: number } };
declare global {
  interface Window {
    YT?: YTApi;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiReady: Promise<YTApi> | null = null;
function loadApi(): Promise<YTApi> {
  apiReady ??= new Promise((resolve, reject) => {
    if (window.YT?.Player) return resolve(window.YT);
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      resolve(window.YT!);
    };
    const s = document.createElement("script");
    s.src = "https://www.youtube.com/iframe_api";
    s.async = true;
    s.onerror = () => {
      apiReady = null;
      reject(new Error("Couldn't load the YouTube player."));
    };
    document.head.appendChild(s);
  });
  return apiReady;
}

type Size = "mini" | "large" | "chip";
type Place = { x: number; y: number; w: number };
const PLACE_KEY = "video-window-place";

/** Keeps the small window fully on screen, between 240 px wide and the screen's width. */
function fit(p: Place): Place {
  const w = Math.round(Math.min(Math.max(p.w, 240), window.innerWidth - 16));
  const h = (w * 9) / 16 + 36; // video + title bar
  return {
    w,
    x: Math.round(Math.min(Math.max(p.x, 8), window.innerWidth - w - 8)),
    y: Math.round(Math.min(Math.max(p.y, 8), window.innerHeight - h - 8)),
  };
}

export function VideoPlayer() {
  const path = usePathname();
  const voice = useVoice();
  const host = useRef<HTMLDivElement | null>(null);
  const frame = useRef<HTMLDivElement | null>(null);
  const player = useRef<YTPlayer | null>(null);
  const [queue, setQueue] = useState<VideoItem[]>([]);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [size, setSize] = useState<Size>("mini");
  const [showQueue, setShowQueue] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const st = useRef({ queue, index, playing });
  useEffect(() => {
    st.current = { queue, index, playing };
  }, [queue, index, playing]);
  const volume = useRef(100);

  const item = queue[index] ?? null;
  const visible = !!item && !isPublicPage(path);

  const search = useCallback(async (q: string) => {
    const r = await fetch(`/api/video/search?q=${encodeURIComponent(q)}&n=12`);
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error ?? "Video search failed.");
    return (data.videos ?? []) as VideoItem[];
  }, []);

  /** Loads queue[i] into the player (creating it the first time). */
  const playAt = useCallback(async (list: VideoItem[], i: number) => {
    const v = list[i];
    if (!v) return false;
    st.current = { ...st.current, queue: list, index: i };
    setQueue(list);
    setIndex(i);
    setError(null);
    setSize((s) => (s === "chip" ? "mini" : s));
    const YT = await loadApi();
    if (player.current) {
      player.current.loadVideoById(v.id);
      return true;
    }
    // The player mounts into a node the window renders; wait a frame for it.
    await new Promise((r) => requestAnimationFrame(r));
    if (!frame.current) return false;
    const el = document.createElement("div");
    frame.current.replaceChildren(el);
    player.current = new YT.Player(el, {
      videoId: v.id,
      host: "https://www.youtube-nocookie.com",
      playerVars: { autoplay: 1, playsinline: 1, rel: 0, modestbranding: 1 },
      events: {
        onStateChange: (e: { data: number }) => {
          if (e.data === YT.PlayerState.PLAYING) {
            setPlaying(true);
            window.dispatchEvent(new CustomEvent(MEDIA_START_EVENT, { detail: { source: "video" } }));
          } else if (e.data === YT.PlayerState.PAUSED) setPlaying(false);
          else if (e.data === YT.PlayerState.ENDED) {
            setPlaying(false);
            advance?.();
          }
        },
        // 101 / 150: the uploader doesn't allow embedding. Skip to the next one.
        onError: (e: { data: number }) => {
          setError(e.data === 101 || e.data === 150 ? "This video can't play outside YouTube. Skipping." : "This video can't be played. Skipping.");
          advance?.();
        },
      },
    });
    return true;
  }, []);

  const next = useCallback(async () => {
    const { queue: q, index: i } = st.current;
    if (i + 1 < q.length) return playAt(q, i + 1);
    return false;
  }, [playAt]);

  const close = useCallback(() => {
    player.current?.destroy();
    player.current = null;
    st.current = { ...st.current, queue: [], index: 0, playing: false };
    setQueue([]);
    setIndex(0);
    setPlaying(false);
    setShowQueue(false);
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
  }, []);

  const fullscreen = useCallback(() => {
    const el = host.current;
    if (!el) return false;
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    else void el.requestFullscreen?.().catch(() => setSize("large"));
    return true;
  }, []);

  useEffect(() => {
    control = async (c) => {
      const p = player.current;
      const now = st.current.queue[st.current.index];
      const about = (v?: VideoItem) => (v ? { title: v.title, channel: v.channel, duration: v.duration } : null);
      switch (c.action) {
        case "play":
        case "add": {
          const q = (c.query ?? "").trim();
          if (!q) {
            if (now && p) {
              p.playVideo();
              return { resumed: about(now) };
            }
            return { error: "Say what to watch." };
          }
          const videos = await search(q);
          if (!videos.length) return { error: `No videos found for "${q}".` };
          if (c.action === "add" && st.current.queue.length) {
            const { queue: list, index: i } = st.current;
            const merged = [...list.slice(0, i + 1), videos[0], ...list.slice(i + 1)];
            st.current = { ...st.current, queue: merged };
            setQueue(merged);
            return { added_next: about(videos[0]) };
          }
          // A new video always opens as the small floating window (not stuck big from last time).
          setSize("mini");
          if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
          await playAt(videos, 0);
          return { playing: about(videos[0]), up_next: videos.slice(1, 4).map((v) => v.title), note: "If it doesn't start, ask the owner to tap the video once." };
        }
        case "pause":
          p?.pauseVideo();
          return { paused: about(now) };
        case "resume":
          if (!p || !now) return { error: "No video is open. Say what to watch." };
          p.playVideo();
          return { resumed: about(now) };
        case "next":
          return (await next()) ? { playing: about(st.current.queue[st.current.index]) } : { error: "No more videos in the queue." };
        case "previous": {
          const i = Math.max(0, st.current.index - 1);
          await playAt(st.current.queue, i);
          return { playing: about(st.current.queue[i]) };
        }
        case "jump": {
          const i = Math.round(Number(c.position ?? 0)) - 1;
          if (!st.current.queue[i]) return { error: `The queue has ${st.current.queue.length} videos.` };
          await playAt(st.current.queue, i);
          return { playing: about(st.current.queue[i]) };
        }
        case "stop":
          close();
          return { closed: true };
        case "fullscreen":
          setSize("large");
          return fullscreen() ? { fullscreen: true, note: "If the browser refused, it opened large instead." } : { error: "No video is open." };
        case "expand":
          setSize("large");
          return { size: "large" };
        case "minimize":
          // Picture-in-picture style: the small floating window the owner can drag anywhere.
          if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
          setSize("mini");
          return { size: "small floating window", note: "Tell them they can drag it anywhere by its title bar." };
        case "hide":
          if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
          setSize("chip");
          return { size: "hidden to a small bar", note: "It keeps playing; 'show the video' brings it back." };
        case "show":
          setSize("mini");
          return { size: "small floating window" };
        case "volume_up":
        case "volume_down": {
          volume.current = Math.min(100, Math.max(0, volume.current + (c.action === "volume_up" ? 15 : -15)));
          p?.setVolume(volume.current);
          return { volume_percent: volume.current };
        }
        case "now_playing":
          return now ? { playing: about(now), paused: !st.current.playing, position: `${st.current.index + 1} of ${st.current.queue.length}` } : { playing: null };
        case "queue":
          return { now: st.current.index + 1, queue: st.current.queue.slice(0, 12).map((v, i) => `${i + 1}. ${v.title} (${v.channel})`) };
      }
      return { error: "Unknown video action." };
    };
    const fromChat = (e: Event) => void control?.((e as CustomEvent<VideoCommand>).detail).catch(() => {});
    // Music started: pause the video (one thing plays at a time).
    const other = (e: Event) => {
      if ((e as CustomEvent<{ source: string }>).detail?.source !== "video") player.current?.pauseVideo();
    };
    advance = () => void next();
    window.addEventListener(VIDEO_EVENT, fromChat);
    window.addEventListener(MEDIA_START_EVENT, other);
    return () => {
      control = null;
      advance = null;
      window.removeEventListener(VIDEO_EVENT, fromChat);
      window.removeEventListener(MEDIA_START_EVENT, other);
    };
  }, [search, playAt, next, close, fullscreen]);

  // Where the owner put the small window (remembered on this device).
  const [place, setPlace] = useState<Place | null>(null);
  const [moving, setMoving] = useState(false);
  const drag = useRef<{ mode: "move" | "resize"; sx: number; sy: number; x: number; y: number; w: number } | null>(null);
  const placeRef = useRef<Place | null>(null);
  useEffect(() => {
    placeRef.current = place;
  }, [place]);
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(PLACE_KEY) ?? "null") as Place | null;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- restore the saved spot once
      if (saved && typeof saved.x === "number") setPlace(fit(saved));
    } catch {}
    // Keep it on screen when the window or phone rotates.
    const keep = () => setPlace((p) => (p ? fit(p) : p));
    window.addEventListener("resize", keep);
    return () => window.removeEventListener("resize", keep);
  }, []);

  // The voice talks over the video: duck it while speaking.
  const speaking = voice.state === "speaking";
  useEffect(() => {
    const p = player.current;
    if (!p) return;
    try {
      p.setVolume(speaking ? Math.round(volume.current * 0.25) : volume.current);
    } catch {}
  }, [speaking]);

  // ---- moving and resizing the small window (mouse or finger) ----
  function start(mode: "move" | "resize", e: React.PointerEvent<HTMLElement>) {
    if (size === "large" || !host.current) return;
    if (mode === "move" && (e.target as HTMLElement).closest("button")) return;
    const r = host.current.getBoundingClientRect();
    drag.current = { mode, sx: e.clientX, sy: e.clientY, x: r.left, y: r.top, w: r.width };
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
    setMoving(true);
  }
  const beginMove = (e: React.PointerEvent<HTMLElement>) => start("move", e);
  const beginResize = (e: React.PointerEvent<HTMLElement>) => start("resize", e);
  function move(e: React.PointerEvent<HTMLElement>) {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.sx;
    const dy = e.clientY - d.sy;
    // Resizing from the top-right corner: wider to the right, the bottom edge stays put.
    const w = d.mode === "resize" ? d.w + dx : d.w;
    const y = d.mode === "resize" ? d.y - (w - d.w) * (9 / 16) : d.y + dy;
    setPlace(fit({ x: d.mode === "resize" ? d.x : d.x + dx, y, w }));
  }
  function end() {
    if (!drag.current) return;
    drag.current = null;
    setMoving(false);
    if (placeRef.current) {
      try {
        localStorage.setItem(PLACE_KEY, JSON.stringify(placeRef.current));
      } catch {}
    }
  }
  function resetPlace() {
    setPlace(null);
    try {
      localStorage.removeItem(PLACE_KEY);
    } catch {}
  }

  if (!visible || !item) return <div ref={frame} className="hidden" />;

  const toggle = () => (playing ? player.current?.pauseVideo() : player.current?.playVideo());
  // The owner moved / resized the small window: it sits exactly there (the large view stays centred).
  const placed = !!place && size !== "large";

  return (
    <section
      ref={host}
      aria-label="Video player"
      style={placed ? { left: place!.x, top: place!.y, width: size === "chip" ? undefined : place!.w } : undefined}
      className={cx(
        "fixed z-50 overflow-hidden border border-data/40 bg-black shadow-[0_0_40px_-12px_rgba(56,189,248,0.45)]",
        size === "large"
          ? "inset-x-2 top-14 md:inset-x-auto md:left-1/2 md:top-1/2 md:w-[min(72rem,calc(100vw-16rem))] md:-translate-x-1/2 md:-translate-y-1/2"
          : placed
            ? ""
            : "right-4 bottom-[calc(var(--tabbar-h)+var(--music-h,0px)+5rem)] w-[min(24rem,64vw)] md:bottom-[calc(var(--music-h,0px)+5.5rem)]",
        size === "chip" && "w-auto",
        moving && "select-none shadow-[0_0_50px_-8px_rgba(56,189,248,0.7)]",
      )}
    >
      {/* The player stays mounted while minimised, so the sound keeps going. */}
      <div className={cx("relative aspect-video w-full bg-black", size === "chip" && "pointer-events-none absolute h-px w-px opacity-0")}>
        {/* While dragging, the video mustn't swallow the pointer. */}
        <div ref={frame} className={cx("absolute inset-0 [&>iframe]:h-full [&>iframe]:w-full", moving && "pointer-events-none")} />
        {size === "mini" && (
          <div
            role="separator"
            aria-label="Resize video window"
            title="Drag to resize"
            onPointerDown={beginResize}
            onPointerMove={move}
            onPointerUp={end}
            onPointerCancel={end}
            className="absolute right-0 top-0 z-10 h-5 w-5 cursor-nesw-resize touch-none bg-[linear-gradient(225deg,rgba(56,189,248,0.9)_0_30%,transparent_30%)]"
          />
        )}
      </div>

      <header
        onPointerDown={beginMove}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        onDoubleClick={resetPlace}
        title={size === "large" ? undefined : "Drag to move · double-click to put it back"}
        className={cx("flex items-center gap-1.5 bg-[#0b1016]/95 px-2 py-1.5", size !== "large" && "cursor-grab touch-none active:cursor-grabbing")}
      >
        <Video size={13} className="shrink-0 text-data" />
        <span className="min-w-0 flex-1 truncate text-xs" title={`${item.title} · ${item.channel}`}>
          {error ?? item.title}
          {size !== "chip" && <span className="text-soft"> · {item.channel}</span>}
        </span>
        <button type="button" onClick={() => void playAt(queue, Math.max(0, index - 1))} aria-label="Previous video" className="p-1 text-soft hover:text-fg">
          <SkipBack size={14} />
        </button>
        <button type="button" onClick={toggle} aria-label={playing ? "Pause" : "Play"} className="p-1 text-core hover:text-fg">
          {playing ? <Pause size={15} /> : <Play size={15} />}
        </button>
        <button type="button" onClick={() => void next()} aria-label="Next video" className="p-1 text-soft hover:text-fg">
          <SkipForward size={14} />
        </button>
        {size !== "chip" && (
          <>
            <button type="button" onClick={() => setShowQueue(!showQueue)} aria-label="Queue" className={cx("p-1 hover:text-fg", showQueue ? "text-core" : "text-soft")}>
              <ListVideo size={14} />
            </button>
            <button type="button" onClick={fullscreen} aria-label="Full screen" className="p-1 text-soft hover:text-fg">
              <Maximize size={14} />
            </button>
            <button type="button" onClick={() => setSize(size === "large" ? "mini" : "large")} aria-label={size === "large" ? "Smaller" : "Larger"} className="p-1 text-soft hover:text-fg">
              {size === "large" ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
            </button>
          </>
        )}
        <button type="button" onClick={() => setSize(size === "chip" ? "mini" : "chip")} aria-label={size === "chip" ? "Show video" : "Minimise"} className="p-1 text-soft hover:text-fg">
          {size === "chip" ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
        <button type="button" onClick={close} aria-label="Close video" className="p-1 text-faint hover:text-fg">
          <X size={14} />
        </button>
      </header>

      {showQueue && size !== "chip" && (
        <ol className="max-h-56 overflow-y-auto border-t border-line bg-[#0b1016]/98 p-1">
          {queue.map((v, i) => (
            <li key={`${v.id}-${i}`}>
              <button type="button" onClick={() => void playAt(queue, i)} className={cx("flex w-full items-center gap-2 px-1.5 py-1 text-left text-xs hover:bg-raised", i === index && "bg-core/10 text-core")}>
                {/* eslint-disable-next-line @next/next/no-img-element -- YouTube thumbnail */}
                <img src={v.thumb} alt="" className="h-9 w-16 shrink-0 object-cover" loading="lazy" />
                <span className="min-w-0 flex-1">
                  <span className="line-clamp-2">{v.title}</span>
                  <span className="text-[10.5px] text-soft">
                    {v.channel} · {v.duration}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
