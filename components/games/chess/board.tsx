"use client";

import { Chess, type Color, type PieceSymbol, type Square } from "chess.js";
import { useMemo, useState } from "react";
import { cx } from "@/components/ui";

/**
 * The chessboard: tap a piece to see where it can go, tap a square to move (or tap another of your
 * pieces). Pieces slide from square to square (each keeps its identity through the game, so moves
 * animate), the last move and a king in check are highlighted, and a pawn reaching the end asks what
 * to become.
 */
const FILES = "abcdefgh";
export type Placed = { id: string; color: Color; type: PieceSymbol; square: Square };

/** Every piece with a stable id, by replaying the game (so a move slides that piece, not a new one). */
export function placePieces(history: string[]): { pieces: Placed[]; game: Chess } {
  const game = new Chess();
  const at = new Map<string, Placed>();
  for (const row of game.board())
    for (const p of row) if (p) at.set(p.square, { id: `${p.color}${p.type}-${p.square}`, color: p.color, type: p.type, square: p.square });
  for (const san of history) {
    let m;
    try {
      m = game.move(san);
    } catch {
      break;
    }
    const piece = at.get(m.from)!;
    at.delete(m.from);
    // En passant takes the pawn beside, not on, the target square.
    if (m.isEnPassant()) at.delete(m.to[0] + m.from[1]);
    at.delete(m.to);
    at.set(m.to, { ...piece, square: m.to, type: m.promotion ?? piece.type });
    if (m.isKingsideCastle() || m.isQueensideCastle()) {
      const rank = m.from[1];
      const [rf, rt] = m.isKingsideCastle() ? [`h${rank}`, `f${rank}`] : [`a${rank}`, `d${rank}`];
      const rook = at.get(rf);
      if (rook) {
        at.delete(rf);
        at.set(rt, { ...rook, square: rt as Square });
      }
    }
  }
  return { pieces: [...at.values()], game };
}

