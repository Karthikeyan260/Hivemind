import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The room's network code against a hostile peer. Anyone holding the room link can open a connection and send anything,
 * so these tests stand in for PeerJS with a fake, play the attacker, and check that the room (a) ignores what it
 * should, (b) stays fast and bounded under floods and huge inputs, and (c) only lets the opener do the opener's jobs.
 * (A real-browser version of the same attacks is in e2e/theatre-security.spec.ts.)
 */
const fake = vi.hoisted(() => {
  type Fn = (...a: unknown[]) => void;
  class Emitter {
    handlers: Record<string, Fn[]> = {};
    on(ev: string, fn: Fn) {
      (this.handlers[ev] ??= []).push(fn);
      return this;
    }
    emit(ev: string, ...a: unknown[]) {
      for (const fn of this.handlers[ev] ?? []) fn(...a);
    }
  }
  /** The WebRTC connection under a data connection: tests flip its state and fire the change events. */
  class Pc {
    iceConnectionState = "connected";
    connectionState = "connected";
    listeners: Fn[] = [];
    addEventListener(_ev: string, fn: Fn) {
      this.listeners.push(fn);
    }
    set(state: string) {
      this.iceConnectionState = state;
      for (const fn of this.listeners) fn();
    }
  }
  /** The data channel under a connection: tests deliver raw messages on it. */
  class Channel {
    listeners: Fn[] = [];
    addEventListener(_ev: string, fn: Fn) {
      this.listeners.push(fn);
    }
    deliver(data: unknown) {
      for (const fn of this.listeners) fn({ data });
    }
  }
  class Conn extends Emitter {
    open = false;
    closed = false;
    sent: unknown[] = [];
    peerConnection = new Pc();
    dataChannel = new Channel();
    constructor(public peer: string) {
      super();
    }
    send(m: unknown) {
      this.sent.push(m);
    }
    close() {
      this.closed = true;
      this.open = false;
      this.emit("close");
    }
    /** The remote side finished connecting. */
    connect() {
      this.open = true;
      this.emit("open");
    }
    /** The remote side sent a message. */
    receive(m: unknown) {
      this.emit("data", m);
    }
  }
  class FakePeer extends Emitter {
    static all: FakePeer[] = [];
    id: string;
    destroyed = false;
    disconnected = false;
    dialed: Conn[] = [];
    constructor(idOrOpts?: unknown) {
      super();
      this.id = typeof idOrOpts === "string" ? idOrOpts : `anon-${FakePeer.all.length}`;
      FakePeer.all.push(this);
    }
    connect(id: string) {
      const c = new Conn(id);
      this.dialed.push(c);
      return c;
    }
    call() {
      return new Emitter();
    }
    destroy() {
      this.destroyed = true;
    }
    reconnect() {}
    /** A remote peer dials us. */
    incoming(peerId: string) {
      const c = new Conn(peerId);
      this.emit("connection", c);
      return c;
    }
  }
  return { FakePeer, Conn };
});

vi.mock("peerjs", () => ({ default: fake.FakePeer }));

import { TheatreNet, type NetHooks } from "@/lib/theatre/net";
import { MAX_CHAT, MAX_CONNS, MAX_NAME, MAX_PEERS } from "@/lib/theatre/protocol";

const ROOM = "abcdef1234567890";
const HOST_ID = `hm-theatre-${ROOM}`;
const FILM = "mayabazar";

type Spy = NetHooks & { lines: Array<{ who: string; text: string; system: boolean }>; peopleNow: Record<string, string> };
function hooks(): Spy {
  const s = {
    lines: [] as Spy["lines"],
    peopleNow: {} as Record<string, string>,
    people: vi.fn((n: Record<string, string>) => void (s.peopleNow = n)),
    line: vi.fn((who: string, text: string, system: boolean) => void s.lines.push({ who, text, system })),
    react: vi.fn(),
    count: vi.fn(),
    movie: vi.fn(),
    playback: vi.fn(),
    play: vi.fn(),
    pause: vi.fn(),
    seek: vi.fn(),
    here: vi.fn(() => ({ movie: FILM, time: 0, playing: false })),
    live: vi.fn(),
    fail: vi.fn(),
  };
  return s as unknown as Spy;
}
const known = (id: string) => id === FILM || id === "other-film";

