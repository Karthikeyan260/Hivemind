import type { DataConnection, MediaConnection, Peer } from "peerjs";
import { PEER_OPTIONS } from "@/lib/ice";
import { parseMsg, RateLimiter, MAX_CONNS, MAX_PEERS, type Msg } from "./protocol";

/**
 * The wires of a Friends Theatre room. Browser to browser (WebRTC): PeerJS's free broker introduces people,
 * then everyone is connected to everyone (rooms are small). The room link never changes, and nobody is "the host" by
 * birth: whoever opens the link first takes the room's fixed id (derived from the room code) and is the opener; everyone
 * else knocks on that id. The opener introduces each newcomer to the others and tells them where the film is up to.
 * If the opener leaves, a friend takes the fixed id over (and everyone who is left knocks again), so the same link keeps
 * working: leave and come back, or come back after everyone left, and you are in again.
 * Messages are tiny: play / pause / seek, a heartbeat for drift, chat and reactions. Voice is a call to each friend.
 * The film itself never travels here; each person streams it from YouTube or Wikimedia Commons.
 */
export type { Msg } from "./protocol";

export type Playback = { movie: string; time: number; playing: boolean };

export type NetHooks = {
  people(names: Record<string, string>): void;
  line(who: string, text: string, system: boolean): void;
  react(e: string): void;
  /** Someone pressed "start together": count down 5 to 1, then everyone presses play. */
  count(from: string): void;
  /** A friend picked another film. */
  movie(id: string): void;
  /** Where the film is for everyone else: match it. */
  playback(p: Playback): void;
  play(time: number): void;
  pause(time: number): void;
  seek(time: number): void;
  /** Where the film is for us, so we can tell a newcomer. */
  here(): Playback;
  live(): void;
  fail(message: string): void;
};

/** How often the opener sends the heartbeat, and how often a friend who is not connected to the opener knocks again. */
const BEAT_MS = 4000;
/** A new opener waits this long for friends already watching to say where the film is, before it speaks for the film itself. */
const GRACE_MS = 6000;
/** How long a new opener waits for answers to "where is the film?" before it decides what to believe. */
const ASK_WINDOW_MS = 2500;
/** A friend that has not reached an opener for this many knocks tries to become the opener itself. */
const KNOCKS_BEFORE_CLAIM = 2;
/** A connection that has been "disconnected" this long is dropped (it may heal in a blip, so not at once). */
const DOWN_GRACE_MS = 6000;
/** A takeover attempt the broker never answers is abandoned after this long, so the next knock can try again. */
const CLAIM_TIMEOUT_MS = 12_000;
/** The most one connection may send us in RAW_WINDOW_MS (before anything is parsed): far above any honest room, far below a flood. */
const RAW_WINDOW_MS = 10_000;
const MAX_RAW_MESSAGES = 1500;
const MAX_RAW_BYTES = 4 * 1024 * 1024;

export class TheatreNet {
  private peer: Peer | null = null;
  private conns = new Map<string, DataConnection>();
  private calls = new Map<string, MediaConnection>();
  private audios = new Map<string, HTMLAudioElement>();
  private names: Record<string, string> = Object.create(null);
  private mic: MediaStream | null = null;
  private timers: Array<ReturnType<typeof setInterval> | ReturnType<typeof setTimeout>> = [];
  private Ctor: typeof Peer | null = null;
  private dead = false;
  /** True while we hold the room's fixed id (we are the opener). */
  private opener = false;
  /** An opener who just arrived may not speak for the film until it knows where the others are (see GRACE_MS). */
  private authoritative = true;
  /** The answers to "where is the film?" collected while a new opener is deciding, by who gave them. */
  private answers = new Map<string, { m: Playback; at: number }>();
  private deciding = false;
  /** The answers disagreed, so a new opener believes nobody and stays quiet about the film. */
  private undecided = false;
  private claiming = false;
  private knocks = 0;
  private dialing: { dc: DataConnection; at: number } | null = null;
  /** Who we asked where the film is, and when: an answer counts only from one of them, once, and only shortly after. */
  private asked = new Map<string, number>();
  talking = false;

  constructor(
    private room: string,
    private name: string,
    private hooks: NetHooks,
    private knownMovie: (id: string) => boolean = () => true,
  ) {}

  private limiter = new RateLimiter();

