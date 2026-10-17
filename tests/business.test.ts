import { describe, expect, it } from "vitest";
import { BOARD, botAction, bizAct, buildable, canMortgage, houseCost, JAIL, netWorth, newBusiness, PASS_START, rentOf, ringCell, START_CASH, unmortgageCost, type BizState } from "@/lib/games/business";

const two = () => newBusiness([{ id: "host", name: "Karthikeyan" }, { id: "bot1", name: "HIVEMIND", bot: true }]);
const roll = (s: BizState, id: string, d1: number, d2: number, pick = 0) => bizAct(s, id, { type: "roll" }, { d1, d2, pick });
const sq = (name: string) => BOARD.findIndex((q) => q.name === name);

describe("Business: the board", () => {
  it("32 squares, corners where they belong, every city in a group of 2 or 3", () => {
    expect(BOARD).toHaveLength(32);
    expect(BOARD[0].kind).toBe("start");
    expect(BOARD[JAIL].kind).toBe("jail");
    expect(BOARD[16].kind).toBe("rest");
    expect(BOARD[24].kind).toBe("gotojail");
    const groups = new Map<string, number>();
    for (const q of BOARD) if (q.kind === "city") groups.set(q.group, (groups.get(q.group) ?? 0) + 1);
    for (const n of groups.values()) expect(n === 2 || n === 3).toBe(true);
  });
  it("the ring: START bottom-right, Jail bottom-left, Rest House top-left, Go to Jail top-right", () => {
    expect(ringCell(0)).toEqual({ r: 8, c: 8 });
    expect(ringCell(8)).toEqual({ r: 8, c: 0 });
    expect(ringCell(16)).toEqual({ r: 0, c: 0 });
    expect(ringCell(24)).toEqual({ r: 0, c: 8 });
    expect(new Set(BOARD.map((_, i) => `${ringCell(i).r},${ringCell(i).c}`)).size).toBe(32);
  });
});