const nets: TheatreNet[] = [];
async function openRoom() {
  const h = hooks();
  const net = new TheatreNet(ROOM, "Host", h, known);
  nets.push(net);
  await net.start();
  const peer = fake.FakePeer.all.at(-1)!;
  peer.emit("open");
  return { h, net, peer };
}
/** Someone else was already the opener: we join as a friend and have dialled the opener. */
async function joinRoom() {
  const h = hooks();
  const net = new TheatreNet(ROOM, "Friend", h, known);
  nets.push(net);
  await net.start();
  fake.FakePeer.all.at(-1)!.emit("error", { type: "unavailable-id" });
  const peer = fake.FakePeer.all.at(-1)!;
  peer.emit("open");
  const opener = peer.dialed[0];
  opener.connect();
  return { h, net, peer, opener };
}
/** A peer connects to us and says hello. */
function arrive(peer: InstanceType<typeof fake.FakePeer>, id: string, name = "Mallory") {
  const c = peer.incoming(id);
  c.connect();
  c.receive({ t: "hello", name });
  return c;
}

beforeEach(() => {
  fake.FakePeer.all.length = 0;
  vi.useFakeTimers();
  vi.setSystemTime(1_700_000_000_000);
});
afterEach(() => {
  for (const n of nets.splice(0)) n.destroy();
  vi.useRealTimers();
});

describe("who holds the room", () => {
  it("claims the room's fixed id first, built only from the room code", async () => {
    await openRoom();
    expect(fake.FakePeer.all[0].id).toBe(HOST_ID);
  });

  it("joins as a friend when the id is taken, with an id of the broker's own making", async () => {
    const { peer, opener } = await joinRoom();
    expect(fake.FakePeer.all[0].destroyed).toBe(true);
    expect(peer.id).toMatch(/^anon-/);
    expect(opener.peer).toBe(HOST_ID);
  });

  it("a failing broker is reported, not hidden", async () => {
    const h = hooks();
    const net = new TheatreNet(ROOM, "Host", h, known);
    nets.push(net);
    await net.start();
    fake.FakePeer.all[0].emit("error", { type: "network" });
    expect(h.fail).toHaveBeenCalledTimes(1);
  });
});