  /** Switch on with `window.__theatreDebug = true` (the end-to-end tests do) to see every connection and message in the console. */
  private get debugOn() {
    return !!(globalThis as { __theatreDebug?: boolean }).__theatreDebug;
  }
  /** Callers check `debugOn` first, so nothing (not even building the arguments) happens when it is off. */
  private dbg(...a: unknown[]) {
    console.debug("[theatre]", this.peer?.id ?? "-", ...a);
  }

  private get hostId() {
    return `hm-theatre-${this.room}`;
  }

  /** Whether this browser is the one holding the room open right now. */
  get isOpener() {
    return this.opener;
  }

  async start() {
    const { default: PeerCtor } = await import("peerjs");
    if (this.dead) return;
    this.Ctor = PeerCtor;
    // First try to be the opener (the fixed id). If someone already is, join them.
    const p = new PeerCtor(this.hostId, PEER_OPTIONS);
    p.on("open", () => {
      if (this.dead) return p.destroy();
      this.peer = p;
      this.adopt(p);
      this.becomeOpener(true);
    });
    p.on("error", (e) => {
      if (e.type === "unavailable-id") {
        p.destroy();
        if (!this.dead) this.joinAsFriend();
        return;
      }
      this.onError(e.type);
    });
    p.on("disconnected", () => this.reconnect(p));
  }

  private onError(type: string) {
    if (type === "peer-unavailable") return; // the opener isn't there (yet); knocking continues
    this.hooks.fail("Couldn't open the theatre. Check your connection and try again.");
  }

  /** The broker dropped us (sleep, a network blip): ask for our id back, so newcomers can still find us. */
  private reconnect(p: Peer) {
    if (this.dead || p.destroyed || !p.disconnected) return;
    try {
      p.reconnect();
    } catch {
      /* the next knock or heartbeat tries again */
    }
  }

  private joinAsFriend() {
    if (this.dead || !this.Ctor) return;
    const p = new this.Ctor(PEER_OPTIONS);
    p.on("open", () => {
      if (this.dead) return p.destroy();
      this.peer = p;
      this.adopt(p);
      this.dial();
      // Knock on the opener's door until it opens, and again whenever we lose it (it may have left).
      this.timers.push(
        setInterval(() => {
          if (this.opener || this.conns.has(this.hostId)) {
            this.knocks = 0;
            return;
          }
          this.dial();
          // Nobody answers: the room may be empty or the opener gone. Take the room over ourselves.
          if (++this.knocks >= KNOCKS_BEFORE_CLAIM) void this.claim();
        }, BEAT_MS),
      );
    });
    p.on("error", (e) => this.onError(e.type));
    p.on("disconnected", () => this.reconnect(p));
  }

  /** The handlers every one of our peers needs. */
  private adopt(p: Peer) {
    p.on("connection", (dc) => this.wire(dc));
    p.on("call", (c) => {
      c.answer(this.mic ?? undefined);
      this.attach(c.peer, c);
    });
  }

  private dial() {
    const p = this.peer;
    if (!p || p.destroyed || this.opener) return;
    // One knock at a time: a connection still being set up gets a few seconds before we try again.
    if (this.dialing && !this.dialing.dc.open && Date.now() - this.dialing.at < BEAT_MS * 2) return;
    this.dialing?.dc.close();
    const dc = p.connect(this.hostId, { reliable: true });
    this.dialing = { dc, at: Date.now() };
    this.wire(dc);
  }

  /** We became the opener (the first to arrive, or the one who took the room over): keep everyone in step. */
  private becomeOpener(fresh: boolean) {
    this.opener = true;
    this.knocks = 0;
    this.hooks.live();
    this.hooks.line("", fresh ? "The room is open. Share the room link and press play when your friends are in." : "You are running the room now. The room link works as before.", true);
    // Arriving first we may be the only one here, or friends already watching may be about to knock: wait to hear where they are.
    this.authoritative = !fresh;
    // (Not if the answers we heard disagreed: then we say nothing about the film until a later round settles it.)
    if (fresh) this.timers.push(setTimeout(() => void (this.undecided || (this.authoritative = true)), GRACE_MS));
    this.timers.push(
      setInterval(() => {
        if (this.authoritative && this.conns.size) this.send({ t: "hb", ...this.hooks.here() });
      }, BEAT_MS),
    );
  }

  /** A new opener asks each newcomer where the film is, then (after a short wait for the answers) decides once. */
  private startDecision() {
    if (this.deciding) return;
    this.deciding = true;
    this.timers.push(setTimeout(() => this.decide(), ASK_WINDOW_MS));
  }

