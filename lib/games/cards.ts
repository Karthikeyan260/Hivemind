/**
 * Colour Clash: the classic colour-matching card game (Uno-style). 108 cards: in each of four colours
 * one 0, two each of 1–9, Skip, Reverse and +2; plus four Wild and four Wild +4. Match the top card's
 * colour, number or symbol, or play a Wild and choose the colour. Can't play? Draw one; if it fits
 * you may play it, else your turn ends. Skip skips the next player, Reverse turns the direction
 * (with two players it works like Skip), +2 and +4 make the next player draw and lose their turn.
 * Going down to one card, you must call "Last card!" first, or draw 2. First to empty their hand
 * wins. Pure: the shuffle comes from the caller, so only the host shuffles, and tests repeat.
 */
export type CardColor = "red" | "yellow" | "green" | "blue";
export const CARD_COLORS: CardColor[] = ["red", "yellow", "green", "blue"];
export type Card = { id: number; color: CardColor | null; kind: "num" | "skip" | "reverse" | "draw2" | "wild" | "wild4"; n?: number };
export type CardSeat = { id: string; name: string; bot: boolean };
export type CardsState = {
  seats: CardSeat[];
  hands: Record<string, Card[]>;
  /** In the host's copy only; the friend's copy has it empty (see viewFor). */
  deck: Card[];
  deckCount: number;
  /** Cards in each hand (so a friend sees how many others hold without seeing them). */
  counts: Record<string, number>;
  discard: Card[];
  /** The colour to match (a Wild's chosen colour). */
  color: CardColor;
  turn: number;
  dir: 1 | -1;
  /** The current player drew a card this turn: they may play only that card, or pass. */
  drew: number | null;
  /** Called "Last card!" (cleared once they have more than one card again). */
  called: Record<string, boolean>;
  winner: string | null;
  log: string[];
  last?: { seq: number; seat: string; type: "play" | "draw" | "penalty"; card?: Card; count?: number };
  seq: number;
};
export type Rand = () => number;

export function makeDeck(): Card[] {
  const cards: Card[] = [];
  let id = 0;
  for (const color of CARD_COLORS) {
    cards.push({ id: id++, color, kind: "num", n: 0 });
    for (let n = 1; n <= 9; n++) for (let k = 0; k < 2; k++) cards.push({ id: id++, color, kind: "num", n });
    for (const kind of ["skip", "reverse", "draw2"] as const) for (let k = 0; k < 2; k++) cards.push({ id: id++, color, kind });
  }
  for (let k = 0; k < 4; k++) cards.push({ id: id++, color: null, kind: "wild" });
  for (let k = 0; k < 4; k++) cards.push({ id: id++, color: null, kind: "wild4" });
  return cards;
}

export function shuffle<T>(arr: T[], rand: Rand): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export const label = (c: Card) => (c.kind === "num" ? `${c.color} ${c.n}` : c.kind === "wild" ? "Wild" : c.kind === "wild4" ? "Wild +4" : `${c.color} ${c.kind === "draw2" ? "+2" : c.kind}`);

const withCounts = (s: CardsState): CardsState => ({ ...s, deckCount: s.deck.length, counts: Object.fromEntries(Object.entries(s.hands).map(([k, v]) => [k, v.length])) });
const note = (s: CardsState, line: string): CardsState => ({ ...s, log: [...s.log.slice(-19), line] });
const top = (s: CardsState) => s.discard[s.discard.length - 1];

