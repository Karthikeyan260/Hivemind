import { describe, expect, it } from "vitest";
import { botColumn, COLS, drop, landing, lineThrough, newConnect4, openColumns, ROWS, type C4State } from "@/lib/games/connect4";

const game = () => newConnect4([{ id: "a", name: "Asha" }, { id: "b", name: "Bala" }]);
/** Plays columns alternately from seat a. */
function play(cols: number[], from: C4State = game()) {
  let s = from;
  for (const c of cols) s = drop(s, s.seats[s.turn].id, c);
  return s;
}

describe("dropping discs", () => {
  it("falls to the lowest free spot and passes the turn", () => {
    let s = drop(game(), "a", 3);
    expect(s.board[(ROWS - 1) * COLS + 3]).toBe(0);
    expect(s.turn).toBe(1);
    s = drop(s, "b", 3);
    expect(s.board[(ROWS - 2) * COLS + 3]).toBe(1);
  });
  it("ignores the wrong seat, a bad column and a full column", () => {
    const s = game();
    expect(drop(s, "b", 3)).toBe(s);
    expect(drop(s, "a", -1)).toBe(s);
    expect(drop(s, "a", COLS)).toBe(s);
    expect(drop(s, "a", 2.5)).toBe(s);
    const full = play([0, 0, 0, 0, 0, 0]);
    expect(landing(full.board, 0)).toBe(-1);
    expect(drop(full, full.seats[full.turn].id, 0)).toBe(full);
    expect(openColumns(full.board)).toHaveLength(COLS - 1);
  });
});

describe("four in a row", () => {
  it("wins across", () => {
    const s = play([0, 0, 1, 1, 2, 2, 3]);
    expect(s.over).toBe(true);
    expect(s.winner).toBe(0);
    expect(s.line).toHaveLength(4);
  });
  it("wins down", () => {
    const s = play([0, 1, 0, 1, 0, 1, 0]);
    expect(s.over && s.winner).toBe(0);
  });
  it("wins on a rising diagonal and a falling one", () => {
    const rising = play([0, 1, 1, 2, 2, 3, 2, 3, 3, 6, 3]);
    expect(rising.over && rising.winner).toBe(0);
    const falling = play([6, 5, 5, 4, 4, 3, 4, 3, 3, 0, 3]);
    expect(falling.over && falling.winner).toBe(0);
  });
  it("does not move once the game is over", () => {
    const s = play([0, 0, 1, 1, 2, 2, 3]);
    expect(drop(s, "b", 4)).toBe(s);
  });
  it("finds no line through an empty cell or three in a row", () => {
    expect(lineThrough(game().board, 5, 0)).toEqual([]);
    const s = play([0, 0, 1, 1, 2]);
    expect(lineThrough(s.board, ROWS - 1, 2)).toEqual([]);
  });
  it("calls a full board with no line a draw", () => {
    // Random play until a game fills the board with no line (draws are uncommon but not rare).
    let found: C4State | null = null;
    for (let t = 0; t < 30000 && !found; t++) {
      let s = game();
      while (!s.over) {
        const open = openColumns(s.board);
        s = drop(s, s.seats[s.turn].id, open[Math.floor(Math.random() * open.length)]);
      }
      if (s.winner < 0) found = s;
    }
    expect(found).not.toBeNull();
    expect(found!.board.every((v) => v >= 0)).toBe(true);
    expect(found!.line).toEqual([]);
    expect(found!.log.at(-1)).toMatch(/draw/i);
  });
});

describe("HIVEMIND's moves", () => {
  it("takes a win that is one move away", () => {
    // a has 0,1,2 on the bottom row, b has 0,1 above; a to move.
    const s = play([0, 0, 1, 1, 2, 2]);
    for (const level of ["easy", "medium", "hard"] as const) expect(botColumn(s, level)).toBe(3);
  });
  it("blocks a win that is one move away", () => {
    // a threatens 0,1,2 → 3; it is b's turn after a's third disc.
    const s = play([0, 6, 1, 6, 2]);
    for (const level of ["easy", "medium", "hard"] as const) expect(botColumn(s, level, () => 0.99)).toBe(3);
  });
  it("only plays open columns and returns null on a full board", () => {
    const s = play([0, 0, 0, 0, 0, 0]);
    for (let i = 0; i < 50; i++) expect(botColumn(s, "easy")).not.toBe(0);
    expect(botColumn({ ...s, board: Array(COLS * ROWS).fill(0) }, "hard")).toBeNull();
  });
  it("hard beats easy far more often than not, and every game ends", () => {
    let hard = 0;
    let easy = 0;
    for (let g = 0; g < 4; g++) {
      let s = newConnect4([{ id: "h", name: "Hard", bot: true }, { id: "e", name: "Easy", bot: true }]);
      if (g % 2) s = { ...s, seats: [s.seats[1], s.seats[0]] as C4State["seats"] };
      let guard = 0;
      while (!s.over && guard++ < 60) {
        const seat = s.seats[s.turn];
        const c = botColumn(s, seat.id === "h" ? "hard" : "easy");
        expect(c).not.toBeNull();
        s = drop(s, seat.id, c!);
      }
      expect(s.over).toBe(true);
      if (s.winner >= 0 && s.seats[s.winner].id === "h") hard++;
      else if (s.winner >= 0) easy++;
    }
    expect(hard).toBeGreaterThan(easy);
  }, 30_000);
});
