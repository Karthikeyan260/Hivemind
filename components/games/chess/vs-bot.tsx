"use client";

import { Chess, type Color, type PieceSymbol, type Square } from "chess.js";
import { Bot, Flag, Lightbulb, RotateCcw, Undo2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { cx } from "@/components/ui";
import { useVoiceActions } from "@/components/voice/provider";
import { LEVELS, type Level } from "@/lib/games/chess-bot";
import { think } from "@/lib/games/chess-think";
import { timeoutResult } from "@/lib/games/chess-time";
import { gameKey, recordResult } from "@/lib/games/record";
import { sfx } from "@/lib/sfx";
import { Board, captured, ClockFace, Taken } from "./board";
import { endOf, left, MoveList, Pick, resultText, spokenMove, TimePicker, tcLabel, type Result, type TimeControl } from "./shared";

/**
 * Chess against HIVEMIND's bot, on this device: four levels, either colour, an optional clock,
 * hints and take-backs. The game is kept on this device, so a reload carries on.
 */
/** turnStart: when the side to move started thinking (the clock runs from there). id: when it began. */
type Saved = { id?: number; history: string[]; me: Color; level: Level; tc: TimeControl; clock: { w: number; b: number } | null; result: Result; turnStart: number };
const KEY = "hm-chess-bot";
// Called from taps and voice commands (never while rendering).
const nowMs = () => Date.now();
const coin = () => Math.random() < 0.5;
const load = (): Saved | null => {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? "null") as Saved | null;
    // The clock was paused while the game was closed.
    return s ? { ...s, turnStart: nowMs() } : null;
  } catch {
    return null;
  }
};

