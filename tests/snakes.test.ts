import { describe, expect, it } from "vitest";
import { cellOfSquare, GOAL, LADDERS, newSnakes, rollSnakes, SNAKES, standings, type SnakesState } from "@/lib/games/snakes";

const two = () => newSnakes([{ id: "host", name: "Karthikeyan" }, { id: "bot1", name: "HIVEMIND", bot: true }]);
const at = (s: SnakesState, id: string, p: number): SnakesState => ({ ...s, pos: { ...s.pos, [id]: p } });

describe("Snakes & Ladders rules", () => {
  it("everyone starts off the board; the first roll puts you on it", () => {
    const s = rollSnakes(two(), "host", 3);
    expect(s.pos.host).toBe(3);
    expect(s.turn).toBe(1);
  });
  it("only the player whose turn it is can roll, and only 1–6", () => {
    const s = two();
    expect(rollSnakes(s, "bot1", 3)).toBe(s);
    expect(rollSnakes(s, "host", 7)).toBe(s);
    expect(rollSnakes(s, "host", 0)).toBe(s);
  });
  it("a ladder's foot climbs, a snake's head slides", () => {
    const up = rollSnakes(at(two(), "host", 25), "host", 3); // 28 → 84
    expect(up.pos.host).toBe(84);
    expect(up.last).toMatchObject({ walk: 28, to: 84, via: "ladder" });
    const down = rollSnakes(at(two(), "host", 85), "host", 2); // 87 → 24
    expect(down.pos.host).toBe(24);
    expect(down.last?.via).toBe("snake");
  });
  it("a 6 rolls again; three 6s in a row lose the turn", () => {
    let s = rollSnakes(two(), "host", 6);
    expect(s.turn).toBe(0);
    s = rollSnakes(s, "host", 6);
    expect(s.turn).toBe(0);
    const p = s.pos.host;
    s = rollSnakes(s, "host", 6);
    expect(s.turn).toBe(1);
    expect(s.pos.host).toBe(p); // the third 6 doesn't move
  });
  it("100 needs the exact number; too much and you stay", () => {
    let s = rollSnakes(at(two(), "host", 97), "host", 5);
    expect(s.pos.host).toBe(97);
    expect(s.turn).toBe(1);
    s = rollSnakes({ ...at(two(), "host", 97) }, "host", 3);
    expect(s.pos.host).toBe(GOAL);
    expect(s.over).toBe(true);
    expect(s.winner).toBe("host");
    expect(rollSnakes(s, "bot1", 2)).toBe(s); // game over: nothing moves
  });
  it("the ladder to 100 wins too", () => {
    const s = rollSnakes(at(two(), "host", 76), "host", 4); // 80 → 100
    expect(s.winner).toBe("host");
  });
  it("standings: the winner, then whoever is furthest", () => {
    let s = newSnakes([{ id: "a", name: "A" }, { id: "b", name: "B" }, { id: "c", name: "C" }]);
    s = { ...s, pos: { a: 40, b: 100, c: 70 }, winner: "b", over: true };
    expect(standings(s).map((x) => x.id)).toEqual(["b", "c", "a"]);
  });
  it("up to 6 players, each their own colour", () => {
    const s = newSnakes(Array.from({ length: 8 }, (_, i) => ({ id: `p${i}`, name: `P${i}` })));
    expect(s.seats).toHaveLength(6);
    expect(new Set(s.seats.map((x) => x.color)).size).toBe(6);
  });
  it("snakes go down, ladders go up, and none starts where another ends", () => {
    for (const [a, b] of Object.entries(LADDERS)) expect(b).toBeGreaterThan(Number(a));
    for (const [a, b] of Object.entries(SNAKES)) expect(b).toBeLessThan(Number(a));
    const starts = [...Object.keys(LADDERS), ...Object.keys(SNAKES)].map(Number);
    expect(new Set(starts).size).toBe(starts.length);
  });
  it("the board snakes: 1 bottom-left, 10 bottom-right, 11 above 10, 100 top-left", () => {
    expect(cellOfSquare(1)).toEqual({ r: 9, c: 0 });
    expect(cellOfSquare(10)).toEqual({ r: 9, c: 9 });
    expect(cellOfSquare(11)).toEqual({ r: 8, c: 9 });
    expect(cellOfSquare(100)).toEqual({ r: 0, c: 0 });
  });
});
