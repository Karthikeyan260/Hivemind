import { HOME, type Color } from "./ludo";

/**
 * Where everything sits on the classic 15×15 Ludo board ([row, col], 0-based): red's yard top-left,
 * green top-right, yellow bottom-right, blue bottom-left, play going clockwise. Track square 0 is
 * red's start; each colour starts 13 squares after the previous one.
 */
export type Cell = [number, number];

const run = (r0: number, c0: number, dr: number, dc: number, n: number): Cell[] => Array.from({ length: n }, (_, i) => [r0 + dr * i, c0 + dc * i]);

/** The 52 shared squares in playing order, starting at red's start square. */
export const TRACK_CELLS: Cell[] = [
  ...run(6, 1, 0, 1, 5), // red's arm, going right
  ...run(5, 6, -1, 0, 6), // up the left side of the top arm
  [0, 7],
  ...run(0, 8, 1, 0, 6), // down the right side of the top arm
  ...run(6, 9, 0, 1, 6), // right along the top of the right arm
  [7, 14],
  ...run(8, 14, 0, -1, 6), // back along the bottom of the right arm
  ...run(9, 8, 1, 0, 6), // down the right side of the bottom arm
  [14, 7],
  ...run(14, 6, -1, 0, 6), // up the left side of the bottom arm
  ...run(8, 5, 0, -1, 6), // left along the bottom of the left arm
  [7, 0],
  [6, 0],
];

/** Each colour's 5-square home column (progress 51–55). */
export const HOME_CELLS: Record<Color, Cell[]> = {
  red: run(7, 1, 0, 1, 5),
  green: run(1, 7, 1, 0, 5),
  yellow: run(7, 13, 0, -1, 5),
  blue: run(13, 7, -1, 0, 5),
};

/** Token spots inside each yard. */
export const YARD_CELLS: Record<Color, Cell[]> = {
  red: [[1.5, 1.5], [1.5, 3.5], [3.5, 1.5], [3.5, 3.5]],
  green: [[1.5, 10.5], [1.5, 12.5], [3.5, 10.5], [3.5, 12.5]],
  yellow: [[10.5, 10.5], [10.5, 12.5], [12.5, 10.5], [12.5, 12.5]],
  blue: [[10.5, 1.5], [10.5, 3.5], [12.5, 1.5], [12.5, 3.5]],
};

/** Where finished tokens gather, in the colour's triangle of the centre. */
export const FINISH_CELL: Record<Color, Cell> = { red: [7, 6.2], green: [6.2, 7], yellow: [7, 7.8], blue: [7.8, 7] };

const START: Record<Color, number> = { red: 0, green: 13, yellow: 26, blue: 39 };

/** The board cell of a token of `color` at progress `p`, token number `i` (for its yard spot). */
export function cellOf(color: Color, p: number, i: number): Cell {
  if (p < 0) return YARD_CELLS[color][i % 4];
  if (p >= HOME) return FINISH_CELL[color];
  if (p > 50) return HOME_CELLS[color][p - 51];
  return TRACK_CELLS[(START[color] + p) % 52];
}