describe("hostile messages", () => {
  const garbage = [
    null,
    undefined,
    0,
    NaN,
    "chat",
    "",
    [],
    [{ t: "chat", text: "x" }],
    {},
    { t: 1 },
    { t: "nope" },
    { t: "chat" },
    { t: "chat", text: 42 },
    { t: "chat", text: { toString: () => "x" } },
    { t: "play", time: "5" },
    { t: "play", time: Infinity },
    { t: "seek", time: -1 },
    { t: "seek", time: 1e12 },
    { t: "movie", id: "https://evil.example/x.mp4" },
    { t: "movie", id: "../../etc/passwd" },
    { t: "movie", id: "unknown-film" },
    { t: "hb", movie: FILM, time: 5, playing: "yes" },
    { t: "react", e: "<script>" },
    { t: "peers", list: "evil" },
    { t: "hello", name: { a: 1 } },
  ];

  it("drops everything that isn't a well-formed message, and never throws", async () => {
    const { h, peer } = await openRoom();
    const evil = peer.incoming("evil");
    evil.connect();
    for (const g of garbage) expect(() => evil.receive(g)).not.toThrow();
    // Only the (cleaned) hello may have got through.
    expect(h.react).not.toHaveBeenCalled();
    expect(h.seek).not.toHaveBeenCalled();
    expect(h.play).not.toHaveBeenCalled();
    expect(h.movie).not.toHaveBeenCalled();
    expect(h.lines.filter((l) => !l.system)).toEqual([]);
  });

  it("survives a hostile object (throwing getters, __proto__) without polluting anything", async () => {
    const { h, peer } = await openRoom();
    const evil = peer.incoming("evil");
    evil.connect();
    const trap = {
      get t(): string {
        throw new Error("boom");
      },
    };
    expect(() => evil.receive(trap)).not.toThrow();
    evil.receive(JSON.parse('{"t":"chat","text":"hi","__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}}}'));
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(h.lines.some((l) => l.text === "hi")).toBe(true);
  });

  it("caps names and chat, and strips invisible and direction-flipping characters", async () => {
    const { h, peer } = await openRoom();
    const evil = arrive(peer, "evil", "<img src=x onerror=alert(1)>" + "A".repeat(500) + "‮​");
    const name = Object.values(h.peopleNow)[0];
    expect(name.length).toBeLessThanOrEqual(MAX_NAME);
    expect(name).not.toMatch(/[‮​]/);
    evil.receive({ t: "chat", text: "x".repeat(100_000) + "‮" });
    const said = h.lines.filter((l) => !l.system).map((l) => l.text);
    expect(said).toHaveLength(1);
    expect(said[0].length).toBeLessThanOrEqual(MAX_CHAT);
  });

  it("handles a huge message quickly (a megabyte of chat, a million-entry list, deep nesting)", async () => {
    const { peer } = await joinRoom();
    const evil = peer.incoming("evil");
    evil.connect();
    const t0 = performance.now();
    evil.receive({ t: "chat", text: "a ".repeat(2_500_000) });
    evil.receive({ t: "hello", name: " ".repeat(5_000_000) + "x" });
    evil.receive({ t: "peers", list: new Array(2_000_000).fill("abcdefgh") });
    let deep: Record<string, unknown> = { t: "chat", text: "x" };
    for (let i = 0; i < 50_000; i++) deep = { next: deep };
    evil.receive(deep);
    expect(performance.now() - t0).toBeLessThan(1000);
  });

  it("limits a flood: a thousand messages get a handful through, per kind", async () => {
    const { h, peer } = await openRoom();
    const evil = arrive(peer, "evil");
    for (let i = 0; i < 1000; i++) {
      evil.receive({ t: "chat", text: `spam ${i}` });
      evil.receive({ t: "react", e: "😂" });
      evil.receive({ t: "seek", time: i });
      evil.receive({ t: "hello", name: `n${i}` });
    }
    expect(h.lines.filter((l) => !l.system).length).toBeLessThanOrEqual(10);
    expect(vi.mocked(h.react).mock.calls.length).toBeLessThanOrEqual(20);
    expect(vi.mocked(h.seek).mock.calls.length).toBeLessThanOrEqual(20);
  });

  it("an attacker's flood doesn't silence an honest friend", async () => {
    const { h, peer } = await openRoom();
    const evil = arrive(peer, "evil");
    for (let i = 0; i < 500; i++) evil.receive({ t: "chat", text: "spam" });
    const friend = arrive(peer, "friend", "Priya");
    friend.receive({ t: "chat", text: "hello everyone" });
    expect(h.lines.some((l) => l.who === "Priya" && l.text === "hello everyone")).toBe(true);
  });

  it("lets an honest friend back in once the window has passed", async () => {
    const { h, peer } = await openRoom();
    const friend = arrive(peer, "friend", "Priya");
    for (let i = 0; i < 30; i++) friend.receive({ t: "chat", text: `m${i}` });
    const first = h.lines.filter((l) => !l.system).length;
    expect(first).toBeLessThanOrEqual(10);
    vi.advanceTimersByTime(11_000);
    friend.receive({ t: "chat", text: "later" });
    expect(h.lines.some((l) => l.text === "later")).toBe(true);
  });
});

describe("the room can't be filled", () => {
  it(`turns away connections past ${MAX_CONNS}, and the ones already in stay`, async () => {
    const { peer } = await openRoom();
    const conns = Array.from({ length: 60 }, (_, i) => {
      const c = peer.incoming(`peer-${i}`);
      c.connect();
      return c;
    });
    expect(conns.filter((c) => !c.closed)).toHaveLength(MAX_CONNS);
    expect(conns.slice(0, MAX_CONNS).every((c) => !c.closed)).toBe(true);
  });

  it("room for a newcomer again once someone leaves", async () => {
    const { peer } = await openRoom();
    const conns = Array.from({ length: MAX_CONNS }, (_, i) => {
      const c = peer.incoming(`p${i}`);
      c.connect();
      return c;
    });
    conns[0].close();
    const late = peer.incoming("late");
    late.connect();
    expect(late.closed).toBe(false);
  });
});

