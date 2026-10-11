"use client";

import type { DataConnection, MediaConnection, Peer } from "peerjs";
import { Bot, Copy, Eraser, Mic, MicOff, RotateCcw, Send, Trash2, Trophy } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { cx } from "@/components/ui";
import { checkHost, proveHost } from "@/lib/peer-auth";

/**
 * Draw & Guess for two people plus HIVEMIND. One person draws a word, the other guesses by typing;
 * HIVEMIND watches the same drawing and guesses too (it only ever sees the picture). Browser to
 * browser like HIVEMIND calls (PeerJS), with voice on so you can laugh at each other's drawings.
 * The owner's side (host) runs the game: words, timer, scores, and HIVEMIND's guesses.
 *
 * Phones drop the connection when you switch apps (sharing the link on WhatsApp, a quick look at
 * another tab) and sometimes reload the page. So each side keeps its game in this tab
 * (sessionStorage), both sides reconnect on their own, the clock pauses while you're apart, and
 * the host sends the whole game back to the friend when they meet again.
 */
const WORDS = [
  "idli", "dosa", "filter coffee", "auto rickshaw", "kolam", "banana leaf", "coconut tree", "temple", "beach", "umbrella",
  "cricket bat", "kite", "bicycle", "elephant", "mango", "fish", "sun", "house", "train", "bus", "laptop", "guitar", "moon",
  "rain", "flower", "cat", "dog", "cow", "parrot", "chair", "clock", "spectacles", "shoe", "mobile phone", "book", "rainbow",
  "tea cup", "rocket", "aeroplane", "boat", "mountain", "tree", "ceiling fan", "bulb", "key", "heart", "jasmine", "drum",
  "lamp", "pot", "snake", "butterfly", "star", "bridge", "football", "cake", "ice cream", "ladder", "tiger", "peacock",
];
const ROUNDS = 6;
const ROUND_S = 80;
const AI_EVERY_MS = 6500;
const COLORS = ["#111111", "#e5484d", "#2f7fe8", "#2fa34a", "#f59e0b", "#8b5cf6"];
/** How long to keep trying to get back together before calling it. */
const GIVE_UP_MS = 3 * 60_000;
/** A saved game older than this is stale (a new visit starts fresh). */
const SAVED_FOR_MS = 45 * 60_000;

type Who = "host" | "guest";
type Stage = "connecting" | "waiting" | "lobby" | "playing" | "reconnecting" | "over" | "error";
type Stroke = { pts: [number, number][]; color: string; w: number };
type Round = { n: number; drawer: Who; word?: string; len: string; ends: number };
type Line = { who: string; text: string; kind: "guess" | "ok" | "ai" | "info" };
type Scores = { host: number; guest: number; ai: number };
type Msg =
  | { t: "hello"; name: string; id?: string }
  | { t: "round"; n: number; drawer: Who; word?: string; len: string; ms: number }
  | { t: "stroke"; s: Stroke }
  | { t: "clear" }
  | { t: "guess"; text: string }
  | { t: "feed"; line: Line }
  | { t: "scores"; scores: Scores }
  | { t: "reveal"; word: string }
  | { t: "over"; scores: Scores }
  // Host → friend after (re)connecting: the whole game, so a dropped connection or reload resumes.
  | { t: "sync"; stage: "lobby" | "playing" | "over"; round: (Omit<Round, "ends"> & { ms: number }) | null; scores: Scores; feed: Line[]; strokes: Stroke[] }
  // The guest checks the host is the owner's real browser before anything else (see lib/peer-auth).
  | { t: "challenge"; nonce: string }
  | { t: "proof"; proof: string };
type Game = { n: number; word: string; drawer: Who; ends: number; guessed: boolean; aiGot: boolean; aiTried: string[]; used: Set<string>; dirty: boolean; scores: Scores };
type Saved = { at: number; stage: Stage; other: string; guestId?: string; round: Round | null; scores: Scores; feed: Line[]; strokes: Stroke[]; game?: Omit<Game, "used" | "dirty"> & { used: string[] } };

