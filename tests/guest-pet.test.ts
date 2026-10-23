import { describe, expect, it } from "vitest";
import { afterFireflies, afterFlower, afterGame, cleanGuestName, GUEST_XP, guestStage, HUES, newGuestPet, readGuestPet } from "@/lib/guest-pet";
import { cleanPet } from "@/lib/games/party-rules";
import { stageFor, STAGES } from "@/lib/pet-stages";

describe("a friend's guest pet", () => {
  it("is hatched with a clean name and one of the six colours", () => {
    const p = newGuestPet("  pixel!! ", 3)!;
    expect(p).toMatchObject({ name: "Pixel", hue: 3, xp: 0, games: 0, flowers: 0 });
    expect(newGuestPet("🙂🙂", 1)).toBeNull();
    expect(newGuestPet("", 1)).toBeNull();
    expect(newGuestPet("Bo", 99)!.hue).toBe(0);
    expect(newGuestPet("Bo", -1)!.hue).toBe(0);
    expect(cleanGuestName("a very long name for a pet indeed")).toHaveLength(16);
    expect(HUES).toHaveLength(6);
  });
  it("grows from games and the firefly game, and keeps its best score", () => {
    let p = newGuestPet("Pixel", 0)!;
    p = afterGame(p);
    expect(p).toMatchObject({ xp: GUEST_XP.game, games: 1 });
    const a = afterFireflies(p, 12);
    expect(a.newBest).toBe(true);
    expect(a.pet.fireflies).toEqual({ best: 12, plays: 1 });
    expect(a.pet.xp).toBe(GUEST_XP.game + GUEST_XP.fireflies + 3);
    const b = afterFireflies(a.pet, 5);
    expect(b.newBest).toBe(false);
    expect(b.pet.fireflies.best).toBe(12);
    expect(afterFireflies(p, -5).pet.fireflies.best).toBe(0);
    expect(afterFireflies(p, 99999).pet.fireflies.best).toBe(500);
  });
  it("evolves through the same four stages as Nova", () => {
    expect(stageFor(0)).toBe(0);
    expect(stageFor(59)).toBe(0);
    expect(stageFor(60)).toBe(1);
    expect(stageFor(300)).toBe(2);
    expect(stageFor(900)).toBe(3);
    expect(STAGES).toHaveLength(4);
    expect(guestStage({ ...newGuestPet("Bo", 0)!, xp: 320 })).toBe(2);
  });
  it("keeps flowers it is given", () => {
    expect(afterFlower(newGuestPet("Bo", 0)!).flowers).toBe(1);
    expect(afterFlower({ ...newGuestPet("Bo", 0)!, flowers: 9999 }).flowers).toBe(9999);
  });
  it("is read back safely from the browser's store, even edited by hand", () => {
    expect(readGuestPet(null)).toBeNull();
    expect(readGuestPet("nonsense")).toBeNull();
    expect(readGuestPet('{"name":""}')).toBeNull();
    const p = readGuestPet('{"name":"<b>Bo</b>","hue":99,"xp":-5,"games":1e12,"fireflies":{"best":9999,"plays":2},"flowers":3}')!;
    expect(p.name).not.toMatch(/[<>/]/);
    expect(p.hue).toBe(5);
    expect(p.xp).toBe(0);
    expect(p.games).toBe(99_999);
    expect(p.fireflies.best).toBe(500);
    expect(p.flowers).toBe(3);
  });
});

describe("a pet sent to the table is checked on arrival", () => {
  it("passes a good one through", () => {
    expect(cleanPet({ name: "Pixel", hue: 2, stage: 1, xp: 80, wear: "crown", best: 12, flowers: 3 })).toEqual({ name: "Pixel", hue: 2, stage: 1, xp: 80, wear: "crown", best: 12, flowers: 3 });
  });
  it("cleans the name, clamps the numbers, and drops an accessory that does not exist", () => {
    const p = cleanPet({ name: "<script>alert(1)</script>", hue: 99, stage: 9, xp: -4, wear: "<img>", best: 1e9, flowers: "lots" })!;
    expect(p.name).not.toMatch(/[<>()]/);
    expect(p.name.length).toBeLessThanOrEqual(16);
    expect(p).toMatchObject({ hue: 5, stage: 3, xp: 0, wear: null, best: 500, flowers: 0 });
  });
  it("is not a pet when it has no name or is not an object", () => {
    for (const v of [null, undefined, 5, "pet", [], { name: "" }, { name: "🙂" }]) expect(cleanPet(v), JSON.stringify(v)).toBeUndefined();
  });
});