  /**
   * What to believe about the film's place, from the answers we collected. Nobody has anywhere real to be: it is a new
   * room, and we speak for the film. Otherwise we believe the place that most answerers agree on, and only if that is
   * more than half of them: one hostile newcomer can't move the film of a room whose friends say otherwise, and when the
   * answers split evenly we believe nobody and say nothing about the film (a later newcomer's answer can settle it).
   */
  private decide() {
    this.deciding = false;
    const answers = [...this.answers.values()];
    this.answers.clear();
    this.asked.clear(); // the window for answers is over: a late "answer" no longer counts
    if (this.authoritative || this.dead) return;
    const now = Date.now();
    // A film that was playing has moved on since the answer was given.
    const list = answers.map(({ m, at }) => ({ ...m, time: m.playing ? m.time + (now - at) / 1000 : m.time }));
    // Only a place somebody really got to counts as a place (a friend who just arrived is at 0:00), but every answerer
    // counts in the vote: someone with nothing to report is a vote against a forged place.
    const real = list.filter((a) => a.playing || a.time > 2);
    if (real.length === 0) {
      this.undecided = false;
      this.authoritative = true;
      this.send({ t: "state", ...this.hooks.here() });
      return;
    }
    let best: Playback[] = [];
    for (const a of real) {
      const agree = real.filter((b) => b.movie === a.movie && Math.abs(b.time - a.time) <= 15);
      if (agree.length > best.length) best = agree;
    }
    if (best.length * 2 > list.length) {
      this.undecided = false;
      this.authoritative = true;
      this.hooks.playback(best[0]);
    } else {
      this.undecided = true;
      if (this.debugOn) this.dbg("answers disagree, believing nobody");
    }
  }

  /**
   * The opener is gone: try to hold the room's fixed id. A second peer is made first, so if somebody else wins the race
   * we lose nothing; if we win we swap it in for our own id (friends then knock on it and connect again).
   */
  private async claim() {
    if (this.claiming || this.opener || this.dead || !this.Ctor) return;
    this.claiming = true;
    // Several friends notice at once: a short random wait keeps them from all grabbing at the same moment.
    await new Promise((r) => this.timers.push(setTimeout(r, Math.random() * 1500)));
    if (this.dead || this.opener || this.conns.has(this.hostId)) {
      this.claiming = false;
      return;
    }
    const c = new this.Ctor(this.hostId, PEER_OPTIONS);
    // A broker that never answers must not block every later attempt: give up on this one after a while.
    const giveUp = setTimeout(() => {
      if (!this.claiming) return;
      this.claiming = false;
      c.destroy();
    }, CLAIM_TIMEOUT_MS);
    this.timers.push(giveUp);
    c.on("open", () => {
      clearTimeout(giveUp);
      this.claiming = false;
      if (this.dead || this.opener) return c.destroy();
      const old = this.peer;
      this.peer = c;
      this.adopt(c);
      c.on("disconnected", () => this.reconnect(c));
      // Our old id goes: the friends we were connected to see that, then knock on the room id (which is us now).
      this.dialing = null;
      old?.destroy();
      if (this.debugOn) this.dbg("took the room over");
      this.becomeOpener(false);
    });
    c.on("error", (e) => {
      clearTimeout(giveUp);
      if (e.type === "unavailable-id") {
        this.claiming = false; // someone else is the opener already: the next knock finds them
        c.destroy();
      } else if (e.type !== "peer-unavailable") {
        this.claiming = false;
        c.destroy();
      }
    });
  }

  send(m: Msg, to?: DataConnection) {
    if (m.t === "ask") {
      const now = Date.now();
      for (const c of to ? [to] : this.conns.values()) if (c.open) this.asked.set(c.peer, now);
    }
    if (to) {
      if (to.open) to.send(m);
      return;
    }
    if (this.debugOn)
      this.dbg(
        "send",
        m.t,
        "to",
        [...this.conns.values()].filter((c) => c.open).map((c) => c.peer),
      );
    for (const c of this.conns.values()) if (c.open) c.send(m);
  }

