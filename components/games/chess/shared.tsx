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

const PIECE: Record<string, string> = { knight: "n", horse: "n", bishop: "b", rook: "r", castle: "r", queen: "q", king: "k", pawn: "p" };

/**
 * A move said out loud → a legal move in this position: "e4", "Nf3", "knight to f3", "e2 to e4",
 * "bishop takes c6", "castle kingside", "queen side castle". Ambiguous or illegal: why, and the options.
 */
export function spokenMove(game: Chess, said: string): { san: string } | { error: string; options?: string[] } {
  const t = said.toLowerCase().replace(/[.,!]/g, " ").trim();
  const legal = game.moves({ verbose: true });
  if (!legal.length) return { error: "The game is over." };
  if (/castl|o-o/.test(t)) {
    const long = /queen|long|o-o-o/.test(t);
    const m = legal.find((x) => x.san.startsWith(long ? "O-O-O" : "O-O") && (long || !x.san.startsWith("O-O-O")));
    return m ? { san: m.san } : { error: `Castling ${long ? "queenside" : "kingside"} isn't allowed now.` };
  }
  // Written notation as said: "Nf3", "exd5", "e8=Q".
  const asSan = legal.find((x) => x.san.toLowerCase().replace(/[+#]/g, "") === t.replace(/\s+/g, "").replace(/[+#]/g, ""));
  if (asSan) return { san: asSan.san };
  const squares = t.match(/[a-h]\s?[1-8]/g)?.map((s) => s.replace(/\s/g, "")) ?? [];
  const piece = Object.entries(PIECE).find(([w]) => new RegExp(`\\b${w}s?\\b`).test(t))?.[1];
  const promo = /promot|=|queen\b.*\bpromot/.test(t) ? (Object.entries(PIECE).find(([w]) => new RegExp(`(promot\\w*|to|=)\\s*(a\\s+)?${w}`).test(t))?.[1] ?? "q") : undefined;
  let found = legal.filter((x) => (squares.length >= 2 ? x.from === squares[0] && x.to === squares[1] : squares.length === 1 ? x.to === squares[0] : false));
  if (piece && squares.length < 2) found = found.filter((x) => x.piece === piece);
  if (promo) found = found.filter((x) => !x.promotion || x.promotion === promo);
  else if (found.some((x) => x.promotion)) found = found.filter((x) => !x.promotion || x.promotion === "q");
  if (found.length === 1) return { san: found[0].san };
  if (found.length > 1) return { error: "Which one?", options: found.map((x) => x.san) };
  return { error: `"${said}" isn't a legal move here.`, options: legal.slice(0, 12).map((x) => x.san) };
}