describe("Business: a turn", () => {
  it("roll, land on a city, buy it", () => {
    let s = roll(two(), "host", 1, 2); // → 3 Jaipur
    expect(s.pos.host).toBe(3);
    expect(s.phase).toBe("buy");
    s = bizAct(s, "host", { type: "buy" });
    expect(s.owner[3]).toBe("host");
    expect(s.cash.host).toBe(START_CASH - 600);
    expect(s.phase).toBe("end");
    s = bizAct(s, "host", { type: "end" });
    expect(s.turn).toBe(1);
  });
  it("only the current player acts, and only what fits the moment", () => {
    const s = two();
    expect(roll(s, "bot1", 1, 2)).toBe(s);
    expect(bizAct(s, "host", { type: "buy" })).toBe(s);
    expect(bizAct(s, "host", { type: "end" })).toBe(s);
    expect(roll(s, "host", 0, 7)).toBe(s);
  });
  it("landing on someone's city pays them rent", () => {
    let s = roll(two(), "host", 1, 2);
    s = bizAct(bizAct(s, "host", { type: "buy" }), "host", { type: "end" });
    s = roll(s, "bot1", 1, 2); // bot lands on host's Jaipur
    expect(s.cash.bot1).toBe(START_CASH - 50);
    expect(s.cash.host).toBe(START_CASH - 600 + 50);
  });
  it("a whole group doubles the rent; houses multiply it", () => {
    let s = two();
    s = { ...s, owner: { [sq("Agra")]: "host", [sq("Jaipur")]: "host" } };
    expect(rentOf(s, sq("Agra"), 7)).toBe(100);
    s = { ...s, houses: { [sq("Agra")]: 1 } };
    expect(rentOf(s, sq("Agra"), 7)).toBe(250);
    s = { ...s, houses: { [sq("Agra")]: 5 } };
    expect(rentOf(s, sq("Agra"), 7)).toBe(3500);
  });
  it("stations: more owned, more rent; utilities: by the dice", () => {
    let s: BizState = { ...two(), owner: { 5: "host" } };
    expect(rentOf(s, 5, 7)).toBe(250);
    s = { ...s, owner: { 5: "host", 13: "host", 21: "host" } };
    expect(rentOf(s, 5, 7)).toBe(1000);
    s = { ...s, owner: { 10: "host" } };
    expect(rentOf(s, 10, 7)).toBe(280);
    s = { ...s, owner: { 10: "host", 28: "host" } };
    expect(rentOf(s, 10, 7)).toBe(700);
  });
  it("passing START pays ₹1,500", () => {
    let s: BizState = { ...two(), pos: { host: 30, bot1: 0 } };
    s = roll(s, "host", 1, 2); // 30 → 1
    expect(s.pos.host).toBe(1);
    expect(s.cash.host).toBe(START_CASH + PASS_START);
  });
  it("doubles roll again; three doubles go to jail", () => {
    let s = roll(two(), "host", 1, 1); // → 2 Treasure
    s = bizAct({ ...s, phase: "end" }, "host", { type: "end" });
    expect(s.turn).toBe(0);
    expect(s.phase).toBe("roll");
    s = { ...s, doubles: 2 };
    s = roll(s, "host", 3, 3);
    expect(s.pos.host).toBe(JAIL);
    expect(s.jail.host).toBe(0);
  });
  it("Go to Jail; then doubles or ₹500 to get out, forced out after three tries", () => {
    let s: BizState = { ...two(), pos: { host: 20, bot1: 0 } };
    s = roll(s, "host", 1, 3); // → 24 Go to Jail
    expect(s.pos.host).toBe(JAIL);
    s = bizAct(s, "host", { type: "end" });
    expect(s.turn).toBe(1);
    // Paying the fine.
    let p: BizState = { ...s, turn: 0, phase: "roll" };
    p = bizAct(p, "host", { type: "payJail" });
    expect(p.jail.host).toBeUndefined();
    expect(p.cash.host).toBe(START_CASH - 500);
    // Failing twice, then forced to pay and move on the third.
    let j: BizState = { ...s, turn: 0, phase: "roll" };
    j = roll(j, "host", 1, 2);
    expect(j.jail.host).toBe(1);
    j = roll({ ...j, phase: "roll" }, "host", 1, 2);
    expect(j.jail.host).toBe(2);
    j = roll({ ...j, phase: "roll" }, "host", 1, 2);
    expect(j.jail.host).toBeUndefined();
    expect(j.pos.host).toBe(JAIL + 3);
  });
  it("build evenly across a whole group; sell back at half", () => {
    let s: BizState = { ...two(), phase: "end", owner: { 1: "host", 3: "host" } };
    expect(buildable(s, "host").sort()).toEqual([1, 3]);
    s = bizAct(s, "host", { type: "build", sq: 1 });
    expect(s.houses[1]).toBe(1);
    expect(bizAct(s, "host", { type: "build", sq: 1 })).toBe(s); // must build Jaipur first
    s = bizAct(s, "host", { type: "build", sq: 3 });
    expect(s.cash.host).toBe(START_CASH - 2 * houseCost(1));
    s = bizAct(s, "host", { type: "sell", sq: 3 });
    expect(s.houses[3]).toBe(0);
    expect(s.cash.host).toBe(START_CASH - 2 * houseCost(1) + houseCost(3) / 2);
  });
  it("can't build without the whole group", () => {
    const s: BizState = { ...two(), phase: "end", owner: { 1: "host" } };
    expect(bizAct(s, "host", { type: "build", sq: 1 })).toBe(s);
  });
  it("a card is drawn and done (Chance: back 3 squares lands again)", () => {
    let s: BizState = { ...two(), pos: { host: 22, bot1: 0 } };
    s = roll(s, "host", 2, 2, 4); // → 26 Chance, card 4: back 3 → 23 Chennai (buyable)
    expect(s.card?.text).toMatch(/back 3/);
    expect(s.pos.host).toBe(23);
    expect(s.phase).toBe("buy");
  });
  it("short of cash: houses sold first, then bankrupt; last one standing wins", () => {
    let s: BizState = { ...two(), cash: { host: START_CASH, bot1: 100 }, owner: { 30: "host", 31: "host", 6: "bot1", 7: "bot1" }, houses: { 30: 5, 31: 5, 6: 1 }, pos: { host: 0, bot1: 28 }, turn: 1 };
    s = roll(s, "bot1", 1, 1); // → 30 Delhi with a hotel
    expect(s.out).toContain("bot1");
    expect(s.over).toBe(true);
    expect(s.winner).toBe("host");
    expect(s.owner[6]).toBeUndefined(); // the bankrupt's cities go back to the bank
  });
  it("a quick game ends after its rounds: the richest wins", () => {
    let s = newBusiness([{ id: "host", name: "K" }, { id: "bot1", name: "H" }], 1);
    s = { ...s, owner: { 31: "bot1" }, turn: 1, phase: "end" };
    s = bizAct(s, "bot1", { type: "end" });
    expect(s.over).toBe(true);
    expect(s.winner).toBe("bot1");
    expect(netWorth(s, "bot1")).toBe(START_CASH + 4000);
  });
  it("HIVEMIND buys when it can spare the cash, skips when it can't, and ends its turn", () => {
    const s = roll(two(), "host", 1, 2);
    expect(botAction(s)).toEqual({ type: "buy" });
    expect(botAction({ ...s, cash: { ...s.cash, host: 1000 } })).toEqual({ type: "skip" });
    expect(botAction({ ...s, phase: "end" })).toEqual({ type: "end" });
  });
  it("a whole bot game finishes without getting stuck", () => {
    let s = newBusiness([{ id: "a", name: "A", bot: true }, { id: "b", name: "B", bot: true }, { id: "c", name: "C", bot: true }], 40);
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    for (let i = 0; i < 20000 && !s.over; i++) {
      const id = s.seats[s.turn].id;
      const next = bizAct(s, id, botAction(s), { d1: 1 + Math.floor(rnd() * 6), d2: 1 + Math.floor(rnd() * 6), pick: Math.floor(rnd() * 100) });
      expect(next).not.toBe(s);
      s = next;
    }
    expect(s.over).toBe(true);
    for (const x of s.seats) expect(s.cash[x.id]).toBeGreaterThanOrEqual(0);
  });
});

