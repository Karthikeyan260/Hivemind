/**
 * Ludo rules, as played in India: roll a 6 to bring a token out; a 6 gives another roll, but three
 * 6s in a row lose the turn; landing on an opponent (off a safe square) sends it home and gives
 * another roll; reaching home needs the exact number and also gives another roll; first to bring
 * every token home wins (the others keep playing for 2nd and 3rd). Pure: no browser, no network,
 * and the dice come from the caller (so the host's roll is the only roll, and tests are repeatable).
 *
 * A token's position is its progress from its own start: -1 = in the yard, 0–50 = on the shared
 * track (0 is its start square), 51–55 = its home column, 56 = home.
 */
export type Color = "red" | "green" | "yellow" | "blue";
export const COLORS: Color[] = ["red", "green", "yellow", "blue"];
export type Seat = { id: string; name: string; color: Color; bot: boolean };
export type LudoState = {
  seats: Seat[];
  tokens: Record<string, number[]>;
  /** Index into seats of whose turn it is. */
  turn: number;
  dice: number | null;
  /** The current player rolled and must now move (or has no move). */
  rolled: boolean;
  sixes: number;
  /** Seat ids in the order they finished. */
  finished: string[];
  over: boolean;
  log: string[];
  /** The last move, for the board's animation and the "they captured you" moment. */
  last?: { seat: string; token: number; from: number; to: number; captured?: { seat: string; token: number }[]; seq: number };
  /** The last roll, kept after the turn passes so everyone sees what was rolled. */
  lastRoll?: { seat: string; value: number; seq: number };
  seq: number;
};

export const TRACK = 52;
export const HOME = 56;
const START: Record<Color, number> = { red: 0, green: 13, yellow: 26, blue: 39 };
/** Start squares and star squares: nobody can be captured there. */
export const SAFE = new Set([0, 8, 13, 21, 26, 34, 39, 47]);

/** Where a token is on the shared track (0–51), or null when it's in the yard, its home column or home. */
export function square(color: Color, p: number): number | null {
  return p >= 0 && p <= 50 ? (START[color] + p) % TRACK : null;
}

export function newGame(players: { id: string; name: string; bot?: boolean }[], tokensEach: 2 | 4 = 4): LudoState {
  // Two players sit opposite each other (red and yellow); four go round the board.
  const colors: Color[] = players.length === 2 ? ["red", "yellow"] : players.length === 3 ? ["red", "green", "yellow"] : COLORS;
  const seats = players.map((p, i) => ({ id: p.id, name: p.name, color: colors[i], bot: !!p.bot }));
  return {
    seats,
    tokens: Object.fromEntries(seats.map((s) => [s.id, Array(tokensEach).fill(-1)])),
    turn: 0,
    dice: null,
    rolled: false,
    sixes: 0,
    finished: [],
    over: false,
    log: [`${seats[0].name} starts.`],
    seq: 0,
  };
}

const seatOf = (s: LudoState, id: string) => s.seats.find((x) => x.id === id)!;

/** Tokens the current player may move with the dice shown. */
export function movable(s: LudoState): number[] {
  if (!s.rolled || s.dice == null || s.over) return [];
  const seat = s.seats[s.turn];
  return s.tokens[seat.id].flatMap((p, i) => (p === -1 ? (s.dice === 6 ? [i] : []) : p < HOME && p + s.dice! <= HOME ? [i] : []));
}

const done = (s: LudoState, id: string) => s.tokens[id].every((p) => p === HOME);

/** Next seat that's still playing. */
function advance(s: LudoState): LudoState {
  let t = s.turn;
  for (let k = 0; k < s.seats.length; k++) {
    t = (t + 1) % s.seats.length;
    if (!s.finished.includes(s.seats[t].id)) break;
  }
  return { ...s, turn: t, dice: null, rolled: false, sixes: 0 };
}

const note = (s: LudoState, line: string): LudoState => ({ ...s, log: [...s.log.slice(-19), line] });

