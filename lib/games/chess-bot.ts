import { Chess } from "chess.js";
import { colorOf, FastBoard, typeOf, type FMove } from "./chess-fast";

/**
 * HIVEMIND's chess bot: a small classic engine (negamax with alpha-beta pruning, a capture search
 * at the end so it doesn't blunder into recaptures, best-first move ordering, and iterative
 * deepening within a time budget), judging positions by material and where pieces stand.
 * Levels trade depth and add deliberate randomness so beginners can win. Pure: give it a FEN.
 */
export type Level = "beginner" | "easy" | "medium" | "hard";
export const LEVELS: Record<Level, { label: string; maxDepth: number; ms: number; noise: number; blunder: number }> = {
  beginner: { label: "Beginner", maxDepth: 1, ms: 300, noise: 220, blunder: 0.25 },
  easy: { label: "Easy", maxDepth: 2, ms: 600, noise: 70, blunder: 0.05 },
  medium: { label: "Medium", maxDepth: 4, ms: 1200, noise: 15, blunder: 0 },
  hard: { label: "Hard", maxDepth: 7, ms: 2500, noise: 0, blunder: 0 },
};

const VALUE: Record<string, number> = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };
// Piece-square tables (white's view, a8 first), the well-known "simplified evaluation" ones.
const PST: Record<string, number[]> = {
  p: [0, 0, 0, 0, 0, 0, 0, 0, 50, 50, 50, 50, 50, 50, 50, 50, 10, 10, 20, 30, 30, 20, 10, 10, 5, 5, 10, 25, 25, 10, 5, 5, 0, 0, 0, 20, 20, 0, 0, 0, 5, -5, -10, 0, 0, -10, -5, 5, 5, 10, 10, -20, -20, 10, 10, 5, 0, 0, 0, 0, 0, 0, 0, 0],
  n: [-50, -40, -30, -30, -30, -30, -40, -50, -40, -20, 0, 0, 0, 0, -20, -40, -30, 0, 10, 15, 15, 10, 0, -30, -30, 5, 15, 20, 20, 15, 5, -30, -30, 0, 15, 20, 20, 15, 0, -30, -30, 5, 10, 15, 15, 10, 5, -30, -40, -20, 0, 5, 5, 0, -20, -40, -50, -40, -30, -30, -30, -30, -40, -50],
  b: [-20, -10, -10, -10, -10, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 10, 10, 5, 0, -10, -10, 5, 5, 10, 10, 5, 5, -10, -10, 0, 10, 10, 10, 10, 0, -10, -10, 10, 10, 10, 10, 10, 10, -10, -10, 5, 0, 0, 0, 0, 5, -10, -20, -10, -10, -10, -10, -10, -10, -20],
  r: [0, 0, 0, 0, 0, 0, 0, 0, 5, 10, 10, 10, 10, 10, 10, 5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, 0, 0, 0, 5, 5, 0, 0, 0],
  q: [-20, -10, -10, -5, -5, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 5, 5, 5, 0, -10, -5, 0, 5, 5, 5, 5, 0, -5, 0, 0, 5, 5, 5, 5, 0, -5, -10, 5, 5, 5, 5, 5, 0, -10, -10, 0, 5, 0, 0, 0, 0, -10, -20, -10, -10, -5, -5, -10, -10, -20],
  k: [-30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -20, -30, -30, -40, -40, -30, -30, -20, -10, -20, -20, -20, -20, -20, -20, -10, 20, 20, 0, 0, 0, 0, 20, 20, 20, 30, 10, 0, 0, 10, 30, 20],
};
const MATE = 100_000;

/** Score of the position for the side to move (centipawns), from chess.js (used in tests). */
export function evaluate(g: Chess): number {
  return evalFast(FastBoard.fromFen(g.fen()));
}

const TYPE = ["", "p", "n", "b", "r", "q", "k"];
/** Score for the side to move on the fast board: material plus piece placement. */
function evalFast(f: FastBoard): number {
  let score = 0;
  for (let sq = 0; sq < 128; sq++) {
    if (sq & 0x88) {
      sq += 7;
      continue;
    }
    const p = f.b[sq];
    if (!p) continue;
    const t = TYPE[typeOf(p)];
    const r = sq >> 4;
    const c = sq & 7;
    const white = colorOf(p) === 0;
    const v = VALUE[t] + PST[t][white ? r * 8 + c : (7 - r) * 8 + c];
    score += white ? v : -v;
  }
  return f.side === 0 ? score : -score;
}