export function Board({
  history,
  orientation,
  canMove,
  onMove,
  hint,
}: {
  history: string[];
  orientation: Color;
  /** Whether the player (of `orientation`'s colour) may move now. */
  canMove: boolean;
  onMove: (from: Square, to: Square, promotion?: PieceSymbol) => void;
  hint?: { from: Square; to: Square } | null;
}) {
  const { pieces, game } = useMemo(() => placePieces(history), [history]);
  const [selected, setSelected] = useState<Square | null>(null);
  const [promo, setPromo] = useState<{ from: Square; to: Square } | null>(null);
  const turn = game.turn();
  const mine = canMove && turn === orientation;
  const last = game.history({ verbose: true }).at(-1);
  const kingInCheck = game.inCheck() ? pieces.find((p) => p.type === "k" && p.color === turn)?.square : null;
  const targets = useMemo(() => (selected && mine ? game.moves({ square: selected, verbose: true }) : []), [selected, mine, game]);

  const pos = (sq: string) => {
    const f = FILES.indexOf(sq[0]);
    const r = Number(sq[1]) - 1;
    return orientation === "w" ? { x: f, y: 7 - r } : { x: 7 - f, y: r };
  };

  function tap(sq: Square) {
    if (!mine) return;
    const target = targets.find((t) => t.to === sq);
    if (selected && target) {
      if (target.promotion) setPromo({ from: selected, to: sq });
      else onMove(selected, sq);
      setSelected(null);
      return;
    }
    const p = game.get(sq);
    setSelected(p && p.color === turn ? (selected === sq ? null : sq) : null);
  }

  const squares: Square[] = [];
  for (let y = 0; y < 8; y++)
    for (let x = 0; x < 8; x++) {
      const f = orientation === "w" ? x : 7 - x;
      const r = orientation === "w" ? 7 - y : y;
      squares.push(`${FILES[f]}${r + 1}` as Square);
    }

  return (
    <div className="relative aspect-square w-full max-w-[min(100%,78dvh)] select-none overflow-hidden rounded-lg shadow-[0_8px_30px_rgba(0,0,0,0.5)] ring-4 ring-[#3d2817]">
      <div className="absolute inset-0 grid grid-cols-8 grid-rows-8">
        {squares.map((sq, i) => {
          const dark = (FILES.indexOf(sq[0]) + Number(sq[1])) % 2 === 0;
          const t = targets.find((m) => m.to === sq);
          const isLast = last && (last.from === sq || last.to === sq);
          const isHint = hint && (hint.from === sq || hint.to === sq);
          const x = i % 8;
          const y = Math.floor(i / 8);
          return (
            <button
              key={sq}
              type="button"
              onClick={() => tap(sq)}
              aria-label={sq}
              className="relative"
              style={{ background: isHint ? (dark ? "#6aa6d6" : "#a9d0f0") : selected === sq ? (dark ? "#bbcb2b" : "#f5f682") : isLast ? (dark ? "#aaa23a" : "#cdd26a") : dark ? "#769656" : "#eeeed2" }}
            >
              {kingInCheck === sq && <span className="absolute inset-0 bg-[radial-gradient(circle,rgba(255,0,0,0.85)_0%,rgba(255,0,0,0.35)_45%,transparent_72%)]" />}
              {t && (t.captured ? <span className="absolute inset-[6%] rounded-full border-[5px] border-black/25" /> : <span className="absolute left-1/2 top-1/2 size-[30%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-black/25" />)}
              {x === 0 && <span className={cx("absolute left-0.5 top-0 text-[10px] font-bold sm:text-xs", dark ? "text-[#eeeed2]" : "text-[#769656]")}>{sq[1]}</span>}
              {y === 7 && <span className={cx("absolute bottom-0 right-1 text-[10px] font-bold sm:text-xs", dark ? "text-[#eeeed2]" : "text-[#769656]")}>{sq[0]}</span>}
            </button>
          );
        })}
      </div>
      {pieces.map((p) => {
        const { x, y } = pos(p.square);
        return (
          // Pointer events pass through to the square underneath (so a tap is always the square's).
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={p.id}
            src={`/chess/${p.color}${p.type.toUpperCase()}.svg`}
            alt=""
            draggable={false}
            className={cx("pointer-events-none absolute drop-shadow-[0_2px_2px_rgba(0,0,0,0.35)] transition-[left,top] duration-200 ease-out", selected === p.square && "scale-110")}
            style={{ left: `${x * 12.5}%`, top: `${y * 12.5}%`, width: "12.5%", height: "12.5%" }}
          />
        );
      })}
      {promo && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/50" onClick={() => setPromo(null)}>
          <div className="flex gap-2 rounded-xl bg-white p-2 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            {(["q", "r", "b", "n"] as PieceSymbol[]).map((t) => (
              <button
                key={t}
                type="button"
                aria-label={`Promote to ${t}`}
                onClick={() => {
                  onMove(promo.from, promo.to, t);
                  setPromo(null);
                }}
                className="size-16 rounded-lg hover:bg-black/10"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/chess/${orientation}${t.toUpperCase()}.svg`} alt={t} className="size-full" />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const VALUES: Record<PieceSymbol, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
/** Pieces each side has taken, and who's ahead in material. */
export function captured(history: string[]) {
  const { game } = placePieces(history);
  const taken: Record<Color, PieceSymbol[]> = { w: [], b: [] };
  for (const m of game.history({ verbose: true })) if (m.captured) taken[m.color].push(m.captured);
  const score = (c: Color) => taken[c].reduce((n, t) => n + VALUES[t], 0);
  return { taken, lead: score("w") - score("b") };
}

/** Taken pieces in a row, small, with the material lead. */
export function Taken({ pieces, by, lead }: { pieces: PieceSymbol[]; by: Color; lead: number }) {
  const order = ["q", "r", "b", "n", "p"];
  const sorted = [...pieces].sort((a, b) => order.indexOf(a) - order.indexOf(b));
  const opp = by === "w" ? "b" : "w";
  return (
    <span className="flex min-h-5 items-center">
      {sorted.map((t, i) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img key={i} src={`/chess/${opp}${t.toUpperCase()}.svg`} alt={t} className="-ml-1.5 size-5 first:ml-0" />
      ))}
      {lead > 0 && <span className="ml-1 text-xs font-semibold text-soft">+{lead}</span>}
    </span>
  );
}

/** A chess clock face: mm:ss, tenths in the last 10 seconds, red when low, glowing when running. */
export function ClockFace({ ms, running, low }: { ms: number | null; running: boolean; low?: boolean }) {
  if (ms === null) return null;
  const t = Math.max(0, ms);
  const m = Math.floor(t / 60000);
  const s = Math.floor((t % 60000) / 1000);
  const tenths = Math.floor((t % 1000) / 100);
  const text = t < 10_000 ? `${s}.${tenths}` : `${m}:${String(s).padStart(2, "0")}`;
  return (
    <span
      className={cx(
        "rounded-md px-3 py-1 font-mono text-xl font-bold tabular-nums",
        running ? (low || t < 20_000 ? "bg-alert text-white" : "bg-white text-black") : "bg-black/40 text-white/60",
        running && t < 10_000 && "animate-pulse",
      )}
    >
      {text}
    </span>
  );
}
