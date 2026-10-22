/**
 * Connect Four: two players take turns dropping a disc into one of seven columns; it falls to the
 * lowest free spot. First to line up four in a row (across, down or diagonally) wins; a full board
 * with no line is a draw. Pure functions, so the host's browser runs the game and a friend's tap is
 * only a request (see lib/games/party).
 *
 * The board is `rows × cols` cells, row 0 at the top: `board[r * cols + c]` is the seat index (0 or 1)
 * whose disc is there, or -1.
 */
export const COLS = 7;
export const ROWS = 6;
export type C4Seat = { id: string; name: string; bot: boolean };
export type C4State = {
  seats: [C4Seat, C4Seat];
  board: number[];
  turn: 0 | 1;
  over: boolean;
  /** The winning seat index, or -1 (a draw, or the game is still on). */
  winner: number;
  /** The four (or more) winning cells, as board indexes. */
  line: number[];
  last?: { col: number; row: number; seat: number; seq: number };
  log: string[];
  seq: number;
  /** This game's own id (two games can end with the same discs). */
  id?: string;
};
export type C4Level = "easy" | "medium" | "hard";

export function newConnect4(players: [{ id: string; name: string; bot?: boolean }, { id: string; name: string; bot?: boolean }]): C4State {
  const seats = players.map((p) => ({ id: p.id, name: p.name, bot: !!p.bot })) as [C4Seat, C4Seat];
  return { seats, board: Array(COLS * ROWS).fill(-1), turn: 0, over: false, winner: -1, line: [], log: [`${seats[0].name} starts.`], seq: 0, id: Math.random().toString(36).slice(2, 10) };
}

const at = (b: number[], r: number, c: number) => (r < 0 || r >= ROWS || c < 0 || c >= COLS ? -2 : b[r * COLS + c]);

/** The row a disc dropped into `col` would land on, or -1 when the column is full (or not a column). */
export function landing(board: number[], col: number) {
  if (!Number.isInteger(col) || col < 0 || col >= COLS) return -1;
  for (let r = ROWS - 1; r >= 0; r--) if (board[r * COLS + col] < 0) return r;
  return -1;
}

export const openColumns = (board: number[]) => Array.from({ length: COLS }, (_, c) => c).filter((c) => landing(board, c) >= 0);

/** The cells of a run of four or more through (r, c) for the seat that owns it, or []. */
export function lineThrough(board: number[], r: number, c: number): number[] {
  const who = at(board, r, c);
  if (who < 0) return [];
  for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]] as const) {
    const cells = [r * COLS + c];
    for (const sign of [1, -1]) {
      for (let k = 1; at(board, r + dr * k * sign, c + dc * k * sign) === who; k++) cells.push((r + dr * k * sign) * COLS + c + dc * k * sign);
    }
    if (cells.length >= 4) return cells.sort((a, b) => a - b);
  }
  return [];
}

/** A seat drops a disc into a column. Not their turn, a full column, or a finished game: unchanged. */
export function drop(s: C4State, seatId: string, col: number): C4State {
  if (s.over || s.seats[s.turn].id !== seatId) return s;
  const row = landing(s.board, col);
  if (row < 0) return s;
  const board = s.board.slice();
  board[row * COLS + col] = s.turn;
  const line = lineThrough(board, row, col);
  const full = board.every((v) => v >= 0);
  const seq = s.seq + 1;
  const mover = s.seats[s.turn];
  const over = line.length > 0 || full;
  const log = line.length ? [...s.log, `🏆 ${mover.name} connects four!`] : full ? [...s.log, "🤝 The board is full: a draw!"] : s.log;
  return { ...s, board, over, winner: line.length ? s.turn : -1, line, turn: over ? s.turn : ((1 - s.turn) as 0 | 1), last: { col, row, seat: s.turn, seq }, seq, log: log.slice(-30) };
}

/* ── HIVEMIND's moves ── */

