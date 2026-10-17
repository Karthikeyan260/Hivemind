"use client";

import type { DataConnection, MediaConnection, Peer } from "peerjs";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { checkHost, proveHost } from "@/lib/peer-auth";
import { callsFirst, cleanId, cleanName, isReaction, REACT_GAP_MS, reservedId } from "@/lib/games/party-rules";

/**
 * Game night: one link, a lobby, many friends. The owner's browser is the table: friends open the
 * owner's party link, pick a name and wait in the lobby; the owner picks a game and everyone's
 * screen switches to it together; when it ends, everyone's back in the lobby for the next one.
 *
 * Same trust model as the two-player games (lib/games/peer-game): the owner's browser holds every
 * game's state and sends each friend only their own view (no one sees another's cards); friends
 * only send requests ("play card 12") that the owner's side checks, tagged with who sent them. Each
 * friend checks the table is really the owner's (lib/peer-auth). Friends keep a stable id, so a
 * reload or a dropped phone rejoins the same seat. Voice: each friend talks with the owner.
 */
export type PartyGameKind = "cards" | "ludo" | "dots" | "chess" | "draw" | "snakes" | "business";
export const PARTY_GAMES: PartyGameKind[] = ["cards", "ludo", "dots", "chess", "draw", "snakes", "business"];
const isGame = (g: unknown): g is PartyGameKind => PARTY_GAMES.includes(g as PartyGameKind);
/** `peer`: the friend's own connection id, so friends can talk to each other directly (group voice). */
export type PartyPlayer = { id: string; name: string; online: boolean; host?: boolean; peer?: string };
export type PartyPhase = { screen: "lobby" } | { screen: "game"; game: PartyGameKind; n: number };
export type PartyStage = "connecting" | "lobby" | "reconnecting" | "full" | "error";

type Wire =
  | { t: "challenge"; nonce: string }
  | { t: "proof"; proof: string }
  | { t: "hello"; name: string; id: string; peer?: string }
  | { t: "roster"; players: PartyPlayer[]; phase: PartyPhase }
  | { t: "state"; game: PartyGameKind; s: unknown }
  | { t: "act"; game: PartyGameKind; a: unknown }
  | { t: "full" }
  /** A reaction (😂 🔥…): friend → host, then host → everyone else with who sent it. */
  | { t: "react"; e: string; who?: string }
  /** Host → a friend the owner took off the table: don't come back (until the owner reopens game night). */
  | { t: "removed" }
  | { t: "ping" };

export const MAX_PLAYERS = 6;
const KEEP_MS = 3 * 60 * 60_000;
const TRANSIENT = ["network", "disconnected", "server-error", "socket-error", "socket-closed"];
/** A closed phone or a lost network can take a minute to show as a closed connection: both sides
 * say "still here" every few seconds, and a player silent for longer than this counts as away. */
const PING_MS = 4000;
const SILENT_MS = 12_000;

export type PartyFloat = { k: number; e: string; who: string; x: number };
const FLOAT_MS = 2600;

type Bound = { viewFor?: (s: unknown, playerId: string) => unknown; onAction?: (from: string, a: unknown) => void; accept?: (s: unknown) => boolean };

export type Party = {
  role: "host" | "guest";
  /** This player's id: "host" for the owner, a stable id for each friend. */
  me: string;
  hostName: string;
  players: PartyPlayer[];
  phase: PartyPhase;
  stage: PartyStage;
  err: string;
  /** Host: friends can join (the table is open). Guest: connected to the owner. */
  live: boolean;
  /** Bumped whenever a game's state changes (so games re-render). */
  version: number;
  stateOf: (game: PartyGameKind) => unknown;
  publish: (game: PartyGameKind, s: unknown) => void;
  act: (game: PartyGameKind, a: unknown) => void;
  bind: (game: PartyGameKind, b: Bound) => () => void;
  startGame: (game: PartyGameKind) => void;
  backToLobby: () => void;
  removePlayer: (id: string) => void;
  /** Send a reaction to everyone at the table. */
  react: (e: string) => void;
  /** Reactions floating up on this screen right now (each lasts a few seconds). */
  /** Follow the reactions floating up right now; returns the unsubscribe. */
  onFloats: (fn: (f: PartyFloat[]) => void) => () => void;
  voice: { on: boolean; muted: boolean; noMic: boolean; toggleMute: () => void };
};

