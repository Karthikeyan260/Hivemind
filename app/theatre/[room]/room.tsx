"use client";

import { ChevronLeft, Clapperboard, Copy, Film, HelpCircle, Mic, MicOff, Radio, RefreshCw, Search, Send, Users, X } from "lucide-react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import type { Movie } from "@/lib/theatre/catalog";
import { runtime } from "@/lib/theatre/format";
import { TheatreNet, type Playback } from "@/lib/theatre/net";
import { cleanText, isRoomCode, MAX_CHAT, MAX_NAME, REACTIONS } from "@/lib/theatre/protocol";
import { filePlayer, YtPlayer, type Player } from "@/lib/theatre/player";
import { SpeechListener, type SpeechLang, type SpeechState } from "@/lib/theatre/speech";
import { findTitle, parseRoomCommand } from "@/lib/theatre/voice-commands";

/**
 * Friends Theatre: one film, played in step for everyone who has the link, with chat, reactions and voice.
 * Open to anyone with the link (no password); it shows only the room, never any of the owner's data.
 * Browser to browser (WebRTC, see lib/theatre/net.ts). The film itself is streamed by each person straight
 * from Wikimedia Commons (public domain), so only the controls (play, pause, seek), chat and voice travel
 * between friends.
 */
export default function TheatreRoomPage({ initial, fallback }: { initial: Movie | null; fallback: Movie }) {
  const { room } = useParams<{ room: string }>();
  // The code is part of a public broker id: only plain, long-enough codes are accepted (a made-up link shows nothing).
  if (!isRoomCode(room)) {
    return (
      <div className="fixed inset-0 z-50 grid place-items-center bg-[#07070b] px-6 text-center text-white">
        <div>
          <p className="font-serif text-2xl">This link doesn&apos;t look right</p>
          <p className="mt-2 text-sm text-white/60">Ask your friend to send the invite again.</p>
        </div>
      </div>
    );
  }
  return (
    <Suspense>
      <Room initial={initial} fallback={fallback} />
    </Suspense>
  );
}

type Line = { id: number; who: string; text: string; me?: boolean; sys?: boolean };
type Float = { id: number; e: string; x: number };

/** Wall clock for the "ignore the player for a moment" guard (kept out of the render path). */
const clock = () => performance.now();


type Catalog = typeof import("@/lib/theatre/catalog");

