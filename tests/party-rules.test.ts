import { describe, expect, it } from "vitest";
import { quickPage } from "@/lib/agents/quick";
import type { PartyPlayer } from "@/lib/games/party";
import { callsFirst, cleanChat, cleanId, reservedId, cleanName, drawView, guessPoints, here, isReaction, nextRound, REACTIONS, rightGuess, roundDone, seatsFor, spokenGame, spokenPlayer } from "@/lib/games/party-rules";

const P = (id: string, name: string, online = true, host = false): PartyPlayer => ({ id, name, online, host });
const table = [P("host", "Karthikeyan", false, true), P("a", "Arun"), P("p", "Priya", false), P("k", "Kavin"), P("d", "Divya"), P("v", "Kavi")];

describe("game night: who is at the table", () => {
  it("the owner always counts; friends only while connected", () => {
    expect(here(table).map((p) => p.name)).toEqual(["Karthikeyan", "Arun", "Kavin", "Divya", "Kavi"]);
  });
  it("a game seats the first people here, up to its size", () => {
    expect(seatsFor(table, 4)).toEqual([
      { id: "host", name: "Karthikeyan" },
      { id: "a", name: "Arun" },
      { id: "k", name: "Kavin" },
      { id: "d", name: "Divya" },
    ]);
    expect(seatsFor(table, 6)).toHaveLength(5);
  });
  it("a friend can't take an id the games keep for the owner or HIVEMIND's bots", () => {
    for (const id of ["host", "ai", "bot", "bot1", "BOT3"]) expect(reservedId(id)).toBe(true);
    for (const id of ["b0t1", "bot1x", "a1b2c3", "robot1"]) expect(reservedId(id)).toBe(false);
  });
  it("chat messages: one plain line, 200 characters at most, emoji and Tamil kept", () => {
    expect(cleanChat("  hi\n\tthere  ")).toBe("hi there");
    expect(cleanChat("a".repeat(300))).toHaveLength(200);
    expect(cleanChat("\u202eevil")).toBe("evil");
    expect(cleanChat("வணக்கம் 👨‍👩‍👧 <b>")).toBe("வணக்கம் 👨‍👩‍👧 <b>");
    expect(cleanChat(undefined)).toBe("");
    expect(cleanChat("   ")).toBe("");
  });
  it("group voice: exactly one of each pair calls", () => {
    expect(callsFirst("a", "b")).toBe(true);
    expect(callsFirst("b", "a")).toBe(false);
  });
  it("only the six reactions pass; anything else from the wire is dropped", () => {
    expect(REACTIONS).toHaveLength(6);
    for (const e of REACTIONS) expect(isReaction(e)).toBe(true);
    expect(isReaction("💩")).toBe(false);
    expect(isReaction("<img src=x onerror=alert(1)>")).toBe(false);
    expect(isReaction(undefined)).toBe(false);
  });
  it("names and ids from the wire are cleaned", () => {
    expect(cleanName("  <b>Priya</b>!!  ")).toBe("bPriyab");
    expect(cleanName("A very long name that goes on")).toHaveLength(20);
    expect(cleanName("தமிழ் செல்வி")).toBe("தமிழ் செல்வி");
    expect(cleanId("ab-12/../x?y")).toBe("ab-12xy");
    expect(cleanId(undefined)).toBe("");
  });
});

describe("game night by voice", () => {
  it("knows the games by any of their names", () => {
    expect(spokenGame("let's play ludo")).toBe("ludo");
    expect(spokenGame("colour clash")).toBe("cards");
    expect(spokenGame("UNO")).toBe("cards");
    expect(spokenGame("play cards")).toBe("cards");
    expect(spokenGame("draw and guess")).toBe("draw");
    expect(spokenGame("dots and boxes")).toBe("dots");
    expect(spokenGame("a game of chess")).toBe("chess");
    expect(spokenGame("snakes and ladders")).toBe("snakes");
    expect(spokenGame("paramapadham")).toBe("snakes");
    expect(spokenGame("let's play business")).toBe("business");
    expect(spokenGame("monopoly")).toBe("business");
    expect(spokenGame("something fun")).toBeNull();
  });
  it("finds a friend by name, preferring the longest match", () => {
    expect(spokenPlayer(table, "remove Priya")?.id).toBe("p");
    expect(spokenPlayer(table, "play against kavin")?.id).toBe("k");
    expect(spokenPlayer(table, "kavi please")?.id).toBe("v");
    expect(spokenPlayer(table, "nobody")).toBeNull();
  });
  it("the new games open by voice", () => {
    expect(quickPage("let's play snakes and ladders")?.href).toBe("/games/snakes");
    expect(quickPage("open business")?.href).toBe("/games/business");
    expect(quickPage("play monopoly")?.href).toBe("/games/business");
  });
  it("'open game night' goes straight to the party page", () => {
    expect(quickPage("open game night")?.href).toBe("/games/party");
    expect(quickPage("let's play party games")?.href).toBe("/games/party");
    expect(quickPage("play games with my friends")?.href).toBe("/games/party");
  });
});

describe("Draw & Guess at game night", () => {
  it("a guess is right when it's the word, in any case, or a sentence holding a longer word", () => {
    expect(rightGuess("Umbrella", "umbrella")).toBe(true);
    expect(rightGuess("umbrellas!", "umbrella")).toBe(true);
    expect(rightGuess("a big umbrella", "umbrella")).toBe(true);
    expect(rightGuess("the cat", "cat")).toBe(false); // short words must be exact
    expect(rightGuess("cat", "cat")).toBe(true);
    expect(rightGuess("banana", "umbrella")).toBe(false);
    expect(rightGuess("", "umbrella")).toBe(false);
  });
  it("points: 50 plus the seconds left, never less than 50", () => {
    expect(guessPoints(30.4)).toBe(80);
    expect(guessPoints(-3)).toBe(50);
  });
  it("only the drawer, those who guessed it, and everyone after the round see the word", () => {
    const s = { phase: "playing", drawer: "host", guessed: ["a"], word: "kite" };
    expect(drawView(s, "host").word).toBe("kite");
    expect(drawView(s, "a").word).toBe("kite");
    expect(drawView(s, "k").word).toBe("");
    expect(drawView({ ...s, phase: "between" }, "k").word).toBe("kite");
  });
  it("turns go round the table and skip anyone who left", () => {
    const order = ["host", "a", "k"];
    const all = new Set(order);
    expect(nextRound(order, 6, 1, all)).toEqual({ n: 1, drawer: "host" });
    expect(nextRound(order, 6, 5, all)).toEqual({ n: 5, drawer: "a" });
    expect(nextRound(order, 6, 2, new Set(["host", "k"]))).toEqual({ n: 3, drawer: "k" });
    expect(nextRound(order, 6, 7, all)).toBeNull();
    expect(nextRound(order, 3, 2, new Set(["host"]))).toBeNull();
  });
  it("a round ends when time's up, the drawer leaves, or everyone here has guessed", () => {
    const s = { order: ["host", "a", "k"], drawer: "host", guessed: ["a"] };
    const all = new Set(s.order);
    expect(roundDone(s, all, false)).toBe(false);
    expect(roundDone(s, all, true)).toBe(true);
    expect(roundDone(s, new Set(["a", "k"]), false)).toBe(true); // the drawer left
    expect(roundDone(s, new Set(["host", "a"]), false)).toBe(true); // the last guesser left
    expect(roundDone({ ...s, guessed: ["a", "k"] }, all, false)).toBe(true);
    expect(roundDone({ ...s, guessed: [] }, new Set(["host"]), false)).toBe(false); // no one to guess yet
  });
});
