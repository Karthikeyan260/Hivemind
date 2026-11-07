import { describe, expect, it } from "vitest";
import { MOVIES } from "@/lib/theatre/catalog";
import { cleanText, isRoomCode, MAX_CHAT, MAX_NAME, MAX_PEERS, newRoomCode, parseMsg, RateLimiter, REACTIONS } from "@/lib/theatre/protocol";

/**
 * Safety of a Friends Theatre room. The room link is public and anyone holding it can open a connection and send
 * whatever they like, so every message is treated as hostile until it has been checked.
 */
const known = (id: string) => MOVIES.some((m) => m.id === id);
const good = MOVIES[0].id;

describe("room codes", () => {
  it("accepts plain, long-enough codes", () => {
    for (const c of ["a1b2c3d4e5f6", "ABCDEFGH", "0123456789abcdef0123456789abcdef"]) expect(isRoomCode(c), c).toBe(true);
  });
  it("rejects anything else", () => {
    for (const c of ["", "short", "has space 123456", "../../etc/passwd", "a1b2c3d4e5f6!", "a1b2c3d4-e5f6", "<script>alert(1)</script>", "a".repeat(41), "ünïcödé12345", "a1b2c3d4\n", undefined, null, 12345678, ["a1b2c3d4e5f6"]]) {
      expect(isRoomCode(c), String(c)).toBe(false);
    }
  });
});

describe("cleaning text", () => {
  it("removes control, zero-width and direction-flipping characters", () => {
    expect(cleanText("he‮llo​ wor\u0000ld‭", 50)).toBe("hello world");
    expect(cleanText("‮evil name", 50)).toBe("evil name");
    expect(cleanText("a\u0007\u001b[31mb", 50)).toBe("a[31mb");
  });
  it("squeezes whitespace, trims and caps the length", () => {
    expect(cleanText("  a \n\n\t b   ", 50)).toBe("a b");
    expect(cleanText("x".repeat(1000), MAX_CHAT)).toHaveLength(MAX_CHAT);
  });
  it("gives an empty string for anything that isn't text", () => {
    for (const v of [null, undefined, 5, {}, [], true, () => "x"]) expect(cleanText(v, 10)).toBe("");
  });
  it("keeps Tamil, emoji and ordinary punctuation intact", () => {
    expect(cleanText("வணக்கம் 😂 — nice film!", 50)).toBe("வணக்கம் 😂 — nice film!");
  });
});

describe("incoming messages", () => {
  it("accepts every message the room sends itself", () => {
    expect(parseMsg({ t: "hello", name: "Priya" }, known)).toEqual({ t: "hello", name: "Priya" });
    expect(parseMsg({ t: "state", movie: good, time: 12.5, playing: true }, known)).toEqual({ t: "state", movie: good, time: 12.5, playing: true });
    expect(parseMsg({ t: "hb", movie: good, time: 0, playing: false }, known)).toEqual({ t: "hb", movie: good, time: 0, playing: false });
    expect(parseMsg({ t: "play", time: 3 }, known)).toEqual({ t: "play", time: 3 });
    expect(parseMsg({ t: "pause", time: 3 }, known)).toEqual({ t: "pause", time: 3 });
    expect(parseMsg({ t: "seek", time: 600 }, known)).toEqual({ t: "seek", time: 600 });
    expect(parseMsg({ t: "movie", id: good }, known)).toEqual({ t: "movie", id: good });
    expect(parseMsg({ t: "chat", text: "hello" }, known)).toEqual({ t: "chat", text: "hello" });
    expect(parseMsg({ t: "react", e: REACTIONS[0] }, known)).toEqual({ t: "react", e: REACTIONS[0] });
    expect(parseMsg({ t: "ask" }, known)).toEqual({ t: "ask" });
    expect(parseMsg({ t: "count" }, known)).toEqual({ t: "count" });
    expect(parseMsg({ t: "peers", list: ["abc-123_xyz", "def-456"] }, known)).toEqual({ t: "peers", list: ["abc-123_xyz", "def-456"] });
  });

  it("drops things that aren't messages", () => {
    for (const v of [null, undefined, 0, 1, "play", true, [], [{ t: "play", time: 1 }], () => ({ t: "play" })]) expect(parseMsg(v, known), String(v)).toBeNull();
  });

  it("drops unknown or malformed kinds", () => {
    for (const v of [{}, { t: 5 }, { t: "evil" }, { t: "PLAY", time: 1 }, { t: ["play"], time: 1 }, { type: "play", time: 1 }, { t: "constructor" }, { t: "__proto__" }, { t: "toString" }]) {
      expect(parseMsg(v, known), JSON.stringify(v)).toBeNull();
    }
  });

  it("refuses times that aren't real (negative, NaN, Infinity, past a day, strings)", () => {
    for (const time of [-1, NaN, Infinity, -Infinity, 86_401, 1e12, "10", null, undefined, {}, [1]]) {
      for (const t of ["play", "pause", "seek"]) expect(parseMsg({ t, time }, known), `${t} ${String(time)}`).toBeNull();
      expect(parseMsg({ t: "state", movie: good, time, playing: true }, known)).toBeNull();
    }
  });

  it("only lets the room be pointed at films in the catalogue", () => {
    for (const id of ["nope", "", "../x", "yt-", "<img src=x>", "a".repeat(200), 5, null, { toString: () => good }]) {
      expect(parseMsg({ t: "movie", id }, known), String(id)).toBeNull();
      expect(parseMsg({ t: "state", movie: id, time: 1, playing: true }, known)).toBeNull();
    }
  });

  it("needs a real boolean for 'playing'", () => {
    for (const playing of ["true", 1, 0, null, undefined, {}]) expect(parseMsg({ t: "state", movie: good, time: 1, playing }, known)).toBeNull();
  });

  it("cleans names and chat, and drops chat that is empty once cleaned", () => {
    expect(parseMsg({ t: "hello", name: "x".repeat(200) }, known)).toEqual({ t: "hello", name: "x".repeat(MAX_NAME) });
    expect(parseMsg({ t: "hello", name: "‮​" }, known)).toEqual({ t: "hello", name: "Friend" });
    expect(parseMsg({ t: "hello" }, known)).toEqual({ t: "hello", name: "Friend" });
    expect(parseMsg({ t: "chat", text: "y".repeat(5000) }, known)).toEqual({ t: "chat", text: "y".repeat(MAX_CHAT) });
    for (const text of ["", "   ", "​​", null, 5, {}, ["a"]]) expect(parseMsg({ t: "chat", text }, known), String(text)).toBeNull();
  });

  it("leaves markup as plain text for the page to show safely", () => {
    const evil = `<img src=x onerror="alert(1)"><script>fetch('/api/notes')</script>`;
    expect(parseMsg({ t: "chat", text: evil }, known)).toEqual({ t: "chat", text: evil }); // kept as text; React prints it as text
  });

  it("only shows reactions the room offers", () => {
    for (const e of ["💩", "x", "", "😂😂😂😂😂😂😂😂", "<b>", 5, null, "😂 "]) expect(parseMsg({ t: "react", e }, known), String(e)).toBeNull();
  });

  it("bounds the list of people it is told about, and their ids", () => {
    const list = Array.from({ length: 100 }, (_, i) => `peer-${i}-abcd`);
    expect(parseMsg({ t: "peers", list }, known)).toEqual({ t: "peers", list: list.slice(0, MAX_PEERS) });
    expect(parseMsg({ t: "peers", list: ["ok-id-1", "../../x", "has space", 5, null, "a".repeat(200), "<x>"] }, known)).toEqual({ t: "peers", list: ["ok-id-1"] });
    expect(parseMsg({ t: "peers", list: "not-a-list" }, known)).toBeNull();
    expect(parseMsg({ t: "peers" }, known)).toBeNull();
  });

  it("copies only the fields it knows (no smuggled keys, no prototype pollution)", () => {
    const polluted = JSON.parse('{"t":"play","time":5,"__proto__":{"admin":true},"constructor":{"prototype":{"x":1}},"extra":"x"}');
    const m = parseMsg(polluted, known) as Record<string, unknown>;
    expect(m).toEqual({ t: "play", time: 5 });
    expect(Object.keys(m)).toEqual(["t", "time"]);
    expect(({} as Record<string, unknown>).admin).toBeUndefined();
    expect(({} as Record<string, unknown>).x).toBeUndefined();
  });

  it("copes with hostile shapes without throwing", () => {
    const deep: Record<string, unknown> = {};
    let cur = deep;
    for (let i = 0; i < 10_000; i++) cur = (cur.n = {}) as Record<string, unknown>;
    const circular: Record<string, unknown> = { t: "chat" };
    circular.text = circular;
    for (const v of [deep, circular, { t: "chat", text: { toString() { throw new Error("boom"); } } }, Object.create(null), new Proxy({}, { get() { throw new Error("trap"); } })]) {
      expect(() => parseMsg(v, known)).not.toThrow();
    }
  });
});

