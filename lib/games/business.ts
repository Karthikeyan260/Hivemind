/**
 * Business, the Indian property game: roll two dice round a 32-square board of Indian cities, buy
 * what you land on, collect rent, build houses and a hotel once you own a whole colour group, and
 * drive everyone else bankrupt. ₹15,000 to start, ₹1,500 every time you pass START. Doubles roll
 * again (three doubles in a row: jail). Jail: roll doubles to get out, or pay ₹500 (after three
 * tries you must pay). Short of cash: houses are sold back at half price, then you're bankrupt and
 * out. A quick game can end after a set number of rounds: the richest (cash + property) wins.
 *
 * Pure: the dice and the card draw come from the caller (the host's browser), so tests are repeatable.
 */
export type BizColor = "red" | "blue" | "green" | "yellow" | "purple" | "orange";
export const BIZ_COLORS: BizColor[] = ["red", "blue", "green", "yellow", "purple", "orange"];
export type Group = "brown" | "sky" | "pink" | "orange" | "red" | "yellow" | "green" | "blue";
export type Square =
  | { kind: "start"; name: string }
  | { kind: "city"; name: string; group: Group; price: number }
  | { kind: "station"; name: string; price: number }
  | { kind: "utility"; name: string; price: number }
  | { kind: "tax"; name: string; amount: number }
  | { kind: "chance"; name: string }
  | { kind: "treasure"; name: string }
  | { kind: "jail"; name: string }
  | { kind: "rest"; name: string }
  | { kind: "gotojail"; name: string };

const city = (name: string, group: Group, price: number): Square => ({ kind: "city", name, group, price });
const station = (name: string): Square => ({ kind: "station", name, price: 2000 });
const utility = (name: string): Square => ({ kind: "utility", name, price: 1500 });
export const BOARD: Square[] = [
  { kind: "start", name: "START" },
  city("Agra", "brown", 600),
  { kind: "treasure", name: "Treasure" },
  city("Jaipur", "brown", 600),
  { kind: "tax", name: "Income Tax", amount: 1500 },
  station("Railways"),
  city("Kochi", "sky", 1000),
  city("Madurai", "sky", 1200),
  { kind: "jail", name: "Jail" },
  city("Mysuru", "pink", 1400),
  utility("Electric Co."),
  city("Coimbatore", "pink", 1400),
  city("Pune", "pink", 1600),
  station("Airways"),
  city("Hyderabad", "orange", 1800),
  city("Lucknow", "orange", 2000),
  { kind: "rest", name: "Rest House" },
  city("Kolkata", "red", 2200),
  { kind: "chance", name: "Chance" },
  city("Ahmedabad", "red", 2200),
  city("Chandigarh", "red", 2400),
  station("Waterways"),
  city("Bengaluru", "yellow", 2600),
  city("Chennai", "yellow", 2800),
  { kind: "gotojail", name: "Go to Jail" },
  city("Goa", "green", 3000),
  { kind: "chance", name: "Chance" },
  city("Shimla", "green", 3200),
  utility("Water Works"),
  station("Roadways"),
  city("Delhi", "blue", 3500),
  city("Mumbai", "blue", 4000),
];
export const JAIL = 8;
export const START_CASH = 15000;
export const PASS_START = 1500;
export const JAIL_FINE = 500;
const HOUSE_X = [1, 5, 15, 40, 55, 70];

export type BizSeat = { id: string; name: string; color: BizColor; bot: boolean };
export type Phase = "roll" | "buy" | "end";
export type BizState = {
  seats: BizSeat[];
  cash: Record<string, number>;
  pos: Record<string, number>;
  /** Square → owner's seat id. */
  owner: Record<number, string>;
  /** Square → 0–4 houses, 5 = a hotel. */
  houses: Record<number, number>;
  /** Seat → failed tries to roll out of jail so far; absent = not in jail. */
  jail: Record<string, number>;
  out: string[];
  turn: number;
  phase: Phase;
  dice: [number, number] | null;
  /** Doubles rolled this turn (the third sends you to jail). */
  doubles: number;
  /** A double this turn means another roll after this one. */
  again: boolean;
  round: number;
  /** 0 = play until one is left. */
  maxRounds: number;
  winner: string | null;
  over: boolean;
  log: string[];
  /** The last card drawn, shown in the middle of the board. */
  card?: { text: string; deck: "chance" | "treasure"; seq: number };
  last?: { seat: string; from: number; to: number; seq: number };
  lastRoll?: { seat: string; dice: [number, number]; seq: number };
  /** Everything that happened since the current player's roll, in words (shown in the middle of the board). */
  story?: string[];
  /** Whose cash changed in the last action, and by how much (the +₹ / −₹ that float up). */
  money?: { id: string; delta: number }[];
  /** Lines ever logged (so the story knows which are new). */
  told?: number;
  seq: number;
};

