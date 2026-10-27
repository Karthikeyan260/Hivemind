import { describe, expect, it } from "vitest";
import { boost, BOOST_GAP_MS, BOOST_STEP, cleanRace, COUNT_MS, MAX_RUN_MS, newRace, tick, TRACK, viewOf } from "@/lib/games/pet-race";

const none = () => 0;
const id = (s: unknown) => (typeof s === "string" ? s.replace(/[^a-z0-9-]/gi, "").slice(0, 36) : "");

describe("pet race", () => {
  it("counts down, then runs", () => {
    const r = newRace(["host", "a"], 0);
    expect(viewOf(r, 0).left).toBe(3);
    expect(viewOf(r, 2100).left).toBe(1);
    tick(r, COUNT_MS - 1, none);
    expect(r.phase).toBe("count");
    tick(r, COUNT_MS, none);
    expect(r.phase).toBe("run");
  });

  it("ignores taps before the start, from strangers, and too fast", () => {
    const r = newRace(["host", "a"], 0);
    expect(boost(r, "a", 100)).toBe(false);
    tick(r, COUNT_MS, none);
    expect(boost(r, "nobody", COUNT_MS + 10)).toBe(false);
    expect(boost(r, "a", 5000)).toBe(true);
    expect(boost(r, "a", 5000 + BOOST_GAP_MS - 1)).toBe(false);
    expect(boost(r, "a", 5000 + BOOST_GAP_MS)).toBe(true);
    expect(r.lanes.find((l) => l.id === "a")!.p).toBeCloseTo(0.26 + BOOST_STEP * 2);
  });

  it("the pet that taps wins; with no taps the walking still finishes", () => {
    const r = newRace(["host", "a"], 0);
    let t = COUNT_MS;
    tick(r, t, none);
    while (r.phase === "run") {
      t += 120;
      boost(r, "a", t);
      tick(r, t, none);
    }
    expect(r.winner).toBe("a");
    const w = newRace(["host", "a"], 0);
    t = COUNT_MS;
    while (w.phase !== "done" && t < 10 * MAX_RUN_MS) {
      t += 120;
      tick(w, t, none);
    }
    expect(w.phase).toBe("done");
  });

  it("never goes past the end, and ends once someone gets there", () => {
    const r = newRace(["host", "a"], 0);
    tick(r, COUNT_MS, none);
    r.lanes[0].p = TRACK - 0.1;
    tick(r, COUNT_MS + 120, none);
    expect(r.phase).toBe("done");
    expect(r.winner).toBe("host");
    expect(r.lanes.every((l) => l.p <= TRACK)).toBe(true);
  });

  it("only well-formed race views get through from the wire", () => {
    expect(cleanRace(null, id)).toBeNull();
    expect(cleanRace({ phase: "x", lanes: [] }, id)).toBeNull();
    expect(cleanRace({ phase: "run", lanes: [{ id: "a", p: 500 }, { id: "", p: 3 }], left: 99, winner: "zzz" }, id)).toEqual({ phase: "run", left: 5, lanes: [{ id: "a", p: 100 }] });
  });
});