function Room({ initial, fallback }: { initial: Movie | null; fallback: Movie }) {
  const { room } = useParams<{ room: string }>();
  const q = useSearchParams();
  const isHost = q.get("host") === "1";

  // The whole film catalogue is big (thousands of films), and a friend opening an invite only needs the one film named in
  // the link to see the join screen. The server hands that film over; the rest loads in the background while they type
  // their name, and joining waits for it (so the room can check every film a friend picks).
  const [cat, setCat] = useState<Catalog | null>(null);
  const catRef = useRef<Catalog | null>(null);
  const catReady = useRef<Promise<unknown> | null>(null);
  useEffect(() => {
    catReady.current = import("@/lib/theatre/catalog").then((c) => {
      catRef.current = c;
      setCat(c);
    });
  }, []);
  const base = initial ?? fallback;
  const MOVIES: Movie[] = useMemo(() => (cat ? cat.MOVIES : [base]), [cat, base]);
  /** Reads the latest catalogue when called, so callbacks made before it loaded still see it afterwards. */
  const movieById = (id: string | null | undefined): Movie | null => (catRef.current ? catRef.current.movieById(id) : id && initial && id === initial.id ? initial : null);
  const picked = movieById(q.get("m"));
  const first = picked ?? base;

  const [stage, setStage] = useState<"join" | "connecting" | "live" | "error">("join");
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [movieId, setMovieId] = useState(first.id);
  const [quality, setQuality] = useState("480p");
  const [people, setPeople] = useState<Record<string, string>>({});
  const [talking, setTalking] = useState(false);
  const [lines, setLines] = useState<Line[]>([]);
  const [floats, setFloats] = useState<Float[]>([]);
  const [text, setText] = useState("");
  const [picker, setPicker] = useState(false);
  const [filter, setFilter] = useState("");
  const [copied, setCopied] = useState(false);
  const [playError, setPlayError] = useState(false);
  const [ytBlocked, setYtBlocked] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [listen, setListen] = useState<SpeechState>("off");
  const [speechLang, setSpeechLang] = useState<SpeechLang>("en-IN");
  const [heard, setHeard] = useState<{ text: string; note: string } | null>(null);
  const [help, setHelp] = useState(false);
  const countTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const movie = movieById(movieId) ?? first;
  const src = movie.yt ? "" : (movie.qualities.find((x) => x.label === quality) ?? movie.qualities[movie.qualities.length - 2] ?? movie.qualities[0]).src;

  const player = useRef<Player | null>(null);
  const ytHost = useRef<HTMLDivElement | null>(null);
  const net = useRef<TheatreNet | null>(null);
  const quiet = useRef(0); // ignore the player's own events for a moment after we changed it for a friend
  const pending = useRef<{ time: number; play: boolean } | null>(null);
  const movieRef = useRef(first.id);
  const seq = useRef(1);
  const chatEnd = useRef<HTMLDivElement | null>(null);
  const stageEl = useRef<HTMLDivElement | null>(null);
  const speech = useRef<SpeechListener | null>(null);
  const voiceRun = useRef<(text: string) => void>(() => {});
  const heardTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const say = (who: string, t: string, system = false, me = false) => setLines((l) => [...l.slice(-199), { id: seq.current++, who, text: t, sys: system, me }]);

  /** Change the player for a friend's sake without echoing it back to everyone. */
  const remote = (fn: (p: Player) => void) => {
    const p = player.current;
    if (!p) return;
    quiet.current = clock() + 900;
    fn(p);
  };

  const pop = (e: string) => {
    const id = seq.current++;
    setFloats((f) => [...f.slice(-14), { id, e, x: 10 + Math.random() * 80 }]);
    setTimeout(() => setFloats((f) => f.filter((x) => x.id !== id)), 2600);
  };

  /** For films that can only play on YouTube itself: 5, 4, 3, 2, 1, then everyone presses play. */
  const startCount = () => {
    if (countTimer.current) clearInterval(countTimer.current);
    let n = 5;
    setCountdown(n);
    countTimer.current = setInterval(() => {
      n -= 1;
      setCountdown(n);
      if (n < -3 && countTimer.current) {
        clearInterval(countTimer.current);
        setCountdown(null);
      }
    }, 1000);
  };

  const applyPlayback = (m: Playback) => {
    if (m.movie !== movieRef.current && movieById(m.movie)) {
      pending.current = { time: m.time, play: m.playing };
      movieRef.current = m.movie;
      setMovieId(m.movie);
      return;
    }
    remote((p) => {
      if (Math.abs(p.time() - m.time) > 1.2) p.seek(m.time);
      if (m.playing && p.paused()) p.play();
      if (!m.playing && !p.paused()) p.pause();
    });
  };

  // Start: join the room (needs a tap, so the browser lets the film play with sound).
  async function enter() {
    const nm = cleanText(name, MAX_NAME) || (isHost ? "Host" : "Friend");
    try {
      localStorage.setItem("hm-theatre-name", nm);
    } catch {}
    setStage("connecting");
    setError("");
    // The room checks every film a friend picks against the catalogue, so wait until it has loaded (usually already has).
    try {
      await catReady.current;
    } catch {
      setError("Couldn't load the film list. Check your connection and try again.");
      setStage("error");
      return;
    }
    const n = new TheatreNet(room, nm, {
      people: setPeople,
      line: (who, t, system) => say(who, t, system),
      react: pop,
      count: (who) => {
        say("", `${who} started the countdown`, true);
        startCount();
      },
      movie: (id) => {
        if (!movieById(id)) return;
        pending.current = { time: 0, play: false };
        movieRef.current = id;
        setMovieId(id);
      },
      playback: applyPlayback,
      play: (t) =>
        remote((p) => {
          if (Math.abs(p.time() - t) > 0.7) p.seek(t);
          p.play();
        }),
      pause: (t) =>
        remote((p) => {
          p.pause();
          p.seek(t);
        }),
      seek: (t) =>
        remote((p) => {
          p.seek(t);
        }),
      here: () => ({ movie: movieRef.current, time: player.current?.time() ?? 0, playing: !!player.current && !player.current.paused() }),
      live: () => setStage("live"),
      fail: (message) => {
        setError(message);
        setStage("error");
      },
    }, (id) => !!movieById(id));
    net.current = n;
    await n.start();
  }

  useEffect(() => {
    const l = new SpeechListener((t) => voiceRun.current(t), setListen);
    speech.current = l;
    return () => {
      l.destroy();
      if (heardTimer.current) clearTimeout(heardTimer.current);
    };
  }, []);
  useEffect(() => {
    // Closing the tab or going back must tell the room right away (otherwise friends only notice when the connection times out).
    const bye = () => net.current?.destroy();
    // A page restored from the back/forward cache has lost its connections: start over.
    const back = (e: PageTransitionEvent) => {
      if (e.persisted) window.location.reload();
    };
    window.addEventListener("pagehide", bye);
    window.addEventListener("pageshow", back);
    return () => {
      window.removeEventListener("pagehide", bye);
      window.removeEventListener("pageshow", back);
      net.current?.destroy();
      if (countTimer.current) clearInterval(countTimer.current);
    };
  }, []);
  useEffect(() => {
    try {
      const n = localStorage.getItem("hm-theatre-name");
      // eslint-disable-next-line react-hooks/set-state-in-effect -- remembered name, read once after mount
      if (n) setName(n);
    } catch {}
  }, []);
  useEffect(() => {
    chatEnd.current?.scrollIntoView({ block: "end" });
  }, [lines]);

  // The player's own buttons tell everyone else.
  const onPlay = () => {
    setPlayError(false);
    if (clock() < quiet.current) return;
    net.current?.send({ t: "play", time: player.current?.time() ?? 0 });
  };
  const onPause = () => {
    if (clock() < quiet.current) return;
    net.current?.send({ t: "pause", time: player.current?.time() ?? 0 });
  };
  const onSeeked = () => {
    if (clock() < quiet.current) return;
    net.current?.send({ t: "seek", time: player.current?.time() ?? 0 });
  };
  /** The player is ready: go where a friend, a quality change or a new film said to. */
  const onMeta = () => {
    const p = pending.current;
    if (!p) return;
    pending.current = null;
    remote((pl) => {
      pl.seek(p.time);
      if (p.play) pl.play();
    });
  };

  // A YouTube film plays in YouTube's own player (the channel's ads and rules apply).
  const ytId = movie.embed ? movie.yt : null;
  useEffect(() => {
    if (!ytId || stage !== "live") return;
    const host = ytHost.current;
    if (!host) return;
    host.replaceChildren();
    setYtBlocked(false);
    const yp = new YtPlayer(host, ytId, {
      onReady: onMeta,
      onPlay,
      onPause,
      onSeek: onSeeked,
      onError: () => setYtBlocked(true),
    });
    player.current = yp;
    return () => {
      yp.destroy();
      if (player.current === yp) player.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the handlers only use refs and state setters
  }, [ytId, stage]);

  function pickMovie(m: Movie) {
    pending.current = { time: 0, play: false };
    movieRef.current = m.id;
    setMovieId(m.id);
    setPicker(false);
    net.current?.send({ t: "movie", id: m.id });
    say("", `You picked ${m.title}`, true);
  }
  function changeQuality(l: string) {
    const p = player.current;
    pending.current = { time: p?.time() ?? 0, play: !!p && !p.paused() };
    setQuality(l);
  }
  function chat(e: React.FormEvent) {
    e.preventDefault();
    const t = cleanText(text, MAX_CHAT);
    if (!t) return;
    setText("");
    say("You", t, false, true);
    net.current?.send({ t: "chat", text: t });
  }
  function react(e: string) {
    pop(e);
    net.current?.send({ t: "react", e });
  }
  async function toggleVoice() {
    const was = net.current?.talking ?? false;
    const on = await (net.current?.toggleVoice() ?? Promise.resolve(false));
    setTalking(on);
    say("", on ? "Voice is on. Use headphones so your friends don't hear the film twice." : was ? "Voice is off." : "Microphone permission is needed to talk.", true);
  }
  /** Hands-free control: what was said becomes a command (see lib/theatre/voice-commands.ts). */
  function runVoice(text: string) {
    const c = parseRoomCommand(text);
    let note = "I didn't catch a command";
    const p = player.current;
    const go = (n: string) => (note = n);
    if (c) {
      switch (c.t) {
        case "play":
          if (p) {
            p.play();
            go("Playing");
          } else go("Nothing to play yet");
          break;
        case "pause":
          p?.pause();
          go("Paused");
          break;
        case "seek":
          if (p) {
            const to = Math.max(0, p.time() + c.by);
            p.seek(to);
            net.current?.send({ t: "seek", time: to }); // tell friends now, not when the new bit has finished loading
            go(`${c.by > 0 ? "Forward" : "Back"} ${Math.abs(c.by)} s`);
          }
          break;
        case "seekTo":
          if (p) {
            p.seek(c.to);
            net.current?.send({ t: "seek", time: c.to });
            go(`Jumped to ${Math.floor(c.to / 60)} min`);
          }
          break;
        case "volume":
          if (p) {
            p.setVolume(p.volume() + c.by / 100);
            go(`Volume ${Math.round(p.volume() * 100)}%`);
          }
          break;
        case "volumeSet":
          if (p) {
            p.setVolume(c.to / 100);
            go(`Volume ${c.to}%`);
          }
          break;
        case "mute":
          p?.setMuted(c.on);
          go(c.on ? "Muted" : "Sound on");
          break;
        case "fullscreen":
          if (c.on) void stageEl.current?.requestFullscreen?.().catch(() => {});
          else if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
          go(c.on ? "Full screen" : "Left full screen");
          break;
        case "next":
        case "prev": {
          const eps = movie.series ? MOVIES.filter((x) => x.series === movie.series).sort((a, b) => (a.ep ?? 0) - (b.ep ?? 0)) : [];
          const sib = eps[eps.findIndex((x) => x.id === movie.id) + (c.t === "next" ? 1 : -1)];
          if (sib) {
            pickMovie(sib);
            go(`${c.t === "next" ? "Next" : "Previous"}: ${sib.title}`);
          } else go(c.t === "next" ? "No next episode" : "No previous episode");
          break;
        }
        case "catchUp":
          net.current?.send({ t: "ask" });
          go("Catching up with your friends");
          break;
        case "invite":
          void copyLink();
          go("Invite link copied");
          break;
        case "mic":
          if (c.on !== (net.current?.talking ?? false)) void toggleVoice();
          go(c.on ? "Talking to friends: on" : "Talking to friends: off");
          break;
        case "chat": {
          const t = cleanText(c.text, MAX_CHAT);
          if (t) {
            say("You", t, false, true);
            net.current?.send({ t: "chat", text: t });
            go("Sent to the chat");
          }
          break;
        }
        case "react":
          react(c.e);
          go(`Reacted ${c.e}`);
          break;
        case "pick": {
          const m = findTitle(c.query, MOVIES);
          if (m) {
            pickMovie(m);
            go(`Switching to ${m.title}`);
          } else go(`No film called “${c.query}”`);
          break;
        }
        case "quality": {
          const q = movie.qualities.find((x) => x.label === c.label);
          if (!movie.yt && q) {
            changeQuality(q.label);
            go(`Quality ${q.label}`);
          } else go("That quality isn't available here");
          break;
        }
        case "leave":
          go("Leaving");
          window.location.assign(isHost ? "/theatre" : "/");
          break;
        case "help":
          setHelp(true);
          go("Here are some things to say");
          break;
      }
    }
    setHeard({ text, note });
    if (heardTimer.current) clearTimeout(heardTimer.current);
    heardTimer.current = setTimeout(() => setHeard(null), 4000);
  }

  function toggleListen() {
    if (listen === "listening") speech.current?.stop();
    else speech.current?.start(speechLang);
  }
  function switchLang() {
    const next: SpeechLang = speechLang === "en-IN" ? "ta-IN" : "en-IN";
    setSpeechLang(next);
    if (listen === "listening") speech.current?.start(next);
  }

  useEffect(() => {
    voiceRun.current = runVoice;
  });

  async function copyLink() {
    const url = `${location.origin}/theatre/${room}?m=${movieRef.current}`;
    try {
      if (navigator.share && /Mobi|Android/i.test(navigator.userAgent)) await navigator.share({ title: "Friends Theatre", text: `Watch ${movie.title} with me`, url });
      else {
        await navigator.clipboard.writeText(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      }
    } catch {}
  }

  // With nothing typed: one entry per film or series (not every episode), so the list stays short; search finds any episode.
  const list = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (q) return MOVIES.filter((m) => `${m.title} ${m.series ?? ""}`.toLowerCase().includes(q)).slice(0, 150);
    const seen = new Set<string>();
    // (The first 200: with thousands of films, the rest are found by searching.)
    return MOVIES.filter((m) => {
      if (!m.series) return true;
      if (seen.has(m.series)) return false;
      seen.add(m.series);
      return true;
    }).slice(0, 200);
  }, [filter, MOVIES]);
  const names = Object.values(people);

  if (stage === "join" || stage === "error") {
    return (
      <div className="fixed inset-0 z-50 overflow-y-auto bg-[#07070b] text-white">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={first.poster} alt="" className="absolute inset-0 size-full object-cover opacity-25 blur-sm" />
        <div className="absolute inset-0 bg-gradient-to-t from-[#07070b] via-[#07070b]/70 to-[#07070b]/40" />
        <div className="relative mx-auto flex min-h-full max-w-md flex-col justify-center px-5 py-10">
          <p className="flex items-center gap-2 font-mono text-[11px] tracking-[0.3em] text-rose-300/90 uppercase">
            <Clapperboard size={14} /> Friends Theatre
          </p>
          <h1 className="mt-3 font-serif text-4xl leading-tight">{isHost ? "Your room" : "You're invited"}</h1>
          <p className="mt-2 text-white/70">
            {picked ? (
              <>
                {picked.title}
                {picked.year ? ` (${picked.year})` : ""} · {runtime(picked.minutes)} · Tamil
              </>
            ) : (
              "Watch together. Pick a film once you are in."
            )}
          </p>
          <label className="mt-7 block text-sm text-white/70" htmlFor="nm">
            Your name
          </label>
          <input
            id="nm"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void enter()}
            placeholder={isHost ? "Host" : "What should your friends call you?"}
            maxLength={24}
            className="mt-1.5 h-12 rounded-xl border border-white/15 bg-white/8 px-4 text-base outline-none placeholder:text-white/35 focus:border-rose-300/70"
          />
          <button onClick={() => void enter()} className="mt-4 flex h-12 items-center justify-center gap-2 rounded-xl bg-rose-500 font-medium text-white hover:bg-rose-400 focus-visible:outline-2 focus-visible:outline-rose-200">
            <Film size={18} /> {isHost ? "Open the room" : "Join the screening"}
          </button>
          {error && <p className="mt-3 text-sm text-rose-300">{error}</p>}
          <p className="mt-6 text-xs leading-relaxed text-white/45">Everyone plays the film in step. You can chat and talk to each other. The film is played straight from its source (the studio&apos;s YouTube channel, or Wikimedia Commons for public-domain classics).</p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#07070b] text-white">
      <header className="flex shrink-0 items-center gap-2 border-b border-white/10 px-3 py-2.5 sm:px-5">
        <Link href={isHost ? "/theatre" : "/"} aria-label="Leave" className="grid size-9 shrink-0 place-items-center rounded-full text-white/80 hover:bg-white/10">
          <ChevronLeft size={20} />
        </Link>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">
            {movie.title}
            {movie.year ? <span className="text-white/50"> · {movie.year}</span> : null}
          </p>
          <p className="flex items-center gap-1.5 truncate text-[11px] text-white/50">
            <Users size={11} className="shrink-0" /> {names.length ? `You, ${names.join(", ")}` : "Just you so far"}
          </p>
        </div>
        <button onClick={toggleListen} aria-pressed={listen === "listening"} title="Control the film with your voice (English or Tamil)" className={`flex h-9 items-center gap-1.5 rounded-full border px-3 text-xs ${listen === "listening" ? "border-rose-300/60 bg-rose-400/15 text-rose-200" : "border-white/15 text-white/80 hover:bg-white/10"}`}>
          <Radio size={14} className={listen === "listening" ? "animate-pulse" : ""} />
          <span className="hidden sm:inline">{listen === "listening" ? "Listening" : "Commands"}</span>
        </button>
        <button onClick={() => void toggleVoice()} aria-pressed={talking} className={`flex h-9 items-center gap-1.5 rounded-full border px-3 text-xs ${talking ? "border-emerald-300/60 bg-emerald-400/15 text-emerald-200" : "border-white/15 text-white/80 hover:bg-white/10"}`}>
          {talking ? <Mic size={14} /> : <MicOff size={14} />}
          {talking ? "Voice on" : "Voice"}
        </button>
        <button onClick={() => void copyLink()} className="flex h-9 items-center gap-1.5 rounded-full bg-rose-500 px-3.5 text-xs font-medium hover:bg-rose-400">
          <Copy size={13} /> {copied ? "Copied!" : "Invite"}
        </button>
      </header>

      <div className="grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)] lg:grid-cols-[minmax(0,1fr)_340px] lg:grid-rows-1">
        <div className="relative min-h-0 overflow-y-auto p-3 sm:p-5">
          <div ref={stageEl} className="relative overflow-hidden rounded-xl bg-black shadow-2xl ring-1 ring-white/10">
            {movie.yt && !movie.embed ? (
              <div className="relative grid aspect-video w-full place-items-center overflow-hidden bg-black">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={movie.poster} alt="" className="absolute inset-0 size-full scale-110 object-cover opacity-30 blur-md" />
                <div className="relative max-w-md px-5 text-center">
                  {countdown !== null ? (
                    <p className="font-serif text-7xl tabular-nums">{countdown > 0 ? countdown : "Play!"}</p>
                  ) : (
                    <>
                      <p className="font-serif text-xl sm:text-2xl">{movie.title}</p>
                      <p className="mt-2 text-sm leading-relaxed text-white/65">{movie.channel} only lets this film play on YouTube itself. Everyone opens it, then press Start together and play on zero.</p>
                    </>
                  )}
                  <div className="mt-4 flex flex-wrap justify-center gap-2">
                    <a href={`https://www.youtube.com/watch?v=${movie.yt}`} target="_blank" rel="noreferrer" className="flex h-10 items-center gap-2 rounded-lg bg-white px-4 text-sm font-medium text-black hover:bg-white/85">
                      Open on YouTube
                    </a>
                    <button
                      onClick={() => {
                        net.current?.send({ t: "count" });
                        startCount();
                      }}
                      className="flex h-10 items-center gap-2 rounded-lg bg-rose-500 px-4 text-sm font-medium hover:bg-rose-400"
                    >
                      Start together
                    </button>
                  </div>
                </div>
              </div>
            ) : movie.yt ? (
              <div ref={ytHost} className="aspect-video w-full bg-black [&_iframe]:size-full" />
            ) : (
              <video
                ref={(el) => {
                  if (!el) return;
                  const pl = filePlayer(el);
                  player.current = pl;
                  return () => {
                    if (player.current === pl) player.current = null;
                  };
                }}
                key={src}
                src={src}
                poster={movie.poster}
                controls
                playsInline
                preload="metadata"
                onPlay={onPlay}
                onPause={onPause}
                onSeeked={onSeeked}
                onLoadedMetadata={onMeta}
                onError={() => setPlayError(true)}
                className="aspect-video w-full bg-black"
              />
            )}
            {heard && (
              <div role="status" className="pointer-events-none absolute bottom-3 left-3 z-10 max-w-[80%] rounded-lg bg-black/75 px-3 py-2 text-xs backdrop-blur">
                <span className="text-white/55">Heard: “{heard.text}”</span>
                <span className="mt-0.5 block font-medium text-white">{heard.note}</span>
              </div>
            )}
            <div className="pointer-events-none absolute inset-0 overflow-hidden">
              {floats.map((f) => (
                <span key={f.id} className="theatre-float absolute bottom-10 text-4xl" style={{ left: `${f.x}%` }}>
                  {f.e}
                </span>
              ))}
            </div>
          </div>
          {listen === "denied" && <p className="mt-2 text-sm text-amber-300">The browser blocked the microphone. Allow it in the address bar to use voice commands.</p>}
          {listen === "unsupported" && <p className="mt-2 text-sm text-amber-300">This browser can&apos;t listen for voice commands. Try Chrome, Edge or Safari.</p>}
          {help && (
            <div className="mt-2 rounded-xl border border-white/10 bg-white/5 p-3 text-xs leading-relaxed text-white/75">
              <p className="mb-1 font-medium text-white">Say, in English or தமிழ்:</p>
              <p>“play” · “pause” (நிறுத்து) · “forward” · “back 30 seconds” · “go to 45 minutes” · “restart”</p>
              <p>“volume up” · “volume down” · “volume 40” · “mute” · “unmute” · “full screen”</p>
              <p>“next episode” · “previous” · “play Mayabazar” · “catch up” · “invite”</p>
              <p>“say that was great” (sends it to the chat) · “laugh” · “clap” · “heart” · “wow”</p>
              <p>“mic on” / “mic off” (talk to your friends)</p>
            </div>
          )}
          {playError && !movie.yt && <p className="mt-2 text-sm text-amber-300">The film didn&apos;t start. Press play on the player. If it still won&apos;t play, try Chrome or lower the quality below.</p>}
          {ytBlocked && (
            <p className="mt-2 text-sm text-amber-300">
              YouTube won&apos;t play this one here (the channel may not allow it outside YouTube, or it isn&apos;t available in your country).{" "}
              <a href={`https://www.youtube.com/watch?v=${movie.yt}`} target="_blank" rel="noreferrer" className="underline">
                Open it on YouTube
              </a>{" "}
              or pick another film.
            </p>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
            <button onClick={() => setPicker(true)} className="flex h-9 items-center gap-1.5 rounded-full border border-white/15 px-3.5 hover:bg-white/10">
              <Film size={14} /> Change film
            </button>
            {listen !== "off" && (
              <>
                <button onClick={switchLang} className="flex h-9 items-center gap-1.5 rounded-full border border-rose-300/40 px-3.5 text-rose-200 hover:bg-white/10" title="Switch the language you speak">
                  {speechLang === "en-IN" ? "English" : "தமிழ்"}
                </button>
                <button onClick={() => setHelp((h) => !h)} className="flex h-9 items-center gap-1.5 rounded-full border border-white/15 px-3 hover:bg-white/10">
                  <HelpCircle size={14} /> What can I say?
                </button>
              </>
            )}
            <button onClick={() => net.current?.send({ t: "ask" })} className="flex h-9 items-center gap-1.5 rounded-full border border-white/15 px-3.5 hover:bg-white/10" title="Jump to where your friends are">
              <RefreshCw size={13} /> Catch up
            </button>
            <label className={`ml-auto flex items-center gap-2 text-white/60 ${movie.yt ? "hidden" : ""}`}>
              Quality
              <select value={quality} onChange={(e) => changeQuality(e.target.value)} className="h-9 rounded-full border border-white/15 bg-[#12121a] px-3 text-white">
                {movie.qualities.map((x) => (
                  <option key={x.label} value={x.label}>
                    {x.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="mt-4 text-xs leading-relaxed text-white/40">
            {movie.about ? `${movie.about} ` : ""}
            {movie.yt ? (
              <>
                Plays from the{" "}
                <a href={`https://www.youtube.com/watch?v=${movie.yt}`} target="_blank" rel="noreferrer" className="underline">
                  {movie.channel ?? "official"} YouTube channel
                </a>
                ; its ads may show.
              </>
            ) : (
              <>
                Public domain on{" "}
                <a href={movie.page} target="_blank" rel="noreferrer" className="underline">
                  Wikimedia Commons
                </a>
                .
              </>
            )}
          </p>
        </div>

        <aside className="flex min-h-0 flex-col border-t border-white/10 bg-[#0c0c13] lg:border-t-0 lg:border-l">
          <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-3 py-3 text-sm">
            {lines.map((l) =>
              l.sys ? (
                <p key={l.id} className="py-0.5 text-center text-[11px] text-white/40">
                  {l.text}
                </p>
              ) : (
                <p key={l.id} className={l.me ? "text-right" : ""}>
                  <span className="mr-1.5 text-[11px] font-medium text-rose-300/90">{l.who}</span>
                  <span className={`inline-block max-w-[85%] rounded-2xl px-3 py-1.5 text-left ${l.me ? "bg-rose-500/90" : "bg-white/10"}`}>{l.text}</span>
                </p>
              ),
            )}
            <div ref={chatEnd} />
          </div>
          <div className="flex justify-between gap-1 border-t border-white/10 px-3 py-2">
            {REACTIONS.map((e) => (
              <button key={e} onClick={() => react(e)} className="grid size-9 place-items-center rounded-full text-xl hover:bg-white/10 active:scale-90" aria-label={`React ${e}`}>
                {e}
              </button>
            ))}
          </div>
          <form onSubmit={chat} className="flex gap-2 border-t border-white/10 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Say something…" maxLength={400} className="h-10 min-w-0 flex-1 rounded-full border border-white/15 bg-white/8 px-4 text-sm outline-none placeholder:text-white/35 focus:border-rose-300/70" />
            <button aria-label="Send" className="grid size-10 shrink-0 place-items-center rounded-full bg-rose-500 hover:bg-rose-400">
              <Send size={16} />
            </button>
          </form>
        </aside>
      </div>

      {picker && (
        <div className="absolute inset-0 z-10 flex flex-col bg-[#07070b]/95 backdrop-blur-sm" role="dialog" aria-label="Choose a film">
          <div className="flex items-center gap-2 border-b border-white/10 p-3">
            <Search size={16} className="text-white/50" />
            <input autoFocus value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search films" className="h-9 flex-1 bg-transparent text-base outline-none placeholder:text-white/35" />
            <button onClick={() => setPicker(false)} aria-label="Close" className="grid size-9 place-items-center rounded-full hover:bg-white/10">
              <X size={18} />
            </button>
          </div>
          <div className="grid flex-1 grid-cols-2 content-start gap-3 overflow-y-auto p-3 sm:grid-cols-3 lg:grid-cols-5">
            {list.map((m) => (
              <button key={m.id} onClick={() => pickMovie(m)} className="group text-left">
                <div className="relative aspect-video overflow-hidden rounded-lg bg-white/5 ring-1 ring-white/10 group-hover:ring-rose-300/60">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={m.poster} alt="" loading="lazy" className="size-full object-cover" />
                </div>
                <p className="mt-1.5 truncate text-sm">{m.title}</p>
                <p className="text-[11px] text-white/45">
                  {m.year ?? "Classic"} · {runtime(m.minutes)}
                </p>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