export function ChessVsBot({ myName }: { myName: string }) {
  const [g, setG] = useState<Saved | null>(null);
  const [level, setLevel] = useState<Level>("easy");
  const [colour, setColour] = useState<"w" | "b" | "random">("w");
  const [tc, setTc] = useState<TimeControl>(null);
  const [thinking, setThinking] = useState(false);
  const [hint, setHint] = useState<{ from: Square; to: Square } | null>(null);
  const [now, setNow] = useState(0);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- a saved game only exists in the browser
    setG(load());
  }, []);
  const save = useCallback((next: Saved | null) => {
    setG(next);
    try {
      if (next) localStorage.setItem(KEY, JSON.stringify(next));
      else localStorage.removeItem(KEY);
    } catch {}
  }, []);

  const game = useMemo(() => {
    const c = new Chess();
    for (const m of g?.history ?? []) c.move(m);
    return c;
  }, [g?.history]);
  const turn = game.turn();
  const bot: Color | null = g ? (g.me === "w" ? "b" : "w") : null;
  const names: Record<Color, string> = g ? (g.me === "w" ? { w: myName, b: "HIVEMIND" } : { w: "HIVEMIND", b: myName }) : { w: "", b: "" };

  function start(opts?: { me: Color; level: Level; tc: TimeControl }) {
    const me = opts?.me ?? (colour === "random" ? (coin() ? "w" : "b") : colour);
    const lv = opts?.level ?? level;
    const t = opts ? opts.tc : tc;
    save({ id: nowMs(), history: [], me, level: lv, tc: t, clock: t ? { w: t.base * 60_000, b: t.base * 60_000 } : null, result: null, turnStart: nowMs() });
    setHint(null);
    sfx.boot();
  }

  /** A move by either side: clock (with increment), sounds, and the end of the game. */
  const play = useCallback(
    (san: string) => {
      setG((cur) => {
        if (!cur || cur.result) return cur;
        const c = new Chess();
        for (const m of cur.history) c.move(m);
        const mover = c.turn();
        let m;
        try {
          m = c.move(san);
        } catch {
          return cur;
        }
        let clock = cur.clock;
        if (clock && cur.tc) {
          const spent = nowMs() - cur.turnStart;
          clock = { ...clock, [mover]: clock[mover] - spent + cur.tc.inc * 1000 };
        }
        const result = endOf(c);
        const next = { ...cur, history: [...cur.history, m.san], clock, result, turnStart: nowMs() };
        try {
          localStorage.setItem(KEY, JSON.stringify(next));
        } catch {}
        if (result) sfx.done();
        else if (m.captured) sfx.send();
        else if (c.inCheck()) sfx.lock();
        else sfx.hover();
        return next;
      });
      setHint(null);
    },
    [],
  );

  // The bot's turn.
  const fen = game.fen();
  useEffect(() => {
    if (!g || g.result || turn !== bot) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the bot starts thinking now
    setThinking(true);
    const t0 = nowMs();
    void think(fen, g.level).then(async (san) => {
      // Never instant: a short pause reads as "thinking".
      await new Promise((r) => setTimeout(r, Math.max(0, 450 - (nowMs() - t0))));
      if (cancelled) return;
      setThinking(false);
      if (san) play(san);
    });
    return () => {
      cancelled = true;
    };
  }, [fen, turn, bot, g?.result, g?.level, play, g]);

  // The clock: tick, and a flag falls at zero.
  useEffect(() => {
    if (!g?.clock || g.result) return;
    const t = setInterval(() => {
      const n = nowMs();
      setNow(n);
      const rem = left(g.clock![turn], true, g.turnStart, n);
      if (rem <= 0) {
        sfx.error();
        save({ ...g, clock: { ...g.clock!, [turn]: 0 }, result: timeoutResult(game, turn) });
      }
    }, 100);
    return () => clearInterval(t);
  }, [g, turn, save, game]);

  // A finished game goes into the owner's record (once, even across reloads).
  useEffect(() => {
    if (!g?.result) return;
    recordResult(`chess-bot-${g.id ?? gameKey(...g.history)}`, {
      game: "chess",
      mode: "bot",
      outcome: !g.result.winner ? "draw" : g.result.winner === g.me ? "win" : "loss",
      vs: "HIVEMIND",
      level: g.level,
      detail: g.result.reason,
    });
  }, [g]);

  function onMove(from: Square, to: Square, promotion?: PieceSymbol) {
    const m = game.moves({ verbose: true }).find((x) => x.from === from && x.to === to && (!x.promotion || x.promotion === (promotion ?? "q")));
    if (m) play(m.san);
  }
  function undo() {
    if (!g || thinking) return;
    // Take back the bot's reply and my move.
    const back = turn === g.me ? 2 : 1;
    save({ ...g, history: g.history.slice(0, Math.max(0, g.history.length - back)), result: null, turnStart: nowMs() });
    setHint(null);
  }
  async function getHint() {
    if (!g || thinking || turn !== g.me) return;
    setThinking(true);
    const san = await think(fen, "medium");
    setThinking(false);
    const m = san ? game.moves({ verbose: true }).find((x) => x.san === san) : null;
    if (m) setHint({ from: m.from, to: m.to });
  }

  // Voice: the whole game by speaking ("start medium as black with 5 minutes", "knight to f3", "hint").
  useVoiceActions({
    chess_start: {
      description: "Chess page (vs HIVEMIND): start a new game. input: in words, any of a level (beginner, easy, medium, hard), a colour (white, black, random) and a clock ('5 min', '3 plus 2', or none).",
      run: ({ input }) => {
        const t = String(input ?? "").toLowerCase();
        const lv = (Object.keys(LEVELS) as Level[]).find((l) => t.includes(l)) ?? g?.level ?? level;
        const me: Color = /black/.test(t) ? "b" : /random/.test(t) ? (coin() ? "w" : "b") : /white/.test(t) ? "w" : (g?.me ?? (colour === "random" ? "w" : colour));
        const clock = t.match(/(\d+)\s*(?:min\w*)?\s*(?:\||plus|\+)\s*(\d+)/) ?? t.match(/(\d+)\s*min/);
        const clockTc: TimeControl = clock ? { base: Number(clock[1]), inc: Number(clock[2] ?? 0) } : /no clock|without/.test(t) ? null : (g?.tc ?? tc);
        start({ me, level: lv, tc: clockTc });
        return { started: true, you_play: me === "w" ? "white" : "black", level: lv, clock: tcLabel(clockTc) };
      },
    },
    chess_move: {
      description: "Chess page (vs HIVEMIND): make the owner's move. input: the move as said, e.g. 'e4', 'knight to f3', 'e2 to e4', 'bishop takes c6', 'castle kingside'. If it asks 'which one', ask the owner.",
      run: ({ input }) => {
        if (!g) return { error: "No game yet: start one first." };
        if (g.result) return { error: "The game is over." };
        if (thinking || turn !== g.me) return { error: "Wait: it's HIVEMIND's turn." };
        const r = spokenMove(game, String(input ?? ""));
        if ("error" in r) return r;
        play(r.san);
        return { played: r.san, note: "HIVEMIND replies in a moment; say its move when asked (chess_status)." };
      },
    },
    chess_status: {
      description: "Chess page (vs HIVEMIND): the position in words: last moves, whose turn, check, result, captured material.",
      run: () =>
        g
          ? {
              you_play: g.me === "w" ? "white" : "black",
              last_moves: g.history.slice(-4),
              turn: g.result ? "game over" : turn === g.me ? "yours" : "HIVEMIND's",
              in_check: game.inCheck(),
              result: g.result ? resultText(g.result, g.me, names).title + " " + resultText(g.result, g.me, names).sub : null,
              legal_moves: turn === g.me && !g.result ? game.moves().slice(0, 20) : undefined,
            }
          : { error: "No game yet." },
    },
    chess_hint: { description: "Chess page (vs HIVEMIND): show a hint arrow for the owner's move.", run: async () => (g && turn === g.me && !g.result ? (await getHint(), { hint: "shown on the board" }) : { error: "No hint right now." }) },
    chess_undo: { description: "Chess page (vs HIVEMIND): take back the last move (yours and HIVEMIND's reply).", run: () => (g?.history.length ? (undo(), { undone: true }) : { error: "Nothing to take back." }) },
    chess_resign: {
      description: "Chess page (vs HIVEMIND): resign the game. Only when the owner clearly says to resign.",
      run: () => (g && !g.result ? (save({ ...g, result: { winner: g.me === "w" ? "b" : "w", reason: "resignation" } }), { resigned: true }) : { error: "No game to resign." }),
    },
  });

  if (!g)
    return (
      <div className="flex flex-col gap-4 rounded-2xl border border-line bg-panel p-4">
        <div>
          <p className="mb-2 text-sm font-semibold">How strong is HIVEMIND?</p>
          <Pick options={(Object.keys(LEVELS) as Level[]).map((l) => ({ value: l, label: LEVELS[l].label }))} value={level} onChange={setLevel} />
        </div>
        <div>
          <p className="mb-2 text-sm font-semibold">You play</p>
          <Pick
            options={[
              { value: "w", label: "♔ White" },
              { value: "b", label: "♚ Black" },
              { value: "random", label: "🎲 Random" },
            ]}
            value={colour}
            onChange={setColour}
          />
        </div>
        <div>
          <p className="mb-2 text-sm font-semibold">Clock</p>
          <TimePicker value={tc} onChange={setTc} />
        </div>
        <button type="button" onClick={() => start()} className="self-start rounded-full bg-core px-6 py-2.5 text-base font-bold text-core-ink shadow-lg transition-transform hover:scale-105">
          Start the game
        </button>
      </div>
    );

  const { taken, lead } = captured(g.history);
  const opp = bot!;
  const clockOf = (c: Color) => (g.clock ? left(g.clock[c], !g.result && turn === c, g.turnStart, Math.max(now, g.turnStart)) : null);
  const end = g.result ? resultText(g.result, g.me, names) : null;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
      <div className="flex flex-col gap-2">
        <PlayerBar name={`HIVEMIND · ${LEVELS[g.level].label}`} icon={<Bot size={16} />} active={!g.result && turn === opp} thinking={thinking && turn === opp} clock={clockOf(opp)} taken={<Taken pieces={taken[opp]} by={opp} lead={opp === "w" ? lead : -lead} />} />
        <div className="relative">
          <Board history={g.history} orientation={g.me} canMove={!g.result && !thinking} onMove={onMove} hint={hint} />
          {end && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center rounded-lg bg-black/55 backdrop-blur-[2px]">
              <div className="text-3xl font-black text-white drop-shadow">{end.title}</div>
              <div className="mt-1 text-sm text-white/80">{end.sub}</div>
              <div className="mt-4 flex gap-2">
                <button type="button" onClick={() => start({ me: g.me, level: g.level, tc: g.tc })} className="flex items-center gap-1.5 rounded-full bg-core px-5 py-2 font-bold text-core-ink">
                  <RotateCcw size={15} /> Rematch
                </button>
                <button type="button" onClick={() => save(null)} className="rounded-full border-2 border-white/60 px-5 py-2 font-bold text-white">
                  New game
                </button>
              </div>
            </div>
          )}
        </div>
        <PlayerBar name={`${myName} (you)`} active={!g.result && turn === g.me} clock={clockOf(g.me)} taken={<Taken pieces={taken[g.me]} by={g.me} lead={g.me === "w" ? lead : -lead} />} />
      </div>
      <div className="flex flex-col gap-3">
        <div className="text-xs text-soft">
          {tcLabel(g.tc)} · you play {g.me === "w" ? "White" : "Black"}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Action onClick={undo} disabled={thinking || !g.history.length} icon={<Undo2 size={16} />}>
            Take back
          </Action>
          <Action onClick={getHint} disabled={thinking || !!g.result || turn !== g.me} icon={<Lightbulb size={16} />}>
            Hint
          </Action>
          <Action onClick={() => save({ ...g, result: { winner: opp, reason: "resignation" } })} disabled={!!g.result} icon={<Flag size={16} />} danger>
            Resign
          </Action>
          <Action onClick={() => save(null)} icon={<RotateCcw size={16} />}>
            New game
          </Action>
        </div>
        <MoveList history={g.history} />
      </div>
    </div>
  );
}

