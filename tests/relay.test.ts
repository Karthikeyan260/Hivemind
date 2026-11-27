import { describe, expect, it, vi } from "vitest";
import { type Bus, type Frame, type RelayConn, relayConnect, relayHost } from "@/lib/games/relay";

/** A broadcast channel in memory: every frame goes to everyone else on it (like Supabase with self: false). */
function channel() {
  const members = new Set<{ fn: Set<(f: Frame) => void> }>();
  const log: Frame[] = [];
  const join = (): Bus & { spy: Frame[] } => {
    const me = { fn: new Set<(f: Frame) => void>() };
    members.add(me);
    const spy: Frame[] = [];
    return {
      spy,
      send(f) {
        log.push(f);
        const copy = JSON.parse(JSON.stringify(f)) as Frame;
        queueMicrotask(() => members.forEach((m) => m !== me && m.fn.forEach((fn) => fn(copy))));
      },
      onFrame(fn) {
        const wrap = (f: Frame) => {
          spy.push(f);
          fn(f);
        };
        me.fn.add(wrap);
        return () => me.fn.delete(wrap);
      },
      close() {
        members.delete(me);
      },
    };
  };
  return { join, log };
}

// Real WebCrypto work runs between frames: give it room even when the whole suite runs in parallel.
const settle = () => new Promise((r) => setTimeout(r, 300));
const opened = (c: RelayConn) => new Promise<void>((ok) => (c.open ? ok() : c.on("open", () => ok())));

describe("game relay over a broadcast channel", () => {
  it("connects a friend to the table and carries messages both ways, in order", async () => {
    const ch = channel();
    const atTable: unknown[] = [];
    let hostSide: RelayConn | null = null;
    const host = relayHost(ch.join(), (c) => {
      hostSide = c;
      c.on("data", (d) => atTable.push(d));
    });
    const friend = relayConnect(ch.join());
    const atFriend: unknown[] = [];
    friend.on("data", (d) => atFriend.push(d));
    await opened(friend);
    expect(friend.open).toBe(true);
    for (let i = 0; i < 5; i++) friend.send({ t: "act", a: i });
    await settle();
    expect(atTable).toEqual([0, 1, 2, 3, 4].map((a) => ({ t: "act", a })));
    hostSide!.send({ t: "state", s: { cards: [3, 7] } });
    await settle();
    expect(atFriend).toEqual([{ t: "state", s: { cards: [3, 7] } }]);
    host.close();
  });

  it("keeps each friend's messages private from the other friends on the channel", async () => {
    const ch = channel();
    const tableConns: RelayConn[] = [];
    relayHost(ch.join(), (c) => tableConns.push(c));
    const ann = relayConnect(ch.join());
    const bob = relayConnect(ch.join());
    const annGot: unknown[] = [];
    const bobGot: unknown[] = [];
    ann.on("data", (d) => annGot.push(d));
    bob.on("data", (d) => bobGot.push(d));
    await Promise.all([opened(ann), opened(bob)]);
    await settle();
    expect(tableConns).toHaveLength(2);
    // The table sends each friend only their own hand.
    tableConns[0].send({ hand: "ANN-SECRET" });
    tableConns[1].send({ hand: "BOB-SECRET" });
    await settle();
    expect([...annGot, ...bobGot]).toHaveLength(2);
    expect(JSON.stringify(annGot).includes("BOB")).toBe(false);
    expect(JSON.stringify(bobGot).includes("ANN")).toBe(false);
    // Nothing on the channel itself shows the cards: it's all ciphertext.
    expect(JSON.stringify(ch.log).includes("SECRET")).toBe(false);
  });

  it("ignores a forged move and a replayed one", async () => {
    const ch = channel();
    const atTable: unknown[] = [];
    relayHost(ch.join(), (c) => c.on("data", (d) => atTable.push(d)));
    const friend = relayConnect(ch.join());
    await opened(friend);
    friend.send({ move: "real" });
    await settle();
    expect(atTable).toEqual([{ move: "real" }]);
    const real = ch.log.find((f): f is Extract<Frame, { k: "d" }> => f.k === "d" && f.from === "g")!;
    const eve = ch.join();
    // Replay the same frame: same counter, so it's dropped.
    eve.send(real);
    // A forged one with a higher counter but garbage inside: fails to decrypt, dropped.
    eve.send({ ...real, n: real.n + 5, x: btoa("not really encrypted") });
    // Someone else's copy re-labelled with a higher counter: the counter is authenticated, so it fails too.
    eve.send({ ...real, n: real.n + 1 });
    await settle();
    expect(atTable).toEqual([{ move: "real" }]);
  });

  it("drops the connection when someone else on the channel also answers for the table", async () => {
    const ch = channel();
    relayHost(ch.join(), () => {});
    const eve = ch.join();
    // Eve answers every new connection with her own key, hoping to sit in the middle.
    eve.onFrame(async (f) => {
      if (f.k !== "syn") return;
      const kp = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveKey"]);
      const raw = new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey));
      eve.send({ k: "ack", c: f.c, pub: btoa(String.fromCharCode(...raw)) });
    });
    const friend = relayConnect(ch.join());
    const errors: unknown[] = [];
    let closed = false;
    friend.on("error", (e) => errors.push(e));
    friend.on("close", () => (closed = true));
    await settle();
    await settle();
    expect(closed).toBe(true);
    expect(errors.length).toBe(1);
  });

  it("gives up with an error when no table answers", async () => {
    vi.useFakeTimers();
    try {
      const ch = channel();
      const friend = relayConnect(ch.join());
      let err = false;
      friend.on("error", () => (err = true));
      await vi.advanceTimersByTimeAsync(21_000);
      expect(err).toBe(true);
      expect(friend.open).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("tells the other side when a connection is closed", async () => {
    const ch = channel();
    let hostSide: RelayConn | null = null;
    relayHost(ch.join(), (c) => (hostSide = c));
    const friend = relayConnect(ch.join());
    await opened(friend);
    await settle();
    let hostSawClose = false;
    hostSide!.on("close", () => (hostSawClose = true));
    friend.close();
    await settle();
    expect(hostSawClose).toBe(true);
    expect(hostSide!.open).toBe(false);
    // Sending after close does nothing (no throw).
    friend.send({ late: true });
  });
});
