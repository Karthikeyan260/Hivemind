import type { Chess, Color } from "chess.js";

/**
 * What a flag fall means. A player out of time loses, unless their opponent could not checkmate them
 * however the game went on: then it is a draw (the rule on every major chess site).
 *
 * Mate is impossible for a side with only a bare king. With one knight or bishop it is only possible if
 * the other side still has some piece besides its king to get in its own way (a "helpmate"). A pawn, rook,
 * queen, or two minor pieces can always mate in theory.
 */
export function timeoutResult(game: Chess, flagged: Color): { winner: Color | null; reason: string } {
  const winner: Color = flagged === "w" ? "b" : "w";
  const count = (color: Color) => {
    const n = { heavy: 0, minor: 0, other: 0 };
    for (const row of game.board())
      for (const sq of row) {
        if (!sq || sq.color !== color) continue;
        if (sq.type === "p" || sq.type === "r" || sq.type === "q") n.heavy++;
        else if (sq.type === "n" || sq.type === "b") n.minor++;
      }
    n.other = n.heavy + n.minor;
    return n;
  };
  const mine = count(winner);
  const theirs = count(flagged);
  const canMate = mine.heavy > 0 || mine.minor >= 2 || (mine.minor === 1 && theirs.other > 0);
  return canMate ? { winner, reason: "time" } : { winner: null, reason: "timeout with no mating material" };
}
