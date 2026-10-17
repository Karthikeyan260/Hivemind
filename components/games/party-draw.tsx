"use client";

import { Bot, Eraser, Trash2, Trophy } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { AI_EVERY_MS, blanks, COLORS, okStroke, pickWord, ROUND_S, type Stroke } from "@/components/games/draw-game";
import { cx } from "@/components/ui";
import { useVoiceActions } from "@/components/voice/provider";
import { type Party, usePartyGame } from "@/lib/games/party";
import { DRAWER_POINTS, drawView, guessPoints, here, nextRound, rightGuess, roundDone } from "@/lib/games/party-rules";
import { sfx } from "@/lib/sfx";

/**
 * Draw & Guess for game night: everyone in the lobby takes turns drawing; the rest guess by typing,
 * and HIVEMIND guesses too from the picture. The owner's browser runs it (words, timer, scores,
 * HIVEMIND's guesses) and sends each player only what they may see: the word goes to the drawer, and
 * to each player once they've guessed it.
 */
type Line = { who: string; text: string; kind: "guess" | "ok" | "ai" | "info" };
type Night = {
  phase: "playing" | "between" | "over";
  order: string[];
  names: Record<string, string>;
  n: number;
  total: number;
  drawer: string;
  /** Empty in a player's copy until they may see it. */
  word: string;
  len: string;
  /** Time left in the round when this copy was sent. */
  left: number;
  guessed: string[];
  aiGot: boolean;
  scores: Record<string, number>;
  feed: Line[];
  strokes: Stroke[];
  live: Stroke | null;
  seq: number;
};
type Action = { type: "stroke"; s: Stroke } | { type: "live"; s: Stroke } | { type: "clear" } | { type: "guess"; text: string };

const okState = (s: unknown): s is Night => {
  const x = s as Night;
  return !!x && Array.isArray(x.order) && x.order.length <= 6 && typeof x.drawer === "string" && Array.isArray(x.strokes) && Array.isArray(x.feed) && typeof x.scores === "object";
};
const viewFor = (s: Night, id: string): Night => drawView(s, id);
const clip = (v: unknown, n: number) => String(v ?? "").slice(0, n);