/** How good a position is for `me`: open windows of four that only they can still fill, weighted by how many discs are in them, and the centre column. */
function score(board: number[], me: number): number {
  let total = 0;
  const windows: [number, number][] = [];
  for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]] as const) {
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const er = r + dr * 3;
        const ec = c + dc * 3;
        if (er < 0 || er >= ROWS || ec < 0 || ec >= COLS) continue;
        let mine = 0;
        let theirs = 0;
        for (let k = 0; k < 4; k++) {
          const v = board[(r + dr * k) * COLS + c + dc * k];
          if (v === me) mine++;
          else if (v >= 0) theirs++;
        }
        windows.push([mine, theirs]);
      }
    }
  }
  for (const [mine, theirs] of windows) {
    if (mine && theirs) continue;
    const n = mine || theirs;
    const w = n === 3 ? 50 : n === 2 ? 6 : n === 1 ? 1 : 0;
    total += mine ? w : -w * 1.2;
  }
  for (let r = 0; r < ROWS; r++) if (board[r * COLS + 3] === me) total += 3;
  else if (board[r * COLS + 3] >= 0) total -= 3;
  return total;
}

const ORDER = [3, 2, 4, 1, 5, 0, 6];

/** Negamax with alpha-beta from `me`'s side: higher is better for the seat to move. */
function search(board: number[], who: number, depth: number, alpha: number, beta: number): number {
  const cols = ORDER.filter((c) => landing(board, c) >= 0);
  if (!cols.length) return 0;
  let best = -Infinity;
  for (const c of cols) {
    const r = landing(board, c);
    board[r * COLS + c] = who;
    let v: number;
    if (lineThrough(board, r, c).length) v = 1_000_000 + depth;
    else if (depth <= 1) v = score(board, who);
    else v = -search(board, 1 - who, depth - 1, -beta, -alpha);
    board[r * COLS + c] = -1;
    if (v > best) best = v;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }
  return best;
}

const DEPTH: Record<C4Level, number> = { easy: 2, medium: 4, hard: 7 };

/**
 * The column HIVEMIND plays for the seat to move, or null when the board is full. Easy takes a win or
 * blocks a loss that is one move away but otherwise plays loosely; medium and hard look ahead
 * (depth 4 and 7), so hard is hard to beat.
 */
export function botColumn(s: C4State, level: C4Level = "medium", rand: () => number = Math.random): number | null {
  const open = openColumns(s.board);
  if (!open.length) return null;
  const me = s.turn;
  const board = s.board.slice();
  const wins = (who: number, c: number) => {
    const r = landing(board, c);
    board[r * COLS + c] = who;
    const w = lineThrough(board, r, c).length > 0;
    board[r * COLS + c] = -1;
    return w;
  };
  const win = open.find((c) => wins(me, c));
  if (win !== undefined) return win;
  const block = open.find((c) => wins(1 - me, c));
  if (block !== undefined) return block;
  if (level === "easy" && rand() < 0.45) return open[Math.floor(rand() * open.length)];
  const depth = DEPTH[level];
  const scored = open.map((c) => {
    const r = landing(board, c);
    board[r * COLS + c] = me;
    // Playing here must not hand the opponent a win on top of it.
    const gives = r > 0 && wins(1 - me, c);
    const v = depth <= 1 ? score(board, me) : -search(board, 1 - me, depth - 1, -Infinity, Infinity);
    board[r * COLS + c] = -1;
    return { c, v: gives ? v - 5000 : v };
  });
  const top = Math.max(...scored.map((x) => x.v));
  const best = scored.filter((x) => x.v >= top - (level === "easy" ? 15 : 0));
  // Keep the order centre-first for ties, but let easy wander a little.
  return best.sort((a, b) => ORDER.indexOf(a.c) - ORDER.indexOf(b.c))[level === "easy" ? Math.floor(rand() * best.length) : 0].c;
}
