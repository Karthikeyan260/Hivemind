"use client";

import { ListMusic, Loader2, Music2, Pause, Play, SkipBack, SkipForward, Volume1, Volume2, VolumeX, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { cx } from "@/components/ui";
import { useVoice } from "@/components/voice/provider";
import { MUSIC_EVENT } from "@/lib/client-api";
import { isPublicPage } from "@/lib/public-paths";

/**
 * HIVEMIND's own music player: full songs (JioSaavn, no ads) playing in the owner's browser, with a
 * "now playing" bar on every page, a queue, the phone's lock-screen controls, and voice control
 * ("play Vibe Venuma", "next", "previous", "louder"). Music goes quiet while the voice is talking.
 */
export type Song = { id: string; title: string; artists: string; album: string; image: string; duration: number; language: string; year: string; media: string };

export type MusicCommand = {
  action: "play" | "add" | "pause" | "resume" | "next" | "previous" | "stop" | "volume_up" | "volume_down" | "set_volume" | "now_playing" | "queue" | "jump";
  query?: string;
  volume?: number;
  position?: number;
};
type Result = Record<string, unknown>;

let control: ((c: MusicCommand) => Promise<Result>) | null = null;
/** Voice / chat entry point; works from any page while the player is mounted. */
export function musicCommand(c: MusicCommand): Promise<Result> {
  return control ? control(c) : Promise.resolve({ error: "The music player isn't available on this page." });
}

const fmt = (s: number) => (Number.isFinite(s) && s > 0 ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}` : "0:00");
const LINK_MS = 2 * 60 * 60_000; // stream links last a few hours: refresh after two

export function MusicPlayer() {
  const path = usePathname();
  const voice = useVoice();
  const audio = useRef<HTMLAudioElement | null>(null);
  const links = useRef(new Map<string, { url: string; at: number }>());
  const [queue, setQueue] = useState<Song[]>([]);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [volume, setVolume] = useState(0.8);
  const [time, setTime] = useState({ at: 0, of: 0 });
  const [showQueue, setShowQueue] = useState(false);
  // Latest values for the command handler (it outlives renders).
  const st = useRef({ queue, index, volume, playing });
  useEffect(() => {
    st.current = { queue, index, volume, playing };
  }, [queue, index, volume, playing]);

  const song = queue[index] ?? null;
  const visible = !!song && !isPublicPage(path);

  // Other floating things (voice dock, web window) sit above the bar.
  useEffect(() => {
    document.documentElement.style.setProperty("--music-h", visible ? "4rem" : "0px");
  }, [visible]);

  const link = useCallback(async (s: Song, fresh = false) => {
    const hit = links.current.get(s.id);
    if (!fresh && hit && Date.now() - hit.at < LINK_MS) return hit.url;
    const r = await fetch("/api/music/stream", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ media: s.media }) });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || !data.url) throw new Error(data.error ?? "This song can't be played right now.");
    links.current.set(s.id, { url: data.url, at: Date.now() });
    return data.url as string;
  }, []);

  /** Loads and plays queue[i]. Returns false when the browser wants a tap first. */
  const playAt = useCallback(
    async (list: Song[], i: number, fresh = false): Promise<boolean> => {
      const el = audio.current;
      const s = list[i];
      if (!el || !s) return false;
      st.current = { ...st.current, queue: list, index: i };
      setQueue(list);
      setIndex(i);
      setError(null);
      setLoading(true);
      try {
        el.src = await link(s, fresh);
        await el.play();
        setBlocked(false);
        return true;
      } catch (err) {
        // Autoplay rules: without a recent tap the browser may refuse; the bar shows a big Play.
        if (err instanceof DOMException && err.name === "NotAllowedError") {
          setBlocked(true);
          return false;
        }
        setError(err instanceof Error ? err.message : "Couldn't play that song.");
        return false;
      } finally {
        setLoading(false);
      }
    },
    [link],
  );

  const search = useCallback(async (q: string, n = 20) => {
    const r = await fetch(`/api/music/search?q=${encodeURIComponent(q)}&n=${n}`);
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error ?? "Music search failed.");
    return (data.songs ?? []) as Song[];
  }, []);

  const next = useCallback(async () => {
    const { queue: q, index: i } = st.current;
    if (i + 1 < q.length) return playAt(q, i + 1);
    // End of the queue: keep going with more by the same artists.
    const cur = q[i];
    if (!cur) return false;
    const more = (await search(`${cur.artists.split(",")[0]} songs`, 15).catch(() => [])).filter((s) => !q.some((x) => x.id === s.id));
    if (!more.length) return false;
    return playAt([...q, ...more], i + 1);
  }, [playAt, search]);

  const previous = useCallback(() => {
    const el = audio.current;
    const { queue: q, index: i } = st.current;
    // Like every player: a few seconds in, "previous" restarts the song.
    if (el && el.currentTime > 5) {
      el.currentTime = 0;
      return Promise.resolve(true);
    }
    return playAt(q, Math.max(0, i - 1));
  }, [playAt]);

  // The command handler voice and chat use.
  useEffect(() => {
    control = async (c) => {
      const el = audio.current;
      const now = st.current.queue[st.current.index];
      const about = (s?: Song) => (s ? { title: s.title, artists: s.artists, album: s.album } : null);
      switch (c.action) {
        case "play":
        case "add": {
          const q = (c.query ?? "").trim();
          if (!q) {
            if (c.action === "play" && now && el) {
              await el.play().catch(() => setBlocked(true));
              return { resumed: about(now) };
            }
            return { error: "Say what to play: a song, an artist, a film or a mood." };
          }
          const songs = await search(q);
          if (!songs.length) return { error: `Nothing found for "${q}".` };
          if (c.action === "add") {
            const { queue: list, index: i } = st.current;
            if (!list.length) {
              const ok = await playAt(songs, 0);
              return { playing: about(songs[0]), ...(ok ? {} : { note: "Ask the owner to tap Play on the music bar (the browser needs a tap)." }) };
            }
            // "Play X next": right after the current song.
            const merged = [...list.slice(0, i + 1), songs[0], ...list.slice(i + 1)];
            st.current = { ...st.current, queue: merged };
            setQueue(merged);
            return { added_next: about(songs[0]) };
          }
          const ok = await playAt(songs, 0);
          return {
            playing: about(songs[0]),
            up_next: songs.slice(1, 4).map((s) => s.title),
            ...(ok ? {} : { note: "The browser needs one tap: ask the owner to tap Play on the music bar at the bottom." }),
          };
        }
        case "pause":
          el?.pause();
          return { paused: about(now) };
        case "resume":
          if (!now || !el) return { error: "Nothing is playing. Say what to play." };
          await el.play().catch(() => setBlocked(true));
          return { resumed: about(now) };
        case "next": {
          const ok = await next();
          const s = st.current.queue[st.current.index];
          return ok ? { playing: about(s) } : { error: "No more songs in the queue." };
        }
        case "previous": {
          await previous();
          return { playing: about(st.current.queue[st.current.index]) };
        }
        case "jump": {
          const i = Math.round(Number(c.position ?? 0)) - 1;
          const q = st.current.queue;
          if (!q[i]) return { error: `The queue has ${q.length} songs.` };
          await playAt(q, i);
          return { playing: about(q[i]) };
        }
        case "stop":
          el?.pause();
          setQueue([]);
          setIndex(0);
          return { stopped: true };
        case "volume_up":
        case "volume_down":
        case "set_volume": {
          const v = c.action === "set_volume" ? Math.min(1, Math.max(0, Number(c.volume ?? 0.5) > 1 ? Number(c.volume) / 100 : Number(c.volume ?? 0.5))) : Math.min(1, Math.max(0, st.current.volume + (c.action === "volume_up" ? 0.15 : -0.15)));
          st.current = { ...st.current, volume: v };
          setVolume(v);
          return { volume_percent: Math.round(v * 100) };
        }
        case "now_playing":
          return now ? { playing: about(now), paused: !st.current.playing, position: `${st.current.index + 1} of ${st.current.queue.length}` } : { playing: null };
        case "queue":
          return { now: st.current.index + 1, queue: st.current.queue.slice(0, 15).map((s, i) => `${i + 1}. ${s.title} - ${s.artists}`) };
      }
      return { error: "Unknown music action." };
    };
    const fromChat = (e: Event) => void control?.((e as CustomEvent<MusicCommand>).detail).catch(() => {});
    window.addEventListener(MUSIC_EVENT, fromChat);
    return () => {
      control = null;
      window.removeEventListener(MUSIC_EVENT, fromChat);
    };
  }, [search, playAt, next, previous]);

  // The voice talks over the music: duck it while speaking.
  const speaking = voice.state === "speaking";
  useEffect(() => {
    if (audio.current) audio.current.volume = speaking ? volume * 0.25 : volume;
  }, [volume, speaking]);

  // Phone lock screen / headphone buttons / keyboard media keys.
  useEffect(() => {
    if (!("mediaSession" in navigator) || !song) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: song.title,
      artist: song.artists,
      album: song.album,
      artwork: song.image ? [{ src: song.image, sizes: "500x500", type: "image/jpeg" }] : [],
    });
    navigator.mediaSession.setActionHandler("play", () => void audio.current?.play());
    navigator.mediaSession.setActionHandler("pause", () => audio.current?.pause());
    navigator.mediaSession.setActionHandler("nexttrack", () => void next());
    navigator.mediaSession.setActionHandler("previoustrack", () => void previous());
  }, [song, next, previous]);

  async function onError() {
    // An expired link: get a fresh one once, then give up on this song.
    const s = st.current.queue[st.current.index];
    if (!s) return;
    const hit = links.current.get(s.id);
    if (hit && Date.now() - hit.at > 60_000) {
      links.current.delete(s.id);
      await playAt(st.current.queue, st.current.index, true);
    } else {
      setError("This song can't be played. Skipping.");
      void next();
    }
  }

  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = audio.current;
    if (!el || !time.of) return;
    const r = e.currentTarget.getBoundingClientRect();
    el.currentTime = ((e.clientX - r.left) / r.width) * time.of;
  };
  const toggle = () => {
    const el = audio.current;
    if (!el) return;
    if (el.paused) void el.play().then(() => setBlocked(false)).catch(() => setBlocked(true));
    else el.pause();
  };
  const VolIcon = volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;

  return (
    <>
      <audio
        ref={audio}
        preload="auto"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => void next()}
        onError={() => void onError()}
        onTimeUpdate={(e) => setTime({ at: e.currentTarget.currentTime, of: e.currentTarget.duration || song?.duration || 0 })}
      />
      {visible && song && (
        <section
          aria-label="Music player"
          className="fixed inset-x-0 bottom-[var(--tabbar-h)] z-40 h-16 border-t border-line bg-[#0b1016]/95 backdrop-blur-md md:left-52"
        >
          {/* Progress: click to seek. */}
          <div className="absolute inset-x-0 -top-1 h-2 cursor-pointer" onClick={seek} title={`${fmt(time.at)} / ${fmt(time.of)}`}>
            <div className="mt-[3px] h-0.5 bg-line">
              <div className="h-full bg-core" style={{ width: `${time.of ? (time.at / time.of) * 100 : 0}%` }} />
            </div>
          </div>

          <div className="flex h-full items-center gap-3 px-3">
            {song.image ? (
              // eslint-disable-next-line @next/next/no-img-element -- remote cover art
              <img src={song.image} alt="" className="h-11 w-11 shrink-0 object-cover" />
            ) : (
              <Music2 size={22} className="shrink-0 text-faint" />
            )}
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{song.title}</div>
              <div className="truncate text-xs text-soft">{error ?? (blocked ? "Tap ▶ to start the music" : song.artists)}</div>
            </div>
            <span className="hidden font-mono text-[10.5px] text-faint sm:block">
              {fmt(time.at)} / {fmt(time.of)}
            </span>
            <button type="button" onClick={() => void previous()} aria-label="Previous song" className="p-1.5 text-soft hover:text-fg">
              <SkipBack size={18} />
            </button>
            <button
              type="button"
              onClick={toggle}
              aria-label={playing ? "Pause" : "Play"}
              className={cx("flex h-10 w-10 items-center justify-center rounded-full bg-core text-core-ink hover:bg-core/85", blocked && "animate-pulse")}
            >
              {loading ? <Loader2 size={18} className="animate-spin" /> : playing ? <Pause size={18} /> : <Play size={18} className="translate-x-px" />}
            </button>
            <button type="button" onClick={() => void next()} aria-label="Next song" className="p-1.5 text-soft hover:text-fg">
              <SkipForward size={18} />
            </button>
            <label className="hidden items-center gap-1 text-soft md:flex" title="Volume">
              <VolIcon size={16} />
              <input type="range" min={0} max={1} step={0.05} value={volume} onChange={(e) => setVolume(Number(e.target.value))} className="w-20" aria-label="Volume" />
            </label>
            <button type="button" onClick={() => setShowQueue(!showQueue)} aria-label="Queue" className={cx("p-1.5 hover:text-fg", showQueue ? "text-core" : "text-soft")}>
              <ListMusic size={18} />
            </button>
            <button
              type="button"
              onClick={() => {
                audio.current?.pause();
                setQueue([]);
                setShowQueue(false);
              }}
              aria-label="Close player"
              className="p-1.5 text-faint hover:text-fg"
            >
              <X size={16} />
            </button>
          </div>

          {showQueue && (
            <ol className="absolute bottom-full right-2 mb-2 max-h-[50vh] w-[min(22rem,calc(100vw-1rem))] overflow-y-auto border border-line bg-[#0b1016]/98 p-1 shadow-xl">
              {queue.map((s, i) => (
                <li key={`${s.id}-${i}`}>
                  <button
                    type="button"
                    onClick={() => void playAt(queue, i)}
                    className={cx("flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs hover:bg-raised", i === index && "bg-core/10 text-core")}
                  >
                    <span className="w-5 shrink-0 text-right font-mono text-faint">{i + 1}</span>
                    <span className="min-w-0 flex-1 truncate">
                      {s.title} <span className="text-soft">· {s.artists}</span>
                    </span>
                    <span className="font-mono text-faint">{fmt(s.duration)}</span>
                  </button>
                </li>
              ))}
            </ol>
          )}
        </section>
      )}
    </>
  );
}