describe("Business: the Rest House pot and mortgages", () => {
  it("tax goes into the pot and landing on Rest House pays it out", () => {
    let s = two();
    s = { ...s, pos: { ...s.pos, host: 2 } };
    s = roll(s, "host", 1, 1); // 2 -> 4 Income Tax
    expect(BOARD[s.pos.host].kind).toBe("tax");
    expect(s.pot).toBe(1500);
    s = { ...s, pos: { ...s.pos, bot1: 14 }, turn: 1, phase: "roll", doubles: 0, again: false, dice: null };
    s = roll(s, "bot1", 1, 1); // 14 -> 16 Rest House
    expect(s.pot).toBe(0);
    expect(s.cash.bot1).toBe(START_CASH + 1500);
  });
  it("mortgage gives half the price, charges no rent, and lifting costs 10% extra", () => {
    let s = two();
    s = { ...s, owner: { 3: "host" } };
    expect(canMortgage(s, "host", 3)).toBe(true);
    s = bizAct(s, "host", { type: "mortgage", sq: 3 });
    expect(s.mort?.[3]).toBe(true);
    expect(s.cash.host).toBe(START_CASH + 300);
    expect(rentOf(s, 3, 7)).toBe(0);
    expect(bizAct(s, "host", { type: "mortgage", sq: 3 })).toBe(s);
    s = bizAct(s, "host", { type: "unmortgage", sq: 3 });
    expect(s.mort?.[3]).toBeUndefined();
    expect(unmortgageCost(3)).toBe(330);
    expect(s.cash.host).toBe(START_CASH + 300 - 330);
  });
  it("no mortgage with houses on the colour group, and no building on a mortgaged group", () => {
    let s = two();
    s = { ...s, owner: { 1: "host", 3: "host" }, houses: { 1: 1 } };
    expect(canMortgage(s, "host", 3)).toBe(false);
    s = { ...s, houses: {}, mort: { 1: true } };
    expect(buildable(s, "host")).toEqual([]);
  });
  it("a bill is paid by mortgaging before going bankrupt", () => {
    const base = two();
    const broke = roll({ ...base, cash: { ...base.cash, host: 100 }, pos: { ...base.pos, host: 2 } }, "host", 1, 1); // Income Tax ₹1,500, nothing to sell
    expect(broke.out).toContain("host");
    const rich = roll({ ...base, owner: { 30: "host", 31: "host" }, cash: { ...base.cash, host: 100 }, pos: { ...base.pos, host: 2 } }, "host", 1, 1);
    expect(rich.out).not.toContain("host");
    expect(rich.mort?.[31]).toBe(true);
    expect(rich.cash.host).toBeGreaterThanOrEqual(0);
  });
});
