/**
 * Dots and Boxes: take turns drawing a line between two dots; close the fourth side of a box and it's
 * yours, and you go again. Most boxes when the grid is full wins. Pure functions, so the host's
 * browser runs the game and the friend's taps are only requests (see lib/games/peer-game).
 *
 * Lines are numbered: first the horizontal ones, row by row ((rows + 1) × cols), then the vertical
 * ones (rows × (cols + 1)). `lines[i]` is the seat index that drew it, or -1.
 */
export type DotsSeat = { id: string; name: string; bot: boolean };
export type DotsState = {
  rows: number;
  cols: number;
  seats: DotsSeat[];
  lines: number[];
  /** Box (r, c) at r * cols + c: the seat index that closed it, or -1. */
  boxes: number[];
  turn: number;
  over: boolean;
  last?: { line: number; seat: number; closed: number; seq: number };
  log: string[];
  seq: number;
};
export type GridSize = 3 | 4 | 5 | 6;

export const hCount = (s: Pick<DotsState, "rows" | "cols">) => (s.rows + 1) * s.cols;
export const lineCount = (s: Pick<DotsState, "rows" | "cols">) => hCount(s) + s.rows * (s.cols + 1);

export function newDots(players: { id: string; name: string; bot?: boolean }[], size: GridSize = 4): DotsState {
  const s = { rows: size, cols: size };
  return {
    ...s,
    seats: players.map((p) => ({ id: p.id, name: p.name, bot: !!p.bot })),
    lines: Array(lineCount(s)).fill(-1),
    boxes: Array(size * size).fill(-1),
    turn: 0,
    over: false,
    log: [`${players[0].name} starts.`],
    seq: 0,
  };
}

/** Where a line is: "h" row r between columns c and c+1, or "v" column c between rows r and r+1. */
export function lineAt(s: Pick<DotsState, "rows" | "cols">, i: number) {
  const H = hCount(s);
  return i < H ? { dir: "h" as const, r: Math.floor(i / s.cols), c: i % s.cols } : { dir: "v" as const, r: Math.floor((i - H) / (s.cols + 1)), c: (i - H) % (s.cols + 1) };
}

/** The four lines around box (r, c): top, bottom, left, right. */
export function sidesOf(s: Pick<DotsState, "rows" | "cols">, r: number, c: number) {
  const H = hCount(s);
  return [r * s.cols + c, (r + 1) * s.cols + c, H + r * (s.cols + 1) + c, H + r * (s.cols + 1) + c + 1];
}

/** The (one or two) boxes a line borders. */
export function boxesOf(s: Pick<DotsState, "rows" | "cols">, i: number) {
  const { dir, r, c } = lineAt(s, i);
  const out: number[] = [];
  if (dir === "h") {
    if (r > 0) out.push((r - 1) * s.cols + c);
    if (r < s.rows) out.push(r * s.cols + c);
  } else {
    if (c > 0) out.push(r * s.cols + c - 1);
    if (c < s.cols) out.push(r * s.cols + c);
  }
  return out;
}

const drawn = (lines: number[], s: DotsState, box: number) => sidesOf(s, Math.floor(box / s.cols), box % s.cols).filter((l) => lines[l] >= 0).length;

export const scores = (s: DotsState) => s.seats.map((_, i) => s.boxes.filter((b) => b === i).length);

/** A seat draws a line. Closing a box (or two) scores and keeps the turn. Anything invalid: unchanged. */
export function drawLine(s: DotsState, seatId: string, line: number): DotsState {
  const seat = s.seats[s.turn];
  if (s.over || seat?.id !== seatId || !Number.isInteger(line) || line < 0 || line >= s.lines.length || s.lines[line] >= 0) return s;
  const lines = s.lines.slice();
  lines[line] = s.turn;
  const boxes = s.boxes.slice();
  let closed = 0;
  for (const b of boxesOf(s, line)) {
    if (boxes[b] < 0 && drawn(lines, s, b) === 4) {
      boxes[b] = s.turn;
      closed++;
    }
  }
  const over = boxes.every((b) => b >= 0);
  const next: DotsState = { ...s, lines, boxes, over, turn: closed || over ? s.turn : (s.turn + 1) % s.seats.length, last: { line, seat: s.turn, closed, seq: s.seq + 1 }, seq: s.seq + 1 };
  let log = s.log;
  if (closed) log = [...log, `${seat.name} closed ${closed === 2 ? "two boxes" : "a box"}${over ? "" : " and goes again"}.`];
  if (over) {
    const sc = scores(next);
    const best = Math.max(...sc);
    const top = s.seats.filter((_, i) => sc[i] === best);
    log = [...log, top.length > 1 ? `🤝 A tie at ${best} boxes!` : `🏆 ${top[0].name} wins with ${best} boxes!`];
  }
  return { ...next, log: log.slice(-30) };
}

/** Seat indexes with the most boxes (one = a winner, more = a tie). */
export function leaders(s: DotsState) {
  const sc = scores(s);
  const best = Math.max(...sc);
  return sc.flatMap((v, i) => (v === best ? [i] : []));
}

/**
 * HIVEMIND's move: close a box when it can; otherwise a "safe" line (one that doesn't give a box away);
 * when every line gives something away, the one that gives away the fewest boxes.
 */
export function botLine(s: DotsState, rand: () => number = Math.random): number | null {
  const free = s.lines.flatMap((v, i) => (v < 0 ? [i] : []));
  if (!free.length) return null;
  const pick = (xs: number[]) => xs[Math.floor(rand() * xs.length)];
  const closes = (lines: number[], i: number) => boxesOf(s, i).filter((b) => s.boxes[b] < 0 && drawn(lines, s, b) === 3).length;
  // 1. Take boxes (two at once first).
  const take = free.filter((i) => closes(s.lines, i) > 0);
  if (take.length) return pick(take.filter((i) => closes(s.lines, i) === 2).length ? take.filter((i) => closes(s.lines, i) === 2) : take);
  // 2. A line that leaves no box with three sides.
  const safe = free.filter((i) => boxesOf(s, i).every((b) => drawn(s.lines, s, b) < 2));
  if (safe.length) return pick(safe);
  // 3. Give away as little as possible: count what the next player could take in a row after it.
  let best: number[] = [];
  let least = Infinity;
  for (const i of free) {
    const lines = s.lines.slice();
    lines[i] = 0;
    const boxes = s.boxes.slice();
    let given = 0;
    for (;;) {
      const grab = lines.findIndex((v, j) => v < 0 && boxesOf(s, j).some((b) => boxes[b] < 0 && drawn(lines, s, b) === 3));
      if (grab < 0) break;
      lines[grab] = 0;
      for (const b of boxesOf(s, grab))
        if (boxes[b] < 0 && drawn(lines, s, b) === 4) {
          boxes[b] = 0;
          given++;
        }
    }
    if (given < least) {
      least = given;
      best = [i];
    } else if (given === least) best.push(i);
  }
  return pick(best);
}
