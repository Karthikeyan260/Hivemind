import { Chess } from "chess.js";
import { describe, expect, it } from "vitest";
import { spokenMove } from "@/components/games/chess/shared";

describe("chess moves said out loud", () => {
  it("understands the usual ways of saying a move", () => {
    const g = new Chess();
    expect(spokenMove(g, "e4")).toEqual({ san: "e4" });
    expect(spokenMove(g, "knight to f3")).toEqual({ san: "Nf3" });
    expect(spokenMove(g, "Nf3")).toEqual({ san: "Nf3" });
    expect(spokenMove(g, "e2 to e4")).toEqual({ san: "e4" });
    expect(spokenMove(g, "pawn to d4")).toEqual({ san: "d4" });
  });

  it("castles, takes, and asks when it's unclear or illegal", () => {
    const g = new Chess("r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1");
    expect(spokenMove(g, "castle kingside")).toEqual({ san: "O-O" });
    expect(spokenMove(g, "castle queen side")).toEqual({ san: "O-O-O" });
    const t = new Chess("4k3/8/8/3p4/4P3/8/8/4K3 w - - 0 1");
    expect(spokenMove(t, "pawn takes d5")).toEqual({ san: "exd5" });
    const two = new Chess("4k3/8/8/8/8/8/8/1N2KN2 w - - 0 1");
    expect(spokenMove(two, "knight to d2")).toMatchObject({ error: "Which one?", options: ["Nbd2", "Nfd2"] }); // either knight can go
    expect(spokenMove(new Chess(), "queen to h5")).toMatchObject({ error: expect.stringContaining("isn't a legal move") });
  });
});
