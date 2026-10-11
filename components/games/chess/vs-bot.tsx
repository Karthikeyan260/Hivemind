"use client";

import { Chess, type Color, type PieceSymbol, type Square } from "chess.js";
import { Bot, Flag, Lightbulb, RotateCcw, Undo2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { cx } from "@/components/ui";
import { LEVELS, type Level } from "@/lib/games/chess-bot";
import { think } from "@/lib/games/chess-think";
import { sfx } from "@/lib/sfx";
import { Board, captured, ClockFace, Taken } from "./board";
import { endOf, left, MoveList, Pick, resultText, TimePicker, tcLabel, type Result, type TimeControl } from "./shared";

/**
 * Chess against HIVEMIND's bot, on this device: four levels, either colour, an optional clock,
 * hints and take-backs. The game is kept on this device, so a reload carries on.
 */
/** turnStart: when the side to move started thinking (the clock runs from there). */
type Saved = { history: string[]; me: Color; level: Level; tc: TimeControl; clock: { w: number; b: number } | null; result: Result; turnStart: number };
const KEY = "hm-chess-bot";
const load = (): Saved | null => {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? "null") as Saved | null;
    // The clock was paused while the game was closed.
    return s ? { ...s, turnStart: Date.now() } : null;
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

  function start() {
    const me = colour === "random" ? (Math.random() < 0.5 ? "w" : "b") : colour;
    save({ history: [], me, level, tc, clock: tc ? { w: tc.base * 60_000, b: tc.base * 60_000 } : null, result: null, turnStart: Date.now() });
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
          const spent = Date.now() - cur.turnStart;
          clock = { ...clock, [mover]: clock[mover] - spent + cur.tc.inc * 1000 };
        }
        const result = endOf(c);
        const next = { ...cur, history: [...cur.history, m.san], clock, result, turnStart: Date.now() };
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
    const t0 = Date.now();
    void think(fen, g.level).then(async (san) => {
      // Never instant: a short pause reads as "thinking".
      await new Promise((r) => setTimeout(r, Math.max(0, 450 - (Date.now() - t0))));
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
      const n = Date.now();
      setNow(n);
      const rem = left(g.clock![turn], true, g.turnStart, n);
      if (rem <= 0) {
        sfx.error();
        save({ ...g, clock: { ...g.clock!, [turn]: 0 }, result: { winner: turn === "w" ? "b" : "w", reason: "time" } });
      }
    }, 100);
    return () => clearInterval(t);
  }, [g, turn, save]);

  function onMove(from: Square, to: Square, promotion?: PieceSymbol) {
    const m = game.moves({ verbose: true }).find((x) => x.from === from && x.to === to && (!x.promotion || x.promotion === (promotion ?? "q")));
    if (m) play(m.san);
  }
  function undo() {
    if (!g || thinking) return;
    // Take back the bot's reply and my move.
    const back = turn === g.me ? 2 : 1;
    save({ ...g, history: g.history.slice(0, Math.max(0, g.history.length - back)), result: null, turnStart: Date.now() });
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
        <button type="button" onClick={start} className="self-start rounded-full bg-core px-6 py-2.5 text-base font-bold text-core-ink shadow-lg transition-transform hover:scale-105">
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
              <button type="button" onClick={() => save(null)} className="mt-4 rounded-full bg-core px-5 py-2 font-bold text-core-ink">
                New game
              </button>
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
