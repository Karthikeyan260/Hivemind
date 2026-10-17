/**
 * Snakes & Ladders, as played in India: everyone starts off the board; roll and move forward; land at
 * a ladder's foot and climb, at a snake's head and slide; a 6 rolls again (three 6s in a row lose the
 * turn); 100 needs the exact number (too much and you stay put). First to 100 wins. Pure: the dice
 * come from the caller, so the host's roll is the only roll and tests are repeatable.
 */
export type SnakeColor = "red" | "blue" | "green" | "yellow" | "purple" | "orange";
export const SNAKE_COLORS: SnakeColor[] = ["red", "blue", "green", "yellow", "purple", "orange"];
export type SnakeSeat = { id: string; name: string; color: SnakeColor; bot: boolean };
export type SnakesState = {
  seats: SnakeSeat[];
  /** 0 = not on the board yet, 1–100 = the square. */
  pos: Record<string, number>;
  turn: number;
  sixes: number;
  winner: string | null;
  over: boolean;
  log: string[];
  /** The last move, for the board's animation: the walk, then the climb or the slide. */
  last?: { seat: string; from: number; walk: number; to: number; via: "ladder" | "snake" | null; seq: number };
  lastRoll?: { seat: string; value: number; seq: number };
  seq: number;
};

export const GOAL = 100;
/** Ladders: foot → top. */
export const LADDERS: Record<number, number> = { 1: 38, 4: 14, 9: 31, 21: 42, 28: 84, 36: 44, 51: 67, 71: 91, 80: 100 };
/** Snakes: head → tail. */
export const SNAKES: Record<number, number> = { 16: 6, 47: 26, 49: 11, 56: 53, 62: 19, 64: 60, 87: 24, 93: 73, 95: 75, 98: 78 };

export function newSnakes(players: { id: string; name: string; bot?: boolean }[]): SnakesState {
  const seats = players.slice(0, 6).map((p, i) => ({ id: p.id, name: p.name, color: SNAKE_COLORS[i], bot: !!p.bot }));
  return { seats, pos: Object.fromEntries(seats.map((s) => [s.id, 0])), turn: 0, sixes: 0, winner: null, over: false, log: [`${seats[0].name} starts. Roll to get on the board!`], seq: 0 };
}

const note = (s: SnakesState, line: string): SnakesState => ({ ...s, log: [...s.log.slice(-19), line] });
const pass = (s: SnakesState): SnakesState => ({ ...s, turn: (s.turn + 1) % s.seats.length, sixes: 0 });

/** The current player rolls (the caller supplies the 1–6) and moves. */
export function rollSnakes(s: SnakesState, seatId: string, dice: number): SnakesState {
  const seat = s.seats[s.turn];
  if (s.over || seat?.id !== seatId || !(Number.isInteger(dice) && dice >= 1 && dice <= 6)) return s;
  const seq = s.seq + 1;
  const sixes = dice === 6 ? s.sixes + 1 : 0;
  let next: SnakesState = { ...s, sixes, seq, lastRoll: { seat: seatId, value: dice, seq } };
  if (sixes === 3) return note(pass(next), `${seat.name} rolled three 6s: turn over.`);
  const from = s.pos[seatId];
  const walk = from + dice;
  if (walk > GOAL) {
    next = note(next, `${seat.name} rolled ${dice}: needs exactly ${GOAL - from} to finish.`);
    return dice === 6 ? next : pass(next);
  }
  const to = LADDERS[walk] ?? SNAKES[walk] ?? walk;
  const via = LADDERS[walk] ? "ladder" : SNAKES[walk] ? "snake" : null;
  next = { ...next, pos: { ...s.pos, [seatId]: to }, last: { seat: seatId, from, walk, to, via, seq } };
  next = note(next, via === "ladder" ? `${seat.name} rolled ${dice} and climbed a ladder: ${walk} → ${to}! 🪜` : via === "snake" ? `${seat.name} rolled ${dice} and got bitten: ${walk} → ${to}. 🐍` : `${seat.name} rolled ${dice}: ${from || "start"} → ${to}.`);
  if (to === GOAL) return note({ ...next, winner: seatId, over: true }, `${seat.name} wins! 🎉`);
  return dice === 6 ? note(next, `${seat.name} rolled a 6: roll again.`) : pass(next);
}

/** Everyone, best first: the winner, then by how far along they are. */
export function standings(s: SnakesState): SnakeSeat[] {
  return [...s.seats].sort((a, b) => (a.id === s.winner ? -1 : b.id === s.winner ? 1 : s.pos[b.id] - s.pos[a.id]));
}

/** Where square n sits on the 10×10 board (row 0 at the top): 1 is bottom-left, rows snake back and forth. */
export function cellOfSquare(n: number): { r: number; c: number } {
  const k = Math.max(1, Math.min(GOAL, n)) - 1;
  const row = Math.floor(k / 10);
  const col = row % 2 ? 9 - (k % 10) : k % 10;
  return { r: 9 - row, c: col };
}
