import type { SupabaseClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// An in-memory stand-in for the private store and the database client (no network in these tests).
const store = new Map<string, unknown>();
vi.mock("@/lib/private-store", () => ({
  readJSON: async (_s: unknown, key: string, fallback: unknown) => (store.has(key) ? store.get(key) : fallback),
  writeJSON: async (_s: unknown, key: string, value: unknown) => void store.set(key, value),
}));
vi.mock("@/lib/db", () => ({ db: () => ({}) as SupabaseClient }));

import { proxy } from "@/proxy";
import { MOVIES } from "@/lib/theatre/catalog";
import { cleanText, isRoomCode, MAX_CHAT, MAX_NAME, MAX_PEERS, newRoomCode, parseMsg } from "@/lib/theatre/protocol";
import { GET as readRoom, POST as rotateRoom } from "@/app/api/theatre/room/route";
import { getRoomCode } from "@/lib/theatre/room";

/**
 * Security of Friends Theatre as a whole: what the permanent room link is made of, who may read or change it, what a
 * room accepts from someone holding the link, and that the catalogue itself can't carry anything dangerous.
 */
const known = (id: string) => MOVIES.some((m) => m.id === id);

describe("the room code is a secret that is hard to guess and hard to abuse", () => {
  it("is long and random: 16 letters/digits, never repeating across many codes", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 20_000; i++) {
      const c = newRoomCode();
      expect(c).toMatch(/^[A-Za-z0-9]{16}$/);
      seen.add(c);
    }
    expect(seen.size).toBe(20_000);
  });

  it("every character of every position is used (no fixed prefix or pattern to guess)", () => {
    const first = new Set<string>();
    const last = new Set<string>();
    for (let i = 0; i < 20_000; i++) {
      const c = newRoomCode();
      first.add(c[0]);
      last.add(c[15]);
    }
    expect(first.size).toBe(62);
    expect(last.size).toBe(62);
  });

  it("is accepted only in its plain form: nothing that could change the broker id, the path or the page", () => {
    const bad = [
      "abcdefg", // too short
      "a".repeat(41), // too long
      "abcdefgh\n", // a trailing newline slipping past a $ anchor
      "abcdefgh\r\n",
      " abcdefgh",
      "abcd efgh",
      "abcdefgh-ijkl", // not the broker's own separators
      "abcdefgh_ijkl",
      "abcdefgh/../x",
      "..%2f..%2fabcdefgh",
      "abcdefgh%00",
      "abcdefgh\u0000",
      "abcdefgh‮",
      "abcdéfghijkl", // letters outside a-z
      "abcdefgh٣٤٥٦", // Arabic-Indic digits
      "ａｂｃｄｅｆｇｈ", // full-width letters
      "<script>alert(1)</script>",
      "abc?x=1&y=2def",
      "abcdefgh#frag",
      "hm-theatre-abcdefgh",
    ];
    for (const b of bad) expect(isRoomCode(b), JSON.stringify(b)).toBe(false);
    for (const v of [null, undefined, 12345678, ["abcdefghij"], { toString: () => "abcdefghij" }]) expect(isRoomCode(v)).toBe(false);
    for (const good of ["abcdefgh", "ABCDEFGH12345678", "a".repeat(40), newRoomCode()]) expect(isRoomCode(good), good).toBe(true);
  });
});