export type BizAction = { type: "roll" } | { type: "buy" } | { type: "skip" } | { type: "end" } | { type: "build"; sq: number } | { type: "sell"; sq: number } | { type: "payJail" };
/** What the caller rolled and drew (the host's random numbers). */
export type BizLuck = { d1: number; d2: number; pick: number };

export const houseCost = (sq: number) => {
  const q = BOARD[sq];
  return q.kind === "city" ? Math.round(q.price / 2 / 100) * 100 : 0;
};
export const groupOf = (g: Group) => BOARD.flatMap((q, i) => (q.kind === "city" && q.group === g ? [i] : []));
export const ownsGroup = (s: BizState, id: string, g: Group) => groupOf(g).every((i) => s.owner[i] === id);
const priceOf = (sq: number) => {
  const q = BOARD[sq];
  return q.kind === "city" || q.kind === "station" || q.kind === "utility" ? q.price : 0;
};

/** Rent due on a square (with the dice total, for utilities). */
export function rentOf(s: BizState, sq: number, diceTotal: number): number {
  const q = BOARD[sq];
  const who = s.owner[sq];
  if (!who) return 0;
  if (q.kind === "city") {
    const base = Math.round((q.price * 0.08) / 10) * 10;
    const h = s.houses[sq] ?? 0;
    return h ? base * HOUSE_X[h] : ownsGroup(s, who, q.group) ? base * 2 : base;
  }
  if (q.kind === "station") {
    const n = BOARD.filter((x, i) => x.kind === "station" && s.owner[i] === who).length;
    return 250 * 2 ** (n - 1);
  }
  if (q.kind === "utility") {
    const n = BOARD.filter((x, i) => x.kind === "utility" && s.owner[i] === who).length;
    return diceTotal * (n === 2 ? 100 : 40);
  }
  return 0;
}

/** The title deed's rent lines for a square (what the property card shows). */
export function rentTable(sq: number): { label: string; amount: string }[] {
  const q = BOARD[sq];
  const rs = (n: number) => `₹${n.toLocaleString("en-IN")}`;
  if (q.kind === "city") {
    const base = Math.round((q.price * 0.08) / 10) * 10;
    return [
      { label: "Rent", amount: rs(base) },
      { label: "With the colour set", amount: rs(base * 2) },
      ...[1, 2, 3, 4].map((h) => ({ label: `With ${h} house${h > 1 ? "s" : ""}`, amount: rs(base * HOUSE_X[h]) })),
      { label: "With a hotel", amount: rs(base * HOUSE_X[5]) },
      { label: "Each house costs", amount: rs(houseCost(sq)) },
    ];
  }
  if (q.kind === "station") return [1, 2, 3, 4].map((n) => ({ label: `Own ${n} transport${n > 1 ? "s" : ""}`, amount: rs(250 * 2 ** (n - 1)) }));
  if (q.kind === "utility") return [
    { label: "Own 1 utility", amount: "40 × dice" },
    { label: "Own both", amount: "100 × dice" },
  ];
  return [];
}

/** Cash plus what everything owned is worth (price, and houses at cost). */
export function netWorth(s: BizState, id: string) {
  let w = s.cash[id] ?? 0;
  for (const [k, who] of Object.entries(s.owner)) if (who === id) w += priceOf(Number(k)) + (s.houses[Number(k)] ?? 0) * houseCost(Number(k));
  return w;
}