  /**
   * A friend who closes the tab says goodbye; one whose network dies (a closed laptop, a killed app, a lost signal) says
   * nothing, and the connection looks open for a long time. Watch the WebRTC connection itself and drop it once it has
   * been down for a few seconds, so the room notices, and a friend can take the room over, in about ten seconds.
   */
  private watch(dc: DataConnection) {
    const pc = (dc as unknown as { peerConnection?: RTCPeerConnection }).peerConnection;
    if (!pc || typeof pc.addEventListener !== "function") return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const dead = () => ["failed", "closed", "disconnected"].includes(pc.iceConnectionState) || ["failed", "closed"].includes(pc.connectionState);
    const check = () => {
      const state = pc.iceConnectionState;
      if (state === "failed" || state === "closed" || pc.connectionState === "failed") {
        dc.close();
      } else if (state === "disconnected") {
        // "disconnected" can heal by itself (a blip): give it a few seconds before giving up.
        timer ??= setTimeout(() => {
          timer = null;
          if (dead()) dc.close();
        }, DOWN_GRACE_MS);
        this.timers.push(timer);
      } else if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    };
    pc.addEventListener("iceconnectionstatechange", check);
    pc.addEventListener("connectionstatechange", check);
  }

  /**
   * Counts everything that arrives on a connection, before any of it is understood. Our own limits (see RateLimiter) only
   * apply to messages that parse; a peer can also send junk that PeerJS itself chokes on, or a flood of tiny messages.
   * Honest traffic is a few messages every few seconds, so a connection that sends thousands, or megabytes, is dropped.
   */
  private guard(dc: DataConnection) {
    const ch = (dc as unknown as { dataChannel?: RTCDataChannel }).dataChannel;
    if (!ch || typeof ch.addEventListener !== "function") return;
    let count = 0;
    let bytes = 0;
    let since = Date.now();
    ch.addEventListener("message", (e: MessageEvent) => {
      const now = Date.now();
      if (now - since > RAW_WINDOW_MS) {
        count = 0;
        bytes = 0;
        since = now;
      }
      const d = e.data as { byteLength?: number; size?: number; length?: number } | string | null;
      count++;
      bytes += d === null || d === undefined ? 0 : typeof d === "string" ? d.length : (d.byteLength ?? d.size ?? d.length ?? 0);
      if (count > MAX_RAW_MESSAGES || bytes > MAX_RAW_BYTES) {
        if (this.debugOn) this.dbg("flood, dropping", dc.peer, count, bytes);
        dc.close();
      }
    });
  }

  private wire(dc: DataConnection) {
    dc.on("open", () => {
      // The link is public: nobody may fill the room with connections. Past the limit, newcomers are turned away.
      if (!this.conns.has(dc.peer) && this.conns.size >= MAX_CONNS) {
        if (this.debugOn) this.dbg("room full, refusing", dc.peer);
        dc.close();
        return;
      }
      this.conns.set(dc.peer, dc);
      this.watch(dc);
      this.guard(dc);
      if (this.debugOn) this.dbg("open", dc.peer);
      this.knocks = 0;
      dc.send({ t: "hello", name: this.name } satisfies Msg);
      this.hooks.live();
    });
    dc.on("data", (d) => this.handle(dc, d));
    const gone = () => {
      if (this.debugOn) this.dbg("close", dc.peer, this.conns.get(dc.peer) === dc ? "(current)" : "(stale)");
      if (this.conns.get(dc.peer) !== dc) return;
      this.conns.delete(dc.peer);
      this.limiter.forget(dc.peer);
      this.calls.get(dc.peer)?.close();
      const nm = this.names[dc.peer];
      delete this.names[dc.peer];
      this.hooks.people({ ...this.names });
      if (nm) this.hooks.line("", `${nm} left`, true);
      // The opener left: friends keep watching each other, and one of us takes the room over.
      if (dc.peer === this.hostId && !this.opener && !this.dead) {
        this.knocks = KNOCKS_BEFORE_CLAIM;
        void this.claim();
      }
    };
    dc.on("close", gone);
    dc.on("error", gone);
  }

  private who(id: string) {
    return this.names[id] || "Friend";
  }