describe("only the opener does the opener's jobs", () => {
  it("a friend takes introductions ('peers') from the opener only, and never more than the limit", async () => {
    const { peer, opener } = await joinRoom();
    const ids = Array.from({ length: 100 }, (_, i) => `friend-${i}-abcd`);
    // From a stranger: ignored.
    const evil = peer.incoming("evil");
    evil.connect();
    evil.receive({ t: "peers", list: ids });
    expect(peer.dialed).toHaveLength(1); // only the opener we knocked on
    // From the opener: accepted, but bounded and only valid ids.
    opener.receive({ t: "peers", list: ["x", "bad id!", "../../x", "a".repeat(200), ...ids] });
    expect(peer.dialed.length - 1).toBeLessThanOrEqual(MAX_PEERS);
    expect(peer.dialed.slice(1).every((c) => /^[A-Za-z0-9_-]{4,80}$/.test(c.peer))).toBe(true);
  });

  it("an opener never obeys 'peers' from anyone", async () => {
    const { peer } = await openRoom();
    const evil = arrive(peer, "evil");
    evil.receive({ t: "peers", list: ["victim-one-1234", "victim-two-1234"] });
    expect(peer.dialed).toHaveLength(0);
  });

  it("the heartbeat is the opener's: a friend can't steer everyone's film with one", async () => {
    const { h, peer, opener } = await joinRoom();
    const evil = peer.incoming("evil");
    evil.connect();
    evil.receive({ t: "hb", movie: "other-film", time: 3000, playing: true });
    expect(h.playback).not.toHaveBeenCalled();
    opener.receive({ t: "hb", movie: FILM, time: 30, playing: true });
    expect(h.playback).toHaveBeenCalledWith({ movie: FILM, time: 30, playing: true });
  });

  it("a friend's 'state' counts only as an answer to a question we asked", async () => {
    const { h, net, peer } = await joinRoom();
    const friend = peer.incoming("friend");
    friend.connect();
    friend.receive({ t: "state", movie: "other-film", time: 100, playing: true });
    expect(h.playback).not.toHaveBeenCalled(); // nobody asked
    net.send({ t: "ask" });
    friend.receive({ t: "state", movie: FILM, time: 100, playing: true });
    expect(h.playback).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(11_000);
    friend.receive({ t: "state", movie: "other-film", time: 5, playing: false });
    expect(h.playback).toHaveBeenCalledTimes(1); // too late: unsolicited again
  });

  it("a room that just opened doesn't let a newcomer at 0:00 reset the film, but believes a real place", async () => {
    const { h, peer } = await openRoom();
    const guest = arrive(peer, "guest", "Priya");
    guest.receive({ t: "state", movie: "other-film", time: 0, playing: false });
    expect(h.playback).not.toHaveBeenCalled();
    guest.receive({ t: "state", movie: FILM, time: 3600, playing: true });
    expect(h.playback).toHaveBeenCalledWith({ movie: FILM, time: 3600, playing: true });
  });
});

describe("leaving", () => {
  it("destroy() tears everything down: no connection, timer or send is left", async () => {
    const { net, peer } = await openRoom();
    const c = arrive(peer, "friend");
    c.sent.length = 0;
    net.destroy();
    expect(peer.destroyed).toBe(true);
    vi.advanceTimersByTime(60_000);
    expect(c.sent).toEqual([]);
  });
});