export function newBusiness(players: { id: string; name: string; bot?: boolean }[], maxRounds = 0): BizState {
  const seats = players.slice(0, 6).map((p, i) => ({ id: p.id, name: p.name, color: BIZ_COLORS[i], bot: !!p.bot }));
  return {
    seats,
    cash: Object.fromEntries(seats.map((x) => [x.id, START_CASH])),
    pos: Object.fromEntries(seats.map((x) => [x.id, 0])),
    owner: {},
    houses: {},
    jail: {},
    out: [],
    turn: 0,
    phase: "roll",
    dice: null,
    doubles: 0,
    again: false,
    round: 1,
    maxRounds,
    winner: null,
    over: false,
    log: [`${seats[0].name} starts. Everyone has ₹${START_CASH.toLocaleString("en-IN")}.`],
    seq: 0,
  };
}

const rs = (n: number) => `₹${n.toLocaleString("en-IN")}`;
const note = (s: BizState, line: string): BizState => ({ ...s, log: [...s.log.slice(-29), line], told: (s.told ?? 0) + 1 });
const nameOf = (s: BizState, id: string) => s.seats.find((x) => x.id === id)?.name ?? "?";

/** `id` pays `amount` to `to` (or the bank). Short of cash: houses go back at half price; still short: bankrupt. */
function pay(s: BizState, id: string, amount: number, to: string | null): BizState {
  let n: BizState = { ...s, cash: { ...s.cash }, houses: { ...s.houses }, owner: { ...s.owner } };
  // Sell houses (the most built first) until the bill can be paid.
  while (n.cash[id] < amount) {
    const built = Object.entries(n.owner)
      .filter(([k, w]) => w === id && (n.houses[Number(k)] ?? 0) > 0)
      .map(([k]) => Number(k))
      .sort((a, b) => (n.houses[b] ?? 0) - (n.houses[a] ?? 0));
    if (!built.length) break;
    const sq = built[0];
    n.houses[sq] -= 1;
    n.cash[id] += houseCost(sq) / 2;
    n = note(n, `${nameOf(n, id)} sold a house on ${BOARD[sq].name} for ${rs(houseCost(sq) / 2)}.`);
  }
  if (n.cash[id] >= amount) {
    n.cash[id] -= amount;
    if (to) n.cash[to] += amount;
    return n;
  }
  // Bankrupt: what's left goes to whoever was owed; the properties go back to the bank.
  if (to) n.cash[to] += n.cash[id];
  n.cash[id] = 0;
  for (const [k, w] of Object.entries(n.owner)) if (w === id) delete n.owner[Number(k)];
  for (const k of Object.keys(n.houses)) if (!n.owner[Number(k)]) delete n.houses[Number(k)];
  const jail = { ...n.jail };
  delete jail[id];
  n = note({ ...n, jail, out: [...n.out, id] }, `${nameOf(n, id)} is bankrupt and out of the game! 💸`);
  const left = n.seats.filter((x) => !n.out.includes(x.id));
  if (left.length === 1) n = note({ ...n, over: true, winner: left[0].id }, `${left[0].name} wins the game! 🏆`);
  return n;
}

function toJail(s: BizState, id: string, why: string): BizState {
  return note({ ...s, pos: { ...s.pos, [id]: JAIL }, jail: { ...s.jail, [id]: 0 }, again: false, phase: "end" }, `${nameOf(s, id)} ${why}: off to jail! 🚔`);
}

/** Move forward `steps` (passing START pays). */
function advanceBy(s: BizState, id: string, steps: number): BizState {
  const from = s.pos[id];
  const to = (from + steps) % BOARD.length;
  let n: BizState = { ...s, pos: { ...s.pos, [id]: to }, last: { seat: id, from, to, seq: s.seq } };
  if (from + steps >= BOARD.length) n = note({ ...n, cash: { ...n.cash, [id]: n.cash[id] + PASS_START } }, `${nameOf(n, id)} passed START: +${rs(PASS_START)}.`);
  return n;
}
/** Move to a square going forward (passing START pays). */
const advanceTo = (s: BizState, id: string, sq: number) => advanceBy(s, id, (sq - s.pos[id] + BOARD.length) % BOARD.length || BOARD.length);