export function PartyDraw({ party }: { party: Party }) {
  const isHost = party.role === "host";
  const me = party.me;
  const sRef = useRef<Night | null>(null);
  /** Host only: when the round ends (this device's clock), the words used, HIVEMIND's wrong guesses. */
  const host = useRef({ ends: 0, used: new Set<string>(), aiTried: [] as string[], dirty: false, next: null as ReturnType<typeof setTimeout> | null });
  const lastLive = useRef(0);

  const publishNow = useCallback(
    (s: Night) => {
      sRef.current = s;
      party.publish("draw", { ...s, left: Math.max(0, host.current.ends - Date.now()) });
    },
    [party],
  );
  const update = useCallback(
    (fn: (s: Night) => Night) => {
      const cur = sRef.current;
      if (!cur) return;
      const next = fn(cur);
      if (next !== cur) publishNow({ ...next, seq: cur.seq + 1 });
    },
    [publishNow],
  );
  const say = (s: Night, line: Line): Night => ({ ...s, feed: [...s.feed.slice(-39), line] });

  /* ── host: rounds ── */
  const round = useCallback(
    (s: Night, n: number): Night => {
      // The next drawer who's here (skipping anyone who left).
      const next = nextRound(s.order, s.total, n, new Set(here(party.players).map((p) => p.id)));
      if (!next) return say({ ...s, phase: "over", live: null }, { who: "", text: "Game over!", kind: "info" });
      const { n: k, drawer } = next;
      const word = pickWord(host.current.used);
      host.current.used.add(word);
      host.current.aiTried = [];
      host.current.dirty = false;
      host.current.ends = Date.now() + ROUND_S * 1000;
      return say({ ...s, phase: "playing", n: k, drawer, word, len: blanks(word), guessed: [], aiGot: false, strokes: [], live: null }, { who: "", text: `Round ${k}/${s.total}: ${s.names[drawer] ?? "?"} draws`, kind: "info" });
    },
    [party.players],
  );
  const reveal = useCallback(
    (s: Night): Night => {
      if (host.current.next) clearTimeout(host.current.next);
      host.current.next = setTimeout(() => {
        host.current.next = null;
        update((cur) => (cur.phase === "between" ? round(cur, cur.n + 1) : cur));
      }, 4500);
      return say({ ...s, phase: "between", live: null }, { who: "", text: `The word was “${s.word}”`, kind: "info" });
    },
    [round, update],
  );
  function start(perPlayer: number) {
    const people = here(party.players).slice(0, 6);
    const order = people.map((p) => p.id);
    host.current.used = new Set();
    const s0: Night = {
      phase: "playing",
      order,
      names: Object.fromEntries(people.map((p) => [p.id, p.name])),
      n: 0,
      total: order.length * perPlayer,
      drawer: order[0],
      word: "",
      len: "",
      left: 0,
      guessed: [],
      aiGot: false,
      scores: Object.fromEntries([...order, "ai"].map((id) => [id, 0])),
      feed: [],
      strokes: [],
      live: null,
      seq: (sRef.current?.seq ?? 0) + 1,
    };
    publishNow(round(s0, 1));
    sfx.boot();
  }

  /** Host: a player's move (from the network, or the owner's own taps). */
  const onMove = useCallback(
    (from: string, a: Action) =>
      update((s) => {
        if (s.phase !== "playing") return s;
        if ((a.type === "stroke" || a.type === "live") && from === s.drawer && okStroke(a.s)) {
          host.current.dirty = true;
          return a.type === "stroke" ? { ...s, strokes: [...s.strokes, a.s].slice(-400), live: null } : { ...s, live: a.s };
        }
        if (a.type === "clear" && from === s.drawer) return { ...s, strokes: [], live: null };
        if (a.type === "guess" && from !== s.drawer && !s.guessed.includes(from) && s.order.includes(from)) {
          const text = clip(a.text, 40).trim();
          if (!text) return s;
          const name = s.names[from] ?? "?";
          if (rightGuess(text, s.word)) {
            const secs = (host.current.ends - Date.now()) / 1000;
            const scores = { ...s.scores, [from]: (s.scores[from] ?? 0) + guessPoints(secs), [s.drawer]: (s.scores[s.drawer] ?? 0) + DRAWER_POINTS };
            const next = say({ ...s, guessed: [...s.guessed, from], scores }, { who: name, text: "guessed it! 🎉", kind: "ok" });
            // Everyone who's here has it: show the word and move on.
            return roundDone(next, new Set(here(party.players).map((p) => p.id)), false) ? reveal(next) : next;
          }
          return say(s, { who: name, text, kind: "guess" });
        }
        return s;
      }),
    [update, reveal, party.players],
  );

  const net = usePartyGame<Night, Action>(party, "draw", { accept: okState, viewFor, onAction: onMove });
  const s = net?.state ?? null;
  useEffect(() => {
    if (isHost) sRef.current = (sRef.current && s && sRef.current.seq >= s.seq ? sRef.current : s) ?? sRef.current;
  });

  // Host: the round ends when the clock runs out, the drawer leaves, or everyone still here has guessed.
  const playersRef = useRef(party.players);
  useEffect(() => {
    playersRef.current = party.players;
  });
  useEffect(() => {
    if (!isHost) return;
    const t = setInterval(() => {
      const cur = sRef.current;
      if (cur?.phase !== "playing") return;
      if (roundDone(cur, new Set(here(playersRef.current).map((p) => p.id)), Date.now() >= host.current.ends)) update((x) => (x.phase === "playing" && x.n === cur.n ? reveal(x) : x));
    }, 500);
    return () => clearInterval(t);
  }, [isHost, update, reveal]);

  // Host: after a refresh the saved game comes back without its timers; pick the round up where it was.
  const resumed = useRef(false);
  useEffect(() => {
    if (!isHost || resumed.current || !s) return;
    resumed.current = true;
    if (host.current.ends) return;
    host.current.ends = Date.now() + Math.max(15_000, s.left);
    if (s.word) host.current.used.add(s.word);
    if (s.phase === "between") update((x) => reveal({ ...x, feed: x.feed.slice(0, -1) }));
  }, [isHost, s, update, reveal]);

  // Host: HIVEMIND looks at the drawing and guesses every few seconds.
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!isHost) return;
    const t = setInterval(async () => {
      const cur = sRef.current;
      const c = canvas.current;
      if (!cur || !c || cur.phase !== "playing" || cur.aiGot || !host.current.dirty || !cur.strokes.length) return;
      host.current.dirty = false;
      const n = cur.n;
      const small = document.createElement("canvas");
      small.width = small.height = 384;
      small.getContext("2d")!.drawImage(c, 0, 0, 384, 384);
      try {
        const r = await fetch("/api/games/guess", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ image: small.toDataURL("image/jpeg", 0.7), tried: host.current.aiTried }) });
        if (!r.ok) return;
        const { guess } = (await r.json()) as { guess: string };
        update((x) => {
          if (x.n !== n || x.phase !== "playing" || x.aiGot || !guess || guess === "???") return x;
          if (rightGuess(guess, x.word)) {
            const secs = (host.current.ends - Date.now()) / 1000;
            return say({ ...x, aiGot: true, scores: { ...x.scores, ai: (x.scores.ai ?? 0) + guessPoints(secs) } }, { who: "HIVEMIND", text: "got it! 🤖 (keep going, humans)", kind: "ai" });
          }
          host.current.aiTried.push(guess);
          return say(x, { who: "HIVEMIND", text: `${guess}?`, kind: "ai" });
        });
      } catch {}
    }, AI_EVERY_MS);
    return () => clearInterval(t);
  }, [isHost, update]);

  /* ── the clock on every screen ── */
  const [ends, setEnds] = useState(0);
  const [now, setNow] = useState(0);
  const seq = s?.seq;
  const left = s?.left ?? 0;
  useEffect(() => {
    if (seq === undefined) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- a new game state just arrived
    setEnds(Date.now() + left);
  }, [seq, left]);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);
  const secs = s?.phase === "playing" && now ? Math.max(0, Math.ceil((ends - now) / 1000)) : 0;

  /* ── drawing ── */
  const drawing = !!s && s.phase === "playing" && s.drawer === me;
  const [color, setColor] = useState(COLORS[0]);
  const live = useRef<Stroke | null>(null);
  const redraw = useCallback(() => {
    const c = canvas.current;
    if (!c) return;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    const all = [...(s?.strokes ?? []), ...(drawing ? (live.current ? [live.current] : []) : s?.live ? [s.live] : [])];
    for (const st of all) {
      ctx.strokeStyle = st.color;
      ctx.lineWidth = st.w * (c.width / 600);
      ctx.beginPath();
      st.pts.forEach(([x, y], i) => (i ? ctx.lineTo(x * c.width, y * c.height) : ctx.moveTo(x * c.width, y * c.height)));
      if (st.pts.length === 1) ctx.lineTo(st.pts[0][0] * c.width + 0.1, st.pts[0][1] * c.height);
      ctx.stroke();
    }
  }, [s, drawing]);
  useEffect(() => redraw(), [redraw]);
  const send = (a: Action) => (isHost ? onMove("host", a) : party.act("draw", a));
  const point = (e: React.PointerEvent): [number, number] => {
    const r = canvas.current!.getBoundingClientRect();
    return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))];
  };
  function down(e: React.PointerEvent) {
    if (!drawing || live.current || !e.isPrimary) return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    live.current = { pts: [point(e)], color, w: color === "#ffffff" ? 26 : 6 };
    redraw();
  }
  function move(e: React.PointerEvent) {
    if (!live.current || !e.isPrimary) return;
    if (live.current.pts.length < 2000) live.current.pts.push(point(e));
    redraw();
    // The stroke as it's drawn, a few times a second, so everyone watches it appear.
    if (Date.now() - lastLive.current > 120) {
      lastLive.current = Date.now();
      send({ type: "live", s: { ...live.current, pts: [...live.current.pts] } });
    }
  }
  function up() {
    if (!live.current) return;
    const st = live.current;
    live.current = null;
    send({ type: "stroke", s: st });
  }

  /* ── guessing ── */
  const [guess, setGuess] = useState("");
  const canGuess = !!s && s.phase === "playing" && s.drawer !== me && !s.guessed.includes(me) && s.order.includes(me);
  function submit(e: React.FormEvent) {
    e.preventDefault();
    const t = guess.trim();
    if (!t || !canGuess) return;
    setGuess("");
    send({ type: "guess", text: t });
  }

  // A happy sound when someone gets it.
  const okCount = s?.feed.filter((l) => l.kind === "ok").length ?? 0;
  useEffect(() => {
    if (okCount) sfx.done();
  }, [okCount]);

  const [per, setPer] = useState(2);

  // Voice: start a game, guess the word, or hear how it's going.
  useVoiceActions({
    draw_start: {
      description: "Draw & Guess at game night: start a game (the owner only). input: how many times each player draws (1, 2 or 3).",
      run: ({ input }) => {
        if (!isHost) return { error: "Only the host starts the game." };
        if (s?.phase === "playing" || s?.phase === "between") return { error: "A game is already on." };
        if (atTable.length < 2) return { error: "Needs at least one friend here." };
        const k = Number(String(input ?? "").match(/[123]/)?.[0] ?? per);
        setPer(k);
        start(k);
        return { started: true, rounds: atTable.length * k };
      },
    },
    draw_guess: {
      description: "Draw & Guess at game night: guess the word being drawn. input: the guess, as said.",
      run: ({ input }) => {
        const t = String(input ?? "").trim();
        if (!s || s.phase !== "playing") return { error: "No round is on right now." };
        if (s.drawer === me) return { error: "You're drawing this round." };
        if (s.guessed.includes(me)) return { error: "You already got it." };
        if (!t) return { error: "Say your guess." };
        send({ type: "guess", text: t });
        return { guessed: t, note: "The feed shows if it was right." };
      },
    },
    draw_status: {
      description: "Draw & Guess at game night: the round, who's drawing, seconds left, the blanks (or the word if the owner may see it), who has guessed, and the scores.",
      run: () =>
        s
          ? {
              round: `${s.n} of ${s.total}`,
              phase: s.phase,
              drawing: s.drawer === me ? "you" : s.names[s.drawer],
              word: s.word || null,
              blanks: s.len,
              seconds_left: secs,
              guessed: s.guessed.map((id) => s.names[id]),
              scores: Object.fromEntries([...s.order.map((id) => [s.names[id], s.scores[id] ?? 0]), ["HIVEMIND", s.scores.ai ?? 0]]),
            }
          : { error: "No game yet." },
    },
    draw_clear: {
      description: "Draw & Guess at game night: wipe the drawing (only while the owner is drawing).",
      run: () => (drawing ? (send({ type: "clear" }), { cleared: true }) : { error: "You're not drawing right now." }),
    },
  });
  const atTable = here(party.players);
  const board = s
    ? [...s.order.map((id) => ({ id, name: s.names[id] ?? "?", score: s.scores[id] ?? 0, bot: false })), { id: "ai", name: "HIVEMIND", score: s.scores.ai ?? 0, bot: true }].sort((a, b) => b.score - a.score)
    : [];

  return (
    <div className="flex flex-col gap-3">
      {isHost && (!s || s.phase === "over") && (
        <div className="flex flex-col gap-3 rounded-2xl border border-line bg-panel p-4 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="mr-1 text-soft">Each player draws:</span>
            {[1, 2, 3].map((k) => (
              <button key={k} type="button" onClick={() => setPer(k)} aria-pressed={per === k} className={cx("rounded-full border-2 px-4 py-1.5 text-sm font-semibold", per === k ? "border-core bg-core/15 text-core" : "border-line text-soft hover:text-fg")}>
                {k}×
              </button>
            ))}
            <span className="text-faint">({atTable.length} players · {atTable.length * per} rounds)</span>
          </div>
          <button type="button" onClick={() => start(per)} disabled={atTable.length < 2} className="self-start rounded-full bg-core px-6 py-2.5 text-base font-bold text-core-ink disabled:opacity-50">
            {s?.phase === "over" ? "Play again" : "Start Draw & Guess"}
          </button>
        </div>
      )}
      {!isHost && !s && <p className="text-sm text-soft">Connected! {party.hostName} is setting up Draw &amp; Guess.</p>}

      {s && (
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2 rounded-lg border border-line bg-panel px-3 py-2 text-sm">
              {s.phase === "over" ? (
                <span className="font-medium">Game over!</span>
              ) : (
                <>
                  <span className="text-soft">
                    Round {s.n}/{s.total} · {s.drawer === me ? "you draw" : `${s.names[s.drawer]} draws`}
                  </span>
                  <span className="mx-auto font-mono text-base tracking-widest">{s.word ? <span className={s.drawer === me ? "text-core" : "text-ok"}>{s.drawer === me && s.phase === "playing" ? `Draw: ${s.word}` : s.word}</span> : s.len}</span>
                  <span className={cx("font-mono tabular-nums", secs <= 10 ? "text-alert" : "text-soft")}>{s.phase === "playing" ? `${secs}s` : "…"}</span>
                </>
              )}
            </div>
            <canvas ref={canvas} width={600} height={600} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} className={cx("aspect-square w-full max-w-[min(100%,66dvh)] touch-none self-center rounded-lg border-2 border-line bg-white", drawing ? "cursor-crosshair" : "cursor-default")} />
            {drawing && (
              <div className="flex items-center justify-center gap-2">
                {COLORS.map((c) => (
                  <button key={c} type="button" aria-label={`Colour ${c}`} onClick={() => setColor(c)} className={cx("size-7 rounded-full border-2", color === c ? "border-core" : "border-line")} style={{ background: c }} />
                ))}
                <button type="button" aria-label="Eraser" onClick={() => setColor("#ffffff")} className={cx("flex size-7 items-center justify-center rounded-full border-2 bg-white text-black", color === "#ffffff" ? "border-core" : "border-line")}>
                  <Eraser size={13} />
                </button>
                <button type="button" aria-label="Clear" onClick={() => send({ type: "clear" })} className="flex size-7 items-center justify-center rounded-full border-2 border-line text-soft">
                  <Trash2 size={13} />
                </button>
              </div>
            )}
            {/* Right under the picture, so a guesser on a phone sees both without scrolling. */}
            {canGuess && (
              <form onSubmit={submit} className="flex gap-2">
                <input value={guess} onChange={(e) => setGuess(e.target.value)} placeholder="Type your guess…" aria-label="Your guess" className="min-w-0 flex-1 rounded-md border border-line bg-sunken px-3 py-2 text-base" autoComplete="off" enterKeyHint="send" />
                <button type="submit" className="rounded-md bg-core px-4 text-sm font-medium text-core-ink">
                  Guess
                </button>
              </form>
            )}
            {/* The latest line of the feed, so phone players see guesses without scrolling to the full feed. */}
            {s.feed.length > 0 && (
              <p className="truncate text-sm lg:hidden">
                {s.feed[s.feed.length - 1].who && <span className="font-medium">{s.feed[s.feed.length - 1].who}: </span>}
                {s.feed[s.feed.length - 1].text}
              </p>
            )}
          </div>

          <div className="flex min-h-56 flex-col gap-2">
            <ul className="space-y-1 rounded-lg border border-line bg-panel p-2 text-sm">
              {board.map((p, i) => (
                <li key={p.id} className={cx("flex items-center gap-2 rounded-md px-2 py-1", s.phase === "playing" && p.id === s.drawer && "bg-core/10")}>
                  <span className="w-4 font-mono text-xs text-faint">{s.phase === "over" && i === 0 ? <Trophy size={13} className="text-core" /> : i + 1}</span>
                  <span className="flex-1 truncate">
                    {p.bot && <Bot size={12} className="mr-1 inline text-data" />}
                    {p.name}
                    {p.id === me && <span className="text-faint"> (you)</span>}
                    {s.phase === "playing" && p.id === s.drawer && " ✏️"}
                    {s.guessed.includes(p.id) && " ✅"}
                    {p.bot && s.aiGot && " ✅"}
                  </span>
                  <b className="font-mono tabular-nums">{p.score}</b>
                </li>
              ))}
            </ul>
            <div className="flex min-h-40 flex-1 flex-col rounded-lg border border-line bg-panel">
              <div className="flex-1 space-y-1 overflow-y-auto p-3 text-sm">
                {s.feed.map((l, k) => (
                  <p key={k} className={cx(l.kind === "ok" && "font-medium text-ok", l.kind === "ai" && "text-data", l.kind === "info" && "font-mono text-[11px] tracking-wider text-faint uppercase")}>
                    {l.who && <span className="font-medium">{l.who}: </span>}
                    {l.text}
                  </p>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
