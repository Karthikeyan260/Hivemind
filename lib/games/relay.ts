/**
 * Game messages through Supabase Realtime when two browsers can't reach each other directly.
 *
 * Game night and friend games are peer-to-peer (PeerJS / WebRTC). When a direct path isn't possible
 * (mobile data, strict Wi-Fi) WebRTC needs a TURN relay, and free relays run out or disappear. Game
 * messages are tiny, so this carries them over a Supabase Realtime broadcast channel instead: no
 * relay, no extra service. Voice still needs a direct path (audio can't go this way).
 *
 * A RelayConn looks like a PeerJS DataConnection (open, send, close, on data/open/close/error), so
 * the game code above it is unchanged: friends still check the table is really the owner's
 * (lib/peer-auth) and the owner's side still checks every move.
 *
 * Everyone with the link can listen on the channel, so each connection is end-to-end encrypted:
 * both sides make a fresh ECDH (P-256) key pair, derive an AES-GCM key, and every message carries
 * its connection id, direction and a counter as authenticated data. Other friends on the channel
 * can't read another player's private view (their cards), forge a move, or replay an old one.
 */

export type Frame =
  | { k: "syn"; c: string; pub: string } // friend → table: a new connection and the friend's public key
  | { k: "ack"; c: string; pub: string } // table → friend: the table's public key
  | { k: "d"; c: string; from: "g" | "h"; n: number; iv: string; x: string } // an encrypted message
  | { k: "fin"; c: string; from: "g" | "h" }; // closed

/** One broadcast channel: everyone on it gets every frame (but can only read their own). */
export interface Bus {
  send(f: Frame): void;
  onFrame(fn: (f: Frame) => void): () => void;
  close(): void;
}

type Ev = "data" | "open" | "close" | "error";
const SYN_EVERY_MS = 2000;
const GIVE_UP_MS = 20_000;
/** Supabase's broadcast limit is 256 KB; leave room for the envelope. */
const MAX_FRAME = 200_000;

const b64 = (u: ArrayBuffer | Uint8Array) => {
  const a = u instanceof Uint8Array ? u : new Uint8Array(u);
  let s = "";
  for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode(...a.subarray(i, i + 0x8000));
  return btoa(s);
};
const unb64 = (s: string) => Uint8Array.from(atob(s), (ch) => ch.charCodeAt(0));
const rid = () => b64(crypto.getRandomValues(new Uint8Array(16))).replace(/[^a-z0-9]/gi, "").slice(0, 20);
const subtle = () => globalThis.crypto.subtle;