type Card = { text: string; run: (s: BizState, id: string, total: number) => BizState };
const CHANCE: Card[] = [
  { text: "Advance to START.", run: (s, id) => advanceTo(s, id, 0) },
  { text: "Go to Jail. Do not pass START.", run: (s, id) => toJail(s, id, "drew Go to Jail") },
  { text: "The bank pays you a dividend of ₹1,000.", run: (s, id) => ({ ...s, cash: { ...s.cash, [id]: s.cash[id] + 1000 } }) },
  { text: "Speeding fine: pay ₹300.", run: (s, id) => pay(s, id, 300, null) },
  { text: "Go back 3 squares.", run: (s, id) => ({ ...s, pos: { ...s.pos, [id]: (s.pos[id] - 3 + BOARD.length) % BOARD.length }, last: { seat: id, from: s.pos[id], to: (s.pos[id] - 3 + BOARD.length) % BOARD.length, seq: s.seq } }) },
  { text: "Take a trip to Mumbai.", run: (s, id) => advanceTo(s, id, 31) },
  { text: "Building repairs: pay ₹250 per house and ₹1,000 per hotel.", run: (s, id) => pay(s, id, Object.entries(s.owner).reduce((t, [k, w]) => (w === id ? t + ((s.houses[Number(k)] ?? 0) === 5 ? 1000 : (s.houses[Number(k)] ?? 0) * 250) : t), 0), null) },
  { text: "You won a crossword competition: collect ₹1,500.", run: (s, id) => ({ ...s, cash: { ...s.cash, [id]: s.cash[id] + 1500 } }) },
];
const TREASURE: Card[] = [
  { text: "Bank error in your favour: collect ₹2,000.", run: (s, id) => ({ ...s, cash: { ...s.cash, [id]: s.cash[id] + 2000 } }) },
  { text: "Doctor's fee: pay ₹500.", run: (s, id) => pay(s, id, 500, null) },
  {
    text: "It's your birthday! Every player gives you ₹200.",
    run: (s, id) => s.seats.filter((x) => x.id !== id && !s.out.includes(x.id)).reduce((n, x) => (n.out.includes(x.id) ? n : pay(n, x.id, 200, id)), s),
  },
  { text: "Income tax refund: collect ₹200.", run: (s, id) => ({ ...s, cash: { ...s.cash, [id]: s.cash[id] + 200 } }) },
  { text: "School fees: pay ₹1,000.", run: (s, id) => pay(s, id, 1000, null) },
  { text: "Go to Jail. Do not pass START.", run: (s, id) => toJail(s, id, "drew Go to Jail") },
  { text: "Advance to START.", run: (s, id) => advanceTo(s, id, 0) },
  { text: "You inherit ₹1,000.", run: (s, id) => ({ ...s, cash: { ...s.cash, [id]: s.cash[id] + 1000 } }) },
];
export const CARD_COUNT = { chance: CHANCE.length, treasure: TREASURE.length };

/** What happens on the square just landed on. */
function land(s: BizState, id: string, total: number, pick: number, depth = 0): BizState {
  const sq = s.pos[id];
  const q = BOARD[sq];
  const n: BizState = { ...s, phase: "end" };
  if (q.kind === "city" || q.kind === "station" || q.kind === "utility") {
    const who = n.owner[sq];
    if (!who) return n.cash[id] >= q.price ? { ...n, phase: "buy" } : note(n, `${nameOf(n, id)} can't afford ${q.name} (${rs(q.price)}).`);
    if (who === id || n.out.includes(who)) return n;
    // No rent while the owner is in jail? (Indian house rule varies: we charge it.)
    const rent = rentOf(n, sq, total);
    return pay(note(n, `${nameOf(n, id)} pays ${rs(rent)} rent to ${nameOf(n, who)} for ${q.name}.`), id, rent, who);
  }
  if (q.kind === "tax") return pay(note(n, `${nameOf(n, id)} pays ${q.name}: ${rs(q.amount)}.`), id, q.amount, null);
  if (q.kind === "gotojail") return toJail(n, id, "landed on Go to Jail");
  if (q.kind === "chance" || q.kind === "treasure") {
    const deck = q.kind === "chance" ? CHANCE : TREASURE;
    const card = deck[((pick % deck.length) + deck.length) % deck.length];
    let m = note({ ...n, card: { text: card.text, deck: q.kind, seq: n.seq } }, `${nameOf(n, id)} drew ${q.name}: ${card.text}`);
    const at = m.pos[id];
    m = card.run(m, id, total);
    // A card that moved you: the new square counts too (once).
    if (!m.out.includes(id) && m.pos[id] !== at && m.jail[id] === undefined && depth === 0) return land(m, id, total, pick + 1, 1);
    return { ...m, phase: m.phase === "buy" ? "buy" : "end" };
  }
  return n;
}

