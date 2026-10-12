import { describe, expect, it } from "vitest";
import { boxesOf, botLine, drawLine, leaders, lineCount, newDots, scores, sidesOf, type DotsState } from "@/lib/games/dots";

const two = () => newDots([{ id: "host", name: "Me" }, { id: "guest", name: "Friend" }], 3);
/** Draw these lines one by one, whoever's turn it is. */
const play = (s: DotsState, lines: number[]) => lines.reduce((x, l) => drawLine(x, x.seats[x.turn].id, l), s);

describe("dots and boxes", () => {
  it("numbers lines and boxes consistently", () => {
    const s = two();
    expect(lineCount(s)).toBe(24);
    // Every side of every box borders that box.
    for (let b = 0; b < 9; b++) for (const l of sidesOf(s, Math.floor(b / 3), b % 3)) expect(boxesOf(s, l)).toContain(b);
  });

  it("takes turns, and only the player whose turn it is can draw", () => {
    let s = two();
    expect(drawLine(s, "guest", 0)).toBe(s);
    s = drawLine(s, "host", 0);
    expect(s.turn).toBe(1);
    expect(drawLine(s, "guest", 0)).toBe(s); // already drawn
  });

  it("closing a box scores it and keeps the turn", () => {
    const [top, bottom, left, right] = sidesOf(two(), 0, 0);
    const s = play(two(), [top, bottom, left]);
    expect(s.seats[s.turn].id).toBe("guest");
    const after = drawLine(s, "guest", right);
    expect(after.boxes[0]).toBe(1);
    expect(after.turn).toBe(1); // goes again
    expect(scores(after)).toEqual([0, 1]);
  });

  it("ends when every box is taken, with a winner", () => {
    let s = two();
    for (let i = 0; i < 200 && !s.over; i++) s = drawLine(s, s.seats[s.turn].id, botLine(s, () => 0.42)!);
    expect(s.over).toBe(true);
    expect(scores(s).reduce((a, b) => a + b, 0)).toBe(9);
    expect(leaders(s).length).toBeGreaterThan(0);
  });

  it("HIVEMIND takes a free box, and otherwise doesn't hand one over", () => {
    const [top, bottom, left, right] = sidesOf(two(), 1, 1);
    expect(botLine(play(two(), [top, bottom, left]))).toBe(right);
    // With two sides of a box drawn, drawing a third would give it away: the bot avoids those lines.
    const s = play(two(), [top, bottom]);
    for (let k = 0; k < 20; k++) expect([left, right]).not.toContain(botLine(s, Math.random));
  });
});