describe("a room accepts nothing it can't check, and checking is cheap", () => {
  it("cleans a 10 MB string in well under a second, and keeps only what fits", () => {
    const huge = "word ".repeat(2_000_000);
    const t0 = performance.now();
    const out = cleanText(huge, MAX_CHAT);
    expect(performance.now() - t0).toBeLessThan(500);
    expect(out.length).toBeLessThanOrEqual(MAX_CHAT);
  });

  it("a string made only of invisible and whitespace characters becomes nothing, quickly", () => {
    const t0 = performance.now();
    expect(cleanText("​ ‮\n\t".repeat(1_000_000), MAX_CHAT)).toBe("");
    expect(performance.now() - t0).toBeLessThan(500);
  });

  it("only ever looks at the start of a huge string (so an attacker can't make us chew through all of it)", () => {
    // Everything past eight times the limit is never even read: here the only visible text sits beyond that point.
    expect(cleanText("​".repeat(MAX_CHAT * 8) + "visible", MAX_CHAT)).toBe("");
    // ...while the same text well within reach comes through.
    expect(cleanText("​".repeat(MAX_CHAT) + "visible", MAX_CHAT)).toBe("visible");
  });

  it("only ever looks at the first few entries of a huge list of friends", () => {
    const junk = new Array(MAX_PEERS * 4).fill("bad id!");
    expect(parseMsg({ t: "peers", list: [...junk, "valid-id-1234"] }, known)).toEqual({ t: "peers", list: [] });
    expect(parseMsg({ t: "peers", list: [...junk.slice(4), "valid-id-1234"] }, known)).toEqual({ t: "peers", list: ["valid-id-1234"] });
  });

  it("a name or chat can't hide behind look-alike or direction-flipping characters", () => {
    expect(cleanText("Host‮⁦⁩​﻿", MAX_NAME)).toBe("Host");
    expect(cleanText("a\u0000b\u0007c\u001bd\u009fe", MAX_NAME)).toBe("abcde");
    expect(cleanText("  many   spaces\n\nand\tlines ", 40)).toBe("many spaces and lines");
  });

  it("a list of two million 'friends' costs only a handful of checks and yields at most the limit", () => {
    const list = new Array(2_000_000).fill("peer-abcd");
    const t0 = performance.now();
    const m = parseMsg({ t: "peers", list }, known);
    expect(performance.now() - t0).toBeLessThan(200);
    expect(m).toEqual({ t: "peers", list: expect.any(Array) });
    expect((m as { list: string[] }).list.length).toBeLessThanOrEqual(MAX_PEERS);
  });

  it("peer ids are plain broker ids: nothing long, empty, or with path or markup characters", () => {
    const m = parseMsg({ t: "peers", list: ["ok-id_1", "../../x", "a".repeat(5000), "", "<b>", "id with space", "id\n", "good-two"] }, known);
    expect(m).toEqual({ t: "peers", list: ["ok-id_1", "good-two"] });
  });

  it("only the fields a message needs survive: no smuggled keys, no prototype tricks", () => {
    const m = parseMsg(JSON.parse('{"t":"chat","text":"hi","admin":true,"__proto__":{"isAdmin":true},"constructor":"x"}'), known);
    expect(m).toEqual({ t: "chat", text: "hi" });
    expect(Object.keys(m as object)).toEqual(["t", "text"]);
    expect(({} as Record<string, unknown>).isAdmin).toBeUndefined();
  });

  it("a deeply nested or circular object is dropped without a crash", () => {
    const loop: Record<string, unknown> = { t: "chat" };
    loop.text = loop;
    expect(parseMsg(loop, known)).toBeNull();
    let deep: unknown = { t: "chat", text: "x" };
    for (let i = 0; i < 100_000; i++) deep = [deep];
    expect(parseMsg(deep, known)).toBeNull();
  });

  it("film ids from the wire must be catalogue ids, nothing that is a URL, a path or a script", () => {
    for (const id of ["https://evil.example/x.mp4", "javascript:alert(1)", "data:text/html,<script>", "../../secret", "yt-" + "x".repeat(200), "", "film one", "mayabazar\n"]) {
      expect(parseMsg({ t: "movie", id }, known), id).toBeNull();
      expect(parseMsg({ t: "hb", movie: id, time: 1, playing: false }, known), id).toBeNull();
    }
    expect(parseMsg({ t: "movie", id: "mayabazar" }, known)).toEqual({ t: "movie", id: "mayabazar" });
  });

  it("times are real, finite and within a day; reactions are only the offered ones", () => {
    for (const t of [-1, NaN, Infinity, -Infinity, 86_401, 1e300, "5", null, [5], { valueOf: () => 5 }]) expect(parseMsg({ t: "seek", time: t }, known), String(t)).toBeNull();
    for (const e of ["<script>", "💀", "😂😂", "", "😂​", 5]) expect(parseMsg({ t: "react", e }, known), String(e)).toBeNull();
    expect(parseMsg({ t: "react", e: "😂" }, known)).toEqual({ t: "react", e: "😂" });
  });
});

describe("the catalogue can't carry anything dangerous", () => {
  const SAFE_HOSTS = ["i.ytimg.com", "www.youtube.com", "upload.wikimedia.org", "commons.wikimedia.org"];
  const films = MOVIES;

  it("has plain ids (letters, digits, dash, underscore) and a matching YouTube id", () => {
    for (const m of films) {
      expect(m.id, m.title).toMatch(/^[A-Za-z0-9_-]{1,80}$/);
      if (m.yt) {
        expect(m.yt, m.title).toMatch(/^[A-Za-z0-9_-]{11}$/);
        expect(m.id).toBe(`yt-${m.yt}`);
      }
    }
  });

  it("only points at https pages on the hosts the app expects (no javascript:, data:, http or look-alike hosts)", () => {
    for (const m of films) {
      for (const u of [m.page, m.poster, ...m.qualities.map((q) => q.src)]) {
        if (u.startsWith("/theatre/posters/")) continue; // the app's own poster files
        const url = new URL(u);
        expect(url.protocol, `${m.title}: ${u}`).toBe("https:");
        expect(SAFE_HOSTS, `${m.title}: ${u}`).toContain(url.hostname);
        expect(url.username + url.password, u).toBe("");
      }
    }
  });

  it("has titles and channel names that are plain text: no control or direction-flipping characters, no markup", () => {
    for (const m of films) {
      for (const text of [m.title, m.channel ?? "", m.series ?? "", m.about]) {
        // (zero-width joiners are fine: Tamil script and emoji sequences need them)
        expect(text, m.id).not.toMatch(/[\u0000-\u001f\u007f-\u009f​‎‏‪-‮⁠-⁤⁦-⁩﻿]/);
        expect(text, m.id).not.toMatch(/[<>]/);
      }
      expect(m.title.length, m.id).toBeLessThan(200);
      expect(m.about.length, m.id).toBeLessThan(1000);
    }
  });

  it("gives every film a sane length and year, so nothing the page computes from them can go wrong", () => {
    for (const m of films) {
      expect(Number.isFinite(m.minutes) && m.minutes > 0 && m.minutes < 24 * 60, m.title).toBe(true);
      if (m.year !== null) expect(Number.isInteger(m.year) && m.year >= 1930 && m.year <= new Date().getFullYear() + 1, m.title).toBe(true);
    }
  });
});