const turnId = (s: BizState) => s.seats[s.turn]?.id;

/** The next player still in; a full trip round the table is a round (the quick game may end there). */
function nextTurn(s: BizState): BizState {
  let t = s.turn;
  let round = s.round;
  for (let k = 0; k < s.seats.length; k++) {
    t = (t + 1) % s.seats.length;
    if (t === 0) round++;
    if (!s.out.includes(s.seats[t].id)) break;
  }
  let n: BizState = { ...s, turn: t, round, phase: "roll", dice: null, doubles: 0, again: false };
  if (n.maxRounds && round > n.maxRounds) {
    const best = [...n.seats].filter((x) => !n.out.includes(x.id)).sort((a, b) => netWorth(n, b.id) - netWorth(n, a.id))[0];
    n = note({ ...n, over: true, winner: best.id }, `${n.maxRounds} rounds done. ${best.name} is the richest (${rs(netWorth(n, best.id))}) and wins! 🏆`);
  }
  return n;
}

/** One player's request, checked against the rules (only the current player, only what fits the moment). */
export function bizAct(s: BizState, id: string, a: BizAction, luck: BizLuck = { d1: 1, d2: 1, pick: 0 }): BizState {
  const n = step(s, id, a, luck);
  if (n === s) return s;
  // The turn's story: a roll starts it afresh; what follows (buying, building) adds to it.
  const k = Math.min(n.log.length, (n.told ?? 0) - (s.told ?? 0));
  const fresh = k > 0 ? n.log.slice(-k) : [];
  const story = a.type === "roll" || a.type === "payJail" ? fresh : [...(s.story ?? []), ...fresh].slice(-8);
  const money = n.seats.map((x) => ({ id: x.id, delta: (n.cash[x.id] ?? 0) - (s.cash[x.id] ?? 0) })).filter((m) => m.delta);
  return { ...n, story: a.type === "end" && !fresh.length ? s.story : story, money };
}

