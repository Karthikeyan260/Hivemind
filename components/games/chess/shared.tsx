"use client";

import type { Chess, Color } from "chess.js";
import { cx } from "@/components/ui";

export type TimeControl = { base: number; inc: number } | null; // minutes, seconds
export const TIME_CONTROLS: { label: string; tc: TimeControl; kind: string }[] = [
  { label: "1 min", tc: { base: 1, inc: 0 }, kind: "Bullet" },
  { label: "3 min", tc: { base: 3, inc: 0 }, kind: "Blitz" },
  { label: "3 | 2", tc: { base: 3, inc: 2 }, kind: "Blitz" },
  { label: "5 min", tc: { base: 5, inc: 0 }, kind: "Blitz" },
  { label: "10 min", tc: { base: 10, inc: 0 }, kind: "Rapid" },
  { label: "15 | 10", tc: { base: 15, inc: 10 }, kind: "Rapid" },
  { label: "No clock", tc: null, kind: "Casual" },
];
export const tcLabel = (tc: TimeControl) => (tc ? (tc.inc ? `${tc.base} | ${tc.inc}` : `${tc.base} min`) : "No clock");
export type Result = { winner: Color | null; reason: string } | null;

/** The game's end from the position itself (mate, stalemate, repetition, 50 moves, too few pieces). */
export function endOf(game: Chess): Result {
  if (game.isCheckmate()) return { winner: game.turn() === "w" ? "b" : "w", reason: "checkmate" };
  if (game.isStalemate()) return { winner: null, reason: "stalemate" };
  if (game.isThreefoldRepetition()) return { winner: null, reason: "repetition" };
  if (game.isInsufficientMaterial()) return { winner: null, reason: "not enough pieces to mate" };
  if (game.isDraw()) return { winner: null, reason: "50-move rule" };
  return null;
}

export function TimePicker({ value, onChange }: { value: TimeControl; onChange: (tc: TimeControl) => void }) {
  return (
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-7">
      {TIME_CONTROLS.map((t) => {
        const on = tcLabel(t.tc) === tcLabel(value);
        return (
          <button
            key={t.label}
            type="button"
            onClick={() => onChange(t.tc)}
            aria-pressed={on}
            className={cx("flex flex-col items-center rounded-xl border-2 px-2 py-2 transition-colors", on ? "border-core bg-core/15 text-core" : "border-line text-soft hover:text-fg")}
          >
            <span className="text-base font-bold">{t.label}</span>
            <span className="text-[10px] uppercase tracking-wider opacity-70">{t.kind}</span>
          </button>
        );
      })}
    </div>
  );
}

export function Pick<T extends string>({ options, value, onChange }: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          aria-pressed={value === o.value}
          className={cx("rounded-full border-2 px-4 py-1.5 text-sm font-semibold", value === o.value ? "border-core bg-core/15 text-core" : "border-line text-soft hover:text-fg")}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Moves in pairs, newest in view. */
export function MoveList({ history }: { history: string[] }) {
  const rows: [string, string?][] = [];
  for (let i = 0; i < history.length; i += 2) rows.push([history[i], history[i + 1]]);
  return (
    <div className="max-h-48 overflow-y-auto rounded-xl border border-line bg-panel p-2 font-mono text-sm lg:max-h-[50dvh]" ref={(el) => el?.scrollTo({ top: el.scrollHeight })}>
      {!rows.length && <p className="p-1 font-sans text-xs text-soft">No moves yet.</p>}
      {rows.map(([w, b], i) => (
        <div key={i} className={cx("grid grid-cols-[2.2rem_1fr_1fr] gap-1 rounded px-1", i === rows.length - 1 && "bg-raised")}>
          <span className="text-faint">{i + 1}.</span>
          <span>{w}</span>
          <span>{b ?? ""}</span>
        </div>
      ))}
    </div>
  );
}

export function resultText(r: NonNullable<Result>, me: Color, names: Record<Color, string>) {
  if (!r.winner) return { title: "Draw", sub: `By ${r.reason}.` };
  return { title: r.winner === me ? "You win! 🎉" : `${names[r.winner]} wins`, sub: `By ${r.reason}.` };
}

/** Remaining time on a clock that may be running since `since` (paused clocks pass `now = since`). */
export const left = (ms: number, running: boolean, since: number, now: number) => (running ? ms - (now - since) : ms);