  private handle(dc: DataConnection, raw: unknown) {
    // Everything from the wire is untrusted: only well-formed messages within their allowance get through.
    const m = parseMsg(raw, this.knownMovie);
    if (!m || !this.limiter.allow(dc.peer, m.t, Date.now())) {
      if (this.debugOn) {
        let kind: unknown;
        try {
          kind = (raw as { t?: unknown } | null)?.t; // a hostile object may have a property that throws
        } catch {
          kind = "?";
        }
        this.dbg("dropped", kind, "from", dc.peer, m ? "(too many)" : "(malformed)");
      }
      return;
    }
    const id = dc.peer;
    const h = this.hooks;
    if (this.debugOn) this.dbg("got", m.t, "from", id);
    switch (m.t) {
      case "hello": {
        const nm = m.name;
        const first = !this.names[id];
        this.names[id] = nm;
        h.people({ ...this.names });
        if (first) {
          h.line("", `${nm} joined`, true);
          // The first time we hear from someone, answer with our own name once more: if our greeting on connecting got lost
          // they would otherwise never know who we are (they answer only when they don't know us yet, so this can't loop).
          if (dc.open) dc.send({ t: "hello", name: this.name } satisfies Msg);
        }
        if (this.opener) {
          this.send({ t: "peers", list: [...this.conns.keys()].filter((k) => k !== id) }, dc);
          // A fresh opener doesn't know the film's place yet: ask the newcomer (who may have been watching for an hour).
          if (this.authoritative) this.send({ t: "state", ...h.here() }, dc);
          else {
            this.send({ t: "ask" }, dc);
            this.startDecision();
          }
        }
        if (this.talking) this.callPeer(id);
        break;
      }
      case "peers": {
        // Only the opener introduces people. From anyone else this could send us off to connect to ids of its choosing.
        if (id !== this.hostId || this.opener) break;
        const p = this.peer;
        if (!p) break;
        for (const other of m.list.slice(0, MAX_PEERS)) if (other !== p.id && !this.conns.has(other)) this.wire(p.connect(other, { reliable: true }));
        break;
      }
      case "state":
      case "hb": {
        // The heartbeat is the opener's alone. A "state" is the answer to "where is the film": from the opener, or from a friend we just asked.
        if (m.t === "hb") {
          if (id !== this.hostId) break;
        } else if (id !== this.hostId) {
          // From a friend: only the answer to a question we put to that very friend, once, and soon after.
          const at = this.asked.get(id);
          this.asked.delete(id);
          if (at === undefined || Date.now() - at > 10_000) break;
        }
        // Until we know where the film is, we only collect answers (see decide()): a friend who just arrived is at 0:00,
        // and one answer alone, from someone we know nothing about, is not enough to move everybody's film.
        if (this.opener && !this.authoritative) {
          // (an answer from someone who is only at 0:00 is kept too: it counts as saying "nothing to report", against a forged place)
          if (this.answers.size < MAX_CONNS) this.answers.set(id, { m: { movie: m.movie, time: m.time, playing: m.playing }, at: Date.now() });
          break;
        }
        h.playback({ movie: m.movie, time: m.time, playing: m.playing });
        break;
      }
      case "ask":
        // Only say where the film is when we know: a fresh opener that has not heard from anyone must not reset the room.
        if (this.authoritative) this.send({ t: "state", ...h.here() }, dc);
        break;
      case "play":
        h.play(m.time);
        break;
      case "pause":
        h.pause(m.time);
        break;
      case "seek":
        h.seek(m.time);
        break;
      case "movie":
        h.movie(m.id);
        h.line("", `${this.who(id)} picked another film`, true);
        break;
      case "chat":
        h.line(this.who(id), m.text, false);
        break;
      case "react":
        h.react(m.e);
        break;
      case "count":
        h.count(this.who(id));
        break;
    }
  }

  private attach(id: string, c: MediaConnection) {
    this.calls.get(id)?.close();
    this.calls.set(id, c);
    c.on("stream", (s) => {
      let a = this.audios.get(id);
      if (!a) {
        a = new Audio();
        this.audios.set(id, a);
      }
      a.srcObject = s;
      void a.play().catch(() => {});
    });
    c.on("close", () => {
      if (this.calls.get(id) === c) this.calls.delete(id);
      const a = this.audios.get(id);
      if (a) a.srcObject = null;
    });
  }

  private callPeer(id: string) {
    if (!this.peer || !this.mic) return;
    this.attach(id, this.peer.call(id, this.mic));
  }

  /** Turns the microphone on or off; returns whether it is on now (false too when the mic is refused). */
  async toggleVoice(): Promise<boolean> {
    if (this.talking) {
      this.talking = false;
      this.mic?.getTracks().forEach((t) => t.stop());
      this.mic = null;
      for (const c of this.calls.values()) c.close();
      return false;
    }
    try {
      this.mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch {
      return false;
    }
    this.talking = true;
    for (const id of this.conns.keys()) this.callPeer(id);
    return true;
  }

  destroy() {
    this.dead = true;
    this.timers.forEach((t) => {
      clearInterval(t as ReturnType<typeof setInterval>);
      clearTimeout(t as ReturnType<typeof setTimeout>);
    });
    for (const c of this.calls.values()) c.close();
    for (const a of this.audios.values()) a.srcObject = null;
    this.mic?.getTracks().forEach((t) => t.stop());
    this.peer?.destroy();
    this.peer = null;
    this.conns.clear();
  }
}
