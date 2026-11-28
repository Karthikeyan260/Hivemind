/**
 * Boost (also called 3 Roses or Allimalli): the Tamil pass-the-card game.
 *
 * The host picks a theme (heroes, movies, foods…) and every player writes one name in it. Each name
 * goes on 3 cards; all the cards are shuffled and everyone gets 3. Then the cards go round the table:
 * the player on turn passes one card to the next player, who passes one on, and so on. Whoever holds
 * three of the same name taps BOOST first and gets 1000 points; everyone else races to tap BOOST too:
 * 900, 800, … in the order they react. A game is 10 to 20 deals; the highest total wins.
 *
 * Pure: shuffles come from the caller (the host's browser), so tests are repeatable. The host's browser
 * runs these rules and sends each player only their own hand until a deal is over.
 */
export type BoostColor = "red" | "blue" | "green" | "yellow" | "purple" | "orange";
export const BOOST_COLORS: BoostColor[] = ["red", "blue", "green", "yellow", "purple", "orange"];
export const MIN_PLAYERS = 3;
export const MAX_PLAYERS = 6;
export const ROUND_CHOICES = [10, 15, 20] as const;
/** Points by reaction order: the caller 1000, then 900, 800, … (never below 100). */
export const pointsFor = (place: number) => Math.max(100, 1000 - 100 * place);
export const NAME_MAX = 20;

export const THEMES = {
  heroes: { label: "Heroes", names: ["Rajini", "Kamal", "Vijay", "Ajith", "Suriya", "Dhanush", "Vikram", "Karthi", "Simbu", "Sivakarthikeyan", "Vijay Sethupathi", "Jayam Ravi"] },
  heroines: { label: "Heroines", names: ["Nayanthara", "Trisha", "Samantha", "Jyothika", "Simran", "Keerthy", "Shruti", "Anushka", "Tamannaah", "Sai Pallavi", "Priyanka", "Kajal"] },
  movies: { label: "Movies", names: ["Baasha", "Ghilli", "Mankatha", "Vikram", "Jailer", "Leo", "Master", "Kaithi", "Asuran", "Anniyan", "Sivaji", "Vada Chennai"] },
  foods: { label: "Foods", names: ["Biryani", "Dosa", "Idli", "Parotta", "Pongal", "Vada", "Kothu", "Payasam", "Sambar", "Rasam", "Murukku", "Halwa"] },
  places: { label: "Places", names: ["Chennai", "Madurai", "Ooty", "Kodai", "Trichy", "Coimbatore", "Salem", "Pondy", "Rameswaram", "Kanyakumari", "Thanjavur", "Vellore"] },
  cricketers: { label: "Cricketers", names: ["Dhoni", "Sachin", "Kohli", "Rohit", "Ashwin", "Jadeja", "Bumrah", "Dravid", "Ganguly", "Yuvraj", "Gill", "Pant"] },
  music: { label: "Music directors", names: ["Ilaiyaraaja", "Rahman", "Anirudh", "Harris", "Yuvan", "GV Prakash", "Imman", "Deva", "Vidyasagar", "Santhosh", "Thaman", "Hiphop Tamizha"] },
} as const;
export type ThemeId = keyof typeof THEMES;
export const THEME_IDS = Object.keys(THEMES) as ThemeId[];

export type BoostSeat = { id: string; name: string; color: BoostColor; bot: boolean };
/** names: everyone writes their name · pass: cards go round · react: someone called, the rest race · scored: a deal's points · over: the game. */
export type BoostPhase = "names" | "pass" | "react" | "scored" | "over";
export type BoostState = {
  seats: BoostSeat[];
  phase: BoostPhase;
  theme: ThemeId;
  rounds: number;
  /** The deal being played (1-based). */
  round: number;
  /** Seat → the name they wrote. */
  names: Record<string, string>;
  /** Seat → the cards they hold. Only their own in a player's copy until the deal is scored. */
  hands: Record<string, string[]>;
  /** Seat → how many cards they hold (everyone sees this). */
  counts: Record<string, number>;
  /** The seat whose turn it is to pass a card. */
  turn: number;
  /** Passes made in this deal. */
  passes: number;
  /** BOOST taps this deal, in order (the first is the caller, who held three of a kind). */
  reacted: string[];
  /** Points this deal (once scored), and in total. */
  gained: Record<string, number>;
  scores: Record<string, number>;
  winners: string[];
  log: string[];
  seq: number;
};
export type BoostAction = { type: "name"; name: string } | { type: "pass"; card: number } | { type: "boost" };

