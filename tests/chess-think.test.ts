import { Chess } from "chess.js";
import { describe, expect, it } from "vitest";
import { think } from "@/lib/games/chess-think";

describe("the bot's move when there's no background worker (or it died)", () => {
  it("still answers, on the page itself, with a legal move", async () => {
    // Node has no Worker: this is the same path a crashed worker falls back to.
    const game = new Chess();
    const san = await think(game.fen(), "beginner");
    expect(san).not.toBeNull();
    expect(game.moves()).toContain(san);
  });
  it("answers null when there is nothing to play (checkmate)", async () => {
    const mate = new Chess("rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3");
    expect(mate.isCheckmate()).toBe(true);
    expect(await think(mate.fen(), "beginner")).toBeNull();
  });
});