export function PlayerBar({ name, icon, active, thinking, clock, taken }: { name: string; icon?: React.ReactNode; active: boolean; thinking?: boolean; clock: number | null; taken: React.ReactNode }) {
  return (
    <div className={cx("flex items-center gap-2 rounded-xl border px-3 py-2", active ? "border-core/70 bg-core/10" : "border-line bg-panel")}>
      <span className={cx("flex size-8 shrink-0 items-center justify-center rounded-full bg-raised text-sm font-bold", active && "ring-2 ring-core")}>{icon ?? name[0]}</span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold">
          {name}
          {thinking && <span className="ml-2 animate-pulse text-xs font-normal text-core">thinking…</span>}
        </div>
        {taken}
      </div>
      <ClockFace ms={clock} running={active} />
    </div>
  );
}

export function Action({ onClick, disabled, icon, children, danger }: { onClick: () => void; disabled?: boolean; icon: React.ReactNode; children: React.ReactNode; danger?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cx("flex items-center justify-center gap-1.5 rounded-xl border-2 px-3 py-2 text-sm font-bold transition-colors disabled:opacity-35", danger ? "border-alert/60 text-alert hover:bg-alert/10" : "border-line hover:border-core hover:text-core")}
    >
      {icon} {children}
    </button>
  );
}