function step(s: BizState, id: string, a: BizAction, luck: BizLuck): BizState {
  if (s.over || turnId(s) !== id || s.out.includes(id)) return s;
  const seq = s.seq + 1;
  const name = nameOf(s, id);

  if (a.type === "payJail") {
    if (s.phase !== "roll" || s.jail[id] === undefined || s.cash[id] < JAIL_FINE) return s;
    const jail = { ...s.jail };
    delete jail[id];
    return note({ ...s, jail, cash: { ...s.cash, [id]: s.cash[id] - JAIL_FINE }, seq }, `${name} paid ${rs(JAIL_FINE)} to leave jail.`);
  }

  if (a.type === "roll") {
    if (s.phase !== "roll") return s;
    const { d1, d2 } = luck;
    if (![d1, d2].every((d) => Number.isInteger(d) && d >= 1 && d <= 6)) return s;
    const total = d1 + d2;
    const dbl = d1 === d2;
    let n: BizState = { ...s, seq, dice: [d1, d2], lastRoll: { seat: id, dice: [d1, d2], seq } };
    if (s.jail[id] !== undefined) {
      if (!dbl && s.jail[id] < 2) return note({ ...n, jail: { ...n.jail, [id]: s.jail[id] + 1 }, phase: "end", again: false }, `${name} rolled ${d1} and ${d2}: still in jail.`);
      const jail = { ...n.jail };
      delete jail[id];
      n = { ...n, jail };
      if (dbl) n = note(n, `${name} rolled doubles and walks out of jail!`);
      else {
        n = pay(note(n, `${name} paid ${rs(JAIL_FINE)} after three tries in jail.`), id, JAIL_FINE, null);
        if (n.out.includes(id)) return nextTurn(n);
      }
      n = land(advanceBy({ ...n, again: false }, id, total), id, total, luck.pick);
      if (n.out.includes(id)) return n.over ? n : nextTurn(n);
      return { ...n, again: false };
    }
    const doubles = dbl ? s.doubles + 1 : 0;
    if (doubles === 3) return toJail({ ...n, doubles: 0 }, id, "rolled three doubles");
    n = note({ ...n, doubles, again: dbl }, `${name} rolled ${d1} + ${d2} = ${total}${dbl ? " (doubles!)" : ""}.`);
    n = land(advanceBy(n, id, total), id, total, luck.pick);
    if (n.out.includes(id)) return n.over ? n : nextTurn(n);
    return n;
  }

  if (a.type === "buy") {
    const sq = s.pos[id];
    const price = priceOf(sq);
    if (s.phase !== "buy" || s.owner[sq] || !price || s.cash[id] < price) return s;
    return note({ ...s, seq, phase: "end", owner: { ...s.owner, [sq]: id }, cash: { ...s.cash, [id]: s.cash[id] - price } }, `${name} bought ${BOARD[sq].name} for ${rs(price)}.`);
  }
  if (a.type === "skip") {
    if (s.phase !== "buy") return s;
    return { ...s, seq, phase: "end" };
  }

  if (a.type === "build") {
    const q = BOARD[a.sq];
    if (s.phase === "buy" || !q || q.kind !== "city" || s.owner[a.sq] !== id || !ownsGroup(s, id, q.group)) return s;
    const h = s.houses[a.sq] ?? 0;
    const cost = houseCost(a.sq);
    // Build evenly: no square in the group may be more than one house ahead.
    const least = Math.min(...groupOf(q.group).map((i) => s.houses[i] ?? 0));
    if (h >= 5 || h > least || s.cash[id] < cost) return s;
    return note({ ...s, seq, houses: { ...s.houses, [a.sq]: h + 1 }, cash: { ...s.cash, [id]: s.cash[id] - cost } }, `${name} built ${h + 1 === 5 ? "a hotel" : `house ${h + 1}`} on ${q.name} for ${rs(cost)}.`);
  }
  if (a.type === "sell") {
    const h = s.houses[a.sq] ?? 0;
    if (s.owner[a.sq] !== id || !h) return s;
    const back = houseCost(a.sq) / 2;
    return note({ ...s, seq, houses: { ...s.houses, [a.sq]: h - 1 }, cash: { ...s.cash, [id]: s.cash[id] + back } }, `${name} sold a house on ${BOARD[a.sq].name} for ${rs(back)}.`);
  }

  if (a.type === "end") {
    if (s.phase !== "end") return s;
    // Doubles (and not sent to jail): roll again.
    if (s.again && s.jail[id] === undefined) return { ...s, seq, phase: "roll", dice: null, again: false };
    return { ...nextTurn(s), seq };
  }
  return s;
}

/** Squares the player could build on right now (whole group owned, building evenly, can afford). */
export function buildable(s: BizState, id: string): number[] {
  return BOARD.flatMap((q, i) => {
    if (q.kind !== "city" || s.owner[i] !== id || !ownsGroup(s, id, q.group)) return [];
    const h = s.houses[i] ?? 0;
    const least = Math.min(...groupOf(q.group).map((k) => s.houses[k] ?? 0));
    return h < 5 && h <= least && s.cash[id] >= houseCost(i) ? [i] : [];
  });
}

/** HIVEMIND's move for the current player: pay out of jail when rich, buy unless it leaves too little, build with spare cash. */
export function botAction(s: BizState): BizAction {
  const id = turnId(s);
  const cash = s.cash[id];
  if (s.phase === "roll") return s.jail[id] !== undefined && cash > 4000 ? { type: "payJail" } : { type: "roll" };
  if (s.phase === "buy") {
    const sq = s.pos[id];
    const q = BOARD[sq];
    const completes = q.kind === "city" && groupOf(q.group).every((i) => i === sq || s.owner[i] === id);
    return cash - priceOf(sq) >= (completes ? 300 : 1500) ? { type: "buy" } : { type: "skip" };
  }
  const b = buildable(s, id).sort((a, c) => houseCost(a) - houseCost(c))[0];
  if (b !== undefined && cash - houseCost(b) >= 3000) return { type: "build", sq: b };
  return { type: "end" };
}

/** Where each square sits on the 9×9 ring (START bottom-right, going clockwise along the bottom to the left). */
export function ringCell(i: number): { r: number; c: number } {
  if (i <= 8) return { r: 8, c: 8 - i };
  if (i <= 16) return { r: 8 - (i - 8), c: 0 };
  if (i <= 24) return { r: 0, c: i - 16 };
  return { r: i - 24, c: 8 };
}
