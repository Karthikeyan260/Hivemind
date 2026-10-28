import { describe, expect, it } from "vitest";
import { botMove, callLast, draw, newCardGame, pass, play, playable, type CardsState } from "@/lib/games/cards";
import { drop, newConnect4, openColumns, type C4State } from "@/lib/games/connect4";
import { drawLine, lineCount, newDots, scores, type DotsState } from "@/lib/games/dots";
import { HOME, move, movable, newGame, roll, SAFE, square, type LudoState } from "@/lib/games/ludo";
import { newSnakes, rollSnakes, type SnakesState } from "@/lib/games/snakes";

/** A small seeded random number generator, so a failing game can be replayed. */
const seeded = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = <T,>(r: () => number, a: T[]) => a[Math.floor(r() * a.length)];
const P = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}` }));

describe("random full games", { timeout: 60_000 }, () => {
  it("Colour Clash: always finishes, never loses or duplicates a card", () => {
    for (let seed = 1; seed <= 150; seed++) {
      const r = seeded(seed);
      const n = 2 + (seed % 5);
      let s: CardsState = newCardGame(P(n), r);
      let steps = 0;
      while (!s.winner && steps++ < 4000) {
        const seat = s.seats[s.turn].id;
        const ok = playable(s);
        const before = s.seq;
        if (ok.length && r() < 0.9) {
          const c = pick(r, ok);
          if (s.hands[seat].length === 2) s = callLast(s, seat);
          s = play(s, seat, c.id, c.color ? null : pick(r, ["red", "yellow", "green", "blue"] as const), r);
        } else if (s.drew != null) s = pass(s, seat);
        else s = draw(s, seat, r);
        const ids = [...s.deck, ...s.discard, ...Object.values(s.hands).flat()].map((c) => c.id);
        if (ids.length !== 108 || new Set(ids).size !== 108) throw new Error(`seed ${seed} step ${steps}: ${ids.length} cards, ${new Set(ids).size} distinct`);
        if (s.seq === before && steps > 3900) throw new Error(`seed ${seed}: stuck`);
      }
      expect(s.winner, `seed ${seed} (${n} players) never finished`).not.toBeNull();
      expect(s.hands[s.winner!].length).toBe(0);
    }
  });

  it("Colour Clash bots finish games against each other", () => {
    for (let seed = 1; seed <= 60; seed++) {
      const r = seeded(1000 + seed);
      let s: CardsState = newCardGame(P(2 + (seed % 3)).map((p) => ({ ...p, bot: true })), r);
      let steps = 0;
      while (!s.winner && steps++ < 4000) {
        const seat = s.seats[s.turn].id;
        const m = botMove(s);
        if (m.type === "play") {
          if (m.call) s = callLast(s, seat);
          s = play(s, seat, m.card, m.color, r);
        } else if (m.type === "draw") s = draw(s, seat, r);
        else s = pass(s, seat);
      }
      expect(s.winner, `bot game ${seed} never finished`).not.toBeNull();
    }
  });

  it("Ludo: always finishes, tokens stay on the board, captures always happen", () => {
    for (let seed = 1; seed <= 120; seed++) {
      const r = seeded(2000 + seed);
      let s: LudoState = newGame(P(2 + (seed % 3)), seed % 2 ? 4 : 2);
      let steps = 0;
      while (!s.over && steps++ < 30000) {
        const seat = s.seats[s.turn].id;
        if (!s.rolled) s = roll(s, seat, 1 + Math.floor(r() * 6));
        const m = movable(s);
        if (s.rolled && m.length) s = move(s, seat, pick(r, m));
        for (const [id, toks] of Object.entries(s.tokens)) for (const p of toks) if (p < -1 || p > HOME) throw new Error(`seed ${seed}: ${id} token at ${p}`);
        // two opposing tokens never share an unsafe square
        const at = new Map<number, string>();
        for (const seatInfo of s.seats) for (const p of s.tokens[seatInfo.id]) {
          const sq = square(seatInfo.color, p);
          if (sq === null || SAFE.has(sq)) continue;
          if (at.has(sq) && at.get(sq) !== seatInfo.id) throw new Error(`seed ${seed} step ${steps}: ${at.get(sq)} and ${seatInfo.id} share square ${sq}`);
          at.set(sq, seatInfo.id);
        }
      }
      expect(s.over, `ludo game ${seed} never finished`).toBe(true);
      expect(new Set(s.finished).size).toBe(s.finished.length);
    }
  });

  it("Dots & Boxes: every line is drawn once and every box ends up closed", () => {
    for (let seed = 1; seed <= 80; seed++) {
      const r = seeded(3000 + seed);
      const size = ([3, 4, 5, 6] as const)[seed % 4];
      let s: DotsState = newDots(P(2 + (seed % 3)), size);
      const total = lineCount(s);
      let steps = 0;
      while (!s.over && steps++ < total + 5) {
        const free = Array.from({ length: total }, (_, i) => i).filter((i) => s.lines[i] < 0);
        s = drawLine(s, s.seats[s.turn].id, pick(r, free));
      }
      expect(s.over, `dots game ${seed} never finished`).toBe(true);
      expect(s.lines.every((l) => l >= 0)).toBe(true);
      expect(s.boxes.every((b) => b >= 0)).toBe(true);
      // every box was closed by someone, and the scores add up to all the boxes
      expect(scores(s).reduce((a, b) => a + b, 0)).toBe(s.rows * s.cols);
    }
  });

  it("Connect Four: ends in a win or a full board, and the winning line is really four", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const r = seeded(4000 + seed);
      let s: C4State = newConnect4([{ id: "a", name: "A" }, { id: "b", name: "B" }]);
      let steps = 0;
      while (!s.over && steps++ < 60) s = drop(s, s.seats[s.turn].id, pick(r, openColumns(s.board)));
      expect(s.over, `c4 game ${seed} never finished`).toBe(true);
      if (s.winner >= 0) {
        expect(s.line.length).toBeGreaterThanOrEqual(4);
        for (const i of s.line) expect(s.board[i]).toBe(s.winner);
      } else expect(s.board.every((c) => c >= 0)).toBe(true);
    }
  });

  it("Snakes & Ladders: always has a winner, positions stay between 0 and 100", () => {
    for (let seed = 1; seed <= 150; seed++) {
      const r = seeded(5000 + seed);
      let s: SnakesState = newSnakes(P(2 + (seed % 5)));
      let steps = 0;
      while (!s.over && steps++ < 5000) {
        s = rollSnakes(s, s.seats[s.turn].id, 1 + Math.floor(r() * 6));
        for (const p of Object.values(s.pos)) if (p < 0 || p > 100) throw new Error(`seed ${seed}: position ${p}`);
      }
      expect(s.over, `snakes game ${seed} never finished`).toBe(true);
      expect(s.pos[s.winner!]).toBe(100);
    }
  });
});

import { BOARD, bizAct, botAction, netWorth, newBusiness, type BizState } from "@/lib/games/business";

describe("random full Business games", { timeout: 60_000 }, () => {
  it("bot games with a round limit always finish, and every game keeps sound money and ownership", () => {
    for (let seed = 1; seed <= 80; seed++) {
      const r = seeded(6000 + seed);
      const n = 2 + (seed % 5);
      // With no round limit a game of rich bots can go on for ever (nobody goes broke): those only have to stay consistent.
      const unlimited = seed % 3 === 0;
      let s: BizState = newBusiness(P(n).map((p) => ({ ...p, bot: true })), unlimited ? 0 : 25);
      let steps = 0;
      while (!s.over && steps++ < (unlimited ? 4000 : 20000)) {
        const id = s.seats[s.turn].id;
        const luck = { d1: 1 + Math.floor(r() * 6), d2: 1 + Math.floor(r() * 6), pick: Math.floor(r() * 16) };
        const before = JSON.stringify([s.cash, s.pos, s.turn, s.phase, s.owner]);
        s = bizAct(s, id, botAction(s), luck);
        for (const seat of s.seats) {
          const c = s.cash[seat.id];
          if (!Number.isFinite(c)) throw new Error(`seed ${seed} step ${steps}: ${seat.id} cash is ${c}`);
          if (!Number.isFinite(netWorth(s, seat.id))) throw new Error(`seed ${seed}: net worth NaN`);
          const p = s.pos[seat.id];
          if (!Number.isInteger(p) || p < 0 || p >= BOARD.length) throw new Error(`seed ${seed}: ${seat.id} on square ${p}`);
        }
        for (const [sq, owner] of Object.entries(s.owner)) {
          if (!s.seats.some((x) => x.id === owner)) throw new Error(`seed ${seed}: square ${sq} owned by ${owner}`);
          if (s.out.includes(owner)) throw new Error(`seed ${seed} step ${steps}: square ${sq} still owned by ${owner}, who is out`);
        }
        for (const [sq, h] of Object.entries(s.houses)) if (h < 0 || h > 5) throw new Error(`seed ${seed}: ${h} houses on ${sq}`);
        if (!unlimited && steps > 19990) throw new Error(`seed ${seed}: stuck at ${before}`);
      }
      if (!unlimited) {
        expect(s.over, `business game ${seed} (${n} players) never finished`).toBe(true);
        expect(s.winner).not.toBeNull();
      }
    }
  });
});

import { bingoAct, bestCall, callable, newBingo, randomCard, type BingoState } from "@/lib/games/bingo";

describe("random full Bingo games", { timeout: 60_000 }, () => {
  it("always ends within 25 calls, with winners who really have five lines", () => {
    for (let seed = 1; seed <= 150; seed++) {
      const r = seeded(7000 + seed);
      const n = 1 + (seed % 6);
      let s: BingoState = newBingo(P(n), r);
      for (const x of s.seats) s = bingoAct(s, x.id, { type: "ready", card: randomCard(r) });
      expect(s.phase, `seed ${seed}`).toBe("play");
      let calls = 0;
      while (s.phase === "play" && calls++ < 30) {
        const id = s.seats[s.turn].id;
        const can = callable(s, id);
        expect(can.length, `seed ${seed}: ${id} has nothing to call`).toBeGreaterThan(0);
        const best = seed % 2 ? bestCall(s, id) : null;
        s = bingoAct(s, id, { type: "call", n: best ?? pick(r, can) });
      }
      expect(s.phase, `bingo game ${seed} never ended`).toBe("over");
      expect(s.called.length).toBeLessThanOrEqual(25);
      expect(new Set(s.called).size).toBe(s.called.length);
      expect(s.winners.length).toBeGreaterThan(0);
      for (const w of s.winners) expect(s.lines[w]).toBeGreaterThanOrEqual(5);
    }
  });
});
