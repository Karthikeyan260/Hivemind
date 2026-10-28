import { describe, expect, it } from "vitest";
import { claimSeat } from "@/lib/games/party-rules";

describe("seat ownership at game night", () => {
  it("the first device keeps its seat; another device with the same id is turned away", () => {
    const seats = new Map<string, string>();
    expect(claimSeat(seats, "friend-1", "aaa")).toBe(true);
    expect(claimSeat(seats, "friend-1", "aaa")).toBe(true); // same device reconnecting
    expect(claimSeat(seats, "friend-1", "bbb")).toBe(false); // someone copying the id from the roster
    expect(claimSeat(seats, "friend-1", "")).toBe(false); // or sending no key at all
    expect(claimSeat(seats, "friend-2", "ccc")).toBe(true); // other seats are separate
  });
  it("an older page that sends no key still works until a key has been set for that seat", () => {
    const seats = new Map<string, string>();
    expect(claimSeat(seats, "old", "")).toBe(true);
    expect(claimSeat(seats, "old", "")).toBe(true);
    expect(seats.has("old")).toBe(false);
  });
});