export function shuffle<T>(list: T[], rand: () => number): T[] {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** A name as written: trimmed, single spaces, not too long. */
export const cleanName = (v: unknown) =>
  String(v ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, NAME_MAX);
const key = (n: string) => n.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

/** Three (or more) of one name in this hand? Returns that name. */
export function triple(hand: string[] | undefined): string | null {
  if (!hand) return null;
  const n = new Map<string, number>();
  for (const c of hand) n.set(c, (n.get(c) ?? 0) + 1);
  for (const [c, k] of n) if (k >= 3) return c;
  return null;
}

const note = (s: BoostState, line: string): BoostState => ({ ...s, log: [...s.log.slice(-19), line] });
const nameOf = (s: BoostState, id: string) => s.seats.find((x) => x.id === id)?.name ?? "?";

export function newBoost(players: { id: string; name: string; bot?: boolean }[], opts: { theme?: ThemeId; rounds?: number } = {}, rand: () => number = Math.random): BoostState {
  const seats = players.slice(0, MAX_PLAYERS).map((p, i) => ({ id: p.id, name: p.name, color: BOOST_COLORS[i], bot: !!p.bot }));
  const theme: ThemeId = opts.theme && opts.theme in THEMES ? opts.theme : "heroes";
  const rounds = ROUND_CHOICES.includes(opts.rounds as 10) ? (opts.rounds as number) : 10;
  const s: BoostState = {
    seats,
    phase: "names",
    theme,
    rounds,
    round: 0,
    names: {},
    hands: {},
    counts: Object.fromEntries(seats.map((x) => [x.id, 0])),
    turn: 0,
    passes: 0,
    reacted: [],
    gained: {},
    scores: Object.fromEntries(seats.map((x) => [x.id, 0])),
    winners: [],
    log: [`Theme: ${THEMES[theme].label}. Everyone, write one name!`],
    seq: 0,
  };
  // HIVEMIND's bots write theirs last, once the people have (so a bot never takes a name a person wanted).
  // A table of only bots deals at once.
  return seats.every((x) => x.bot) ? beginDeal(s, rand) : s;
}

/** Have all the people at the table written a name? (Bots write theirs after.) */
export const peopleDone = (s: BoostState) => s.seats.every((x) => x.bot || s.names[x.id]);

/** A name from the theme that nobody has written yet. */
export function botName(s: BoostState, rand: () => number = Math.random): string {
  const taken = new Set(Object.values(s.names).map(key));
  const free = THEMES[s.theme].names.filter((n) => !taken.has(key(n)));
  return free.length ? free[Math.floor(rand() * free.length)] : `${THEMES[s.theme].label} ${Object.keys(s.names).length + 1}`;
}

/** Shuffle everyone's 3 cards and deal 3 each; the next player round the table starts passing. */
export function deal(s: BoostState, rand: () => number = Math.random): BoostState {
  const round = s.round + 1;
  const deck = shuffle(
    s.seats.flatMap((x) => [s.names[x.id], s.names[x.id], s.names[x.id]]),
    rand,
  );
  const hands = Object.fromEntries(s.seats.map((x, i) => [x.id, deck.slice(i * 3, i * 3 + 3)]));
  const turn = (round - 1) % s.seats.length;
  return note(
    { ...s, phase: "pass", round, hands, counts: Object.fromEntries(s.seats.map((x) => [x.id, 3])), turn, passes: 0, reacted: [], gained: {}, seq: s.seq + 1 },
    `Deal ${round} of ${s.rounds}. ${s.seats[turn].name} passes first.`,
  );
}

/** The host: start now. Anyone who hasn't written a name gets one from the theme. */
export function beginDeal(s: BoostState, rand: () => number = Math.random): BoostState {
  if (s.phase !== "names") return s;
  let n = s;
  for (const x of s.seats) if (!n.names[x.id]) n = { ...n, names: { ...n.names, [x.id]: botName(n, rand) } };
  return deal(n, rand);
}

/** One player's request: write their name, pass a card on their turn, or tap BOOST. */
export function boostAct(s: BoostState, id: string, a: BoostAction): BoostState {
  if (!s.seats.some((x) => x.id === id) || !a || typeof a !== "object") return s;
  const seq = s.seq + 1;
  if (a.type === "name") {
    const name = cleanName(a.name);
    if (s.phase !== "names" || s.names[id] || !name) return s;
    // Each name must be different: two players writing the same would put six of one card in the deck.
    if (Object.values(s.names).some((n) => key(n) === key(name))) return s;
    const n: BoostState = { ...s, names: { ...s.names, [id]: name }, seq };
    // The last person to write: the bots write theirs and the cards are dealt.
    return peopleDone(n) ? beginDeal(n) : note(n, `${nameOf(s, id)} has written a name.`);
  }
  if (a.type === "pass") {
    if (s.phase !== "pass" || s.seats[s.turn]?.id !== id) return s;
    const hand = s.hands[id] ?? [];
    const i = Number(a.card);
    if (!Number.isInteger(i) || i < 0 || i >= hand.length) return s;
    const nextSeat = s.seats[(s.turn + 1) % s.seats.length];
    const card = hand[i];
    const mine = hand.filter((_, k) => k !== i);
    const theirs = [...(s.hands[nextSeat.id] ?? []), card];
    return {
      ...s,
      hands: { ...s.hands, [id]: mine, [nextSeat.id]: theirs },
      counts: { ...s.counts, [id]: mine.length, [nextSeat.id]: theirs.length },
      turn: (s.turn + 1) % s.seats.length,
      passes: s.passes + 1,
      seq,
    };
  }
  if (a.type === "boost") {
    if (s.phase === "pass") {
      // Only someone who really holds three of a kind can call it.
      if (!triple(s.hands[id])) return s;
      return note({ ...s, phase: "react", reacted: [id], seq }, `${nameOf(s, id)} calls BOOST! (three ${triple(s.hands[id])}s) Quick, everyone tap!`);
    }
    if (s.phase === "react") {
      if (s.reacted.includes(id)) return s;
      const reacted = [...s.reacted, id];
      const n = { ...s, reacted, seq };
      return reacted.length === s.seats.length ? score(n) : n;
    }
  }
  return s;
}

/** End the reaction race (everyone tapped, or time's up): points by order; anyone who didn't tap gets nothing. */
export function score(s: BoostState): BoostState {
  if (s.phase !== "react") return s;
  const gained = Object.fromEntries(s.seats.map((x) => [x.id, s.reacted.includes(x.id) ? pointsFor(s.reacted.indexOf(x.id)) : 0]));
  const scores = Object.fromEntries(s.seats.map((x) => [x.id, (s.scores[x.id] ?? 0) + gained[x.id]]));
  const order = s.reacted.map((id, i) => `${nameOf(s, id)} +${pointsFor(i)}`).join(", ");
  let n = note({ ...s, phase: "scored", gained, scores, seq: s.seq + 1 }, `Deal ${s.round}: ${order}.`);
  if (s.round >= s.rounds) {
    const top = Math.max(...s.seats.map((x) => scores[x.id]));
    const winners = s.seats.filter((x) => scores[x.id] === top).map((x) => x.id);
    n = note({ ...n, phase: "over", winners }, `${winners.map((w) => nameOf(s, w)).join(" and ")} ${winners.length > 1 ? "share the win" : "wins"} with ${top} points! 🌹`);
  }
  return n;
}

/** The host: the next deal after a scored one. */
export function nextDeal(s: BoostState, rand: () => number = Math.random): BoostState {
  return s.phase === "scored" ? deal(s, rand) : s;
}

/** HIVEMIND's pass: give away a card of the name it holds fewest of (keep building towards three). */
export function botPass(s: BoostState, id: string): number {
  const hand = s.hands[id] ?? [];
  const count = (c: string) => hand.filter((x) => x === c).length;
  let best = 0;
  for (let i = 1; i < hand.length; i++) if (count(hand[i]) < count(hand[best])) best = i;
  return best;
}

/** What one player may see: their own hand (everyone's once a deal is scored); never anyone else's before that. */
export function viewFor(s: BoostState, id: string): BoostState {
  if (s.phase === "scored" || s.phase === "over") return s;
  return { ...s, hands: Object.fromEntries(Object.entries(s.hands).filter(([k]) => k === id)) };
}
