"use client";

import { Bot, Crown, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { cx } from "@/components/ui";
import { useVoiceActions } from "@/components/voice/provider";
import { type Party, usePartyGame } from "@/lib/games/party";
import { here, seatsFor } from "@/lib/games/party-rules";
import { usePeerGame } from "@/lib/games/peer-game";
import { gameKey, recordResult } from "@/lib/games/record";
import { cellOfSquare, GOAL, LADDERS, newSnakes, rollSnakes, SNAKES, standings, type SnakeColor, type SnakesState } from "@/lib/games/snakes";
import { sfx } from "@/lib/sfx";

/**
 * Snakes & Ladders: against HIVEMIND's bots on this device, or with everyone at game night (up to 6).
 * The owner's browser rolls the dice and runs the rules; friends' taps are requests it checks.
 */
type Action = { type: "roll" };

const FILL: Record<SnakeColor, string> = { red: "#e5484d", blue: "#2f7fe8", green: "#2fa34a", yellow: "#f5b400", purple: "#8e4ec6", orange: "#f76b15" };
const dice = () => (crypto.getRandomValues(new Uint32Array(1))[0] % 6) + 1;
const PIPS: Record<number, [number, number][]> = {
  1: [[50, 50]],
  2: [[28, 28], [72, 72]],
  3: [[25, 25], [50, 50], [75, 75]],
  4: [[28, 28], [72, 28], [28, 72], [72, 72]],
  5: [[25, 25], [75, 25], [50, 50], [25, 75], [75, 75]],
  6: [[28, 22], [72, 22], [28, 50], [72, 50], [28, 78], [72, 78]],
};
const okState = (s: unknown): s is SnakesState => {
  const x = s as SnakesState;
  return !!x && Array.isArray(x.seats) && x.seats.length >= 2 && x.seats.length <= 6 && typeof x.pos === "object" && Number.isInteger(x.turn) && Array.isArray(x.log);
};

export function SnakesGame({ myName, party = null }: { myName: string; /** Game night: everyone in the lobby plays (up to 6). */ party?: Party | null }) {
  const isHost = party ? party.role === "host" : true;
  const me = party ? party.me : "host";
  const sRef = useRef<SnakesState | null>(null);
  const publishRef = useRef<(s: SnakesState) => void>(() => {});
  const apply = useCallback((fn: (s: SnakesState) => SnakesState) => {
    const cur = sRef.current;
    if (!cur) return;
    const next = fn(cur);
    if (next !== cur) {
      sRef.current = next;
      publishRef.current(next);
    }
  }, []);
  const onSeat = (seat: string, a: Action) => apply((s) => (a?.type === "roll" ? rollSnakes(s, seat, dice()) : s));
  const solo = usePeerGame<SnakesState, Action>({ role: "host", kind: "snakes", room: "solo", myName, hostName: myName, accept: okState, onAction: () => {}, solo: true, off: !!party });
  const partyNet = usePartyGame<SnakesState, Action>(party, "snakes", { accept: okState, onAction: (from, a) => onSeat(from, a) });
  const net = partyNet ?? solo;
  const { state: s, publish, act, connected } = net;
  useEffect(() => {
    sRef.current = s;
    publishRef.current = publish;
  });

  const [bots, setBots] = useState(1);
  function start(n = bots) {
    const people = party ? seatsFor(party.players, 6) : [{ id: "host", name: myName }];
    const room = 6 - people.length;
    const fill = Math.min(room, party ? n : Math.max(1, n));
    const g = newSnakes([...people, ...Array.from({ length: fill }, (_, i) => ({ id: `bot${i + 1}`, name: i ? `HIVEMIND ${i + 1}` : "HIVEMIND", bot: true }))]);
    if (g.seats.length < 2) return;
    sRef.current = g;
    publish(g);
    sfx.boot();
  }

  // Host: HIVEMIND rolls for its bots, and for a friend who dropped out (until they're back).
  useEffect(() => {
    if (!isHost || !s || s.over || !connected) return;
    const seat = s.seats[s.turn];
    const away = !!party && !seat.bot && seat.id !== "host" && !party.players.find((p) => p.id === seat.id)?.online;
    if (!seat.bot && !away) return;
    // Long enough to watch the last move play out.
    // After the last move has played out on screen, and a moment to see it.
    const t = setTimeout(() => apply((cur) => (cur.seq !== s.seq ? cur : rollSnakes(cur, seat.id, dice()))), moveMs(s) + (away ? 2600 : 1400));
    return () => clearTimeout(t);
  }, [isHost, s, connected, apply, party]);

  // The owner's record.
  useEffect(() => {
    if (!isHost || !s?.over || !s.winner) return;
    const humans = s.seats.filter((x) => !x.bot && x.id !== "host");
    recordResult(`snakes-${party ? "party" : "solo"}-${gameKey(s.seq, s.winner, ...s.seats.map((x) => x.id))}`, {
      game: "snakes",
      mode: humans.length ? "friend" : "bot",
      outcome: s.winner === "host" ? "win" : "loss",
      vs: humans.length ? humans.map((x) => x.name).join(", ") : "HIVEMIND",
      detail: `${s.seats.length} players`,
    });
  }, [isHost, s, party]);

  const myTurn = !!s && !s.over && s.seats[s.turn]?.id === me;
  const canRoll = myTurn && connected;
  function doRoll() {
    if (!canRoll) return;
    if (isHost) apply((cur) => rollSnakes(cur, me, dice()));
    else act({ type: "roll" });
  }
  const turnSeat = s && !s.over ? s.seats[s.turn] : null;

  useVoiceActions({
    snakes_start: {
      description: "Snakes & Ladders page: start a game (the owner only). input: how many HIVEMIND bots to add (0–5), if said.",
      run: ({ input }) => {
        if (!isHost) return { error: "Only the host starts the game." };
        const n = Number(String(input ?? "").match(/\d/)?.[0]);
        start(Number.isInteger(n) ? n : bots);
        return { started: true };
      },
    },
    snakes_roll: {
      description: "Snakes & Ladders page: roll the dice on the owner's turn.",
      run: () => {
        if (!s) return { error: "No game yet." };
        if (!canRoll) return { error: s.over ? "The game is over." : `It's ${turnSeat?.name ?? "someone else"}'s turn.` };
        doRoll();
        return { rolled: true, note: "Say what happened once the token stops (snakes_status)." };
      },
    },
    snakes_status: {
      description: "Snakes & Ladders page: where everyone is, whose turn it is, the last roll, and the winner.",
      run: () =>
        s
          ? { squares: Object.fromEntries(s.seats.map((x) => [x.id === me ? "you" : x.name, s.pos[x.id]])), turn: s.over ? "game over" : turnSeat?.id === me ? "yours" : turnSeat?.name, last: s.log[s.log.length - 1], winner: s.winner ? s.seats.find((x) => x.id === s.winner)?.name : null }
          : { error: "No game yet." },
    },
  });

  const people = party ? here(party.players).length : 1;
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-3">
      {s && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {s.seats.map((seat, i) => (
            <span key={seat.id} className={cx("flex items-center gap-1.5 rounded-full border px-3 py-1", s.turn === i && !s.over ? "border-core bg-core/10" : "border-line")}>
              <span className="size-3 rounded-full" style={{ background: FILL[seat.color] }} />
              {seat.bot && <Bot size={12} className="text-data" />}
              <span className="max-w-28 truncate">{seat.id === me ? `${seat.name} (you)` : seat.name}</span>
              <b className="font-mono text-xs tabular-nums">{s.pos[seat.id] || "–"}</b>
            </span>
          ))}
        </div>
      )}
      {s && (
        <p className="rounded-xl border border-core/30 bg-core/[0.07] px-3 py-2 text-sm">
          <b>🏆 How to win:</b> <span className="text-soft">be first to land exactly on 100. A ladder 🪜 takes you up, a snake 🐍 sends you down, a 6 rolls again (three 6s in a row lose the turn).</span>
        </p>
      )}
      {!s && !isHost && <p className="text-sm text-soft">Connected! {party?.hostName} is setting up Snakes &amp; Ladders.</p>}

      {isHost && (!s || s.over) && (
        <div className="flex flex-col gap-2 rounded-xl border border-line bg-panel p-3 text-sm">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-soft">HIVEMIND bots:</span>
            {(party ? [0, 1, 2, 3, 4, 5] : [1, 2, 3, 4, 5]).filter((n) => n + people <= 6).map((n) => (
              <button key={n} type="button" onClick={() => setBots(n)} aria-pressed={bots === n} className={cx("rounded-full border px-3 py-1 text-xs", bots === n ? "border-core bg-core/15 text-core" : "border-line text-soft hover:text-fg")}>
                {n === 0 ? "None" : n}
              </button>
            ))}
          </div>
          <button type="button" onClick={() => start()} disabled={people + bots < 2} className="inline-flex items-center gap-1.5 self-start rounded-full bg-core px-5 py-2 text-sm font-semibold text-core-ink disabled:opacity-50">
            {s?.over ? <RotateCcw size={14} /> : null} {s?.over ? "Play again" : "Start Snakes & Ladders"}
          </button>
        </div>
      )}

      {s && (
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_280px]">
          <Board s={s} me={me} />
          <div className="flex flex-col gap-3">
            {/* On a phone this bar stays at the bottom of the screen, so Roll is always in reach. */}
            <div className="sticky bottom-[calc(var(--tabbar-h,0px)+0.5rem)] z-30 flex items-center justify-between gap-3 rounded-xl border border-line bg-panel/95 p-3 shadow-lg backdrop-blur lg:static lg:justify-center lg:gap-4 lg:p-4 lg:shadow-none">
              <Dice s={s} />
              <span className={cx("min-w-0 flex-1 text-sm lg:hidden", myTurn ? "font-semibold text-core" : "text-soft")}>{s.over ? "Game over" : myTurn ? "Your turn!" : `${turnSeat?.name}'s turn…`}</span>
              <button type="button" onClick={doRoll} disabled={!canRoll} className={cx("rounded-full px-6 py-3 text-base font-semibold transition-opacity disabled:opacity-30", canRoll ? "animate-pulse bg-core text-core-ink" : "bg-raised text-soft")}>
                🎲 Roll
              </button>
            </div>
            {!s.over && <p className={cx("hidden text-center text-sm lg:block", myTurn ? "font-semibold text-core" : "text-soft")}>{myTurn ? "Your turn: roll the dice!" : `${turnSeat?.name}'s turn…`}</p>}
            {s.over && <Podium s={s} me={me} />}
            <div className="max-h-56 space-y-1 overflow-y-auto rounded-xl border border-line bg-panel p-3 text-sm">
              {[...s.log].reverse().map((l, i) => (
                <p key={i} className={cx(i === 0 ? "text-fg" : "text-soft", /ladder|bitten|wins/.test(l) && "font-medium")}>
                  {l}
                </p>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Dice({ s }: { s: SnakesState }) {
  const r = s.lastRoll;
  const seat = r ? s.seats.find((x) => x.id === r.seat) : null;
  const color = seat ? FILL[seat.color] : "#9aa3ad";
  const [face, setFace] = useState<number | null>(r?.value ?? null);
  const seen = useRef(r?.seq ?? -1);
  const rollSeq = r?.seq;
  const rollValue = r?.value;
  useEffect(() => {
    if (rollSeq === undefined || rollValue === undefined || rollSeq === seen.current) return;
    seen.current = rollSeq;
    sfx.send();
    let n = 0;
    const t = setInterval(() => {
      n++;
      if (n >= 6) {
        clearInterval(t);
        setFace(rollValue);
        return;
      }
      setFace(1 + Math.floor(Math.random() * 6));
    }, 70);
    return () => {
      clearInterval(t);
      setFace(rollValue);
    };
  }, [rollSeq, rollValue]);
  return (
    <div className="flex flex-col items-center gap-1">
      <svg viewBox="0 0 100 100" className="size-16" aria-label={r ? `${seat?.name} rolled ${r.value}` : "Dice"}>
        <rect x="4" y="4" width="92" height="92" rx="18" fill="#fff" stroke={color} strokeWidth="6" />
        {(face ? PIPS[face] : []).map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r="8.5" fill={face === 1 ? color : "#111"} />
        ))}
      </svg>
      <span className="h-4 text-xs text-soft">{r && face === r.value ? `${seat?.name.split(" ")[0]} rolled ${r.value}` : ""}</span>
    </div>
  );
}

function Podium({ s, me }: { s: SnakesState; me: string }) {
  const order = standings(s);
  return (
    <div className="rounded-xl bg-raised p-3 text-center">
      <Crown size={22} className="mx-auto text-core" />
      <div className="mt-1 font-semibold">{s.winner === me ? "You win! 🎉" : `${order[0]?.name} wins!`}</div>
      <div className="text-xs text-soft">{order.map((x, i) => `${i + 1}. ${x.name}`).join(" · ")}</div>
    </div>
  );
}

/* ── the board ── */

const center = (n: number) => {
  const { r, c } = cellOfSquare(n);
  return { x: c * 10 + 5, y: r * 10 + 5 };
};
const STEP_MS = 300;
const SLIDE_MS = 1100;
/** How long the last move takes on screen: the walk, then the climb or the slide. */
const moveMs = (s: SnakesState) => {
  const L = s.last;
  if (!L || L.seq !== s.seq) return 0;
  return (L.walk - L.from) * STEP_MS + (L.via ? SLIDE_MS + 300 : 0);
};

/** A ladder: two rails and rungs, from foot to top. */
function Ladder({ from, to }: { from: number; to: number }) {
  const a = center(from);
  const b = center(to);
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const nx = ((b.y - a.y) / len) * 1.8;
  const ny = (-(b.x - a.x) / len) * 1.8;
  const rungs = Math.max(2, Math.round(len / 4));
  return (
    <g stroke="#8a5a2b" strokeLinecap="round" opacity={0.92}>
      <line x1={a.x + nx} y1={a.y + ny} x2={b.x + nx} y2={b.y + ny} strokeWidth={0.9} />
      <line x1={a.x - nx} y1={a.y - ny} x2={b.x - nx} y2={b.y - ny} strokeWidth={0.9} />
      {Array.from({ length: rungs }, (_, k) => {
        const t = (k + 0.5) / rungs;
        const x = a.x + (b.x - a.x) * t;
        const y = a.y + (b.y - a.y) * t;
        return <line key={k} x1={x + nx} y1={y + ny} x2={x - nx} y2={y - ny} strokeWidth={0.6} />;
      })}
    </g>
  );
}

/** A snake: a wavy body from head to tail, with eyes. */
function snakePath(from: number, to: number) {
  const a = center(from);
  const b = center(to);
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const nx = (b.y - a.y) / len;
  const ny = -(b.x - a.x) / len;
  const waves = Math.max(2, Math.round(len / 12));
  let d = `M ${a.x} ${a.y}`;
  for (let k = 1; k <= waves; k++) {
    const t0 = (k - 0.5) / waves;
    const t1 = k / waves;
    const side = (k % 2 ? 1 : -1) * 3.2;
    d += ` Q ${a.x + (b.x - a.x) * t0 + nx * side} ${a.y + (b.y - a.y) * t0 + ny * side} ${a.x + (b.x - a.x) * t1} ${a.y + (b.y - a.y) * t1}`;
  }
  return d;
}
const SNAKE_HUES = ["#2fa34a", "#e5484d", "#8e4ec6", "#f76b15", "#2f7fe8"];
function Snake({ from, to, i }: { from: number; to: number; i: number }) {
  const a = center(from);
  const col = SNAKE_HUES[i % SNAKE_HUES.length];
  return (
    <g>
      <path d={snakePath(from, to)} fill="none" stroke="#00000055" strokeWidth={2.4} strokeLinecap="round" transform="translate(0.3 0.4)" />
      <path d={snakePath(from, to)} fill="none" stroke={col} strokeWidth={2} strokeLinecap="round" />
      <path d={snakePath(from, to)} fill="none" stroke="#ffffff66" strokeWidth={0.5} strokeDasharray="1 1.6" strokeLinecap="round" />
      <circle cx={a.x} cy={a.y} r={2} fill={col} />
      <circle cx={a.x - 0.7} cy={a.y - 0.5} r={0.45} fill="#fff" />
      <circle cx={a.x + 0.7} cy={a.y - 0.5} r={0.45} fill="#fff" />
      <circle cx={a.x - 0.7} cy={a.y - 0.5} r={0.22} fill="#000" />
      <circle cx={a.x + 0.7} cy={a.y - 0.5} r={0.22} fill="#000" />
    </g>
  );
}

const TILE = ["#fff6dc", "#ffe4b8"];

function Board({ s, me }: { s: SnakesState; me: string }) {
  // The last move played out: square by square, then up the ladder or down the snake.
  const [anim, setAnim] = useState<{ seat: string; at: { x: number; y: number }; slide: boolean } | null>(null);
  const [banner, setBanner] = useState<{ seq: number; text: string; kind: "ladder" | "snake" | "win" } | null>(null);
  const seen = useRef(s.last?.seq ?? -1);
  const game = useRef(s);
  useEffect(() => {
    game.current = s;
  });
  const lastSeq = s.last?.seq;
  useEffect(() => {
    const L = game.current.last;
    if (!L || L.seq !== lastSeq || L.seq === seen.current) return;
    seen.current = L.seq;
    const steps = Array.from({ length: L.walk - L.from }, (_, k) => L.from + 1 + k);
    const timers: ReturnType<typeof setTimeout>[] = [];
    steps.forEach((n, k) =>
      timers.push(
        setTimeout(() => {
          sfx.hover();
          setAnim({ seat: L.seat, at: center(n), slide: false });
        }, k * STEP_MS),
      ),
    );
    const after = steps.length * STEP_MS;
    if (L.via) {
      timers.push(
        setTimeout(() => {
          if (L.via === "ladder") sfx.done();
          else sfx.error();
          setAnim({ seat: L.seat, at: center(L.to), slide: true });
          const who = game.current.seats.find((x) => x.id === L.seat);
          const name = L.seat === me ? "You" : (who?.name ?? "");
          setBanner({ seq: L.seq, kind: L.via!, text: L.via === "ladder" ? `🪜 ${name} climbed a ladder! ${L.walk} → ${L.to}` : `🐍 ${name} got bitten! ${L.walk} → ${L.to}` });
        }, after + 120),
      );
    }
    if (L.to === GOAL) {
      const who = game.current.seats.find((x) => x.id === L.seat);
      timers.push(setTimeout(() => setBanner({ seq: L.seq, kind: "win", text: `🏆 ${L.seat === me ? "You win" : `${who?.name ?? ""} wins`}!` }), after + (L.via ? SLIDE_MS + 200 : 100)));
    }
    timers.push(setTimeout(() => setBanner((b) => (b?.seq === L.seq && b.kind !== "win" ? null : b)), after + (L.via ? SLIDE_MS + 2200 : 0)));
    timers.push(setTimeout(() => setAnim(null), after + (L.via ? SLIDE_MS + 200 : 60)));
    return () => {
      timers.forEach(clearTimeout);
      setAnim(null);
    };
  }, [lastSeq, me]);

  // Tokens: several on one square sit side by side.
  const bySquare = new Map<number, string[]>();
  for (const seat of s.seats) {
    const p = s.pos[seat.id];
    if (p > 0) bySquare.set(p, [...(bySquare.get(p) ?? []), seat.id]);
  }
  const offBoard = s.seats.filter((x) => s.pos[x.id] === 0);
  const turnId = s.seats[s.turn]?.id;

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative aspect-square w-full max-w-[min(100%,72dvh)] overflow-hidden rounded-xl border-2 border-line shadow-sm">
        <svg viewBox="0 0 100 100" className="absolute inset-0 size-full" aria-label="Snakes and ladders board">
          {Array.from({ length: GOAL }, (_, k) => {
            const n = k + 1;
            const { r, c } = cellOfSquare(n);
            return (
              <g key={n}>
                <rect x={c * 10} y={r * 10} width={10} height={10} fill={n === GOAL ? "#ffd84d" : TILE[(r + c) % 2]} stroke="#e6c79a" strokeWidth={0.15} />
                <text x={c * 10 + 1} y={r * 10 + 3} fontSize={2.6} fill="#9a7650" fontWeight={700}>
                  {n}
                </text>
              </g>
            );
          })}
          <text x={5} y={7.6} textAnchor="middle" fontSize={4.6}>
            🏆
          </text>
          {Object.entries(LADDERS).map(([a, b]) => (
            <Ladder key={`l${a}`} from={Number(a)} to={b} />
          ))}
          {Object.entries(SNAKES).map(([a, b], i) => (
            <Snake key={`s${a}`} from={Number(a)} to={b} i={i} />
          ))}
        </svg>
        {banner && (banner.kind !== "win" || s.over) && (
          <div className="pointer-events-none absolute inset-x-0 top-1/2 z-30 flex -translate-y-1/2 justify-center px-3">
            <span key={banner.seq} className={cx("snakes-banner rounded-2xl px-4 py-2 text-center text-base font-black text-white shadow-2xl sm:text-xl", banner.kind === "ladder" ? "bg-[#15803d]" : banner.kind === "snake" ? "bg-[#b91c1c]" : "bg-[#b45309]")}>
              {banner.text}
            </span>
          </div>
        )}
        {s.seats.map((seat) => {
          const moving = anim?.seat === seat.id;
          const p = s.pos[seat.id];
          if (!moving && p === 0) return null;
          const group = bySquare.get(p) ?? [seat.id];
          const k = group.indexOf(seat.id);
          const at = moving ? anim!.at : center(p);
          const dx = !moving && group.length > 1 ? ((k % 3) - 1) * 2.6 : 0;
          const dy = !moving && group.length > 1 ? (Math.floor(k / 3) - 0.5) * 2.6 : 0;
          return (
            <span
              key={seat.id}
              aria-label={`${seat.name} on ${p}`}
              className={cx("absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-md", moving && "z-20", seat.id === turnId && !s.over && "ring-2 ring-core")}
              style={{
                left: `${at.x + dx}%`,
                top: `${at.y + dy}%`,
                width: "5.2%",
                height: "5.2%",
                background: `radial-gradient(circle at 35% 30%, #ffffffaa, ${FILL[seat.color]} 45%)`,
                transition: moving && anim!.slide ? `left ${SLIDE_MS}ms ease-in-out, top ${SLIDE_MS}ms ease-in-out` : `left ${STEP_MS - 20}ms ease-out, top ${STEP_MS - 20}ms ease-out`,
              }}
            >
              {seat.id === me && <span className="flex size-full items-center justify-center text-[9px] font-black text-white [text-shadow:0_1px_2px_#000]">★</span>}
            </span>
          );
        })}
      </div>
      {offBoard.length > 0 && (
        <p className="flex flex-wrap items-center gap-1.5 text-xs text-soft">
          Not on the board yet:
          {offBoard.map((x) => (
            <span key={x.id} className="inline-flex items-center gap-1">
              <span className="size-2.5 rounded-full" style={{ background: FILL[x.color] }} />
              {x.id === me ? "you" : x.name}
            </span>
          ))}
        </p>
      )}
    </div>
  );
}