/** The current player rolls (the caller supplies the 1–6). */
export function roll(s: LudoState, seatId: string, dice: number): LudoState {
  const seat = s.seats[s.turn];
  if (s.over || s.rolled || seat.id !== seatId || !(dice >= 1 && dice <= 6)) return s;
  const sixes = dice === 6 ? s.sixes + 1 : 0;
  let next: LudoState = { ...s, dice, rolled: true, sixes, seq: s.seq + 1, lastRoll: { seat: seatId, value: dice, seq: s.seq + 1 } };
  if (sixes === 3) return note(advance(next), `${seat.name} rolled three 6s: turn over.`);
  if (!movable(next).length) {
    next = note(next, `${seat.name} rolled ${dice}: no move.`);
    // A 6 with nothing to move still rolls again; anything else passes the turn.
    return dice === 6 ? { ...next, rolled: false } : advance(next);
  }
  return next;
}

/** The current player moves one of their tokens by the dice. */
export function move(s: LudoState, seatId: string, token: number): LudoState {
  const seat = s.seats[s.turn];
  if (seat.id !== seatId || !movable(s).includes(token)) return s;
  const dice = s.dice!;
  const tokens = Object.fromEntries(Object.entries(s.tokens).map(([k, v]) => [k, [...v]]));
  const from = tokens[seat.id][token];
  const to = from === -1 ? 0 : from + dice;
  tokens[seat.id][token] = to;

  // Captures: opponents alone or together on the square we land on, unless it's a safe square.
  const captured: { seat: string; token: number }[] = [];
  const sq = square(seat.color, to);
  if (sq !== null && !SAFE.has(sq)) {
    for (const other of s.seats) {
      if (other.id === seat.id) continue;
      tokens[other.id].forEach((p, i) => {
        if (square(other.color, p) === sq) {
          tokens[other.id][i] = -1;
          captured.push({ seat: other.id, token: i });
        }
      });
    }
  }

  let next: LudoState = { ...s, tokens, last: { seat: seat.id, token, from, to, ...(captured.length ? { captured } : {}), seq: s.seq + 1 }, seq: s.seq + 1 };
  if (captured.length) next = note(next, `${seat.name} captured ${[...new Set(captured.map((c) => seatOf(s, c.seat).name))].join(" and ")}!`);
  if (to === HOME) next = note(next, `${seat.name} brought a token home.`);

  if (done(next, seat.id)) {
    const finished = [...next.finished, seat.id];
    next = note({ ...next, finished }, finished.length === 1 ? `🏆 ${seat.name} wins!` : `${seat.name} finished #${finished.length}.`);
    // Over when only one player is left still playing.
    if (finished.length >= next.seats.length - 1) {
      const lastOne = next.seats.find((x) => !finished.includes(x.id));
      return { ...next, finished: lastOne ? [...finished, lastOne.id] : finished, over: true, dice: null, rolled: false };
    }
    return advance(next);
  }
  // Another roll for a 6, a capture or reaching home.
  if (dice === 6 || captured.length || to === HOME) return { ...next, dice: null, rolled: false };
  return advance(next);
}

/**
 * HIVEMIND's move as a bot: capture if it can, then bring a token home, then get out of danger,
 * then bring a new token out, then land on a safe square, else move the token furthest along.
 */
export function botChoice(s: LudoState): number | null {
  const options = movable(s);
  if (!options.length) return null;
  const seat = s.seats[s.turn];
  const mine = s.tokens[seat.id];
  const dice = s.dice!;
  const theirs = s.seats.filter((x) => x.id !== seat.id).flatMap((x) => s.tokens[x.id].map((p) => square(x.color, p)).filter((q): q is number => q !== null));
  // Squares an opponent could reach with their next roll.
  const danger = (sq: number | null) => sq !== null && !SAFE.has(sq) && theirs.some((q) => ((sq - q + TRACK) % TRACK) >= 1 && ((sq - q + TRACK) % TRACK) <= 6);
  const score = (i: number) => {
    const from = mine[i];
    const to = from === -1 ? 0 : from + dice;
    const sq = square(seat.color, to);
    let v = to / 10;
    if (sq !== null && !SAFE.has(sq) && theirs.includes(sq)) v += 100;
    if (to === HOME) v += 80;
    if (danger(square(seat.color, from)) && !danger(sq)) v += 40;
    if (from === -1) v += 30;
    if (sq !== null && SAFE.has(sq)) v += 15;
    if (to > 50 && from <= 50) v += 20; // into the home column: safe for good
    if (danger(sq)) v -= 25;
    return v;
  };
  return options.reduce((best, i) => (score(i) > score(best) ? i : best), options[0]);
}
