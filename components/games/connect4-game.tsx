"use client";

import { Bot, Crown, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { cx } from "@/components/ui";
import { useVoiceActions } from "@/components/voice/provider";
import { botColumn, COLS, drop, landing, newConnect4, ROWS, type C4Level, type C4State } from "@/lib/games/connect4";
import { type Party, usePartyGame } from "@/lib/games/party";
import { seatsFor } from "@/lib/games/party-rules";
import { usePeerGame } from "@/lib/games/peer-game";
import { gameKey, recordResult } from "@/lib/games/record";
import { sfx } from "@/lib/sfx";

/**
 * Connect Four: drop discs, first to line up four wins. Against HIVEMIND on this device (three
 * levels), or with a friend at game night: the first two in the lobby play and the rest watch. The
 * owner's browser runs the rules; a friend's tap is only a request it checks.
 */
type Action = { type: "drop"; col: number };

const COLORS = ["#e5484d", "#f5b400"];
const LEVELS: { id: C4Level; label: string }[] = [
  { id: "easy", label: "Easy" },
  { id: "medium", label: "Medium" },
  { id: "hard", label: "Hard" },
];

const okState = (s: unknown): s is C4State => {
  const x = s as C4State;
  return !!x && Array.isArray(x.seats) && x.seats.length === 2 && Array.isArray(x.board) && x.board.length === COLS * ROWS && x.board.every((v) => v === -1 || v === 0 || v === 1) && (x.turn === 0 || x.turn === 1) && Array.isArray(x.line) && Array.isArray(x.log);
};

export function Connect4Game({ myName, party = null }: { myName: string; /** Game night: the first two in the lobby play. */ party?: Party | null }) {
  const isHost = party ? party.role === "host" : true;
  const me = party ? party.me : "host";
  const sRef = useRef<C4State | null>(null);
  const publishRef = useRef<(s: C4State) => void>(() => {});
  const apply = useCallback((fn: (s: C4State) => C4State) => {
    const cur = sRef.current;
    if (!cur) return;
    const next = fn(cur);
    if (next !== cur) {
      sRef.current = next;
      publishRef.current(next);
    }
  }, []);
  const solo = usePeerGame<C4State, Action>({ role: "host", kind: "connect4", room: "solo", myName, hostName: myName, accept: okState, onAction: () => {}, solo: true, off: !!party });
  const partyNet = usePartyGame<C4State, Action>(party, "connect4", { accept: okState, onAction: (from, a) => apply((cur) => (a?.type === "drop" ? drop(cur, from, Number(a.col)) : cur)) });
  const net = partyNet ?? solo;
  const { state: s, publish, act, connected } = net;
  useEffect(() => {
    sRef.current = s;
    publishRef.current = publish;
  });

  const [level, setLevel] = useState<C4Level>("medium");
  // Who goes first alternates, so a rematch gives the other side the opening.
  const flip = useRef(false);
  function start(opt?: { level?: C4Level }) {
    const lv = opt?.level ?? level;
    if (opt?.level) setLevel(lv);
    const people = party ? seatsFor(party.players, 2) : [{ id: "host", name: myName }];
    const pair = people.length >= 2 ? [people[0], people[1]] : [people[0], { id: "bot1", name: "HIVEMIND", bot: true }];
    const ordered = flip.current ? [pair[1], pair[0]] : pair;
    flip.current = !flip.current;
    const g = newConnect4(ordered as Parameters<typeof newConnect4>[0]);
    sRef.current = g;
    levelRef.current = lv;
    publish(g);
    sfx.boot();
  }
  const levelRef = useRef<C4Level>("medium");
  useEffect(() => {
    levelRef.current = level;
  }, [level]);

  // Host: HIVEMIND drops for its seat, and for a friend who dropped out (until they're back).
  useEffect(() => {
    if (!isHost || !s || s.over || !connected) return;
    const seat = s.seats[s.turn];
    const away = !!party && !seat.bot && seat.id !== "host" && !party.players.find((p) => p.id === seat.id)?.online;
    if (!seat.bot && !away) return;
    const t = setTimeout(() => apply((cur) => (cur.seq !== s.seq ? cur : drop(cur, seat.id, botColumn(cur, levelRef.current) ?? -1))), (away ? 2500 : 750) + (s.seq === 0 ? 400 : 0));
    return () => clearTimeout(t);
  }, [isHost, s, connected, apply, party]);

  // Sounds: a disc, the end.
  const lastSeq = s?.last?.seq;
  const over = !!s?.over;
  useEffect(() => {
    if (lastSeq) sfx.hover();
  }, [lastSeq]);
  useEffect(() => {
    if (over) sfx.done();
  }, [over]);

  // The owner's record.
  useEffect(() => {
    if (!isHost || !s?.over) return;
    const mine = s.seats.findIndex((x) => x.id === "host");
    if (mine < 0) return;
    const other = s.seats[1 - mine];
    recordResult(`connect4-${party ? "party" : "solo"}-${s.id ?? gameKey(s.seq, ...s.board)}`, {
      game: "connect4",
      mode: other.bot ? "bot" : "friend",
      outcome: s.winner < 0 ? "draw" : s.winner === mine ? "win" : "loss",
      vs: other.name,
      level: other.bot ? levelRef.current : undefined,
      detail: s.winner < 0 ? "a draw" : `${s.board.filter((v) => v >= 0).length} discs`,
    });
  }, [isHost, s, party]);

  const myIndex = s ? s.seats.findIndex((x) => x.id === me) : -1;
  const myTurn = !!s && !s.over && s.turn === myIndex && connected;
  const watching = !!s && myIndex < 0;
  function play(col: number) {
    if (!myTurn || !s || landing(s.board, col) < 0) return;
    if (isHost) apply((cur) => drop(cur, me, col));
    else act({ type: "drop", col });
  }

  useVoiceActions({
    c4_start: {
      description: "Connect Four page: start a game. input: 'easy', 'medium' or 'hard' for HIVEMIND's level (against HIVEMIND).",
      run: ({ input }) => {
        if (!isHost || !connected) return { error: "Only the host can start." };
        const t = String(input ?? "").toLowerCase();
        start({ level: /easy/.test(t) ? "easy" : /hard/.test(t) ? "hard" : /medium|normal/.test(t) ? "medium" : undefined });
        return { started: true };
      },
    },
    c4_drop: {
      description: "Connect Four page: drop a disc on the owner's turn. input: the column, 1 (left) to 7 (right).",
      run: ({ input }) => {
        if (!s) return { error: "No game yet." };
        if (!myTurn) return { error: s.over ? "The game is over." : `It's ${s.seats[s.turn].name}'s turn.` };
        const n = Number(String(input ?? "").match(/[1-7]/)?.[0]);
        if (!n) return { error: "Say a column from 1 (left) to 7 (right)." };
        if (landing(s.board, n - 1) < 0) return { error: "That column is full." };
        play(n - 1);
        return { dropped: n };
      },
    },
    c4_status: {
      description: "Connect Four page: whose turn it is and how full the board is.",
      run: () => (s ? { turn: s.over ? "game over" : s.seats[s.turn].name, discs: s.board.filter((v) => v >= 0).length, winner: s.winner >= 0 ? s.seats[s.winner].name : undefined } : { error: "No game yet." }),
    },
  });

  const turnSeat = s && !s.over ? s.seats[s.turn] : null;
  const status = !s
    ? party
      ? isHost
        ? "Pick a level if HIVEMIND plays, and start."
        : `${party.hostName} is setting up the game.`
      : "You against HIVEMIND. Pick a level and start."
    : s.over
      ? ""
      : watching
        ? `${turnSeat?.name}'s turn… you're watching.`
        : myTurn
          ? "Your turn: tap a column."
          : `${turnSeat?.name}'s turn…`;

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {s?.seats.map((seat, i) => (
          <span key={seat.id} className={cx("flex items-center gap-1.5 rounded-full border px-3 py-1 transition-colors", s.turn === i && !s.over ? "border-core bg-core/10" : "border-line")}>
            <span className="size-3 rounded-full" style={{ background: COLORS[i] }} />
            {seat.bot && <Bot size={12} className="text-data" />}
            <span className="max-w-28 truncate">{seat.id === me ? `${seat.name} (you)` : seat.name}</span>
          </span>
        ))}
        {!s && <span className="text-lg font-black tracking-tight">CONNECT FOUR</span>}
      </div>

      {status && <p className={cx("text-sm", myTurn ? "font-medium text-core" : "text-soft")}>{status}</p>}

      {s?.over && <Result s={s} me={myIndex} />}

      {isHost && connected && (!s || s.over) && (
        <div className="flex flex-col gap-2 rounded-xl border border-line bg-panel p-3 text-sm">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-soft">HIVEMIND plays:</span>
            {LEVELS.map((l) => (
              <button key={l.id} type="button" onClick={() => setLevel(l.id)} aria-pressed={level === l.id} className={cx("rounded-full border px-3 py-1 text-xs", level === l.id ? "border-core bg-core/15 text-core" : "border-line text-soft hover:text-fg")}>
                {l.label}
              </button>
            ))}
          </div>
          {party && seatsFor(party.players, 2).length >= 2 && <p className="text-xs text-soft">The first two in the lobby play; everyone else watches.</p>}
          <button type="button" onClick={() => start()} className="inline-flex items-center gap-1.5 self-start rounded-full bg-core px-5 py-2 text-sm font-semibold text-core-ink">
            {s?.over ? <RotateCcw size={14} /> : null} {s?.over ? "Play again" : "Start"}
          </button>
        </div>
      )}

      {s && <Board s={s} canPlay={myTurn} turnColor={COLORS[s.turn]} onDrop={play} />}
    </div>
  );
}