export const PartyContext = createContext<Party | null>(null);
export const useParty = () => useContext(PartyContext);

export function usePartyNet(o: { role: "host" | "guest"; room: string; myName: string; hostName: string; /** Guest: the owner isn't at the table yet (called once, to knock). */ onHostAway?: () => void }): Party {
  const KEY = `hm-party-${o.role}-${o.room}`;
  const [saved] = useState(() => {
    try {
      const v = JSON.parse(sessionStorage.getItem(KEY) ?? "null") as { at: number; players: PartyPlayer[]; phase: PartyPhase; states: Record<string, unknown> } | null;
      return v && Date.now() - v.at < KEEP_MS ? v : null;
    } catch {
      return null;
    }
  });
  const host: PartyPlayer = { id: "host", name: o.role === "host" ? o.myName : o.hostName, online: true, host: true };
  const [players, setPlayers] = useState<PartyPlayer[]>(() => (o.role === "host" ? [host, ...(saved?.players ?? []).filter((p) => !p.host).map((p) => ({ ...p, online: false }))] : (saved?.players ?? [])));
  const [phase, setPhase] = useState<PartyPhase>(saved?.phase ?? { screen: "lobby" });
  const [stage, setStage] = useState<PartyStage>(saved ? "reconnecting" : "connecting");
  const [err, setErr] = useState("");
  // A copy of every game's state for rendering (the ref below is the source of truth for handlers).
  const [snap, setSnap] = useState<Record<string, unknown>>(() => saved?.states ?? {});
  const [voiceOn, setVoiceOn] = useState(false);
  const [muted, setMuted] = useState(false);
  const [noMic, setNoMic] = useState(false);
  const [me] = useState(() => {
    if (o.role === "host") return "host";
    try {
      const id = localStorage.getItem("hm-play-id") || crypto.randomUUID();
      localStorage.setItem("hm-play-id", id);
      return cleanId(id);
    } catch {
      return cleanId(crypto.randomUUID());
    }
  });

  const states = useRef<Record<string, unknown>>(saved?.states ?? {});
  const bound = useRef<Partial<Record<PartyGameKind, Bound>>>({});
  const conns = useRef(new Map<string, DataConnection>()); // host: player id → connection
  const hostConn = useRef<DataConnection | null>(null); // guest
  const peer = useRef<Peer | null>(null);
  const mic = useRef<MediaStream | null>(null);
  const calls = useRef(new Map<string, { call: MediaConnection; audio: HTMLAudioElement }>());
  const verified = useRef(false);
  const nonce = useRef("");
  const heard = useRef(new Map<string, number>()); // host: player id → last message time
  const heardHost = useRef(0); // guest
  const playersRef = useRef(players);
  const phaseRef = useRef(phase);
  const stageRef = useRef(stage);
  const opts = useRef(o);
  useEffect(() => {
    playersRef.current = players;
    phaseRef.current = phase;
    stageRef.current = stage;
    opts.current = o;
  });

  const save = useCallback(() => {
    try {
      sessionStorage.setItem(KEY, JSON.stringify({ at: Date.now(), players: playersRef.current, phase: phaseRef.current, states: states.current }));
    } catch {}
  }, [KEY]);

  /* ── host: send what each player may see ── */
  const viewFor = useCallback((game: PartyGameKind, id: string) => {
    const s = states.current[game];
    const v = bound.current[game]?.viewFor;
    return s && v ? v(s, id) : s;
  }, []);
  const sendTo = useCallback((id: string, m: Wire) => {
    const c = conns.current.get(id);
    if (c?.open) c.send(m);
  }, []);
  const broadcastRoster = useCallback(
    (list = playersRef.current, ph = phaseRef.current) => {
      for (const id of conns.current.keys()) sendTo(id, { t: "roster", players: list, phase: ph });
    },
    [sendTo],
  );
  const setRoster = useCallback(
    (fn: (l: PartyPlayer[]) => PartyPlayer[]) => {
      const next = fn(playersRef.current);
      playersRef.current = next;
      setPlayers(next);
      broadcastRoster(next);
      save();
    },
    [broadcastRoster, save],
  );

  const publish = useCallback(
    (game: PartyGameKind, s: unknown) => {
      states.current[game] = s;
      setSnap({ ...states.current });
      if (opts.current.role === "host") for (const id of conns.current.keys()) sendTo(id, { t: "state", game, s: viewFor(game, id) });
      save();
    },
    [save, sendTo, viewFor],
  );
  // Reactions: shown here at once, and passed round the table by the owner's browser.
  // Kept out of the Party object: a reaction mustn't re-render (and restart the bot timers of) every game.
  const floats = useRef<PartyFloat[]>([]);
  const floatFans = useRef(new Set<(f: PartyFloat[]) => void>());
  const floatTimers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const floatK = useRef(0);
  const lastReact = useRef(new Map<string, number>());
  const setFloats = useCallback((next: PartyFloat[]) => {
    floats.current = next;
    for (const f of floatFans.current) f(next);
  }, []);
  const showReact = useCallback(
    (e: string, who: string) => {
      const k = ++floatK.current;
      setFloats([...floats.current.slice(-24), { k, e, who, x: 8 + Math.random() * 84 }]);
      const t = setTimeout(() => {
        floatTimers.current.delete(t);
        setFloats(floats.current.filter((f) => f.k !== k));
      }, FLOAT_MS);
      floatTimers.current.add(t);
    },
    [setFloats],
  );
  useEffect(() => {
    const timers = floatTimers.current;
    return () => timers.forEach(clearTimeout);
  }, []);
  const onFloats = useCallback((fn: (f: PartyFloat[]) => void) => {
    floatFans.current.add(fn);
    fn(floats.current);
    return () => void floatFans.current.delete(fn);
  }, []);
  const react = useCallback(
    (e: string) => {
      if (!isReaction(e)) return;
      const now = Date.now();
      if (now - (lastReact.current.get("me") ?? 0) < REACT_GAP_MS) return;
      if (opts.current.role === "host") for (const id of conns.current.keys()) sendTo(id, { t: "react", e, who: "host" });
      else {
        const c = hostConn.current;
        if (!c?.open || !verified.current) return;
        c.send({ t: "react", e } satisfies Wire);
      }
      lastReact.current.set("me", now);
      showReact(e, me);
    },
    [me, sendTo, showReact],
  );
  const act = useCallback((game: PartyGameKind, a: unknown) => {
    const c = hostConn.current;
    if (c?.open && verified.current) c.send({ t: "act", game, a } satisfies Wire);
  }, []);
  const bind = useCallback((game: PartyGameKind, b: Bound) => {
    bound.current[game] = b;
    return () => {
      if (bound.current[game] === b) delete bound.current[game];
    };
  }, []);
  const startGame = useCallback(
    (game: PartyGameKind) => {
      const n = phaseRef.current.screen === "game" ? phaseRef.current.n + 1 : 1;
      const ph: PartyPhase = { screen: "game", game, n };
      phaseRef.current = ph;
      setPhase(ph);
      delete states.current[game];
      setSnap({ ...states.current });
      broadcastRoster(playersRef.current, ph);
      save();
    },
    [broadcastRoster, save],
  );
  const backToLobby = useCallback(() => {
    const ph: PartyPhase = { screen: "lobby" };
    phaseRef.current = ph;
    setPhase(ph);
    broadcastRoster(playersRef.current, ph);
    save();
  }, [broadcastRoster, save]);
  /** Host: friends the owner removed this session; if they knock again they're told, not let in. */
  const removed = useRef(new Set<string>());
  const removePlayer = useCallback(
    (id: string) => {
      if (id === "host") return;
      removed.current.add(id);
      const c = conns.current.get(id);
      conns.current.delete(id);
      try {
        c?.send({ t: "removed" } satisfies Wire);
      } catch {}
      // A moment for the message to arrive before the line closes.
      setTimeout(() => c?.close(), 400);
      setRoster((l) => l.filter((p) => p.id !== id));
    },
    [setRoster],
  );
  const toggleMute = useCallback(() => {
    setMuted((m) => {
      mic.current?.getAudioTracks().forEach((t) => (t.enabled = m));
      return !m;
    });
  }, []);
  const hear = useCallback((id: string, call: MediaConnection, stream: MediaStream) => {
    calls.current.get(id)?.audio.pause();
    const audio = new Audio();
    audio.srcObject = stream;
    void audio.play().catch(() => {});
    calls.current.set(id, { call, audio });
    setVoiceOn(true);
  }, []);

  useEffect(() => {
    const { role, room } = opts.current;
    let alive = true;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const later = (fn: () => void, ms: number) => {
      const t = setTimeout(() => {
        timers.delete(t);
        if (alive) fn();
      }, ms);
      timers.add(t);
    };
    const hostId = `hivemind-party-${room}`;
    let dial: () => void = () => {};
    let knocked = false;

    const onHostData = (c: DataConnection, m: Wire) => {
      if (!m || typeof m !== "object") return;
      const who = [...conns.current.entries()].find(([, x]) => x === c)?.[0];
      if (who) heard.current.set(who, Date.now());
      if (m.t === "ping") return;
      if (m.t === "challenge") {
        void proveHost("party", room, String(m.nonce).slice(0, 64)).then((proof) => proof && c.open && c.send({ t: "proof", proof } satisfies Wire));
        return;
      }
      if (m.t === "hello") {
        const id = cleanId(m.id);
        if (!id || reservedId(id)) return void c.close();
        if (removed.current.has(id)) {
          c.send({ t: "removed" } satisfies Wire);
          return void later(() => c.close(), 500);
        }
        const known = playersRef.current.find((p) => p.id === id);
        if (!known && playersRef.current.length >= MAX_PLAYERS) {
          c.send({ t: "full" } satisfies Wire);
          return void later(() => c.close(), 500);
        }
        const old = conns.current.get(id);
        if (old && old !== c) old.close();
        conns.current.set(id, c);
        heard.current.set(id, Date.now());
        const name = cleanName(m.name) || "Friend";
        const peerId = String(m.peer ?? "").replace(/[^a-z0-9-]/gi, "").slice(0, 64) || undefined;
        setRoster((l) => (known ? l.map((p) => (p.id === id ? { ...p, name, online: true, peer: peerId } : p)) : [...l, { id, name, online: true, peer: peerId }]));
        const ph = phaseRef.current;
        if (ph.screen === "game" && states.current[ph.game]) sendTo(id, { t: "state", game: ph.game, s: viewFor(ph.game, id) });
        return;
      }
      if (m.t === "act") {
        const from = [...conns.current.entries()].find(([, x]) => x === c)?.[0];
        if (!from) return;
        bound.current[m.game]?.onAction?.(from, m.a);
      }
      if (m.t === "react") {
        const from = [...conns.current.entries()].find(([, x]) => x === c)?.[0];
        if (!from || !isReaction(m.e)) return;
        // Not too fast from any one friend; then everyone else sees it too.
        const now = Date.now();
        if (now - (lastReact.current.get(from) ?? 0) < REACT_GAP_MS) return;
        lastReact.current.set(from, now);
        showReact(m.e, from);
        for (const id of conns.current.keys()) if (id !== from) sendTo(id, { t: "react", e: m.e, who: from });
      }
    };

    const onGuestData = (c: DataConnection, m: Wire) => {
      if (!m || typeof m !== "object" || c !== hostConn.current) return;
      heardHost.current = Date.now();
      if (m.t === "ping") return;
      if (!verified.current) {
        if (m.t !== "proof") return;
        void checkHost("party", room, nonce.current, m.proof).then((ok) => {
          if (c !== hostConn.current) return;
          if (!ok) {
            setErr("This link isn't answered by its owner right now. Try again later.");
            setStage("error");
            c.close();
            return;
          }
          verified.current = true;
          c.send({ t: "hello", name: opts.current.myName, id: me, peer: peer.current?.id } satisfies Wire);
          const p = peer.current;
          if (p && mic.current) {
            calls.current.get("host")?.call.close();
            const mc = p.call(hostId, mic.current, { metadata: { id: me } });
            mc.on("stream", (st) => hear("host", mc, st));
          }
        });
        return;
      }
      if (m.t === "react") {
        if (isReaction(m.e)) showReact(m.e, cleanId(m.who) || "host");
        return;
      }
      if (m.t === "removed") {
        // Stop knocking: "full" is the stage that ends redialling.
        setStage("full");
        setErr(`${opts.current.hostName} took you off the table for this game night.`);
        return;
      }
      if (m.t === "full") {
        setStage("full");
        setErr(`The table is full (${MAX_PLAYERS} players). Ask ${opts.current.hostName} to make room.`);
        return;
      }
      if (m.t === "roster") {
        const list = (Array.isArray(m.players) ? m.players : []).slice(0, MAX_PLAYERS).map((p) => ({ id: cleanId(p.id), name: cleanName(p.name) || "Friend", online: !!p.online, host: !!p.host, peer: typeof p.peer === "string" ? p.peer.replace(/[^a-z0-9-]/gi, "").slice(0, 64) : undefined }));
        playersRef.current = list;
        setPlayers(list);
        const ph = m.phase && (m.phase.screen === "lobby" || (isGame(m.phase.game) && Number.isInteger(m.phase.n))) ? m.phase : ({ screen: "lobby" } as PartyPhase);
        phaseRef.current = ph;
        setPhase(ph);
        setStage("lobby");
        save();
        mesh(list);
        return;
      }
      if (m.t === "state" && isGame(m.game)) {
        const ok = bound.current[m.game]?.accept;
        if (ok && !ok(m.s)) return;
        states.current[m.game] = m.s;
        setSnap({ ...states.current });
        save();
      }
    };

    /** Group voice: call every other friend who's here (the smaller id calls, so each pair calls once); hang up on those who left. */
    const mesh = (list: PartyPlayer[]) => {
      const p = peer.current;
      if (!p || p.destroyed || !p.open || !mic.current) return;
      const here = new Set(list.filter((x) => x.online && !x.host && x.id !== me).map((x) => x.id));
      for (const [id, v] of [...calls.current.entries()]) {
        if (id !== "host" && !here.has(id)) {
          v.call.close();
          v.audio.pause();
          calls.current.delete(id);
        }
      }
      for (const x of list) {
        if (!x.online || x.host || x.id === me || !x.peer || calls.current.has(x.id) || pending.has(x.id) || !callsFirst(me, x.id)) continue;
        pending.add(x.id);
        const mc = p.call(x.peer, mic.current, { metadata: { id: me, room } });
        mc.on("stream", (st) => {
          pending.delete(x.id);
          hear(x.id, mc, st);
        });
        mc.on("close", () => {
          pending.delete(x.id);
          if (calls.current.get(x.id)?.call === mc) calls.current.delete(x.id);
        });
        later(() => pending.delete(x.id), 15_000);
      }
    };
    const pending = new Set<string>();

    const lostGuest = (id: string, c: DataConnection) => {
      if (conns.current.get(id) !== c) return;
      conns.current.delete(id);
      heard.current.delete(id);
      setRoster((l) => l.map((p) => (p.id === id ? { ...p, online: false } : p)));
      calls.current.get(id)?.call.close();
      calls.current.delete(id);
    };

    const wake = () => {
      if (document.hidden || !alive) return;
      const p = peer.current;
      if (p && !p.destroyed && p.disconnected) p.reconnect();
      if (role === "guest" && !hostConn.current?.open) dial();
    };
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("online", wake);
    window.addEventListener("pagehide", save);

    void (async () => {
      mic.current = (await navigator.mediaDevices?.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }).catch(() => null)) ?? null;
      if (!mic.current) setNoMic(true);
      const { default: PeerCtor } = await import("peerjs");
      if (!alive) return;
      if (role === "host") {
        const open = (attempt: number) => {
          if (!alive) return;
          const p = new PeerCtor(hostId);
          peer.current = p;
          p.on("open", () => setStage("lobby"));
          p.on("connection", (c) => {
            c.on("data", (d) => onHostData(c, d as Wire));
            c.on("close", () => {
              const id = [...conns.current.entries()].find(([, x]) => x === c)?.[0];
              if (id) lostGuest(id, c);
            });
            c.on("error", () => {
              const id = [...conns.current.entries()].find(([, x]) => x === c)?.[0];
              if (id) lostGuest(id, c);
            });
          });
          p.on("call", (mc) => {
            const id = cleanId((mc.metadata as { id?: string } | undefined)?.id);
            if (!id || !conns.current.has(id)) return void mc.close();
            calls.current.get(id)?.call.close();
            mc.answer(mic.current ?? undefined);
            mc.on("stream", (st) => hear(id, mc, st));
          });
          p.on("error", (e) => {
            if (!alive) return;
            if (e.type === "unavailable-id") {
              p.destroy();
              if (attempt < 20) return later(() => open(attempt + 1), 3000);
              setErr("Game night is already open in another tab.");
              setStage("error");
            } else if (TRANSIENT.includes(e.type)) {
              // Never opened (a busy relay as the page loads): start a fresh one, it can't reconnect.
              if (!p.open) {
                p.destroy();
                if (attempt < 30) later(() => open(attempt + 1), Math.min(10_000, 1500 * (attempt + 1)));
              } else later(() => !p.destroyed && p.disconnected && p.reconnect(), 2000);
            } else if (e.type !== "peer-unavailable") {
              setErr("Couldn't open game night. Check your connection.");
              setStage("error");
            }
          });
          p.on("disconnected", () => later(() => !p.destroyed && p.disconnected && p.reconnect(), 1000));
        };
        open(0);
      } else {
        let lastDial = 0;
        dial = () => {
          const p = peer.current;
          if (!alive || !p || p.destroyed || p.disconnected || !p.open || Date.now() - lastDial < 2500 || stageRef.current === "full") return;
          lastDial = Date.now();
          const old = hostConn.current;
          hostConn.current = null;
          old?.close();
          verified.current = false;
          const c = p.connect(hostId, { reliable: true });
          hostConn.current = c;
          c.on("data", (d) => onGuestData(c, d as Wire));
          c.on("open", () => {
            nonce.current = crypto.randomUUID();
            c.send({ t: "challenge", nonce: nonce.current } satisfies Wire);
          });
          const gone = () => c === hostConn.current && stageRef.current !== "error" && stageRef.current !== "full" && setStage("reconnecting");
          c.on("close", gone);
          c.on("error", gone);
        };
        // A friend's own link to the relay. If it fails before it ever opened (a busy relay, a
        // network blip as the page loads), start a fresh one: reconnect() only works after an open.
        const start = (attempt: number) => {
          if (!alive) return;
          const p = new PeerCtor();
          peer.current = p;
          p.on("open", dial);
          // Another friend calling (group voice): only someone at this table.
          p.on("call", (mc) => {
            const meta = (mc.metadata ?? {}) as { id?: string; room?: string };
            const from = cleanId(meta.id);
            if (!from || meta.room !== room || !playersRef.current.some((x) => x.id === from && x.online && !x.host) || !mic.current) return void mc.close();
            calls.current.get(from)?.call.close();
            mc.answer(mic.current);
            mc.on("stream", (st) => hear(from, mc, st));
          });
          p.on("disconnected", () => later(() => !p.destroyed && p.disconnected && (p.open ? p.reconnect() : undefined), 1000));
          p.on("error", (e) => {
            if (!alive || peer.current !== p) return;
            if (e.type === "peer-unavailable") {
              if (stageRef.current === "connecting") setStage("reconnecting");
              if (!knocked) {
                knocked = true;
                opts.current.onHostAway?.();
              }
              later(dial, 3000);
            } else if (TRANSIENT.includes(e.type)) {
              if (!p.open) {
                p.destroy();
                later(() => start(attempt + 1), Math.min(10_000, 1500 * (attempt + 1)));
              } else later(() => (!p.destroyed && p.disconnected ? p.reconnect() : dial()), 2000);
            } else {
              setErr("Couldn't join game night. Check your connection.");
              setStage("error");
            }
          });
        };
        start(0);
      }
    })();

    const redial = setInterval(() => {
      if (role === "guest" && alive && stageRef.current !== "error" && stageRef.current !== "full" && !hostConn.current?.open) dial();
    }, 4000);
    const beat = setInterval(() => {
      if (!alive) return;
      const now = Date.now();
      if (role === "host") {
        for (const [id, c] of [...conns.current.entries()]) {
          if (now - (heard.current.get(id) ?? now) > SILENT_MS) {
            lostGuest(id, c);
            c.close();
          } else if (c.open) c.send({ t: "ping" } satisfies Wire);
        }
      } else {
        const c = hostConn.current;
        if (c?.open && verified.current) {
          c.send({ t: "ping" } satisfies Wire);
          mesh(playersRef.current);
          if (heardHost.current && now - heardHost.current > SILENT_MS && stageRef.current === "lobby") {
            setStage("reconnecting");
            heardHost.current = 0;
            dial();
          }
        }
      }
    }, PING_MS);

    const allCalls = calls.current;
    const allConns = conns.current;
    return () => {
      alive = false;
      timers.forEach(clearTimeout);
      clearInterval(redial);
      clearInterval(beat);
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("online", wake);
      window.removeEventListener("pagehide", save);
      for (const { call, audio } of allCalls.values()) {
        call.close();
        audio.pause();
      }
      allCalls.clear();
      for (const c of allConns.values()) c.close();
      allConns.clear();
      hostConn.current?.close();
      hostConn.current = null;
      peer.current?.destroy();
      mic.current?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one connection for the life of the page
  }, []);

  const stateOf = useCallback((game: PartyGameKind) => snap[game] ?? null, [snap]);
  // A friend reaches "lobby" only once the owner's table answered (verified) and sent the roster.
  const live = stage === "lobby";

  return useMemo(
    () => ({
      role: o.role,
      me,
      hostName: o.hostName,
      players,
      phase,
      stage,
      err,
      live,
      version: Object.keys(snap).length,
      stateOf,
      publish,
      act,
      bind,
      startGame,
      backToLobby,
      removePlayer,
      react,
      onFloats,
      voice: { on: voiceOn, muted, noMic, toggleMute },
    }),
    [o.role, me, o.hostName, players, phase, stage, err, live, snap, stateOf, publish, act, bind, startGame, backToLobby, removePlayer, react, onFloats, voiceOn, muted, noMic, toggleMute],
  );
}