export function newCardGame(players: { id: string; name: string; bot?: boolean }[], rand: Rand, handSize = 7): CardsState {
  let deck = shuffle(makeDeck(), rand);
  const hands: Record<string, Card[]> = {};
  for (const p of players) hands[p.id] = deck.splice(0, handSize);
  // Start on a plain number card (actions and Wilds go back in the deck).
  const start = deck.splice(deck.findIndex((c) => c.kind === "num"), 1)[0];
  deck = shuffle(deck, rand);
  return withCounts({
    seats: players.map((p) => ({ id: p.id, name: p.name, bot: !!p.bot })),
    hands,
    deck,
    deckCount: deck.length,
    counts: {},
    discard: [start],
    color: start.color!,
    turn: 0,
    dir: 1,
    drew: null,
    called: {},
    winner: null,
    log: [`${players[0].name} starts. First card: ${label(start)}.`],
    seq: 0,
  });
}

/** Can this card go on the pile now? */
export function canPlay(s: CardsState, c: Card): boolean {
  if (c.kind === "wild" || c.kind === "wild4") return true;
  const t = top(s);
  if (c.color === s.color) return true;
  if (c.kind === "num" && t.kind === "num") return c.n === t.n;
  return c.kind !== "num" && c.kind === t.kind;
}

/** Cards the current player may play right now. */
export function playable(s: CardsState): Card[] {
  if (s.winner) return [];
  const seat = s.seats[s.turn];
  const hand = s.hands[seat.id] ?? [];
  if (s.drew !== null) return hand.filter((c) => c.id === s.drew && canPlay(s, c));
  return hand.filter((c) => canPlay(s, c));
}

const step = (s: CardsState, by = 1) => (s.turn + s.dir * by + s.seats.length * 4) % s.seats.length;

/** Takes n cards from the deck for a player (reshuffling the pile under the top card if needed). */
function take(s: CardsState, id: string, n: number, rand: Rand): CardsState {
  let deck = [...s.deck];
  let discard = s.discard;
  const got: Card[] = [];
  for (let i = 0; i < n; i++) {
    if (!deck.length) {
      if (discard.length <= 1) break;
      deck = shuffle(discard.slice(0, -1), rand);
      discard = discard.slice(-1);
    }
    got.push(deck.shift()!);
  }
  return { ...s, deck, discard, hands: { ...s.hands, [id]: [...s.hands[id], ...got] } };
}

/** The current player plays a card (a Wild needs the colour they choose). */
export function play(s: CardsState, seatId: string, cardId: number, chosen: CardColor | null, rand: Rand): CardsState {
  const seat = s.seats[s.turn];
  if (seat.id !== seatId || s.winner) return s;
  const card = playable(s).find((c) => c.id === cardId);
  if (!card) return s;
  const wild = card.kind === "wild" || card.kind === "wild4";
  if (wild && !(chosen && CARD_COLORS.includes(chosen))) return s;
  const hand = s.hands[seatId].filter((c) => c.id !== cardId);
  let next: CardsState = { ...s, hands: { ...s.hands, [seatId]: hand }, discard: [...s.discard, card], color: wild ? chosen! : card.color!, drew: null, seq: s.seq + 1 };
  next.last = { seq: next.seq, seat: seatId, type: "play", card };
  next = note(next, `${seat.name} played ${label(card)}${wild ? ` and chose ${chosen}` : ""}.`);

  if (!hand.length) return withCounts(note({ ...next, winner: seatId }, `🏆 ${seat.name} wins!`));
  // One card left without calling "Last card!": draw 2.
  if (hand.length === 1 && !s.called[seatId]) {
    next = take(next, seatId, 2, rand);
    next = note(next, `${seat.name} forgot to say "Last card!" and draws 2.`);
    next.last = { seq: next.seq, seat: seatId, type: "penalty", count: 2 };
  }
  const called = { ...next.called, [seatId]: next.hands[seatId].length === 1 && !!s.called[seatId] };

  const two = s.seats.length === 2;
  let dir = next.dir;
  let skip = 0;
  let drawN = 0;
  if (card.kind === "skip") skip = 1;
  if (card.kind === "reverse") {
    dir = (dir * -1) as 1 | -1;
    if (two) skip = 1;
  }
  if (card.kind === "draw2") drawN = 2;
  if (card.kind === "wild4") drawN = 4;
  next = { ...next, dir, called };
  if (drawN) {
    const victim = next.seats[(next.turn + dir + next.seats.length) % next.seats.length];
    next = take(next, victim.id, drawN, rand);
    next = note(next, `${victim.name} draws ${drawN} and misses a turn.`);
    skip = 1;
  }
  return withCounts({ ...next, turn: step(next, 1 + skip) });
}

