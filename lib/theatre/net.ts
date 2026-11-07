import type { DataConnection, MediaConnection, Peer } from "peerjs";
import { PEER_OPTIONS } from "@/lib/ice";

/**
 * The wires of a Friends Theatre room. Browser to browser (WebRTC): PeerJS's free broker introduces people,
 * then everyone is connected to everyone (rooms are small). The room's opener has a fixed id derived from the
 * room code, so friends know where to knock; the opener introduces each newcomer to the others and tells them
 * where the film is up to. Messages are tiny: play / pause / seek, a heartbeat for drift, chat and reactions.
 * Voice is a call to each friend. The film itself never travels here; each person streams it from Wikimedia Commons.
 */
export type Msg =
  | { t: "hello"; name: string }
  | { t: "peers"; list: string[] }
  | { t: "state"; movie: string; time: number; playing: boolean }
  | { t: "ask" }
  | { t: "play"; time: number }
  | { t: "pause"; time: number }
  | { t: "seek"; time: number }
  | { t: "movie"; id: string }
  | { t: "hb"; movie: string; time: number; playing: boolean }
  | { t: "chat"; text: string }
  | { t: "react"; e: string }
  | { t: "count" };

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

export class TheatreNet {
  private peer: Peer | null = null;
  private conns = new Map<string, DataConnection>();
  private calls = new Map<string, MediaConnection>();
  private audios = new Map<string, HTMLAudioElement>();
  private names: Record<string, string> = {};
  private mic: MediaStream | null = null;
  private timers: Array<ReturnType<typeof setInterval>> = [];
  private dead = false;
  talking = false;

  constructor(
    private room: string,
    private isHost: boolean,
    private name: string,
    private hooks: NetHooks,
  ) {}

  private get hostId() {
    return `hm-theatre-${this.room}`;
  }

  async start() {
    const { default: PeerCtor } = await import("peerjs");
    if (this.dead) return;
    const p = this.isHost ? new PeerCtor(this.hostId, PEER_OPTIONS) : new PeerCtor(PEER_OPTIONS);
    this.peer = p;
    p.on("connection", (dc) => this.wire(dc));
    p.on("call", (c) => {
      c.answer(this.mic ?? undefined);
      this.attach(c.peer, c);
    });
    p.on("open", () => {
      if (this.isHost) {
        this.hooks.live();
        this.hooks.line("", "The room is open. Share the invite link and press play when your friends are in.", true);
        // The opener keeps everyone in step: a heartbeat of where the film is.
        this.timers.push(
          setInterval(() => {
            if (this.conns.size) this.send({ t: "hb", ...this.hooks.here() });
          }, 4000),
        );
        return;
      }
      // A friend: knock on the opener's door until it opens (the room may not be open yet).
      const dial = () => this.wire(p.connect(this.hostId, { reliable: true }));
      dial();
      this.timers.push(
        setInterval(() => {
          if (this.conns.size === 0) dial();
        }, 4000),
      );
    });
    p.on("error", (e) => {
      if (e.type === "peer-unavailable") return; // the opener isn't there yet; knocking continues
      this.hooks.fail(e.type === "unavailable-id" ? "This room is already open in another tab." : "Couldn't open the theatre. Check your connection and try again.");
    });
  }

  send(m: Msg, to?: DataConnection) {
    if (to) {
      if (to.open) to.send(m);
      return;
    }
    for (const c of this.conns.values()) if (c.open) c.send(m);
  }

  private wire(dc: DataConnection) {
    dc.on("open", () => {
      this.conns.set(dc.peer, dc);
      dc.send({ t: "hello", name: this.name } satisfies Msg);
      this.hooks.live();
    });
    dc.on("data", (d) => this.handle(dc, d));
    const gone = () => {
      if (this.conns.get(dc.peer) !== dc) return;
      this.conns.delete(dc.peer);
      this.calls.get(dc.peer)?.close();
      const nm = this.names[dc.peer];
      delete this.names[dc.peer];
      this.hooks.people({ ...this.names });
      if (nm) this.hooks.line("", `${nm} left`, true);
    };
    dc.on("close", gone);
    dc.on("error", gone);
  }

  private who(id: string) {
    return this.names[id] || "Friend";
  }

  private handle(dc: DataConnection, raw: unknown) {
    const m = raw as Msg;
    if (!m || typeof m !== "object") return;
    const id = dc.peer;
    const h = this.hooks;
    switch (m.t) {
      case "hello": {
        const nm = String(m.name || "Friend").slice(0, 24);
        this.names[id] = nm;
        h.people({ ...this.names });
        h.line("", `${nm} joined`, true);
        if (this.isHost) {
          this.send({ t: "peers", list: [...this.conns.keys()].filter((k) => k !== id) }, dc);
          this.send({ t: "state", ...h.here() }, dc);
        }
        if (this.talking) this.callPeer(id);
        break;
      }
      case "peers": {
        const p = this.peer;
        if (!p) break;
        for (const other of m.list.slice(0, 8)) if (other !== p.id && !this.conns.has(other)) this.wire(p.connect(other, { reliable: true }));
        break;
      }
      case "state":
      case "hb":
        h.playback({ movie: String(m.movie), time: Number(m.time) || 0, playing: !!m.playing });
        break;
      case "ask":
        this.send({ t: "state", ...h.here() }, dc);
        break;
      case "play":
        h.play(Number(m.time) || 0);
        break;
      case "pause":
        h.pause(Number(m.time) || 0);
        break;
      case "seek":
        h.seek(Number(m.time) || 0);
        break;
      case "movie":
        h.movie(String(m.id));
        h.line("", `${this.who(id)} picked another film`, true);
        break;
      case "chat":
        h.line(this.who(id), String(m.text).slice(0, 400), false);
        break;
      case "react":
        h.react(String(m.e).slice(0, 4));
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
    this.timers.forEach(clearInterval);
    for (const c of this.calls.values()) c.close();
    for (const a of this.audios.values()) a.srcObject = null;
    this.mic?.getTracks().forEach((t) => t.stop());
    this.peer?.destroy();
    this.peer = null;
    this.conns.clear();
  }
}