/** The board: a blue frame with holes, discs that fall into place, the winning four ringed. */
function Board({ s, canPlay, turnColor, onDrop }: { s: C4State; canPlay: boolean; turnColor: string; onDrop: (col: number) => void }) {
  const [hover, setHover] = useState<number | null>(null);
  const win = new Set(s.line);
  return (
    <svg viewBox={`0 0 ${COLS} ${ROWS + 1.4}`} className="mx-auto w-full max-w-[520px] touch-manipulation select-none" role="group" aria-label="Connect Four board">
      {/* The disc that would drop, above the hovered column. */}
      {canPlay && hover !== null && landing(s.board, hover) >= 0 && <circle cx={hover + 0.5} cy={0.5} r={0.4} fill={turnColor} opacity={0.55} />}
      <g transform="translate(0 1)">
        <rect x={0} y={0} width={COLS} height={ROWS} rx={0.25} className="fill-[#1d4ed8]" />
        {Array.from({ length: COLS * ROWS }, (_, i) => {
          const r = Math.floor(i / COLS);
          const c = i % COLS;
          const owner = s.board[i];
          const newest = s.last && s.last.row === r && s.last.col === c;
          return (
            <g key={i}>
              <circle cx={c + 0.5} cy={r + 0.5} r={0.4} className="fill-[#0b1220]" />
              {owner >= 0 && (
                <circle
                  key={newest ? `n${s.last?.seq}` : "o"}
                  cx={c + 0.5}
                  cy={r + 0.5}
                  r={0.4}
                  fill={COLORS[owner]}
                  className={newest ? "c4-fall" : undefined}
                  style={newest ? ({ "--from": `${-(r + 1.4)}px` } as React.CSSProperties) : undefined}
                />
              )}
              {win.has(i) && <circle cx={c + 0.5} cy={r + 0.5} r={0.4} fill="none" stroke="#fff" strokeWidth={0.09} className="c4-win" />}
            </g>
          );
        })}
        {/* Tap areas: each column, top to bottom. */}
        {canPlay &&
          Array.from({ length: COLS }, (_, c) =>
            landing(s.board, c) >= 0 ? (
              <rect key={c} x={c} y={-1} width={1} height={ROWS + 1} fill="transparent" className="cursor-pointer" onPointerEnter={() => setHover(c)} onPointerLeave={() => setHover((h) => (h === c ? null : h))} onClick={() => onDrop(c)}>
                <title>{`Drop in column ${c + 1}`}</title>
              </rect>
            ) : null,
          )}
      </g>
      {Array.from({ length: COLS }, (_, c) => (
        <text key={c} x={c + 0.5} y={ROWS + 1.25} textAnchor="middle" fontSize={0.17} className="fill-faint font-mono">
          {c + 1}
        </text>
      ))}
    </svg>
  );
}

function Result({ s, me }: { s: C4State; me: number }) {
  const draw = s.winner < 0;
  return (
    <div className="rounded-xl bg-raised p-3 text-center">
      <Crown size={22} className="mx-auto text-core" />
      <div className="mt-1 font-semibold">{draw ? "A draw! 🤝" : s.winner === me ? "You win! 🎉" : `${s.seats[s.winner].name} wins!`}</div>
    </div>
  );
}