/**
 * A game's view of the party, shaped like usePeerGame's result so the same game screen works for a
 * friend game and game night. `onAction` gets who sent the move; `viewFor` gets who it's for.
 */
export function usePartyGame<S, A>(
  party: Party | null,
  game: PartyGameKind,
  h: { accept?: (s: unknown) => s is S; viewFor?: (s: S, playerId: string) => S; onAction?: (from: string, a: A) => void },
) {
  const hRef = useRef(h);
  useEffect(() => {
    hRef.current = h;
  });
  useEffect(() => {
    if (!party) return;
    return party.bind(game, {
      accept: (s) => (hRef.current.accept ? hRef.current.accept(s) : true),
      viewFor: (s, id) => (hRef.current.viewFor ? hRef.current.viewFor(s as S, id) : s),
      onAction: (from, a) => hRef.current.onAction?.(from, a as A),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- bind once per game
  }, [party?.bind, game]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  if (!party) return null;
  const connected = party.role === "host" ? party.stage === "lobby" : party.stage === "lobby";
  // Who "the other side" is in a game's messages: a friend sees the host; the host sees the friends who are here.
  const here = party.players.filter((p) => p.id !== party.me && !p.host && p.online);
  const other = party.role === "guest" ? party.hostName : here.length === 1 ? here[0].name : "everyone";
  return {
    stage: (party.stage === "lobby" ? "connected" : party.stage === "reconnecting" ? "reconnecting" : party.stage === "connecting" ? "connecting" : "error") as "connected" | "reconnecting" | "connecting" | "error",
    err: party.err,
    other,
    state: party.stateOf(game) as S | null,
    publish: (s: S) => party.publish(game, s),
    act: (a: A) => party.act(game, a),
    forget: () => {},
    voiceOn: party.voice.on,
    muted: party.voice.muted,
    toggleMute: party.voice.toggleMute,
    noMic: party.voice.noMic,
    knocked: false,
    audioRef,
    connected,
  };
}
