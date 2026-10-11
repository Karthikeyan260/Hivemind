import { describe, expect, it } from "vitest";
import { botMove, callLast, canPlay, draw, makeDeck, newCardGame, pass, play, playable, viewFor, type Card, type CardsState } from "@/lib/games/cards";

let seed = 11;
const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
const two = () => newCardGame([{ id: "host", name: "Karthik" }, { id: "guest", name: "Harini" }], rand);
const c = (id: number, color: Card["color"], kind: Card["kind"], n?: number): Card => ({ id, color, kind, ...(n !== undefined ? { n } : {}) });
/** A hand-made position: host to play, top card red 5. */
const set = (host: Card[], guest: Card[], extra: Partial<CardsState> = {}): CardsState => ({
  ...two(),
  hands: { host, guest },
  discard: [c(900, "red", "num", 5)],
  color: "red",
  turn: 0,
  dir: 1,
  drew: null,
  called: {},
  ...extra,
});
const turnOf = (s: CardsState) => s.seats[s.turn].id;

describe("colour clash cards", () => {
  it("has the standard 108-card deck", () => {
    const d = makeDeck();
    expect(d).toHaveLength(108);
    expect(d.filter((x) => x.kind === "wild4")).toHaveLength(4);
    expect(d.filter((x) => x.color === "red" && x.n === 0)).toHaveLength(1);
    expect(new Set(d.map((x) => x.id)).size).toBe(108);
  });

  it("deals 7 each and starts on a number card", () => {
    const s = two();
    expect(s.hands.host).toHaveLength(7);
    expect(s.counts.guest).toBe(7);
    expect(s.discard[0].kind).toBe("num");
    expect(s.deckCount).toBe(108 - 14 - 1);
  });

  it("matches colour, number or symbol; Wilds always fit", () => {
    const s = set([], []);
    expect(canPlay(s, c(1, "red", "num", 9))).toBe(true);
    expect(canPlay(s, c(2, "blue", "num", 5))).toBe(true);
    expect(canPlay(s, c(3, "blue", "num", 6))).toBe(false);
    expect(canPlay(s, c(4, null, "wild"))).toBe(true);
    expect(canPlay({ ...s, discard: [c(5, "blue", "skip")], color: "blue" }, c(6, "green", "skip"))).toBe(true);
  });

  it("plays a card and passes the turn; refuses an illegal one", () => {
    let s = set([c(1, "red", "num", 9), c(2, "blue", "num", 6), c(3, "green", "num", 1)], [c(10, "red", "num", 1)]);
    expect(play(s, "host", 2, null, rand)).toBe(s);
    s = play(s, "host", 1, null, rand);
    expect(s.discard.at(-1)!.id).toBe(1);
    expect(turnOf(s)).toBe("guest");
  });

  it("+2 makes the next player draw 2 and miss their turn", () => {
    const s = play(set([c(1, "red", "draw2"), c(2, "red", "num", 1), c(3, "red", "num", 2)], [c(10, "blue", "num", 1)], { deck: makeDeck().slice(0, 10) }), "host", 1, null, rand);
    expect(s.hands.guest).toHaveLength(3);
    expect(turnOf(s)).toBe("host");
  });

  it("with two players Reverse and Skip give another turn", () => {
    const base = [c(2, "red", "num", 1), c(3, "red", "num", 2)];
    expect(turnOf(play(set([c(1, "red", "reverse"), ...base], [c(10, "blue", "num", 1)]), "host", 1, null, rand))).toBe("host");
    expect(turnOf(play(set([c(1, "red", "skip"), ...base], [c(10, "blue", "num", 1)]), "host", 1, null, rand))).toBe("host");
  });

  it("a Wild needs a colour, and Wild +4 makes the next player draw 4", () => {
    const s0 = set([c(1, null, "wild4"), c(2, "red", "num", 1), c(3, "red", "num", 2)], [c(10, "blue", "num", 1)], { deck: makeDeck().slice(0, 10) });
    expect(play(s0, "host", 1, null, rand)).toBe(s0);
    const s = play(s0, "host", 1, "green", rand);
    expect(s.color).toBe("green");
    expect(s.hands.guest).toHaveLength(5);
  });

  it("draw: a fitting card may be played or kept; a card that doesn't fit ends the turn", () => {
    let s = set([c(1, "blue", "num", 6), c(2, "blue", "num", 7)], [c(10, "blue", "num", 1)], { deck: [c(50, "red", "num", 3)] });
    s = draw(s, "host", rand);
    expect(s.drew).toBe(50);
    expect(playable(s).map((x) => x.id)).toEqual([50]);
    expect(turnOf(pass(s, "host"))).toBe("guest");
    let t = set([c(1, "blue", "num", 6), c(2, "blue", "num", 7)], [c(10, "blue", "num", 1)], { deck: [c(51, "green", "num", 3)] });
    t = draw(t, "host", rand);
    expect(turnOf(t)).toBe("guest");
    expect(t.hands.host).toHaveLength(3);
  });

  it('forgetting "Last card!" costs 2 cards; calling it doesn\'t', () => {
    const deck = makeDeck().slice(0, 10);
    const forgot = play(set([c(1, "red", "num", 9), c(2, "blue", "num", 1)], [c(10, "blue", "num", 2)], { deck }), "host", 1, null, rand);
    expect(forgot.hands.host).toHaveLength(3);
    expect(forgot.log.at(-1)).toMatch(/forgot/);
    let ok = callLast(set([c(1, "red", "num", 9), c(2, "blue", "num", 1)], [c(10, "blue", "num", 2)], { deck }), "host");
    ok = play(ok, "host", 1, null, rand);
    expect(ok.hands.host).toHaveLength(1);
  });

  it("wins on the last card", () => {
    const s = play(set([c(1, "red", "num", 9)], [c(10, "blue", "num", 2)], { called: { host: true } }), "host", 1, null, rand);
    expect(s.winner).toBe("host");
    expect(draw(s, "guest", rand)).toBe(s);
  });

  it("a friend sees only their own cards and how many others hold", () => {
    const v = viewFor(two(), "guest");
    expect(v.hands.guest).toHaveLength(7);
    expect(v.hands.host).toEqual([]);
    expect(v.counts.host).toBe(7);
    expect(v.deck).toEqual([]);
  });

  it("games between bots always end with a winner", () => {
    for (let g = 0; g < 20; g++) {
      let s = newCardGame([{ id: "a", name: "A", bot: true }, { id: "b", name: "B", bot: true }, { id: "c", name: "C", bot: true }], rand);
      for (let i = 0; i < 3000 && !s.winner; i++) {
        const who = s.seats[s.turn].id;
        const m = botMove(s);
        if (m.type === "draw") s = draw(s, who, rand);
        else if (m.type === "pass") s = pass(s, who);
        else {
          if (m.call) s = callLast(s, who);
          s = play(s, who, m.card, m.color, rand);
        }
      }
      expect(s.winner, `game ${g}`).not.toBeNull();
      const total = Object.values(s.hands).reduce((n, h) => n + h.length, 0) + s.deck.length + s.discard.length;
      expect(total, `game ${g}: cards conserved`).toBe(108);
    }
  });
});
