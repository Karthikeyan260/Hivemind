import { describe, expect, it } from "vitest";
import { beginDeal, boostAct, botPass, cleanName, deal, newBoost, nextDeal, pointsFor, score, triple, viewFor, type BoostState } from "@/lib/games/boost";

/** Repeatable random numbers. */
const seeded = (n: number) => () => ((n = (n * 16807) % 2147483647) - 1) / 2147483646;
const four = [{ id: "host", name: "Karthi" }, { id: "ann", name: "Ann" }, { id: "bob", name: "Bob" }, { id: "cat", name: "Cat" }];
const named = (rand = seeded(7)) => {
  let s = newBoost(four, { theme: "heroes", rounds: 10 }, rand);
  s = boostAct(s, "host", { type: "name", name: "Vijay" });
  s = boostAct(s, "ann", { type: "name", name: "Ajith" });
  s = boostAct(s, "bob", { type: "name", name: "Suriya" });
  return boostAct(s, "cat", { type: "name", name: "Dhanush" });
};
/** Put hands exactly as a test needs them. */
const withHands = (s: BoostState, hands: Record<string, string[]>): BoostState => ({ ...s, hands, counts: Object.fromEntries(Object.entries(hands).map(([k, v]) => [k, v.length])) });

describe("Boost (3 Roses / Allimalli)", () => {
  it("deals 3 of everyone's name, shuffled, 3 cards each, once everyone has written a name", () => {
    let s = newBoost(four, { theme: "heroes" }, seeded(1));
    expect(s.phase).toBe("names");
    s = boostAct(s, "host", { type: "name", name: "  Vijay  " });
    expect(s.names.host).toBe("Vijay");
    expect(s.phase).toBe("names");
    s = named();
    expect(s.phase).toBe("pass");
    expect(s.round).toBe(1);
    const all = Object.values(s.hands).flat().sort();
    expect(all).toEqual(["Ajith", "Ajith", "Ajith", "Dhanush", "Dhanush", "Dhanush", "Suriya", "Suriya", "Suriya", "Vijay", "Vijay", "Vijay"]);
    for (const p of four) expect(s.hands[p.id]).toHaveLength(3);
  });

  it("refuses a name someone already wrote (same letters, any case or spacing)", () => {
    let s = newBoost(four, { theme: "heroes" }, seeded(1));
    s = boostAct(s, "host", { type: "name", name: "Vijay" });
    expect(boostAct(s, "ann", { type: "name", name: "vi jay" })).toBe(s);
    expect(boostAct(s, "ann", { type: "name", name: "   " })).toBe(s);
    // and you can't change yours once written
    expect(boostAct(s, "host", { type: "name", name: "Ajith" })).toBe(s);
    expect(cleanName("a".repeat(50))).toHaveLength(20);
  });

  it("HIVEMIND's bots pick different names from the theme; all-bot tables deal at once", () => {
    const s = newBoost([{ id: "host", name: "K" }, { id: "b1", name: "H1", bot: true }, { id: "b2", name: "H2", bot: true }], { theme: "foods" }, seeded(3));
    expect(s.names.b1).toBeTruthy();
    expect(s.names.b2).toBeTruthy();
    expect(s.names.b1).not.toBe(s.names.b2);
    expect(s.phase).toBe("names"); // still waiting for the person
    const started = beginDeal(s, seeded(4)); // the host can start anyway: missing names are filled in
    expect(started.phase).toBe("pass");
    expect(Object.keys(started.names)).toHaveLength(3);
  });

  it("passes go round the table, one card each turn, and only the player on turn may pass", () => {
    let s = named();
    const first = s.seats[s.turn].id;
    const nextId = s.seats[(s.turn + 1) % 4].id;
    const other = s.seats[(s.turn + 2) % 4].id;
    expect(boostAct(s, other, { type: "pass", card: 0 })).toBe(s); // not their turn
    expect(boostAct(s, first, { type: "pass", card: 9 })).toBe(s); // no such card
    const card = s.hands[first][1];
    s = boostAct(s, first, { type: "pass", card: 1 });
    expect(s.hands[first]).toHaveLength(2);
    expect(s.hands[nextId]).toHaveLength(4);
    expect(s.hands[nextId][3]).toBe(card);
    expect(s.seats[s.turn].id).toBe(nextId);
    s = boostAct(s, nextId, { type: "pass", card: 0 });
    expect(s.hands[nextId]).toHaveLength(3);
    // cards are never lost or made up
    expect(Object.values(s.hands).flat()).toHaveLength(12);
  });

  it("BOOST only counts with three of a kind; then everyone races and points go 1000, 900, 800…", () => {
    let s = named();
    s = withHands(s, { host: ["Vijay", "Ajith", "Suriya"], ann: ["Ajith", "Ajith", "Ajith"], bob: ["Vijay", "Vijay", "Suriya"], cat: ["Dhanush", "Dhanush", "Dhanush"] });
    // a false call does nothing
    expect(boostAct(s, "host", { type: "boost" })).toBe(s);
    s = boostAct(s, "ann", { type: "boost" });
    expect(s.phase).toBe("react");
    expect(s.reacted).toEqual(["ann"]);
    // no passing while the race is on, and a second tap from the same player doesn't count twice
    expect(boostAct(s, s.seats[s.turn].id, { type: "pass", card: 0 })).toBe(s);
    expect(boostAct(s, "ann", { type: "boost" })).toBe(s);
    s = boostAct(s, "cat", { type: "boost" });
    s = boostAct(s, "host", { type: "boost" });
    expect(s.phase).toBe("react");
    s = boostAct(s, "bob", { type: "boost" }); // last one: scored at once
    expect(s.phase).toBe("scored");
    expect(s.gained).toEqual({ ann: 1000, cat: 900, host: 800, bob: 700 });
    expect(s.scores.ann).toBe(1000);
  });

  it("time's up in the race: whoever didn't tap gets nothing", () => {
    let s = withHands(named(), { host: ["Vijay", "Vijay", "Vijay"], ann: ["Ajith"], bob: ["Suriya"], cat: ["Dhanush"] });
    s = boostAct(s, "host", { type: "boost" });
    s = boostAct(s, "bob", { type: "boost" });
    s = score(s);
    expect(s.gained).toEqual({ host: 1000, bob: 900, ann: 0, cat: 0 });
    expect(pointsFor(20)).toBe(100);
  });

  it("deals again for the set number of rounds, the starter moving round the table, then names the winner", () => {
    let s = named(seeded(11));
    s = { ...s, rounds: 3 };
    const starters: number[] = [];
    for (let r = 1; r <= 3; r++) {
      starters.push(s.turn);
      expect(s.round).toBe(r);
      // give "cat" three of a kind each deal so it's always cat first
      s = withHands(s, { host: ["Vijay"], ann: ["Ajith"], bob: ["Suriya"], cat: ["Dhanush", "Dhanush", "Dhanush"] });
      s = boostAct(s, "cat", { type: "boost" });
      s = boostAct(s, "host", { type: "boost" });
      s = score(s);
      if (r < 3) {
        expect(s.phase).toBe("scored");
        s = nextDeal(s, seeded(r));
      }
    }
    expect(starters).toEqual([0, 1, 2]);
    expect(s.phase).toBe("over");
    expect(s.scores.cat).toBe(3000);
    expect(s.scores.host).toBe(2700);
    expect(s.winners).toEqual(["cat"]);
  });

  it("each player sees only their own hand until the deal is scored", () => {
    const s = named();
    const v = viewFor(s, "ann");
    expect(Object.keys(v.hands)).toEqual(["ann"]);
    expect(v.counts.host).toBe(3); // how many others hold is public
    const done = { ...s, phase: "scored" as const };
    expect(Object.keys(viewFor(done, "ann").hands)).toHaveLength(4);
  });

  it("HIVEMIND passes the card it holds fewest of, and a bot table finishes a deal", () => {
    expect(triple(["A", "B", "A", "A"])).toBe("A");
    expect(triple(["A", "B", "A"])).toBeNull();
    const s = withHands(named(), { host: ["Vijay", "Ajith", "Vijay", "Vijay"], ann: [], bob: [], cat: [] });
    expect(botPass(s, "host")).toBe(1); // gives away the lone Ajith, keeps the Vijays
    // a whole table passing the bot's way always ends with someone holding three
    let g = deal({ ...named(seeded(5)), round: 0 }, seeded(6));
    let guard = 0;
    while (!Object.values(g.hands).some((h) => triple(h)) && guard++ < 500) {
      const id = g.seats[g.turn].id;
      g = boostAct(g, id, { type: "pass", card: botPass(g, id) });
    }
    expect(guard).toBeLessThan(500);
  });
});
