/**
 * Bingo, the pen-and-paper way: everyone writes 1–25 into a 5×5 card in any order they like (secretly).
 * Then, in turns, each player calls one number; everyone slashes it on their own card. Every complete
 * row, column or diagonal earns the next letter of B-I-N-G-O; whoever spells all five letters (5 lines)
 * first wins (if several get there on the same call, they share it). HIVEMIND's bots fill a random card
 * and call the number that helps their lines most.
 *
 * Pure: the shuffles come from the caller (the host's browser), so tests are repeatable.
 */
export type BingoColor = "red" | "blue" | "green" | "yellow" | "purple" | "orange";
export const BINGO_COLORS: BingoColor[] = ["red", "blue", "green", "yellow", "purple", "orange"];
export const LETTERS = ["B", "I", "N", "G", "O"] as const;
/** Lines needed to spell BINGO. */
export const NEED = 5;
export const SIZE = 25;
/** Every way to make a line: 5 rows, 5 columns, 2 diagonals (as card indexes, row by row). */
export const LINES: number[][] = [
  ...Array.from({ length: 5 }, (_, r) => Array.from({ length: 5 }, (_, c) => r * 5 + c)),
  ...Array.from({ length: 5 }, (_, c) => Array.from({ length: 5 }, (_, r) => r * 5 + c)),
  [0, 6, 12, 18, 24],
  [4, 8, 12, 16, 20],
];

export type BingoSeat = { id: string; name: string; color: BingoColor; bot: boolean };
export type BingoPhase = "setup" | "play" | "over";
export type BingoState = {
  seats: BingoSeat[];
  phase: BingoPhase;
  /** Seat → 25 numbers, row by row. Only their own in a friend's copy (everyone's once it's over). Absent until they're ready. */
  cards: Record<string, number[]>;
  /** Seat → has filled in their card. */
  ready: Record<string, boolean>;
  called: number[];
  /** Number → who called it. */
  by: Record<number, string>;
  turn: number;
  /** Seat → complete lines (a letter of BINGO each). */
  lines: Record<string, number>;
  winners: string[];
  log: string[];
  seq: number;
};
export type BingoAction = { type: "ready"; card: number[] } | { type: "call"; n: number };

