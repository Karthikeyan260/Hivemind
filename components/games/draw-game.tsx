"use client";

import type { DataConnection, MediaConnection, Peer } from "peerjs";
import { Bot, Copy, Eraser, Mic, MicOff, Send, Trash2, Trophy } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { cx } from "@/components/ui";

/**
 * Draw & Guess for two people plus HIVEMIND. One person draws a word, the other guesses by typing;
 * HIVEMIND watches the same drawing and guesses too (it only ever sees the picture). Browser to
 * browser like HIVEMIND calls (PeerJS), with voice on so you can laugh at each other's drawings.
 * The owner's side (host) runs the game: words, timer, scores, and HIVEMIND's guesses.
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

type Who = "host" | "guest";
type Stroke = { pts: [number, number][]; color: string; w: number };
type Msg =
  | { t: "hello"; name: string }
  | { t: "round"; n: number; drawer: Who; word?: string; len: string; ms: number }
  | { t: "stroke"; s: Stroke }
  | { t: "clear" }
  | { t: "guess"; text: string }
  | { t: "feed"; line: Line }
  | { t: "scores"; scores: Scores }
  | { t: "reveal"; word: string }
  | { t: "over"; scores: Scores };
type Line = { who: string; text: string; kind: "guess" | "ok" | "ai" | "info" };
type Scores = { host: number; guest: number; ai: number };

const norm = (s: string) => s.toLowerCase().replace(/[^a-z ]/g, "").replace(/\s+/g, " ").trim().replace(/s$/, "");
const blanks = (w: string) => w.replace(/[a-z]/gi, "_ ").trim();

export function DrawGame({ role, room, myName, hostName = "Host", onHostAway }: { role: Who; room: string; myName: string; hostName?: string; /** Guest: the host isn't in the game yet (called once). */ onHostAway?: () => void }) {
  const [stage, setStage] = useState<"connecting" | "waiting" | "lobby" | "playing" | "over" | "error">("connecting");
  const [err, setErr] = useState("");
  const [other, setOther] = useState(role === "guest" ? hostName : "");
  const [round, setRound] = useState<{ n: number; drawer: Who; word?: string; len: string; ends: number } | null>(null);
  const [left, setLeft] = useState(ROUND_S);
  const [feed, setFeed] = useState<Line[]>([]);
  const [scores, setScores] = useState<Scores>({ host: 0, guest: 0, ai: 0 });
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
  const strokes = useRef<Stroke[]>([]);
  const peer = useRef<Peer | null>(null);
  const conn = useRef<DataConnection | null>(null);
  const call = useRef<MediaConnection | null>(null);
  const mic = useRef<MediaStream | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  // Host-only game state.
  const game = useRef({ n: 0, word: "", drawer: "host" as Who, ends: 0, guessed: false, aiGot: false, aiTried: [] as string[], used: new Set<string>(), dirty: false, scores: { host: 0, guest: 0, ai: 0 } as Scores });

  const me: Who = role;
  const drawing = round?.drawer === me && stage === "playing";
  const nameOf = (w: Who) => (w === role ? myName : other || (w === "host" ? hostName : "Guest"));

  const send = useCallback((m: Msg) => {
    if (conn.current?.open) conn.current.send(m);
  }, []);

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
    if (!drawing) return;
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
        setTimeout(nextRound, 3500);
      } else tell({ who: name, text, kind: "guess" });
    },
    [stage, hostName, other, tell, pushScores, send, nextRound],
  );

  const onMsg = useCallback(
    (m: Msg) => {
      if (m.t === "hello") {
        setOther(m.name);
        if (role === "host") {
          setStage("lobby");
          send({ t: "hello", name: myName });
        } else setStage((s) => (s === "connecting" || s === "waiting" ? "lobby" : s));
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
      else if (m.t === "guess" && role === "host") checkGuess(m.text, "guest");
      else if (m.t === "feed") say(m.line);
      else if (m.t === "scores") setScores(m.scores);
      else if (m.t === "reveal") setRound((r) => (r ? { ...r, word: m.word } : r));
      else if (m.t === "over") {
        setScores(m.scores);
        setStage("over");
      }
    },
    [role, myName, send, redraw, clearCanvas, checkGuess, say],
  );
  const onMsgRef = useRef(onMsg);
  useEffect(() => {
    onMsgRef.current = onMsg;
  }, [onMsg]);

  const wire = useCallback(
    (c: DataConnection) => {
      conn.current = c;
      c.on("data", (d) => onMsgRef.current(d as Msg));
      c.on("open", () => c.send({ t: "hello", name: myName } satisfies Msg));
      c.on("close", () => {
        setErr(`${other || "The other player"} left the game.`);
        setStage((s) => (s === "over" ? s : "error"));
      });
    },
    [myName, other],
  );

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
    (async () => {
      mic.current = (await navigator.mediaDevices?.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }).catch(() => null)) ?? null;
      if (!mic.current) setNoMic(true);
      const { default: PeerCtor } = await import("peerjs");
      if (!alive) return;
      const hostId = `hivemind-draw-${room}`;
      if (role === "host") {
        const p = new PeerCtor(hostId);
        peer.current = p;
        p.on("open", () => setStage("waiting"));
        p.on("connection", (c) => {
          if (conn.current?.open) return c.close();
          wire(c);
        });
        p.on("call", (mc) => {
          call.current = mc;
          mc.answer(mic.current ?? undefined);
          mc.on("stream", playVoice);
        });
        p.on("error", (e) => {
          setErr(e.type === "unavailable-id" ? "This game is already open in another tab." : "Couldn't open the game. Check your connection.");
          setStage("error");
        });
      } else {
        const p = new PeerCtor();
        peer.current = p;
        const dial = () => {
          wire(p.connect(hostId, { reliable: true }));
          if (mic.current) {
            const mc = p.call(hostId, mic.current);
            call.current = mc;
            mc.on("stream", playVoice);
          }
        };
        p.on("open", dial);
        p.on("error", (e) => {
          if (e.type === "peer-unavailable") {
            setStage("waiting");
            // The host isn't in the game: let them know once, then keep trying quietly.
            if (awayRef.current) {
              awayRef.current();
              awayRef.current = undefined;
              setKnocked(true);
            }
            setTimeout(() => alive && dial(), 3000);
          } else {
            setErr("Couldn't join the game. Check your connection.");
            setStage("error");
          }
        });
      }
    })();
    return () => {
      alive = false;
      call.current?.close();
      conn.current?.close();
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
        setTimeout(nextRound, 3500);
      }
    }, 300);
    return () => clearInterval(t);
  }, [stage, round, role, tell, send, nextRound]);

  // Host: HIVEMIND looks at the drawing every few seconds and guesses (it never sees the word).
  useEffect(() => {
    if (role !== "host" || stage !== "playing") return;
    const t = setInterval(async () => {
      const g = game.current;
      const c = canvas.current;
      if (!c || g.guessed || g.aiGot || !g.dirty || !strokes.current.length) return;
      g.dirty = false;
      const small = document.createElement("canvas");
      small.width = small.height = 384;
      small.getContext("2d")!.drawImage(c, 0, 0, 384, 384);
      try {
        const r = await fetch("/api/games/guess", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ image: small.toDataURL("image/jpeg", 0.7), tried: g.aiTried }) });
        if (!r.ok) return;
        const { guess: aiGuess } = (await r.json()) as { guess: string };
        if (!aiGuess || aiGuess === "???" || g.guessed || g.n !== game.current.n) return;
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
  const status =
    stage === "connecting"
      ? "Connecting…"
      : stage === "waiting"
        ? role === "host"
          ? "Waiting for your friend to open the link…"
          : knocked
            ? `Waiting for ${hostName}… we sent them a notification, it connects as soon as they open the game.`
            : `Waiting for ${hostName} to open the game…`
        : stage === "lobby"
          ? `${other} is here!`
          : stage === "error"
            ? err
            : "";

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

      {status && <p className={cx("text-sm", stage === "error" ? "text-alert" : "text-soft")}>{status}</p>}

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

      {(stage === "playing" || stage === "over") && (
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2 rounded-lg border border-line bg-panel px-3 py-2 text-sm">
              {stage === "over" ? (
                <span className="font-medium">Game over!</span>
              ) : round ? (
                <>
                  <span className="text-soft">Round {round.n}/{ROUNDS}</span>
                  <span className="mx-auto font-mono text-base tracking-widest">
                    {drawing ? <span className="text-core">Draw: {round.word}</span> : round.word ? <span className="text-ok">{round.word}</span> : round.len}
                  </span>
                  <span className={cx("font-mono tabular-nums", left <= 10 ? "text-alert" : "text-soft")}>{left}s</span>
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