async function keyPair() {
  const kp = await subtle().generateKey({ name: "ECDH", namedCurve: "P-256" }, false, ["deriveKey"]);
  return { kp, pub: b64(await subtle().exportKey("raw", kp.publicKey)) };
}
async function shared(mine: CryptoKeyPair, theirs: string) {
  const pub = await subtle().importKey("raw", unb64(theirs), { name: "ECDH", namedCurve: "P-256" }, false, []);
  return subtle().deriveKey({ name: "ECDH", public: pub }, mine.privateKey, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
const aad = (c: string, from: string, n: number) => new TextEncoder().encode(`${c}|${from}|${n}`);

/** One side of one encrypted connection. Shaped like PeerJS's DataConnection for the parts the games use. */
export class RelayConn {
  open = false;
  readonly peer: string;
  readonly metadata = { relay: true };
  private key: CryptoKey | null = null;
  private sent = 0;
  private got = 0;
  private queue: Promise<void> = Promise.resolve();
  private handlers: Record<Ev, ((x?: unknown) => void)[]> = { data: [], open: [], close: [], error: [] };
  private done = false;

  constructor(
    readonly id: string,
    private readonly side: "g" | "h",
    private readonly bus: Bus,
    peer: string,
    private readonly onEnd: () => void,
  ) {
    this.peer = peer;
  }

  on(ev: Ev, fn: (x?: unknown) => void) {
    this.handlers[ev].push(fn);
    return this;
  }
  private emit(ev: Ev, x?: unknown) {
    for (const fn of this.handlers[ev]) {
      try {
        fn(x);
      } catch (e) {
        console.warn("relay handler:", e);
      }
    }
  }

  /** @internal the shared key is ready: the connection is open. */
  ready(key: CryptoKey) {
    if (this.done || this.key) return;
    this.key = key;
    this.open = true;
    this.emit("open");
  }

  send(m: unknown) {
    if (!this.open || !this.key || this.done) return;
    const key = this.key;
    const n = ++this.sent;
    // In order: each message waits for the one before it to be encrypted and sent.
    this.queue = this.queue.then(async () => {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const x = b64(await subtle().encrypt({ name: "AES-GCM", iv, additionalData: aad(this.id, this.side, n) }, key, new TextEncoder().encode(JSON.stringify(m))));
      if (x.length > MAX_FRAME) return void console.warn("relay: a message too big to send was dropped");
      if (!this.done) this.bus.send({ k: "d", c: this.id, from: this.side, n, iv: b64(iv), x });
    });
  }

  /** @internal an encrypted frame for this connection, from the other side. */
  async take(f: Extract<Frame, { k: "d" }>) {
    if (!this.key || this.done || f.from === this.side) return;
    // Replays and old frames: only a higher counter than the last one counts.
    if (!Number.isInteger(f.n) || f.n <= this.got) return;
    try {
      const plain = await subtle().decrypt({ name: "AES-GCM", iv: unb64(f.iv), additionalData: aad(this.id, f.from, f.n) }, this.key, unb64(f.x));
      if (f.n <= this.got) return;
      this.got = f.n;
      this.emit("data", JSON.parse(new TextDecoder().decode(plain)));
    } catch {
      // Not ours, tampered with, or garbled: ignore it.
    }
  }

  close() {
    if (this.done) return;
    this.bus.send({ k: "fin", c: this.id, from: this.side });
    this.end();
  }
  /** @internal the other side closed, or it never answered. */
  end(err?: boolean) {
    if (this.done) return;
    this.done = true;
    this.open = false;
    if (err) this.emit("error", new Error("relay: no answer"));
    this.emit("close");
    this.onEnd();
  }
}

/**
 * The table (host): answers friends who come in over the relay. `onConnection` gets each new
 * connection just like PeerJS's peer.on("connection"); it opens once the keys are agreed.
 */
export function relayHost(bus: Bus, onConnection: (c: RelayConn) => void) {
  const conns = new Map<string, { conn: RelayConn; pub: string; key: Promise<CryptoKey> }>();
  // One key pair for the table's life; each friend's key differs (theirs is fresh), so each connection's key does too.
  const mine = keyPair();
  const off = bus.onFrame(async (f) => {
    if (!f || typeof f !== "object" || typeof f.c !== "string" || f.c.length > 40) return;
    if (f.k === "syn" && typeof f.pub === "string" && f.pub.length < 200) {
      const known = conns.get(f.c);
      if (known) {
        // The friend didn't hear the answer yet: say it again (same key).
        if (known.pub === f.pub) {
          const { pub } = await mine;
          bus.send({ k: "ack", c: f.c, pub });
        }
        return;
      }
      const conn = new RelayConn(f.c, "h", bus, `relay-${f.c}`, () => conns.delete(f.c));
      const key = mine.then(({ kp }) => shared(kp, f.pub));
      conns.set(f.c, { conn, pub: f.pub, key });
      onConnection(conn);
      try {
        const k = await key;
        const { pub } = await mine;
        bus.send({ k: "ack", c: f.c, pub });
        conn.ready(k);
      } catch {
        conns.delete(f.c);
      }
      return;
    }
    const entry = conns.get(f.c);
    if (!entry) return;
    if (f.k === "d" && f.from === "g") void entry.conn.take(f);
    else if (f.k === "fin" && f.from === "g") entry.conn.end();
  });
  return {
    close() {
      off();
      for (const { conn } of [...conns.values()]) conn.close();
      conns.clear();
      bus.close();
    },
  };
}

/** A friend: one connection to the table over the relay. Like peer.connect(): returns at once, emits "open" when ready. */
export function relayConnect(bus: Bus): RelayConn {
  const c = rid();
  let timer: ReturnType<typeof setInterval> | undefined;
  let stopped = false;
  const stop = () => {
    stopped = true;
    clearInterval(timer);
    clearTimeout(giveUp);
    off();
    bus.close();
  };
  const conn = new RelayConn(c, "g", bus, "relay-host", stop);
  const mine = keyPair();
  // The table always answers on the channel. Two different answers for one connection means someone else
  // on the channel answered too (to sit in the middle): drop it, the friend dials again.
  let answer: string | null = null;
  const off = bus.onFrame(async (f) => {
    if (!f || typeof f !== "object" || f.c !== c) return;
    if (f.k === "ack" && typeof f.pub === "string") {
      if (answer !== null) {
        if (f.pub !== answer) conn.end(true);
        return;
      }
      answer = f.pub;
      try {
        const key = await shared((await mine).kp, f.pub);
        clearInterval(timer);
        clearTimeout(giveUp);
        conn.ready(key);
      } catch {
        conn.end(true);
      }
    } else if (f.k === "d" && f.from === "h") void conn.take(f);
    else if (f.k === "fin" && f.from === "h") conn.end();
  });
  // Counted from the moment of dialling: no table answer by then, it failed (the game dials again).
  const giveUp = setTimeout(() => !conn.open && conn.end(true), GIVE_UP_MS);
  void mine.then(({ pub }) => {
    // Closed before the key was even ready: don't start knocking.
    if (conn.open || stopped) return;
    const syn = () => !conn.open && bus.send({ k: "syn", c, pub });
    syn();
    timer = setInterval(syn, SYN_EVERY_MS);
  });
  return conn;
}

/* ── Supabase Realtime as the bus ── */

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
/** Is the relay set up (the project's public key is configured)? Without it, games work exactly as before. */
export const relayAvailable = () => !!(URL_ && KEY) && typeof window !== "undefined" && !!globalThis.crypto?.subtle;

type RtClient = { channel: (name: string, o?: unknown) => RtChannel; removeChannel: (c: RtChannel) => unknown };
type RtChannel = { on: (t: string, f: { event: string }, cb: (m: { payload: Frame }) => void) => RtChannel; subscribe: (cb?: (s: string) => void) => RtChannel; send: (m: { type: string; event: string; payload: Frame }) => unknown };
let client: Promise<RtClient> | null = null;
async function rt(): Promise<RtClient> {
  client ??= import("@supabase/supabase-js").then(({ createClient }) => createClient(URL_!, KEY!, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }) as unknown as RtClient);
  return client;
}

/** A broadcast channel for one table (the PeerJS host id: it already holds the room's secret). Frames sent before it's joined wait. */
export function supabaseBus(table: string): Bus {
  const fns = new Set<(f: Frame) => void>();
  let ch: RtChannel | null = null;
  let joined = false;
  let closed = false;
  const waiting: Frame[] = [];
  void rt().then((sb) => {
    if (closed) return;
    ch = sb
      .channel(`hm-relay:${table}`, { config: { broadcast: { self: false, ack: false } } })
      .on("broadcast", { event: "f" }, ({ payload }) => fns.forEach((fn) => fn(payload)))
      .subscribe((status) => {
        if (status !== "SUBSCRIBED") return;
        joined = true;
        for (const f of waiting.splice(0)) void ch?.send({ type: "broadcast", event: "f", payload: f });
      });
  });
  return {
    send(f) {
      if (closed) return;
      if (joined && ch) void ch.send({ type: "broadcast", event: "f", payload: f });
      else if (waiting.length < 50) waiting.push(f);
    },
    onFrame(fn) {
      fns.add(fn);
      return () => fns.delete(fn);
    },
    close() {
      closed = true;
      fns.clear();
      if (ch) void rt().then((sb) => sb.removeChannel(ch!));
    },
  };
}