describe("flooding", () => {
  it("lets a normal pace through and ignores a flood, per sender and kind", () => {
    const r = new RateLimiter();
    let passed = 0;
    for (let i = 0; i < 200; i++) if (r.allow("friend-1", "chat", 1000 + i)) passed++;
    expect(passed).toBe(10);
    expect(r.allow("friend-2", "chat", 1100)).toBe(true); // someone else is unaffected
    expect(r.allow("friend-1", "react", 1100)).toBe(true); // another kind is unaffected
  });
  it("lets the sender back in once the window has passed", () => {
    const r = new RateLimiter();
    for (let i = 0; i < 10; i++) r.allow("a", "chat", 0);
    expect(r.allow("a", "chat", 5000)).toBe(false);
    expect(r.allow("a", "chat", 10_001)).toBe(true);
  });
  it("forgets a friend who left", () => {
    const r = new RateLimiter();
    for (let i = 0; i < 10; i++) r.allow("gone", "chat", 0);
    r.forget("gone");
    expect(r.allow("gone", "chat", 1)).toBe(true);
  });
  it("keeps a long film's heartbeat and sync flowing (4 s heartbeat is well inside its allowance)", () => {
    const r = new RateLimiter();
    let dropped = 0;
    for (let t = 0; t < 4 * 3600 * 1000; t += 4000) if (!r.allow("host", "hb", t)) dropped++;
    expect(dropped).toBe(0);
  });
});

describe("new room codes", () => {
  it("makes plain, long codes that pass the room-code check", () => {
    for (let i = 0; i < 200; i++) {
      const c = newRoomCode();
      expect(c).toHaveLength(16);
      expect(isRoomCode(c), c).toBe(true);
    }
    expect(isRoomCode(newRoomCode(40))).toBe(true);
  });
  it("never repeats, so a link can't be guessed or collide", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 5000; i++) seen.add(newRoomCode());
    expect(seen.size).toBe(5000);
  });
  it("uses every kind of character about equally (no skew a guesser could use)", () => {
    const count: Record<string, number> = {};
    const total = 62 * 800;
    let made = "";
    while (made.length < total) made += newRoomCode(16);
    for (const ch of made.slice(0, total)) count[ch] = (count[ch] ?? 0) + 1;
    expect(Object.keys(count)).toHaveLength(62);
    for (const [ch, n] of Object.entries(count)) {
      expect(n, ch).toBeGreaterThan(800 * 0.7);
      expect(n, ch).toBeLessThan(800 * 1.3);
    }
  });
});