describe("greetings", () => {
  it("answers a first hello with our own name, once, and never starts a back-and-forth", async () => {
    const { h, peer } = await openRoom();
    const c = peer.incoming("friend");
    c.connect();
    const before = c.sent.filter((m) => (m as { t?: string }).t === "hello").length; // our greeting on connecting
    c.receive({ t: "hello", name: "Priya" });
    c.receive({ t: "hello", name: "Priya" });
    c.receive({ t: "hello", name: "Priya" });
    const hellos = c.sent.filter((m) => (m as { t?: string }).t === "hello").length - before;
    expect(hellos).toBe(1);
    expect(h.lines.filter((l) => l.text === "Priya joined")).toHaveLength(1);
  });
});

describe("a connection that dies without a goodbye", () => {
  it("is dropped once the network path has been down for a few seconds, so the room notices", async () => {
    const { peer } = await openRoom();
    const c = arrive(peer, "friend");
    c.peerConnection.set("disconnected");
    vi.advanceTimersByTime(5000);
    expect(c.closed).toBe(false); // a blip gets a chance to heal
    vi.advanceTimersByTime(2000);
    expect(c.closed).toBe(true);
  });

  it("is kept if it heals in time", async () => {
    const { peer } = await openRoom();
    const c = arrive(peer, "friend");
    c.peerConnection.set("disconnected");
    vi.advanceTimersByTime(3000);
    c.peerConnection.set("connected");
    vi.advanceTimersByTime(20_000);
    expect(c.closed).toBe(false);
  });

  it("is dropped at once when the connection has failed or closed", async () => {
    const { peer } = await openRoom();
    const a = arrive(peer, "a");
    const b = arrive(peer, "b");
    a.peerConnection.set("failed");
    b.peerConnection.set("closed");
    expect(a.closed && b.closed).toBe(true);
  });

  it("a friend whose opener dies silently takes the room over, and a takeover the broker never answers is retried", async () => {
    const { peer, opener } = await joinRoom();
    opener.peerConnection.set("failed"); // the opener's laptop is shut
    expect(opener.closed).toBe(true);
    await vi.advanceTimersByTimeAsync(2000); // the short random wait before grabbing the room
    const first = fake.FakePeer.all.filter((p) => p.id === HOST_ID && p !== fake.FakePeer.all[0]);
    expect(first).toHaveLength(1); // one attempt to hold the room's id, and the broker never answers it
    await vi.advanceTimersByTimeAsync(13_000);
    expect(first[0].destroyed).toBe(true); // given up, not stuck
    await vi.advanceTimersByTimeAsync(12_000);
    const later = fake.FakePeer.all.filter((p) => p.id === HOST_ID && p !== fake.FakePeer.all[0]);
    expect(later.length).toBeGreaterThanOrEqual(2); // and tried again
    expect(peer.destroyed).toBe(false);
  });
});

describe("a flood of raw traffic", () => {
  it("drops a connection that sends thousands of messages, even ones that are only junk (like null)", async () => {
    const { peer } = await openRoom();
    const evil = arrive(peer, "evil");
    const honest = arrive(peer, "honest", "Priya");
    for (let i = 0; i < 1400; i++) evil.dataChannel.deliver(null);
    expect(evil.closed).toBe(false); // a busy moment is fine
    for (let i = 0; i < 200; i++) evil.dataChannel.deliver(null);
    expect(evil.closed).toBe(true);
    expect(honest.closed).toBe(false);
  });

  it("drops a connection that sends megabytes, however few the messages", async () => {
    const { peer } = await openRoom();
    const evil = arrive(peer, "evil");
    for (let i = 0; i < 3; i++) evil.dataChannel.deliver(new ArrayBuffer(1024 * 1024));
    expect(evil.closed).toBe(false);
    evil.dataChannel.deliver(new ArrayBuffer(2 * 1024 * 1024));
    expect(evil.closed).toBe(true);
  });

  it("forgives a busy moment: the count starts again every ten seconds", async () => {
    const { peer } = await openRoom();
    const c = arrive(peer, "friend");
    for (let round = 0; round < 5; round++) {
      for (let i = 0; i < 1000; i++) c.dataChannel.deliver({ t: "hb" });
      vi.advanceTimersByTime(11_000);
    }
    expect(c.closed).toBe(false);
  });
});