describe("the gate: who may reach what", () => {
  const OLD_ENV = process.env.APP_PASSWORD;
  beforeEach(() => {
    process.env.APP_PASSWORD = "correct horse battery staple";
    store.clear();
  });
  const req = (path: string, init?: ConstructorParameters<typeof NextRequest>[1]) => new NextRequest(`http://localhost:3000${path}`, init);
  const status = async (path: string, init?: ConstructorParameters<typeof NextRequest>[1]) => (await proxy(req(path, init))).status;

  it("shuts the owner's room-code API to anyone without a session, every way of spelling it", async () => {
    for (const p of ["/api/theatre/room", "/api/theatre/room/", "/api/theatre//room", "/api/Theatre/room", "/api/theatre/room?x=1", "/api/theatre/room%2F", "/api/theatre"]) {
      expect(await status(p), `GET ${p}`).toBe(401);
      expect(await status(p, { method: "POST" }), `POST ${p}`).toBe(401);
      expect(await status(p, { method: "PUT" }), `PUT ${p}`).toBe(401);
      expect(await status(p, { method: "DELETE" }), `DELETE ${p}`).toBe(401);
    }
  });

  it("is not fooled by a made-up or malformed session cookie", async () => {
    const cookies = ["sb_owner=", "sb_owner=true", "sb_owner=admin", "sb_owner=v2.", "sb_owner=v2.nothex.nothex", `sb_owner=v2.${"0".repeat(48)}.${"0".repeat(64)}`.replace("v2.", "v1."), "sb_owner=../../x", "other=1"];
    for (const c of cookies) {
      expect(await status("/api/theatre/room", { headers: { cookie: c } }), c).toBe(401);
      expect(await status("/theatre", { headers: { cookie: c } }), c).toBe(307); // the shelf redirects to the password page
    }
  });

  it("keeps the shelf and every other page and API behind the password, while a room link stays open", async () => {
    expect(await status("/theatre")).toBe(307);
    expect(await status("/api/notes")).toBe(401);
    expect(await status(`/theatre/${newRoomCode()}`)).toBe(200);
  });

  it("in production, stays closed (503), not open, when the password isn't configured", async () => {
    vi.stubEnv("NODE_ENV", "production");
    delete process.env.APP_PASSWORD;
    try {
      expect(await status("/api/theatre/room")).toBe(503);
      expect(await status("/api/theatre/room", { method: "POST" })).toBe(503);
      expect(await status("/theatre")).toBe(503);
      expect(await status("/api/notes")).toBe(503);
    } finally {
      vi.unstubAllEnvs();
      if (OLD_ENV === undefined) delete process.env.APP_PASSWORD;
      else process.env.APP_PASSWORD = OLD_ENV;
    }
  });
});

describe("the room-code API itself", () => {
  beforeEach(() => store.clear());

  it("tells the browser never to keep the code (no cache holds the link)", async () => {
    const r = await readRoom();
    expect(r.headers.get("cache-control")).toContain("no-store");
    const w = await rotateRoom();
    expect(w.headers.get("cache-control")).toContain("no-store");
  });

  it("returns a valid code that stays the same until it's changed on purpose", async () => {
    const a = ((await (await readRoom()).json()) as { code: string }).code;
    const b = ((await (await readRoom()).json()) as { code: string }).code;
    expect(isRoomCode(a)).toBe(true);
    expect(b).toBe(a);
  });

  it("a new code replaces the old one for good: the old link is no longer the owner's room", async () => {
    const old = await getRoomCode({} as SupabaseClient);
    const next = ((await (await rotateRoom()).json()) as { code: string }).code;
    expect(next).not.toBe(old);
    expect(await getRoomCode({} as SupabaseClient)).toBe(next);
    expect(((await (await readRoom()).json()) as { code: string }).code).toBe(next);
  });

  it("answers with nothing but the code (no other data rides along)", async () => {
    const body = (await (await readRoom()).json()) as Record<string, unknown>;
    expect(Object.keys(body)).toEqual(["code"]);
  });
});
