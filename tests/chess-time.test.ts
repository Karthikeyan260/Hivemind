import { Chess } from "chess.js";
import { describe, expect, it } from "vitest";
import { timeoutResult } from "@/lib/games/chess-time";

const at = (fen: string) => new Chess(fen);

describe("a flag fall: a win, unless the other side can't mate", () => {
  it("a normal position: the side with time left wins", () => {
    expect(timeoutResult(new Chess(), "w")).toEqual({ winner: "b", reason: "time" });
    expect(timeoutResult(new Chess(), "b")).toEqual({ winner: "w", reason: "time" });
  });
  it("a bare king (or nothing but a king and one knight/bishop against a bare king) can't win on time", () => {
    // White has only a king; Black's flag falls: draw, not a white win.
    expect(timeoutResult(at("4k3/8/8/8/8/8/8/4K3 w - - 0 1"), "b").winner).toBeNull();
    // White king + bishop vs black king, black flags: draw.
    expect(timeoutResult(at("4k3/8/8/8/8/8/8/3BK3 w - - 0 1"), "b").winner).toBeNull();
    // White king + knight vs black king, black flags: draw.
    expect(timeoutResult(at("4k3/8/8/8/8/8/8/3NK3 w - - 0 1"), "b").winner).toBeNull();
  });
  it("a lone minor piece can still win on time if the other side has material to block with (a helpmate exists)", () => {
    // White K+B, Black K+P: black flags: white wins.
    expect(timeoutResult(at("4k3/4p3/8/8/8/8/8/3BK3 w - - 0 1"), "b")).toEqual({ winner: "w", reason: "time" });
  });
  it("a pawn, a rook, a queen or two minor pieces can mate in theory: a win", () => {
    expect(timeoutResult(at("4k3/8/8/8/8/8/4P3/4K3 w - - 0 1"), "b").winner).toBe("w");
    expect(timeoutResult(at("4k3/8/8/8/8/8/8/R3K3 w - - 0 1"), "b").winner).toBe("w");
    expect(timeoutResult(at("4k3/8/8/8/8/8/8/Q3K3 w - - 0 1"), "b").winner).toBe("w");
    expect(timeoutResult(at("4k3/8/8/8/8/8/8/2BNK3 w - - 0 1"), "b").winner).toBe("w");
  });
});