/** A shuffle from the caller's random numbers (`rand` gives [0, 1)). */
export function shuffle<T>(list: T[], rand: () => number): T[] {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
export const randomCard = (rand: () => number) => shuffle(Array.from({ length: SIZE }, (_, i) => i + 1), rand);
/** Is this a card: exactly the numbers 1–25, each once? */
export const validCard = (c: unknown): c is number[] => Array.isArray(c) && c.length === SIZE && new Set(c).size === SIZE && c.every((n) => Number.isInteger(n) && n >= 1 && n <= SIZE);

/** Which of the 12 lines are complete (by index into LINES) once `called` are slashed. */
export function doneLines(card: number[], called: Set<number>): number[] {
  return LINES.flatMap((l, k) => (l.every((i) => called.has(card[i])) ? [k] : []));
}

export function newBingo(players: { id: string; name: string; bot?: boolean }[], rand: () => number = Math.random): BingoState {
  const seats = players.slice(0, 6).map((p, i) => ({ id: p.id, name: p.name, color: BINGO_COLORS[i], bot: !!p.bot }));
  const bots = seats.filter((x) => x.bot);
  const s: BingoState = {
    seats,
    phase: "setup",
    cards: Object.fromEntries(bots.map((x) => [x.id, randomCard(rand)])),
    ready: Object.fromEntries(seats.map((x) => [x.id, x.bot])),
    called: [],
    by: {},
    turn: 0,
    lines: Object.fromEntries(seats.map((x) => [x.id, 0])),
    winners: [],
    log: ["Fill in your card: put 1–25 in the boxes however you like."],
    seq: 0,
  };
  return seats.every((x) => x.bot) ? play(s) : s;
}

const note = (s: BingoState, line: string): BingoState => ({ ...s, log: [...s.log.slice(-19), line] });
const nameOf = (s: BingoState, id: string) => s.seats.find((x) => x.id === id)?.name ?? "?";
const play = (s: BingoState): BingoState => note({ ...s, phase: "play", turn: 0 }, `Everyone's ready. ${s.seats[0].name} calls first!`);

/** The host starts now: anyone not ready gets a random card. */
export function beginPlay(s: BingoState, rand: () => number = Math.random): BingoState {
  if (s.phase !== "setup") return s;
  const cards = { ...s.cards };
  const ready = { ...s.ready };
  for (const x of s.seats) if (!cards[x.id]) {
    cards[x.id] = randomCard(rand);
    ready[x.id] = true;
  }
  return play({ ...s, cards, ready, seq: s.seq + 1 });
}

/** One player's request: hand in a filled card, or (on their turn) call a number. */
export function bingoAct(s: BingoState, id: string, a: BingoAction): BingoState {
  const seq = s.seq + 1;
  if (a.type === "ready") {
    if (s.phase !== "setup" || s.ready[id] || !s.seats.some((x) => x.id === id) || !validCard(a.card)) return s;
    const n: BingoState = { ...s, cards: { ...s.cards, [id]: [...a.card] }, ready: { ...s.ready, [id]: true }, seq };
    return n.seats.every((x) => n.ready[x.id]) ? play(n) : note(n, `${nameOf(s, id)} is ready.`);
  }
  if (a.type === "call") {
    const n = Number(a.n);
    if (s.phase !== "play" || s.seats[s.turn]?.id !== id || !Number.isInteger(n) || n < 1 || n > SIZE || s.called.includes(n)) return s;
    const called = [...s.called, n];
    const set = new Set(called);
    const lines = Object.fromEntries(s.seats.map((x) => [x.id, doneLines(s.cards[x.id], set).length]));
    let next: BingoState = { ...s, called, by: { ...s.by, [n]: id }, lines, seq };
    next = note(next, `${nameOf(s, id)} calls ${n}.`);
    const winners = next.seats.filter((x) => lines[x.id] >= NEED).map((x) => x.id);
    if (winners.length) return note({ ...next, winners, phase: "over" }, `${winners.map((w) => nameOf(s, w)).join(" and ")} ${winners.length > 1 ? "all spell" : "spells"} B-I-N-G-O and ${winners.length > 1 ? "share the win" : "wins"}! 🎉`);
    const gained = next.seats.filter((x) => lines[x.id] > s.lines[x.id]);
    for (const x of gained) next = note(next, `${x.name} completes a line: ${LETTERS.slice(0, lines[x.id]).join("-")}!`);
    return { ...next, turn: (s.turn + 1) % s.seats.length };
  }
  return s;
}

/** Numbers `id` can still call (on their own card, not called yet). */
export const callable = (s: BingoState, id: string) => (s.cards[id] ?? []).filter((n) => !s.called.includes(n));

/** The number that helps `id` most: the one sitting in the lines that are closest to complete. */
export function bestCall(s: BingoState, id: string): number | null {
  const card = s.cards[id];
  if (!card) return null;
  const set = new Set(s.called);
  let best: number | null = null;
  let top = -1;
  for (const n of callable(s, id)) {
    const i = card.indexOf(n);
    const score = LINES.filter((l) => l.includes(i)).reduce((t, l) => t + (l.filter((k) => set.has(card[k])).length + 1) ** 2, 0);
    if (score > top) {
      top = score;
      best = n;
    }
  }
  return best ?? (Array.from({ length: SIZE }, (_, k) => k + 1).find((n) => !s.called.includes(n)) ?? null);
}

/** What one player may see: their own card (everyone's once it's over); never anyone else's before that. */
export function viewFor(s: BingoState, id: string): BingoState {
  return s.phase === "over" ? s : { ...s, cards: Object.fromEntries(Object.entries(s.cards).filter(([k]) => k === id)) };
}