const norm = (s: string) => s.toLowerCase().replace(/[^a-z ]/g, "").replace(/\s+/g, " ").trim().replace(/s$/, "");
const blanks = (w: string) => w.replace(/[a-z]/gi, "_ ").trim();
const clip = (v: unknown, n: number) => String(v ?? "").slice(0, n);
const cleanName = (v: unknown) => clip(v, 20).replace(/[^\p{L}\p{N} .'-]/gu, "").trim();
const NO_SCORES: Scores = { host: 0, guest: 0, ai: 0 };
/** A stroke from the other player: real points in the canvas, a known colour, a sane size. */
const okStroke = (st: unknown): st is Stroke => {
  const x = st as Stroke;
  return (
    !!x &&
    Array.isArray(x.pts) &&
    x.pts.length > 0 &&
    x.pts.length <= 2000 &&
    x.pts.every((p) => Array.isArray(p) && p.length === 2 && p.every((n) => typeof n === "number" && n >= 0 && n <= 1)) &&
    [...COLORS, "#ffffff"].includes(x.color) &&
    (x.w === 6 || x.w === 26)
  );
};
const okLine = (l: unknown): l is Line => !!l && typeof (l as Line).text === "string" && ["guess", "ok", "ai", "info"].includes((l as Line).kind);
const okScores = (s: unknown): s is Scores => !!s && ["host", "guest", "ai"].every((k) => Number.isFinite((s as Record<string, number>)[k]));

function loadSaved(key: string): Saved | null {
  try {
    const s = JSON.parse(sessionStorage.getItem(key) ?? "null") as Saved | null;
    return s && Date.now() - s.at < SAVED_FOR_MS ? s : null;
  } catch {
    return null;
  }
}

export function DrawGame({ role, room, myName, hostName = "Host", onHostAway }: { role: Who; room: string; myName: string; hostName?: string; /** Guest: the host isn't in the game yet (called once). */ onHostAway?: () => void }) {
  const KEY = `hm-draw-${role}-${room}`;
  // This tab's saved game, read once (the component only ever renders in the browser).
  const [saved] = useState(() => loadSaved(KEY));
  const wasIn = saved && (saved.stage === "playing" || saved.stage === "lobby" || saved.stage === "reconnecting") ? saved : null;
  const [stage, setStage] = useState<Stage>(saved?.stage === "over" ? "over" : wasIn ? "reconnecting" : "connecting");
  const [err, setErr] = useState("");
  const [other, setOther] = useState(saved?.other || (role === "guest" ? hostName : ""));
  const [round, setRound] = useState<Round | null>(saved?.round ?? null);
  const [left, setLeft] = useState(ROUND_S);
  const [feed, setFeed] = useState<Line[]>(saved?.feed ?? []);
  const [scores, setScores] = useState<Scores>(saved?.scores ?? NO_SCORES);
  const [guess, setGuess] = useState("");
  const [color, setColor] = useState(COLORS[0]);
  const [muted, setMuted] = useState(false);
  const [voiceOn, setVoiceOn] = useState(false);
  // No microphone (blocked or none): playing still works, talking doesn't.
  const [noMic, setNoMic] = useState(false);
  const [listening, setListening] = useState(false);
  const [aiTalks, setAiTalks] = useState(true);
  const aiTalksRef = useRef(true);
  const [copied, setCopied] = useState(false);
  const [knocked, setKnocked] = useState(false);
  const awayRef = useRef(onHostAway);

  const canvas = useRef<HTMLCanvasElement | null>(null);
  const strokes = useRef<Stroke[]>(saved?.strokes ?? []);
  const peer = useRef<Peer | null>(null);
  const conn = useRef<DataConnection | null>(null);
  const call = useRef<MediaConnection | null>(null);
  const mic = useRef<MediaStream | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  // Guest: the host proved it's the owner on this connection; until then nothing is sent or played.
  const verified = useRef(false);
  const nonce = useRef("");
  const roundTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const giveUp = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Where to go back to once reconnected, and when the connection dropped (the clock pauses).
  const resumeTo = useRef<"lobby" | "playing" | null>(wasIn ? (wasIn.stage === "lobby" ? "lobby" : "playing") : null);
  const pausedAt = useRef<number | null>(wasIn ? saved!.at : null);
  // Host: which friend is in the game (a reconnect from the same browser takes their seat back).
  const guestId = useRef(saved?.guestId ?? "");
  // Guest: this browser's id, so the host knows it's the same friend coming back.
  const myId = useRef("");
  // Host-only game state.
  const game = useRef<Game>(
    saved?.game ? { ...saved.game, used: new Set(saved.game.used), dirty: false } : { n: 0, word: "", drawer: "host", ends: 0, guessed: false, aiGot: false, aiTried: [], used: new Set(), dirty: false, scores: { ...NO_SCORES } },
  );
  const stageRef = useRef(stage);
  useEffect(() => {
    stageRef.current = stage;
  }, [stage]);

  const me: Who = role;
  const drawing = round?.drawer === me && stage === "playing";
  const nameOf = (w: Who) => (w === role ? myName : other || (w === "host" ? hostName : "Guest"));

  const send = useCallback((m: Msg) => {
    if (conn.current?.open) conn.current.send(m);
  }, []);

  /* ───── this tab's copy of the game ───── */
  const latest = useRef({ stage, other, round, scores, feed });
  useEffect(() => {
    latest.current = { stage, other, round, scores, feed };
  }, [stage, other, round, scores, feed]);
  const leaving = useRef(false);
  const save = useCallback(() => {
    if (leaving.current) return;
    const l = latest.current;
    const g = game.current;
    const s: Saved = {
      at: Date.now(),
      stage: l.stage === "reconnecting" && resumeTo.current ? resumeTo.current : l.stage,
      other: l.other,
      guestId: guestId.current || undefined,
      round: l.round,
      scores: l.scores,
      feed: l.feed.slice(-30),
      strokes: strokes.current,
      ...(role === "host" ? { game: { n: g.n, word: g.word, drawer: g.drawer, ends: g.ends, guessed: g.guessed, aiGot: g.aiGot, aiTried: g.aiTried, used: [...g.used], scores: g.scores } } : {}),
    };
    if (s.stage === "error" || s.stage === "connecting" || s.stage === "waiting") return;
    try {
      sessionStorage.setItem(KEY, JSON.stringify(s));
    } catch {}
  }, [KEY, role]);
  useEffect(() => {
    save();
  }, [save, stage, other, round, scores, feed]);
  useEffect(() => {
    // Strokes change too often for state: save them every couple of seconds, and on leaving the tab.
    const t = setInterval(save, 2000);
    const hide = () => document.hidden && save();
    document.addEventListener("visibilitychange", hide);
    window.addEventListener("pagehide", save);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", hide);
      window.removeEventListener("pagehide", save);
    };
  }, [save]);

  /* ───── canvas ───── */
  const redraw = useCallback(() => {
    const c = canvas.current;
    if (!c) return;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const s of strokes.current) {
      ctx.strokeStyle = s.color;
      ctx.lineWidth = s.w * (c.width / 600);
      ctx.beginPath();
      s.pts.forEach(([x, y], i) => (i ? ctx.lineTo(x * c.width, y * c.height) : ctx.moveTo(x * c.width, y * c.height)));
      if (s.pts.length === 1) ctx.lineTo(s.pts[0][0] * c.width + 0.1, s.pts[0][1] * c.height);
      ctx.stroke();
    }
  }, []);
  const clearCanvas = useCallback(() => {
    strokes.current = [];
    redraw();
  }, [redraw]);

  useEffect(() => {
    redraw();
  }, [redraw, stage]);

  const live = useRef<Stroke | null>(null);
  const sentPts = useRef(0);
  const flush = useRef<ReturnType<typeof setInterval> | null>(null);
  function point(e: React.PointerEvent): [number, number] {
    const r = canvas.current!.getBoundingClientRect();
    return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))];
  }
  function down(e: React.PointerEvent) {
    // One finger draws; a second touch mid-stroke is ignored.
    if (!drawing || live.current || !e.isPrimary) return;
    canvas.current!.setPointerCapture(e.pointerId);
    live.current = { pts: [point(e)], color, w: color === "#ffffff" ? 26 : 6 };
    strokes.current.push(live.current);
    redraw();
    // Send the stroke in pieces while drawing, so the other side sees it appear.
    sentPts.current = 0;
    flush.current = setInterval(sendNew, 60);
  }
  // The points not sent yet, overlapping one so the pieces join up on the other side.
  function sendNew() {
    const s = live.current;
    if (!s || s.pts.length <= sentPts.current) return;
    send({ t: "stroke", s: { ...s, pts: s.pts.slice(Math.max(0, sentPts.current - 1)) } });
    sentPts.current = s.pts.length;
  }
  function move(e: React.PointerEvent) {
    if (!live.current) return;
    live.current.pts.push(point(e));
    redraw();
  }
  function up() {
    if (!live.current) return;
    if (flush.current) clearInterval(flush.current);
    sendNew();
    live.current = null;
    game.current.dirty = true;
  }

  /* ───── messages ───── */
  const say = useCallback((line: Line) => {
    setFeed((f) => [...f.slice(-30), line]);
    // HIVEMIND says its guesses out loud, like a third player at the table.
    if (line.kind === "ai" && aiTalksRef.current && "speechSynthesis" in window) {
      const u = new SpeechSynthesisUtterance(line.text.endsWith("?") ? `Is it... ${line.text}` : "I got it!");
      u.lang = "en-IN";
      u.rate = 1.05;
      speechSynthesis.speak(u);
    }
  }, []);
  const tell = useCallback(
    (line: Line) => {
      say(line);
      send({ t: "feed", line });
    },
    [say, send],
  );
  const pushScores = useCallback(() => {
    setScores({ ...game.current.scores });
    send({ t: "scores", scores: game.current.scores });
  }, [send]);

  // Host: start a round.
  const nextRound = useCallback(() => {
    const g = game.current;
    if (g.n >= ROUNDS) {
      setStage("over");
      send({ t: "over", scores: g.scores });
      return;
    }
    g.n += 1;
    g.drawer = g.n % 2 === 1 ? "host" : "guest";
    let w = WORDS[Math.floor(Math.random() * WORDS.length)];
    while (g.used.has(w)) w = WORDS[Math.floor(Math.random() * WORDS.length)];
    g.used.add(w);
    g.word = w;
    g.ends = Date.now() + ROUND_S * 1000;
    g.guessed = false;
    g.aiGot = false;
    g.aiTried = [];
    g.dirty = false;
    clearCanvas();
    setRound({ n: g.n, drawer: g.drawer, word: g.drawer === "host" ? w : undefined, len: blanks(w), ends: g.ends });
    send({ t: "clear" });
    send({ t: "round", n: g.n, drawer: g.drawer, word: g.drawer === "guest" ? w : undefined, len: blanks(w), ms: ROUND_S * 1000 });
    tell({ who: "", text: `Round ${g.n}: ${g.drawer === "host" ? hostName : other || "Guest"} draws`, kind: "info" });
  }, [clearCanvas, send, tell, hostName, other]);

  // Host: someone guessed (the guesser is whoever isn't drawing).
  const checkGuess = useCallback(
    (text: string, by: Who) => {
      const g = game.current;
      if (stage !== "playing" || g.guessed || by === g.drawer) return;
      const name = by === "host" ? hostName : other || "Guest";
      if (norm(text) === norm(g.word)) {
        g.guessed = true;
        const secs = Math.max(0, Math.round((g.ends - Date.now()) / 1000));
        g.scores[by] += 50 + secs;
        g.scores[g.drawer] += 40;
        tell({ who: name, text: `got it: "${g.word}" (+${50 + secs})`, kind: "ok" });
        pushScores();
        send({ t: "reveal", word: g.word });
        setRound((r) => (r ? { ...r, word: g.word } : r));
        if (roundTimer.current) clearTimeout(roundTimer.current);
        roundTimer.current = setTimeout(nextRound, 3500);
      } else tell({ who: name, text, kind: "guess" });
    },
    [stage, hostName, other, tell, pushScores, send, nextRound],
  );

  /** Back together: the clock catches up with the pause, and the stage the game was in comes back. */
  const resume = useCallback(() => {
    if (giveUp.current) clearTimeout(giveUp.current);
    giveUp.current = null;
    const paused = pausedAt.current ? Date.now() - pausedAt.current : 0;
    pausedAt.current = null;
    const to = resumeTo.current;
    resumeTo.current = null;
    if (role === "host" && paused > 0 && to === "playing" && !game.current.guessed) {
      game.current.ends += paused;
      setRound((r) => (r ? { ...r, ends: r.ends + paused } : r));
    }
    return to;
  }, [role]);

  /** Host → friend: everything they need to carry on where they were. */
  const syncTo = useCallback(
    (c: DataConnection, st: Stage) => {
      const g = game.current;
      const r = latest.current.round;
      const showWord = g.drawer === "guest" || g.guessed;
      c.send({
        t: "sync",
        stage: st === "over" ? "over" : st === "playing" ? "playing" : "lobby",
        round: r ? { n: r.n, drawer: r.drawer, word: showWord ? g.word : undefined, len: r.len, ms: Math.max(0, g.ends - Date.now()) } : null,
        scores: g.scores,
        feed: latest.current.feed.slice(-30),
        strokes: strokes.current,
      } satisfies Msg);
    },
    [],
  );

  /** The other side went away: keep the game, show "reconnecting", give up after a few minutes. */
  const lost = useCallback(() => {
    const st = stageRef.current;
    if (st === "over" || st === "error") return;
    if (st === "playing" || st === "lobby") resumeTo.current = st;
    pausedAt.current ??= Date.now();
    setStage(resumeTo.current ? "reconnecting" : "waiting");
    if (!giveUp.current)
      giveUp.current = setTimeout(() => {
        giveUp.current = null;
        if (stageRef.current !== "reconnecting" && stageRef.current !== "waiting") return;
        setErr(`Lost ${latest.current.other || "the other player"} for a few minutes. Open the game again to carry on.`);
        setStage("error");
      }, GIVE_UP_MS);
  }, []);

  const onMsg = useCallback(
    (m: Msg, c: DataConnection) => {
      if (!m || typeof m !== "object") return;
      if (role === "host") {
        // The guest is untrusted: only these, checked. Scores, rounds and the feed come from here.
        if (m.t === "challenge") {
          const n = clip(m.nonce, 64);
          void proveHost("draw", room, n).then((proof) => proof && c.open && c.send({ t: "proof", proof } satisfies Msg));
          return;
        }
        if (m.t === "hello") {
          const id = clip(m.id, 64);
          // A different friend while one is still connected: this game is taken.
          if (conn.current && conn.current !== c && conn.current.open && guestId.current && id !== guestId.current) {
            c.close();
            return;
          }
          if (conn.current && conn.current !== c) conn.current.close();
          conn.current = c;
          if (id) guestId.current = id;
          setOther(cleanName(m.name) || "Guest");
          const to = resume();
          const cur = stageRef.current;
          const st = to ?? (cur === "over" ? "over" : cur === "playing" ? "playing" : "lobby");
          setStage(st);
          c.send({ t: "hello", name: myName } satisfies Msg);
          syncTo(c, st);
          return;
        }
        if (c !== conn.current) return;
        if (m.t === "guess") return checkGuess(clip(m.text, 40), "guest");
        const guestDraws = game.current.drawer === "guest" && !game.current.guessed;
        if (m.t === "clear" && guestDraws) return clearCanvas();
        if (m.t !== "stroke" || !guestDraws || !okStroke(m.s)) return;
      } else if (!verified.current) {
        // Guest: nothing counts until the host proves it's the owner (again on every reconnect).
        if (m.t !== "proof") return;
        void checkHost("draw", room, nonce.current, m.proof).then((ok) => {
          if (c !== conn.current) return;
          if (!ok) {
            setErr("This link isn't answered by its owner right now. Try again later.");
            setStage("error");
            c.close();
            return;
          }
          verified.current = true;
          c.send({ t: "hello", name: myName, id: myId.current } satisfies Msg);
          // Voice only to the verified host.
          const p = peer.current;
          if (p && mic.current) {
            call.current?.close();
            const mc = p.call(`hivemind-draw-${room}`, mic.current);
            call.current = mc;
            mc.on("stream", playVoice);
          }
        });
        return;
      } else if (m.t === "stroke" && !okStroke(m.s)) return;
      if (m.t === "hello") {
        setOther(cleanName(m.name) || hostName);
      } else if (m.t === "sync") {
        // Guest: the host's copy of the game wins.
        resume();
        strokes.current = Array.isArray(m.strokes) ? m.strokes.filter(okStroke) : [];
        redraw();
        if (okScores(m.scores)) setScores(m.scores);
        setFeed(Array.isArray(m.feed) ? m.feed.filter(okLine).slice(-30) : []);
        const r = m.round;
        setRound(r && Number.isFinite(r.n) ? { n: r.n, drawer: r.drawer === "guest" ? "guest" : "host", word: r.word ? clip(r.word, 40) : undefined, len: clip(r.len, 80), ends: Date.now() + Math.min(Math.max(0, Number(r.ms) || 0), ROUND_S * 1000) } : null);
        setStage(m.stage === "playing" && r ? "playing" : m.stage === "over" ? "over" : "lobby");
      } else if (m.t === "round") {
        setStage("playing");
        setRound({ n: m.n, drawer: m.drawer, word: m.word, len: m.len, ends: Date.now() + m.ms });
      } else if (m.t === "stroke") {
        const last = strokes.current[strokes.current.length - 1];
        // Pieces of the same stroke arrive in order; join them.
        if (last && live.current === null && last.color === m.s.color && last.pts.length && last.pts[last.pts.length - 1][0] === m.s.pts[0][0] && last.pts[last.pts.length - 1][1] === m.s.pts[0][1]) last.pts.push(...m.s.pts.slice(1));
        else strokes.current.push(m.s);
        redraw();
        game.current.dirty = true;
      } else if (m.t === "clear") clearCanvas();
      else if (m.t === "feed") say(m.line);
      else if (m.t === "scores") setScores(m.scores);
      else if (m.t === "reveal") setRound((r) => (r ? { ...r, word: m.word } : r));
      else if (m.t === "over") {
        setScores(m.scores);
        setStage("over");
      }
    },
    [role, room, myName, hostName, redraw, clearCanvas, checkGuess, say, resume, syncTo],
  );
  const onMsgRef = useRef(onMsg);
  useEffect(() => {
    onMsgRef.current = onMsg;
  }, [onMsg]);

  const wire = useCallback(
    (c: DataConnection) => {
      c.on("data", (d) => onMsgRef.current(d as Msg, c));
      c.on("open", () => {
        if (role === "host") return;
        verified.current = false;
        nonce.current = crypto.randomUUID();
        c.send({ t: "challenge", nonce: nonce.current } satisfies Msg);
      });
      // Only the connection that's actually in the game counts as "they left".
      c.on("close", () => c === conn.current && lostRef.current());
      c.on("error", () => c === conn.current && lostRef.current());
    },
    [role],
  );
  const lostRef = useRef(lost);
  useEffect(() => {
    lostRef.current = lost;
  }, [lost]);

  const playVoice = (stream: MediaStream) => {
    if (audio.current) {
      audio.current.srcObject = stream;
      void audio.current.play().catch(() => {});
    }
    setVoiceOn(true);
  };

  // Connect: the host waits for the guest; the guest dials in. Voice rides along when the mic is allowed.
  useEffect(() => {
    let alive = true;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const later = (fn: () => void, ms: number) => {
      const t = setTimeout(() => {
        timers.delete(t);
        if (alive) fn();
      }, ms);
      timers.add(t);
    };
    let dial: () => void = () => {};
    const hostId = `hivemind-draw-${room}`;
    // A tab coming back to the front: wake the broker connection and (guest) dial again.
    const back = () => {
      if (document.hidden || !alive) return;
      const p = peer.current;
      if (p && !p.destroyed && p.disconnected) p.reconnect();
      if (role === "guest" && !conn.current?.open) dial();
    };
    document.addEventListener("visibilitychange", back);
    window.addEventListener("online", back);

    (async () => {
      mic.current = (await navigator.mediaDevices?.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }).catch(() => null)) ?? null;
      if (!mic.current) setNoMic(true);
      const { default: PeerCtor } = await import("peerjs");
      if (!alive) return;
      if (role === "host") {
        // The game's address. After a reload the old tab's claim on it can linger for a little while,
        // so keep trying for a minute before saying it's open somewhere else.
        const open = (attempt: number) => {
          if (!alive) return;
          const p = new PeerCtor(hostId);
          peer.current = p;
          p.on("open", () => setStage((s) => (s === "connecting" ? "waiting" : s)));
          p.on("connection", (c) => wire(c));
          p.on("call", (mc) => {
            call.current?.close();
            call.current = mc;
            mc.answer(mic.current ?? undefined);
            mc.on("stream", playVoice);
          });
          p.on("error", (e) => {
            if (!alive) return;
            if (e.type === "unavailable-id") {
              p.destroy();
              if (attempt < 20) return later(() => open(attempt + 1), 3000);
              setErr("This game is already open in another tab.");
              setStage("error");
              return;
            }
            // The broker dropped (phone backgrounded, network blip): carry on and reconnect.
            if (["network", "disconnected", "server-error", "socket-error", "socket-closed"].includes(e.type)) {
              later(() => !p.destroyed && p.disconnected && p.reconnect(), 2000);
              return;
            }
            setErr("Couldn't open the game. Check your connection.");
            setStage("error");
          });
          p.on("disconnected", () => alive && later(() => !p.destroyed && p.disconnected && p.reconnect(), 1000));
        };
        open(0);
      } else {
        // This browser's id for this game, so the host gives our seat back after a reconnect.
        try {
          myId.current = localStorage.getItem("hm-play-id") || crypto.randomUUID();
          localStorage.setItem("hm-play-id", myId.current);
        } catch {
          myId.current ||= crypto.randomUUID();
        }
        const p = new PeerCtor();
        peer.current = p;
        // Data first; voice starts only after the host proves it's the owner (see onMsg).
        let lastDial = 0;
        dial = () => {
          // One attempt at a time (a retry timer and the tab coming back can both ask).
          if (!alive || p.destroyed || p.disconnected || Date.now() - lastDial < 2500) return;
          lastDial = Date.now();
          const old = conn.current;
          conn.current = null;
          old?.close();
          const c = p.connect(hostId, { reliable: true });
          conn.current = c;
          wire(c);
        };
        p.on("open", dial);
        p.on("disconnected", () => alive && later(() => !p.destroyed && p.disconnected && p.reconnect(), 1000));
        p.on("error", (e) => {
          if (!alive) return;
          if (e.type === "peer-unavailable") {
            // The host isn't there (yet, or reloading): let them know once, then keep trying quietly.
            if (stageRef.current === "connecting") setStage("waiting");
            if (awayRef.current && !resumeTo.current) {
              awayRef.current();
              awayRef.current = undefined;
              setKnocked(true);
            }
            later(dial, 3000);
          } else if (["network", "disconnected", "server-error", "socket-error", "socket-closed"].includes(e.type)) {
            later(() => (!p.destroyed && p.disconnected ? p.reconnect() : dial()), 2000);
          } else {
            setErr("Couldn't join the game. Check your connection.");
            setStage("error");
          }
        });
      }
    })();

    // Guest: a dropped connection is dialled again every few seconds (the host waits for us).
    const redial = setInterval(() => {
      if (role === "guest" && alive && stageRef.current === "reconnecting" && !conn.current?.open) dial();
    }, 4000);

    return () => {
      alive = false;
      timers.forEach(clearTimeout);
      clearInterval(redial);
      document.removeEventListener("visibilitychange", back);
      window.removeEventListener("online", back);
      if (roundTimer.current) clearTimeout(roundTimer.current);
      if (giveUp.current) clearTimeout(giveUp.current);
      if (flush.current) clearInterval(flush.current);
      call.current?.close();
      const c = conn.current;
      conn.current = null; // so its close doesn't count as the other player leaving
      c?.close();
      peer.current?.destroy();
      mic.current?.getTracks().forEach((t) => t.stop());
    };
    // Connect once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Countdown; the host ends the round when time runs out.
  useEffect(() => {
    if (stage !== "playing" || !round) return;
    const t = setInterval(() => {
      const s = Math.max(0, Math.round((round.ends - Date.now()) / 1000));
      setLeft(s);
      const g = game.current;
      if (role === "host" && s <= 0 && !g.guessed && g.n === round.n) {
        g.guessed = true;
        tell({ who: "", text: `Time's up! It was "${g.word}"`, kind: "info" });
        send({ t: "reveal", word: g.word });
        setRound((r) => (r ? { ...r, word: g.word } : r));
        if (roundTimer.current) clearTimeout(roundTimer.current);
        roundTimer.current = setTimeout(nextRound, 3500);
      }
    }, 300);
    return () => clearInterval(t);
  }, [stage, round, role, tell, send, nextRound]);

  // Host after a reload mid-round: a round that was already answered moves on by itself.
  useEffect(() => {
    if (role !== "host" || stage !== "playing" || !round || !game.current.guessed || roundTimer.current) return;
    roundTimer.current = setTimeout(nextRound, 3500);
  }, [role, stage, round, nextRound]);

  // Host: HIVEMIND looks at the drawing every few seconds and guesses (it never sees the word).
  useEffect(() => {
    if (role !== "host" || stage !== "playing") return;
    const t = setInterval(async () => {
      const g = game.current;
      const c = canvas.current;
      if (!c || g.guessed || g.aiGot || !g.dirty || !strokes.current.length) return;
      g.dirty = false;
      const n = g.n;
      const small = document.createElement("canvas");
      small.width = small.height = 384;
      small.getContext("2d")!.drawImage(c, 0, 0, 384, 384);
      try {
        const r = await fetch("/api/games/guess", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ image: small.toDataURL("image/jpeg", 0.7), tried: g.aiTried }) });
        if (!r.ok) return;
        const { guess: aiGuess } = (await r.json()) as { guess: string };
        if (!aiGuess || aiGuess === "???" || g.guessed || g.n !== n) return;
        if (norm(aiGuess) === norm(g.word) || (norm(aiGuess).includes(norm(g.word)) && norm(g.word).length > 3)) {
          g.aiGot = true;
          g.scores.ai += 50 + Math.max(0, Math.round((g.ends - Date.now()) / 1000));
          tell({ who: "HIVEMIND", text: "got it! 🤖 (keep going, humans)", kind: "ai" });
          pushScores();
        } else {
          g.aiTried.push(aiGuess);
          tell({ who: "HIVEMIND", text: `${aiGuess}?`, kind: "ai" });
        }
      } catch {}
    }, AI_EVERY_MS);
    return () => clearInterval(t);
  }, [role, stage, tell, pushScores]);

  // Host: a new game with the same friend.
  function playAgain() {
    game.current = { n: 0, word: "", drawer: "host", ends: 0, guessed: false, aiGot: false, aiTried: [], used: new Set(), dirty: false, scores: { ...NO_SCORES } };
    if (roundTimer.current) clearTimeout(roundTimer.current);
    roundTimer.current = null;
    setFeed([]);
    pushScores();
    setStage("playing");
    nextRound();
  }

  function submitGuess(e: React.FormEvent) {
    e.preventDefault();
    const text = guess.trim();
    if (!text) return;
    setGuess("");
    if (role === "host") checkGuess(text, "host");
    else send({ t: "guess", text });
  }

  // Say your guess instead of typing it (the browser's speech recognition, Indian English).
  function speakGuess() {
    type Rec = { lang: string; maxAlternatives: number; interimResults: boolean; start: () => void; stop: () => void; onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null; onend: (() => void) | null; onerror: (() => void) | null };
    const W = window as unknown as { SpeechRecognition?: new () => Rec; webkitSpeechRecognition?: new () => Rec };
    const R = W.SpeechRecognition ?? W.webkitSpeechRecognition;
    if (!R) return setErr("This browser can't take voice guesses; type it instead.");
    const r = new R();
    r.lang = "en-IN";
    r.maxAlternatives = 3;
    r.interimResults = false;
    r.onresult = (e) => {
      const alts = Array.from(e.results[0] ?? []).map((a) => a.transcript.trim()).filter(Boolean);
      // The word may be any of the heard alternatives: try the one that matches, else the first.
      const word = game.current.word;
      const pick = (role === "host" && alts.find((a) => norm(a) === norm(word))) || alts[0];
      if (!pick) return;
      if (role === "host") checkGuess(pick, "host");
      else alts.slice(0, 3).forEach((a) => send({ t: "guess", text: a }));
    };
    r.onend = () => setListening(false);
    r.onerror = () => setListening(false);
    setListening(true);
    r.start();
  }

  function toggleMute() {
    const on = !muted;
    mic.current?.getAudioTracks().forEach((t) => (t.enabled = !on));
    setMuted(on);
  }

  const invite = typeof window === "undefined" ? "" : `${location.origin}/play/${room}?from=${encodeURIComponent(myName)}`;
  const friend = other || (role === "host" ? "your friend" : hostName);
  const status =
    stage === "connecting"
      ? "Connecting…"
      : stage === "waiting"
        ? role === "host"
          ? "Waiting for your friend to open the link…"
          : knocked
            ? `Waiting for ${hostName}… we sent them a notification, it connects as soon as they open the game.`
            : `Waiting for ${hostName} to open the game…`
        : stage === "reconnecting"
          ? `Connection lost. Reconnecting to ${friend}… the game and the clock are paused.`
          : stage === "lobby"
            ? `${friend} is here!`
            : stage === "error"
              ? err
              : "";
  const board = (stage === "playing" || stage === "over" || stage === "reconnecting") && !!round;

  return (
    <div
      className="mx-auto flex w-full max-w-5xl flex-col gap-3"
      onPointerDown={() => {
        // Phones only play the friend's voice after a tap on the page.
        if (audio.current?.srcObject && audio.current.paused) void audio.current.play().catch(() => {});
      }}
    >
      <audio ref={audio} autoPlay playsInline />
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <ScoreChip label={nameOf("host")} value={scores.host} on={round?.drawer === "host"} />
        <ScoreChip label={nameOf("guest") || "Guest"} value={scores.guest} on={round?.drawer === "guest"} />
        <ScoreChip label="HIVEMIND" value={scores.ai} bot />
        <span className="ml-auto flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => {
              aiTalksRef.current = !aiTalks;
              setAiTalks(!aiTalks);
            }}
            title="HIVEMIND says its guesses out loud"
            className={cx("flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs", aiTalks ? "border-data/50 text-data" : "border-line text-faint")}
          >
            <Bot size={13} /> {aiTalks ? "AI talks" : "AI quiet"}
          </button>
          {voiceOn ? (
            <button type="button" onClick={toggleMute} className={cx("flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs", muted ? "border-alert text-alert" : "border-ok/50 text-ok")}>
              {muted ? <MicOff size={13} /> : <Mic size={13} />} {muted ? "Muted" : "Voice on"}
            </button>
          ) : (
            <span className={cx("flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs", noMic ? "border-alert/50 text-alert" : "border-line text-faint")} title={noMic ? "Allow the microphone for this site to talk while you play" : ""}>
              {noMic ? <MicOff size={13} /> : <Mic size={13} />} {noMic ? "Mic blocked" : stage === "lobby" || stage === "playing" ? "Voice connecting…" : "Voice"}
            </span>
          )}
        </span>
      </div>

      {status && <p className={cx("text-sm", stage === "error" ? "text-alert" : stage === "reconnecting" ? "animate-pulse text-core" : "text-soft")}>{status}</p>}

      {role === "host" && stage === "waiting" && (
        <div className="flex flex-wrap gap-2">
          <a
            href={`https://wa.me/?text=${encodeURIComponent(`${myName} challenges you to Draw & Guess on HIVEMIND! Tap to play: ${invite}`)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-full bg-ok/90 px-4 py-2 text-sm font-medium text-black"
          >
            <Send size={14} /> Invite on WhatsApp
          </a>
          <button type="button" onClick={() => void navigator.clipboard?.writeText(invite).then(() => setCopied(true))} className="inline-flex items-center gap-1.5 rounded-full border border-line px-4 py-2 text-sm text-soft">
            <Copy size={14} /> {copied ? "Link copied" : "Copy link"}
          </button>
        </div>
      )}

      {role === "host" && stage === "lobby" && (
        <button
          type="button"
          onClick={() => {
            setStage("playing");
            nextRound();
          }}
          className="self-start rounded-full bg-core px-5 py-2 text-sm font-semibold text-core-ink"
        >
          Start game ({ROUNDS} rounds)
        </button>
      )}
      {role === "guest" && stage === "lobby" && <p className="text-sm text-soft">Connected! {hostName} starts the game.</p>}
      {(stage === "reconnecting" || stage === "error") && (wasIn || round) && (
        <button
          type="button"
          onClick={() => {
            leaving.current = true;
            try {
              sessionStorage.removeItem(KEY);
            } catch {}
            location.reload();
          }}
          className="self-start text-xs text-soft underline hover:text-fg"
        >
          Leave this game and start fresh
        </button>
      )}
      {role === "host" && stage === "over" && conn.current?.open && (
        <button type="button" onClick={playAgain} className="inline-flex items-center gap-1.5 self-start rounded-full bg-core px-5 py-2 text-sm font-semibold text-core-ink">
          <RotateCcw size={14} /> Play again with {friend}
        </button>
      )}

      {board && (
        <div className={cx("grid gap-3 lg:grid-cols-[minmax(0,1fr)_300px]", stage === "reconnecting" && "pointer-events-none opacity-60")}>
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2 rounded-lg border border-line bg-panel px-3 py-2 text-sm">
              {stage === "over" ? (
                <span className="font-medium">Game over!</span>
              ) : round ? (
                <>
                  <span className="text-soft">Round {round.n}/{ROUNDS}</span>
                  <span className="mx-auto font-mono text-base tracking-widest">
                    {round.drawer === me && !round.word?.length ? round.len : round.drawer === me ? <span className="text-core">Draw: {round.word}</span> : round.word ? <span className="text-ok">{round.word}</span> : round.len}
                  </span>
                  <span className={cx("font-mono tabular-nums", left <= 10 ? "text-alert" : "text-soft")}>{stage === "reconnecting" ? "⏸" : `${left}s`}</span>
                </>
              ) : null}
            </div>
            <canvas
              ref={canvas}
              width={600}
              height={600}
              onPointerDown={down}
              onPointerMove={move}
              onPointerUp={up}
              onPointerCancel={up}
              className={cx("aspect-square w-full max-w-[min(100%,72dvh)] touch-none self-center rounded-lg border-2 border-line bg-white", drawing ? "cursor-crosshair" : "cursor-default")}
            />
            {drawing && (
              <div className="flex items-center justify-center gap-2">
                {COLORS.map((c) => (
                  <button key={c} type="button" aria-label={`Colour ${c}`} onClick={() => setColor(c)} className={cx("size-7 rounded-full border-2", color === c ? "border-core" : "border-line")} style={{ background: c }} />
                ))}
                <button type="button" aria-label="Eraser" onClick={() => setColor("#ffffff")} className={cx("flex size-7 items-center justify-center rounded-full border-2 bg-white text-black", color === "#ffffff" ? "border-core" : "border-line")}>
                  <Eraser size={13} />
                </button>
                <button
                  type="button"
                  aria-label="Clear"
                  onClick={() => {
                    clearCanvas();
                    send({ t: "clear" });
                  }}
                  className="flex size-7 items-center justify-center rounded-full border-2 border-line text-soft"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            )}
          </div>

          <div className="flex min-h-56 flex-col rounded-lg border border-line bg-panel">
            <div className="flex-1 space-y-1 overflow-y-auto p-3 text-sm">
              {stage === "over" && <Winner scores={scores} host={nameOf("host")} guest={nameOf("guest")} />}
              {feed.map((l, k) => (
                <p key={k} className={cx(l.kind === "ok" && "font-medium text-ok", l.kind === "ai" && "text-data", l.kind === "info" && "font-mono text-[11px] uppercase tracking-wider text-faint")}>
                  {l.who && <span className="font-medium">{l.who}: </span>}
                  {l.text}
                </p>
              ))}
            </div>
            {stage === "playing" && !drawing && !round?.word && (
              <form onSubmit={submitGuess} className="flex gap-2 border-t border-line p-2">
                <button type="button" onClick={speakGuess} aria-label="Say your guess" title="Say your guess" className={cx("flex size-9 shrink-0 items-center justify-center rounded-md border", listening ? "animate-pulse border-core bg-core/20 text-core" : "border-line text-soft")}>
                  <Mic size={15} />
                </button>
                <input value={guess} onChange={(e) => setGuess(e.target.value)} placeholder={listening ? "Listening… say it" : "Type or say your guess…"} className="min-w-0 flex-1 rounded-md border border-line bg-sunken px-3 py-2 text-sm" autoComplete="off" />
                <button type="submit" className="rounded-md bg-core px-3 text-sm font-medium text-core-ink">
                  Guess
                </button>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ScoreChip({ label, value, on, bot }: { label: string; value: number; on?: boolean; bot?: boolean }) {
  return (
    <span className={cx("flex items-center gap-1.5 rounded-full border px-3 py-1", on ? "border-core bg-core/10" : "border-line", bot && "text-data")}>
      {bot && <Bot size={13} />}
      <span className="max-w-28 truncate">{label}</span>
      <b className="font-mono tabular-nums">{value}</b>
      {on && <span className="text-[10px] text-core">✏️</span>}
    </span>
  );
}

function Winner({ scores, host, guest }: { scores: Scores; host: string; guest: string }) {
  const all = [
    { n: host, s: scores.host },
    { n: guest, s: scores.guest },
    { n: "HIVEMIND", s: scores.ai },
  ].sort((a, b) => b.s - a.s);
  return (
    <div className="mb-3 rounded-lg bg-raised p-3 text-center">
      <Trophy size={22} className="mx-auto text-core" />
      <div className="mt-1 font-semibold">{all[0].n} wins!</div>
      <div className="text-xs text-soft">{all.map((x) => `${x.n} ${x.s}`).join(" · ")}</div>
      {all[0].n === "HIVEMIND" && <div className="mt-1 text-xs text-data">The AI beat you both 🤖</div>}
    </div>
  );
}
