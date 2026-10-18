import { describe, expect, it } from "vitest";
import { beginPlay, bestCall, bingoAct, callable, doneLines, LINES, newBingo, NEED, randomCard, validCard, viewFor, type BingoState } from "@/lib/games/bingo";

const seeded = (seed = 7) => () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const ident = Array.from({ length: 25 }, (_, i) => i + 1);
/** Two humans, both ready, in play (host's card is 1..25 in order, Pal's is the reverse). */
const game = (): BingoState => {
  let s = newBingo([{ id: "host", name: "Karthik" }, { id: "pal", name: "Pal" }], seeded());
  s = bingoAct(s, "host", { type: "ready", card: ident });
  s = bingoAct(s, "pal", { type: "ready", card: [...ident].reverse() });
  return s;
};
const call = (s: BingoState, id: string, n: number) => bingoAct(s, id, { type: "call", n });

describe("Bingo: the card", () => {
  it("a card is 1–25, each once, in any order", () => {
    expect(validCard(ident)).toBe(true);
    expect(validCard(randomCard(seeded(3)))).toBe(true);
    expect(validCard(ident.slice(1))).toBe(false);
    expect(validCard([...ident.slice(1), 1])).toBe(true);
    expect(validCard([...ident.slice(1), 24])).toBe(false);
    expect(validCard([...ident.slice(1), 26])).toBe(false);
    expect(validCard("nope")).toBe(false);
  });
  it("12 lines: 5 rows, 5 columns, 2 diagonals", () => {
    expect(LINES).toHaveLength(12);
    expect(doneLines(ident, new Set([1, 2, 3, 4, 5]))).toEqual([0]);
    expect(doneLines(ident, new Set([1, 7, 13, 19, 25]))).toEqual([10]); // a diagonal
    expect(doneLines(ident, new Set([1, 6, 11, 16, 21]))).toEqual([5]); // a column
    expect(doneLines(ident, new Set(ident))).toHaveLength(12);
  });
});

describe("Bingo: setting up", () => {
  it("waits until everyone has filled in their card; nobody sees another's", () => {
    let s = newBingo([{ id: "host", name: "Karthik" }, { id: "pal", name: "Pal" }, { id: "bot1", name: "HIVEMIND", bot: true }], seeded());
    expect(s.phase).toBe("setup");
    expect(s.ready.bot1).toBe(true);
    expect(bingoAct(s, "host", { type: "ready", card: [1, 2, 3] })).toBe(s); // not a card
    s = bingoAct(s, "host", { type: "ready", card: ident });
    expect(s.phase).toBe("setup");
    expect(bingoAct(s, "host", { type: "ready", card: [...ident].reverse() })).toBe(s); // can't change it
    expect(Object.keys(viewFor(s, "pal").cards)).toEqual([]);
    expect(Object.keys(viewFor(s, "host").cards)).toEqual(["host"]);
    s = bingoAct(s, "pal", { type: "ready", card: randomCard(seeded(5)) });
    expect(s.phase).toBe("play");
  });
  it("the host can start early: whoever isn't ready gets a random card", () => {
    let s = newBingo([{ id: "host", name: "Karthik" }, { id: "pal", name: "Pal" }], seeded());
    s = bingoAct(s, "host", { type: "ready", card: ident });
    s = beginPlay(s, seeded(9));
    expect(s.phase).toBe("play");
    expect(validCard(s.cards.pal)).toBe(true);
  });
  it("only bots: straight into play", () => {
    expect(newBingo([{ id: "a", name: "A", bot: true }, { id: "b", name: "B", bot: true }], seeded()).phase).toBe("play");
  });
});

describe("Bingo: playing", () => {
  it("only the player whose turn it is calls, once per number, then it passes on", () => {
    let s = game();
    expect(call(s, "pal", 3)).toBe(s);
    expect(call(s, "host", 0)).toBe(s);
    expect(call(s, "host", 26)).toBe(s);
    s = call(s, "host", 3);
    expect(s.called).toEqual([3]);
    expect(s.by[3]).toBe("host");
    expect(s.seats[s.turn].id).toBe("pal");
    expect(call(s, "pal", 3)).toBe(s); // already called
    expect(call(s, "host", 4)).toBe(s); // not their turn
  });
  it("every complete line earns a letter for each card that has it", () => {
    let s = game();
    // Host's first row is 1–5; Pal's card is reversed, so 1–5 are Pal's last row.
    for (const n of [1, 2, 3, 4, 5]) s = call(s, s.seats[s.turn].id, n);
    expect(s.lines.host).toBe(1);
    expect(s.lines.pal).toBe(1);
    expect(s.log.some((l) => /completes a line: B!/.test(l))).toBe(true);
  });
  it("spelling BINGO (5 lines) wins; the game stops and every card is shown", () => {
    let s = game();
    for (let n = 1; n <= 25 && s.phase === "play"; n++) s = call(s, s.seats[s.turn].id, n);
    expect(s.phase).toBe("over");
    expect(s.winners.length).toBeGreaterThan(0);
    for (const w of s.winners) expect(s.lines[w]).toBeGreaterThanOrEqual(NEED);
    expect(call(s, s.seats[s.turn].id, 25)).toBe(s);
    expect(Object.keys(viewFor(s, "pal").cards).sort()).toEqual(["host", "pal"]);
  });
  it("a tie when two spell it on the same call", () => {
    let s = game();
    for (let n = 1; n <= 25 && s.phase === "play"; n++) s = call(s, s.seats[s.turn].id, n);
    // 1..25 against its reverse: both cards complete their lines together.
    expect([...s.winners].sort()).toEqual(["host", "pal"]);
  });
  it("the bot calls what helps most, and a bot-only game finishes", () => {
    let s = newBingo([{ id: "a", name: "A", bot: true }, { id: "b", name: "B", bot: true }, { id: "c", name: "C", bot: true }], seeded(11));
    expect(callable(s, "a")).toHaveLength(25);
    for (let i = 0; i < 40 && s.phase === "play"; i++) {
      const id = s.seats[s.turn].id;
      const next = call(s, id, bestCall(s, id)!);
      expect(next).not.toBe(s);
      s = next;
    }
    expect(s.phase).toBe("over");
    expect(s.winners.length).toBeGreaterThan(0);
    for (const w of s.winners) expect(s.lines[w]).toBeGreaterThanOrEqual(NEED);
  });
});