const VAL_OF = [0, 100, 320, 330, 500, 900, 0];
/** Captures first (most valuable victim, least valuable attacker), then promotions. */
const order = (moves: FMove[]) =>
  moves
    .map((m) => ({ m, k: (m.captured ? 10 * VAL_OF[typeOf(m.captured)] - VAL_OF[typeOf(m.piece)] + 1000 : 0) + (m.promo ? 800 : 0) }))
    .sort((x, y) => y.k - x.k)
    .map((x) => x.m);

class OutOfTime extends Error {}

/** The bot's move for the position (SAN), within the level's time and depth. Null when the game is over. */
export function bestMove(fen: string, level: Level = "medium", rand: () => number = Math.random): string | null {
  const game = new Chess(fen);
  if (game.isGameOver()) return null;
  const f = FastBoard.fromFen(fen);
  const root = f.moves();
  if (!root.length) return null;
  const toSan = (m: FMove) => {
    const u = FastBoard.uci(m);
    return game.moves({ verbose: true }).find((x) => x.from + x.to + (x.promotion ?? "") === u)?.san ?? null;
  };
  const L = LEVELS[level];
  // Beginners sometimes just play something.
  if (L.blunder && rand() < L.blunder) return toSan(root[Math.floor(rand() * root.length)]);
  const deadline = Date.now() + L.ms;
  let nodes = 0;

  const quiesce = (alpha: number, beta: number, depth: number): number => {
    if ((++nodes & 2047) === 0 && Date.now() > deadline) throw new OutOfTime();
    const stand = evalFast(f);
    if (stand >= beta || depth > 8) return stand;
    if (stand > alpha) alpha = stand;
    for (const m of order(f.moves(true))) {
      f.make(m);
      const sc = -quiesce(-beta, -alpha, depth + 1);
      f.unmake();
      if (sc >= beta) return sc;
      if (sc > alpha) alpha = sc;
    }
    return alpha;
  };

  const search = (depth: number, alpha: number, beta: number, ply: number): number => {
    if ((++nodes & 2047) === 0 && Date.now() > deadline) throw new OutOfTime();
    const moves = f.moves();
    // No legal moves: checkmate if in check, else stalemate. Fifty quiet moves: a draw.
    if (!moves.length) return f.inCheck() ? -MATE + ply : 0;
    if (f.half >= 100) return 0;
    if (depth === 0) return quiesce(alpha, beta, 0);
    let best = -Infinity;
    for (const m of order(moves)) {
      f.make(m);
      const sc = -search(depth - 1, -beta, -alpha, ply + 1);
      f.unmake();
      if (sc > best) best = sc;
      if (sc > alpha) alpha = sc;
      if (alpha >= beta) break;
    }
    return best;
  };

  let pick = order(root)[0];
  for (let depth = 1; depth <= L.maxDepth; depth++) {
    try {
      const scored: { m: FMove; s: number }[] = [];
      // The previous best first, so a cut-off search still improves on it.
      const list = [pick, ...order(root).filter((m) => m !== pick)];
      let alpha = -Infinity;
      // Moves within reach of the best (by the level's random variety) get exact scores; the rest
      // only need proving worse. Comparing a "no better than" bound to real scores let bad moves win.
      const margin = L.noise ? 2 * L.noise + 1 : 0;
      for (const m of list) {
        f.make(m);
        const sc = -search(depth - 1, -Infinity, -(alpha - margin), 1);
        f.unmake();
        scored.push({ m, s: sc });
        if (sc > alpha) alpha = sc;
      }
      // Some noise on lower levels so the bot isn't the same every game (never hides a mate).
      const noisy = scored.map((x) => ({ ...x, n: x.s + (Math.abs(x.s) > MATE / 2 ? 0 : (rand() - 0.5) * 2 * L.noise) }));
      pick = noisy.reduce((x, y) => (y.n > x.n ? y : x)).m;
      if (Math.abs(alpha) > MATE / 2) break; // found a mate
    } catch (e) {
      if (!(e instanceof OutOfTime)) throw e;
      break;
    }
  }
  return toSan(pick);
}
