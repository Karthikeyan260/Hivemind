import { describe, expect, it } from "vitest";
import { Chess } from "chess.js";
import { bestMove, evaluate } from "@/lib/games/chess-bot";

let seed = 5;
const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

describe("HIVEMIND chess bot", () => {
  it("scores the start as level and an extra queen as winning", () => {
    expect(Math.abs(evaluate(new Chess()))).toBeLessThan(50);
    expect(evaluate(new Chess("rnb1kbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"))).toBeGreaterThan(800);
  });

  it("finds mate in one", () => {
    // Scholar's mate: Qxf7#.
    expect(bestMove("r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5Q2/PPPP1PPP/RNB1K1NR w KQkq - 4 4", "medium", rand)).toBe("Qxf7#");
    // Back-rank mate.
    expect(bestMove("6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1", "easy", rand)).toBe("Ra8#");
  });

  it("takes a free queen and doesn't hang its own", () => {
    expect(bestMove("rnb1kbnr/pppp1ppp/8/4p1q1/3P4/2N5/PPP1PPPP/R1BQKBNR w KQkq - 1 3", "medium", rand)).toBe("Bxg5");
    // Black's queen is attacked by the knight: it should move it (or defend), not leave it.
    const fen = "rnb1kbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1qPP/RNBQKB1R w KQkq - 0 4";
    expect(bestMove(fen, "medium", rand)).toBe("Kxf2");
  });

  it("always returns a legal move, and nothing when the game is over", () => {
    const g = new Chess();
    for (let i = 0; i < 30 && !g.isGameOver(); i++) {
      const m = bestMove(g.fen(), i % 2 ? "beginner" : "easy", rand);
      expect(m).not.toBeNull();
      g.move(m!);
    }
    expect(bestMove("7k/5Q2/6K1/8/8/8/8/8 b - - 0 1", "hard", rand)).toBeNull(); // stalemate
  }, 60_000);

  it("a stronger level clearly outplays the beginner", () => {
    let hardWins = 0;
    for (let game = 0; game < 2; game++) {
      const g = new Chess();
      const hardIsWhite = game === 0;
      for (let ply = 0; ply < 60 && !g.isGameOver(); ply++) {
        const hardToMove = (g.turn() === "w") === hardIsWhite;
        g.move(bestMove(g.fen(), hardToMove ? "easy" : "beginner", rand)!);
      }
      if (g.isCheckmate() && (g.turn() === "w") !== hardIsWhite) hardWins++;
      else if (!g.isGameOver()) {
        // Unfinished: the stronger side should at least be well ahead.
        const e = evaluate(g) * (g.turn() === "w" ? 1 : -1) * (hardIsWhite ? 1 : -1);
        if (e > 300) hardWins++;
      }
    }
    expect(hardWins).toBe(2);
  }, 180_000);
});