/** The current player draws one card (once per turn). */
export function draw(s: CardsState, seatId: string, rand: Rand): CardsState {
  const seat = s.seats[s.turn];
  if (seat.id !== seatId || s.winner || s.drew !== null) return s;
  let next = take(s, seatId, 1, rand);
  const got = next.hands[seatId][next.hands[seatId].length - 1];
  next = { ...next, seq: s.seq + 1, called: { ...next.called, [seatId]: false } };
  next.last = { seq: next.seq, seat: seatId, type: "draw", count: 1 };
  if (next.hands[seatId].length === s.hands[seatId].length) return withCounts(note({ ...next, turn: step(next) }, `${seat.name} couldn't draw.`));
  // A drawn card that fits may be played straight away; otherwise the turn passes.
  if (canPlay(next, got)) return withCounts(note({ ...next, drew: got.id }, `${seat.name} drew a card.`));
  return withCounts(note({ ...next, turn: step(next), drew: null }, `${seat.name} drew a card.`));
}

/** After drawing a playable card, keep it instead. */
export function pass(s: CardsState, seatId: string): CardsState {
  const seat = s.seats[s.turn];
  if (seat.id !== seatId || s.drew === null) return s;
  return withCounts({ ...s, drew: null, turn: step(s), seq: s.seq + 1 });
}

/** "Last card!": allowed on your turn when you're about to play your second-to-last card. */
export function callLast(s: CardsState, seatId: string): CardsState {
  const seat = s.seats[s.turn];
  if (seat.id !== seatId || s.hands[seatId].length !== 2 || s.called[seatId]) return s;
  return note({ ...s, called: { ...s.called, [seatId]: true }, seq: s.seq + 1 }, `${seat.name}: "Last card!"`);
}

/** What a player may see: their own hand, how many everyone else holds, never the deck. */
export function viewFor(s: CardsState, seatId: string): CardsState {
  return { ...s, deck: [], hands: Object.fromEntries(Object.entries(s.hands).map(([k, v]) => [k, k === seatId ? v : []])) };
}

/** HIVEMIND's turn as a bot: what to do next. */
export function botMove(s: CardsState): { type: "play"; card: number; color: CardColor | null; call: boolean } | { type: "draw" } | { type: "pass" } {
  const seat = s.seats[s.turn];
  const hand = s.hands[seat.id];
  const options = playable(s);
  if (!options.length) return s.drew !== null ? { type: "pass" } : { type: "draw" };
  const nextId = s.seats[step(s)].id;
  const danger = (s.counts[nextId] ?? s.hands[nextId]?.length ?? 9) <= 2;
  const rank = (c: Card) =>
    // Hit hard when the next player is about to win; otherwise keep Wilds for later.
    (danger && (c.kind === "draw2" || c.kind === "wild4" || c.kind === "skip") ? 50 : 0) + (c.kind === "num" ? 10 + (c.n ?? 0) / 10 : 0) + (c.kind === "skip" || c.kind === "reverse" || c.kind === "draw2" ? 8 : 0) + (c.kind === "wild" ? 2 : 0) + (c.kind === "wild4" ? 1 : 0);
  const card = options.reduce((a, b) => (rank(b) > rank(a) ? b : a));
  const most = CARD_COLORS.map((col) => [col, hand.filter((c) => c.color === col && c.id !== card.id).length] as const).sort((a, b) => b[1] - a[1])[0][0];
  return { type: "play", card: card.id, color: card.color ? null : most, call: hand.length === 2 };
}
