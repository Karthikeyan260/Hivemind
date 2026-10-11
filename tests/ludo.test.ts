import { describe, expect, it } from "vitest";
import { botChoice, HOME, move, movable, newGame, roll, SAFE, square, type LudoState } from "@/lib/games/ludo";

const two = () => newGame([{ id: "host", name: "Karthik" }, { id: "guest", name: "Harini" }], 4);
const at = (s: LudoState, id: string, positions: number[]): LudoState => ({ ...s, tokens: { ...s.tokens, [id]: positions } });
const turnOf = (s: LudoState) => s.seats[s.turn].id;

describe("ludo rules", () => {
  it("seats two players opposite each other", () => {
    expect(two().seats.map((s) => s.color)).toEqual(["red", "yellow"]);
    expect(newGame([{ id: "a", name: "A" }, { id: "b", name: "B" }, { id: "c", name: "C" }, { id: "d", name: "D" }]).seats.map((s) => s.color)).toEqual(["red", "green", "yellow", "blue"]);
  });

  it("needs a 6 to bring a token out, and only the current player can roll", () => {
    let s = two();
    expect(roll(s, "guest", 6)).toBe(s);
    s = roll(s, "host", 4);
    expect(movable(s)).toEqual([]);
    expect(turnOf(s)).toBe("guest"); // no move: turn passes
    s = roll(s, "guest", 6);
    expect(movable(s)).toEqual([0, 1, 2, 3]);
    s = move(s, "guest", 2);
    expect(s.tokens.guest[2]).toBe(0);
    expect(turnOf(s)).toBe("guest"); // a 6 rolls again
    expect(s.rolled).toBe(false);
  });

  it("loses the turn on three 6s in a row", () => {
    let s = at(two(), "host", [5, -1, -1, -1]);
    s = move(roll(s, "host", 6), "host", 0);
    s = move(roll(s, "host", 6), "host", 0);
    s = roll(s, "host", 6);
    expect(turnOf(s)).toBe("guest");
    expect(s.tokens.host[0]).toBe(17);
  });

  it("captures on a normal square, sending the token home with another roll", () => {
    // Red's progress 10 is square 10; yellow starts at 26, so yellow progress 36 is square 10 too.
    let s = at(at(two(), "host", [7, -1, -1, -1]), "guest", [36, -1, -1, -1]);
    expect(square("red", 10)).toBe(square("yellow", 36));
    s = move(roll(s, "host", 3), "host", 0);
    expect(s.tokens.guest[0]).toBe(-1);
    expect(s.last?.captured).toEqual([{ seat: "guest", token: 0 }]);
    expect(turnOf(s)).toBe("host");
    expect(s.log.at(-1)).toMatch(/captured Harini/);
  });

  it("never captures on a safe square", () => {
    // Square 8 is a star.
    expect(SAFE.has(8)).toBe(true);
    let s = at(at(two(), "host", [5, -1, -1, -1]), "guest", [34, -1, -1, -1]);
    s = move(roll(s, "host", 3), "host", 0);
    expect(s.tokens.guest[0]).toBe(34);
    expect(turnOf(s)).toBe("guest");
  });

  it("needs the exact number to get home, which gives another roll", () => {
    let s = at(two(), "host", [54, -1, -1, -1]);
    s = roll(s, "host", 3);
    expect(movable(s)).toEqual([]);
    s = { ...s, turn: 0, dice: null, rolled: false };
    s = move(roll(s, "host", 2), "host", 0);
    expect(s.tokens.host[0]).toBe(HOME);
    expect(turnOf(s)).toBe("host");
  });

  it("ends when a player brings every token home", () => {
    let s = at(two(), "host", [HOME, HOME, HOME, 55]);
    s = move(roll(s, "host", 1), "host", 3);
    expect(s.over).toBe(true);
    expect(s.finished).toEqual(["host", "guest"]);
    expect(s.log.join(" ")).toMatch(/Karthik wins/);
    expect(roll(s, "guest", 6)).toBe(s);
  });

  it("with four players the others keep playing for 2nd place", () => {
    let s = newGame([{ id: "a", name: "A" }, { id: "b", name: "B", bot: true }, { id: "c", name: "C" }, { id: "d", name: "D", bot: true }], 2);
    s = at(s, "a", [HOME, 55]);
    s = move(roll(s, "a", 1), "a", 1);
    expect(s.over).toBe(false);
    expect(s.finished).toEqual(["a"]);
    expect(turnOf(s)).toBe("b");
  });

  it("the bot captures when it can, else brings a token out", () => {
    let s = at(at(two(), "host", [7, -1, -1, -1]), "guest", [36, -1, -1, -1]);
    s = roll(s, "host", 3);
    expect(botChoice(s)).toBe(0);
    let t = at(at(two(), "host", [20, -1, -1, -1]), "guest", [-1, -1, -1, -1]);
    t = roll(t, "host", 6);
    expect(botChoice(t)).toBe(1); // bring a new token out
  });

  it("a whole game between two bots always finishes", () => {
    let seed = 7;
    const dice = () => ((seed = (seed * 16807) % 2147483647) % 6) + 1;
    let s = newGame([{ id: "a", name: "A", bot: true }, { id: "b", name: "B", bot: true }], 4);
    for (let i = 0; i < 5000 && !s.over; i++) {
      const who = turnOf(s);
      if (!s.rolled) s = roll(s, who, dice());
      else s = move(s, who, botChoice(s)!);
    }
    expect(s.over).toBe(true);
    expect(s.finished).toHaveLength(2);
  });
});

describe("ludo board", async () => {
  const { TRACK_CELLS, HOME_CELLS, cellOf } = await import("@/lib/games/ludo-board");
  it("has 52 distinct track squares, each next to the one before", () => {
    expect(TRACK_CELLS).toHaveLength(52);
    expect(new Set(TRACK_CELLS.map((c) => c.join())).size).toBe(52);
    for (let i = 0; i < 52; i++) {
      const [a, b] = [TRACK_CELLS[i], TRACK_CELLS[(i + 1) % 52]];
      expect(Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]), `step ${i}`).toBeLessThanOrEqual(2);
      expect(Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1])), `step ${i}`).toBe(1);
    }
  });
  it("each colour's last track square leads into its home column", () => {
    for (const c of ["red", "green", "yellow", "blue"] as const) {
      const [a, b] = [cellOf(c, 50, 0), HOME_CELLS[c][0]];
      expect(Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]), c).toBe(1);
    }
  });
  it("puts the start squares in the right arms", () => {
    expect(cellOf("red", 0, 0)).toEqual([6, 1]);
    expect(cellOf("green", 0, 0)).toEqual([1, 8]);
    expect(cellOf("yellow", 0, 0)).toEqual([8, 13]);
    expect(cellOf("blue", 0, 0)).toEqual([13, 6]);
  });
});

describe("what the board shows", () => {
  it("keeps the last roll after the turn passes, and the last move with its sequence", () => {
    let s = roll(two(), "host", 4);
    expect(s.dice).toBe(null); // no move: the turn passed
    expect(s.lastRoll).toMatchObject({ seat: "host", value: 4 });
    s = move(roll(s, "guest", 6), "guest", 0);
    expect(s.last).toMatchObject({ seat: "guest", token: 0, from: -1, to: 0 });
    expect(s.last!.seq).toBe(s.seq);
  });
});
