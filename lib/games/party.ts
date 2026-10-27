"use client";

import type { DataConnection, MediaConnection, Peer } from "peerjs";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { PEER_OPTIONS } from "@/lib/ice";
import { checkHost, proveHost } from "@/lib/peer-auth";
import { boost as raceBoost, cleanRace, MIN_RACERS, newRace, TICK_MS, tick as raceTick, viewOf as raceView, type Race, type RaceView } from "@/lib/games/pet-race";
import { callsFirst, CHAT_GAP_MS, cleanChat, cleanId, cleanName, cleanPet, GIFT_GAP_MS, isReaction, REACT_GAP_MS, reservedId } from "@/lib/games/party-rules";

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
export type PartyGameKind = "cards" | "ludo" | "dots" | "chess" | "draw" | "snakes" | "business" | "bingo" | "connect4";
export const PARTY_GAMES: PartyGameKind[] = ["cards", "ludo", "dots", "chess", "draw", "snakes", "business", "bingo", "connect4"];
const isGame = (g: unknown): g is PartyGameKind => PARTY_GAMES.includes(g as PartyGameKind);
/** `peer`: the friend's own connection id, so friends can talk to each other directly (group voice). */
export type PartyPlayer = { id: string; name: string; online: boolean; host?: boolean; peer?: string; /** Their pet, if they have one (the owner's Nova, or a friend's guest pet). */ pet?: PartyPet; /** Pet races won tonight (a crown each). */ crowns?: number };
/** What the table knows of someone's pet: only this, never anything else. Friends send it themselves, so every field is checked on arrival (see cleanPet). */
export type PartyPet = { name: string; hue: number; stage: number; xp: number; wear: string | null; best: number; flowers: number };
export type PartyPhase = { screen: "lobby" } | { screen: "game"; game: PartyGameKind; n: number };
export type PartyStage = "connecting" | "lobby" | "reconnecting" | "full" | "error";

type Wire =
  | { t: "challenge"; nonce: string }
  | { t: "proof"; proof: string }
  | { t: "hello"; name: string; id: string; peer?: string; pet?: PartyPet }
  /** A friend's pet changed (it grew, got a flower): friend → host, who updates the roster. */
  | { t: "pet"; pet: PartyPet | null }
  /** A flower for someone's pet: friend → host (who says so in the chat), then host → that friend. */
  | { t: "gift"; to?: string; from?: string }
  /** The pet race as it stands: host → everyone (null: it is over and cleared). */
  | { t: "race"; r: RaceView | null }
  /** A tap for your own pet in the race: friend → host. */
  | { t: "boost" }
  | { t: "roster"; players: PartyPlayer[]; phase: PartyPhase }
  | { t: "state"; game: PartyGameKind; s: unknown }
  | { t: "act"; game: PartyGameKind; a: unknown }
  | { t: "full" }
  /** A reaction (😂 🔥…): friend → host, then host → everyone else with who sent it. */
  | { t: "react"; e: string; who?: string }
  /** A chat message: friend → host, then host → everyone with who sent it; "chats" catches up a friend who joins. */
  | { t: "chat"; text: string; who?: string; at?: number }
  | { t: "chats"; list: PartyChat[] }
  /** Host → a friend the owner took off the table: don't come back (until the owner reopens game night). */
  | { t: "removed" }
  | { t: "ping" };

export const MAX_PLAYERS = 6;
const KEEP_MS = 3 * 60 * 60_000;
const TRANSIENT = ["network", "disconnected", "server-error", "socket-error", "socket-closed"];
/** A closed phone or a lost network can take a minute to show as a closed connection: both sides
 * say "still here" every few seconds, and a player silent for longer than this counts as away. */
const PING_MS = 4000;
const SILENT_MS = 30_000;

export type PartyFloat = { k: number; e: string; who: string; x: number };
export type PartyChat = { k: number; who: string; text: string; at: number };
const CHAT_KEEP = 60;
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
  /** Guest: what joining is doing right now ("Looking for the table…"), so a stuck join says where it is stuck. */
  note: string;
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
  /** Send a chat message to everyone at the table; false if it couldn't go (empty, too fast, not connected). */
  chat: (text: string) => boolean;
  /** Send a flower to someone's pet (their id); false if it couldn't go (too fast, not connected, no such pet). */
  gift: (to: string) => boolean;
  /** Follow the chat; returns the unsubscribe. */
  onChat: (fn: (list: PartyChat[]) => void) => () => void;
  voice: { on: boolean; muted: boolean; noMic: boolean; toggleMute: () => void };
  /** The pet race between games: the owner starts it, everyone taps for their own pet. */
  race: { start: () => boolean; boost: () => void; on: (fn: (r: RaceView | null) => void) => () => void };
};

export const PartyContext = createContext<Party | null>(null);
export const useParty = () => useContext(PartyContext);

export function usePartyNet(o: { role: "host" | "guest"; room: string; myName: string; hostName: string; /** Guest: the owner isn't at the table yet (called once, to knock). */ onHostAway?: () => void; /** This player's pet (the owner's Nova, or a friend's guest pet): shown to everyone at the table. */ pet?: PartyPet | null; /** Someone sent a flower to this player's pet. */ onGift?: () => void }): Party {
  const KEY = `hm-party-${o.role}-${o.room}`;
  const [saved] = useState(() => {
    try {
      const v = JSON.parse(sessionStorage.getItem(KEY) ?? "null") as { at: number; players: PartyPlayer[]; phase: PartyPhase; states: Record<string, unknown> } | null;
      return v && Date.now() - v.at < KEEP_MS ? v : null;
    } catch {
      return null;
    }
  });
  const host: PartyPlayer = { id: "host", name: o.role === "host" ? o.myName : o.hostName, online: true, host: true, ...(o.role === "host" && o.pet ? { pet: o.pet } : {}) };
  const [players, setPlayers] = useState<PartyPlayer[]>(() => (o.role === "host" ? [host, ...(saved?.players ?? []).filter((p) => !p.host).map((p) => ({ ...p, online: false }))] : (saved?.players ?? [])));
  const [phase, setPhase] = useState<PartyPhase>(saved?.phase ?? { screen: "lobby" });
  const [stage, setStage] = useState<PartyStage>(saved ? "reconnecting" : "connecting");
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");
  // A copy of every game's state for rendering (the ref below is the source of truth for handlers).
  const [snap, setSnap] = useState<Record<string, unknown>>(() => saved?.states ?? {});
  const [voiceOn, setVoiceOn] = useState(false);
  // The microphone starts muted (its tracks are switched off): nothing is sent until the player taps the button.
  // The browser's own mic stream is still opened on joining, because without one it hides device addresses and friends on the same PC or Wi-Fi can't connect.
  const [muted, setMuted] = useState(true);
  const micLive = useRef(false);
  const audioCtx = useRef<AudioContext | null>(null);
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
  // Chat: like reactions, kept out of the Party object so a message doesn't re-render every game.
  const chats = useRef<PartyChat[]>([]);
  const chatFans = useRef(new Set<(l: PartyChat[]) => void>());
  const chatK = useRef(0);
  const lastChat = useRef(new Map<string, number>());
  const setChats = useCallback((next: PartyChat[]) => {
    chats.current = next.slice(-CHAT_KEEP);
    for (const f of chatFans.current) f(chats.current);
  }, []);
  const addChat = useCallback((who: string, text: string, at: number) => setChats([...chats.current, { k: ++chatK.current, who, text, at }]), [setChats]);
  const onChat = useCallback((fn: (l: PartyChat[]) => void) => {
    chatFans.current.add(fn);
    fn(chats.current);
    return () => void chatFans.current.delete(fn);
  }, []);
  const chat = useCallback(
    (raw: string) => {
      const text = cleanChat(raw);
      const now = Date.now();
      if (!text || now - (lastChat.current.get("me") ?? 0) < CHAT_GAP_MS) return false;
      if (opts.current.role === "host") for (const id of conns.current.keys()) sendTo(id, { t: "chat", text, who: "host", at: now });
      else {
        const c = hostConn.current;
        if (!c?.open || !verified.current) return false;
        c.send({ t: "chat", text } satisfies Wire);
      }
      lastChat.current.set("me", now);
      addChat(me, text, now);
      return true;
    },
    [me, sendTo, addChat],
  );
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
  // Flowers for pets (host side): checked, said in the chat for everyone, and passed to the pet's owner.
  const lastGift = useRef(new Map<string, number>());
  const giveFlower = useCallback(
    (from: string, toId: string) => {
      const now = Date.now();
      if (now - (lastGift.current.get(from) ?? 0) < GIFT_GAP_MS) return false;
      const to = playersRef.current.find((p) => p.id === toId && (p.online || p.host));
      const giver = from === "host" ? playersRef.current.find((p) => p.host) : playersRef.current.find((p) => p.id === from);
      if (!to || !giver || to.id === from || !to.pet) return false;
      lastGift.current.set(from, now);
      const text = `🌸 sent a flower to ${to.pet.name}`;
      addChat(from, text, now);
      for (const id of conns.current.keys()) if (id !== from) sendTo(id, { t: "chat", text, who: from, at: now });
      if (to.host) opts.current.onGift?.();
      else sendTo(to.id, { t: "gift", from } satisfies Wire);
      return true;
    },
    [addChat, sendTo],
  );
  // The pet race (owner's browser runs it): kept out of the Party object like reactions, so a tick doesn't re-render a game.
  const raceRef = useRef<Race | null>(null);
  const raceView0 = useRef<RaceView | null>(null);
  const raceFans = useRef(new Set<(r: RaceView | null) => void>());
  const raceTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const raceClear = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastBoost = useRef(0);
  const showRace = useCallback((v: RaceView | null) => {
    raceView0.current = v;
    for (const f of raceFans.current) f(v);
  }, []);
  const onRace = useCallback((fn: (r: RaceView | null) => void) => {
    raceFans.current.add(fn);
    fn(raceView0.current);
    return () => void raceFans.current.delete(fn);
  }, []);
  const pushRace = useCallback(
    (v: RaceView | null) => {
      showRace(v);
      for (const id of conns.current.keys()) sendTo(id, { t: "race", r: v } satisfies Wire);
    },
    [showRace, sendTo],
  );
  const startRace = useCallback(() => {
    if (opts.current.role !== "host" || raceRef.current || phaseRef.current.screen !== "lobby") return false;
    const ids = playersRef.current.filter((p) => p.pet && (p.online || p.host)).map((p) => p.id);
    if (ids.length < MIN_RACERS) return false;
    const r = newRace(ids, Date.now());
    raceRef.current = r;
    pushRace(raceView(r, Date.now()));
    raceTimer.current = setInterval(() => {
      const cur = raceRef.current;
      if (!cur) return;
      const now = Date.now();
      raceTick(cur, now);
      pushRace(raceView(cur, now));
      if (cur.phase !== "done") return;
      if (raceTimer.current) clearInterval(raceTimer.current);
      raceTimer.current = null;
      const win = playersRef.current.find((p) => p.id === cur.winner);
      if (win?.pet) {
        const text = `🏆 ${win.pet.name} won the pet race! 👑`;
        addChat(cur.winner ?? "host", text, now);
        for (const id of conns.current.keys()) sendTo(id, { t: "chat", text, who: cur.winner ?? "host", at: now } satisfies Wire);
      }
      setRoster((l) => l.map((p) => (p.id === cur.winner ? { ...p, crowns: Math.min(99, (p.crowns ?? 0) + 1) } : p)));
      // The result stays on screen a while, then the track clears.
      raceClear.current = setTimeout(() => {
        raceRef.current = null;
        pushRace(null);
      }, 9000);
    }, TICK_MS);
    return true;
  }, [pushRace, addChat, sendTo, setRoster]);
  const boostMe = useCallback(() => {
    const now = Date.now();
    if (now - lastBoost.current < 60) return;
    lastBoost.current = now;
    if (opts.current.role === "host") {
      if (raceRef.current) raceBoost(raceRef.current, "host", now);
    } else {
      const c = hostConn.current;
      if (c?.open && verified.current) c.send({ t: "boost" } satisfies Wire);
    }
  }, []);
  useEffect(
    () => () => {
      if (raceTimer.current) clearInterval(raceTimer.current);
      if (raceClear.current) clearTimeout(raceClear.current);
    },
    [],
  );
  const gift = useCallback(
    (toId: string) => {
      if (opts.current.role === "host") return giveFlower("host", toId);
      const c = hostConn.current;
      if (!c?.open || !verified.current) return false;
      c.send({ t: "gift", to: toId } satisfies Wire);
      return true;
    },
    [giveFlower],
  );
  // The pet changed (it grew, got a flower): tell the table. The owner's own entry is just updated; a friend tells the owner.
  const petKey = JSON.stringify(o.pet ?? null);
  useEffect(() => {
    const pet = opts.current.pet ?? undefined;
    if (opts.current.role === "host") {
      if (JSON.stringify(playersRef.current.find((p) => p.host)?.pet ?? null) !== JSON.stringify(pet ?? null)) setRoster((l) => l.map((p) => (p.host ? { ...p, pet } : p)));
    } else {
      const c = hostConn.current;
      if (c?.open && verified.current) c.send({ t: "pet", pet: pet ?? null } satisfies Wire);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the pet itself changes
  }, [petKey]);
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
      // A race still on the track ends when a game starts.
      if (raceRef.current) {
        if (raceTimer.current) clearInterval(raceTimer.current);
        if (raceClear.current) clearTimeout(raceClear.current);
        raceTimer.current = null;
        raceClear.current = null;
        raceRef.current = null;
        pushRace(null);
      }
      const n = phaseRef.current.screen === "game" ? phaseRef.current.n + 1 : 1;
      const ph: PartyPhase = { screen: "game", game, n };
      phaseRef.current = ph;
      setPhase(ph);
      delete states.current[game];
      setSnap({ ...states.current });
      broadcastRoster(playersRef.current, ph);
      save();
    },
    [broadcastRoster, save, pushRace],
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
  /** Use a real mic stream (muted unless told otherwise): calls already running switch over to it. */
  const adoptMic = useCallback((st: MediaStream, muteIt: boolean) => {
    const track = st.getAudioTracks()[0];
    if (!track) return;
    track.enabled = !muteIt;
    const old = mic.current;
    mic.current = st;
    micLive.current = true;
    for (const { call } of calls.current.values()) {
      for (const s of call.peerConnection?.getSenders() ?? []) if (!s.track || s.track.kind === "audio") void s.replaceTrack(track).catch(() => {});
    }
    if (old && old !== st) old.getTracks().forEach((t) => t.stop());
    setNoMic(false);
    setMuted(muteIt);
  }, []);
  /** The mic button when no mic was given yet (blocked or still waiting): ask again, and unmute once it is allowed. */
  const openMic = useCallback(async () => {
    try {
      adoptMic(await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }), false);
    } catch {
      setNoMic(true);
    }
  }, [adoptMic]);
  const toggleMute = useCallback(() => {
    if (!micLive.current) return void openMic();
    setMuted((m) => {
      mic.current?.getAudioTracks().forEach((t) => (t.enabled = m));
      return !m;
    });
  }, [openMic]);
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
        const pet = cleanPet(m.pet);
        setRoster((l) => (known ? l.map((p) => (p.id === id ? { ...p, name, online: true, peer: peerId, pet } : p)) : [...l, { id, name, online: true, peer: peerId, pet }]));
        const ph = phaseRef.current;
        if (ph.screen === "game" && states.current[ph.game]) sendTo(id, { t: "state", game: ph.game, s: viewFor(ph.game, id) });
        if (chats.current.length) sendTo(id, { t: "chats", list: chats.current.slice(-30) });
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
      if (m.t === "pet") {
        const from = [...conns.current.entries()].find(([, x]) => x === c)?.[0];
        if (!from) return;
        const pet = cleanPet(m.pet);
        setRoster((l) => l.map((p) => (p.id === from ? { ...p, pet } : p)));
        return;
      }
      if (m.t === "gift") {
        const from = [...conns.current.entries()].find(([, x]) => x === c)?.[0];
        if (from) giveFlower(from, String(m.to ?? ""));
        return;
      }
      if (m.t === "boost") {
        const from = [...conns.current.entries()].find(([, x]) => x === c)?.[0];
        if (from && raceRef.current) raceBoost(raceRef.current, from, Date.now());
        return;
      }
      if (m.t === "chat") {
        const from = [...conns.current.entries()].find(([, x]) => x === c)?.[0];
        const text = cleanChat(m.text);
        if (!from || !text) return;
        const now = Date.now();
        if (now - (lastChat.current.get(from) ?? 0) < CHAT_GAP_MS) return;
        lastChat.current.set(from, now);
        addChat(from, text, now);
        for (const id of conns.current.keys()) if (id !== from) sendTo(id, { t: "chat", text, who: from, at: now });
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
          setNote("Checked. Joining the lobby…");
          c.send({ t: "hello", name: opts.current.myName, id: me, peer: peer.current?.id, pet: opts.current.pet ?? undefined } satisfies Wire);
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
      if (m.t === "chat") {
        const text = cleanChat(m.text);
        if (text) addChat(cleanId(m.who) || "host", text, Number.isFinite(m.at) ? Number(m.at) : Date.now());
        return;
      }
      if (m.t === "chats") {
        // Catching up after joining: the owner's copy, plus anything sent here meanwhile.
        const list = (Array.isArray(m.list) ? m.list : [])
          .slice(-30)
          .map((x) => ({ k: ++chatK.current, who: cleanId(x?.who) || "host", text: cleanChat(x?.text), at: Number.isFinite(x?.at) ? Number(x.at) : 0 }))
          .filter((x) => x.text);
        const seen = new Set(list.map((x) => `${x.who}|${x.at}|${x.text}`));
        setChats([...list, ...chats.current.filter((x) => !seen.has(`${x.who}|${x.at}|${x.text}`))].sort((a, b) => a.at - b.at));
        return;
      }
      if (m.t === "gift") {
        opts.current.onGift?.();
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
        const list = (Array.isArray(m.players) ? m.players : []).slice(0, MAX_PLAYERS).map((p) => ({ id: cleanId(p.id), name: cleanName(p.name) || "Friend", online: !!p.online, host: !!p.host, peer: typeof p.peer === "string" ? p.peer.replace(/[^a-z0-9-]/gi, "").slice(0, 64) : undefined, pet: cleanPet(p.pet), crowns: Math.min(99, Math.max(0, Math.floor(Number((p as PartyPlayer).crowns) || 0))) || undefined }));
        playersRef.current = list;
        setPlayers(list);
        const ph = m.phase && (m.phase.screen === "lobby" || (isGame(m.phase.game) && Number.isInteger(m.phase.n))) ? m.phase : ({ screen: "lobby" } as PartyPhase);
        // A new game starts from nothing: the last one's finished board must not flash up first.
        const before = phaseRef.current;
        if (ph.screen === "game" && (before.screen !== "game" || before.n !== ph.n) && states.current[ph.game] !== undefined) {
          delete states.current[ph.game];
          setSnap({ ...states.current });
        }
        phaseRef.current = ph;
        setPhase(ph);
        setStage("lobby");
        save();
        mesh(list);
        return;
      }
      if (m.t === "race") {
        showRace(m.r === null ? null : cleanRace(m.r, cleanId));
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
      // The prompt must never hold the join up: after a few seconds carry on with a silent stream, and use the real one if it is allowed later.
      // Either way the mic starts muted (adoptMic).
      const asked = navigator.mediaDevices?.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }).catch(() => null) ?? Promise.resolve(null);
      const first = await Promise.race([asked, new Promise<null>((r) => setTimeout(() => r(null), 5000))]);
      if (first) adoptMic(first, true);
      else {
        try {
          const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
          if (Ctx) {
            audioCtx.current = new Ctx();
            mic.current = audioCtx.current.createMediaStreamDestination().stream;
          }
        } catch {
          mic.current = null;
        }
        void asked.then((st) => {
          if (!st) return setNoMic(true);
          if (alive) adoptMic(st, true);
          else st.getTracks().forEach((t) => t.stop());
        });
      }
      const { default: PeerCtor } = await import("peerjs");
      if (!alive) return;
      if (role === "host") {
        const open = (attempt: number) => {
          if (!alive) return;
          const p = new PeerCtor(hostId, PEER_OPTIONS);
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
            setNote(`Found ${opts.current.hostName}'s table. Checking it's really them…`);
            nonce.current = crypto.randomUUID();
            c.send({ t: "challenge", nonce: nonce.current } satisfies Wire);
          });
          const gone = () => {
            if (c !== hostConn.current || stageRef.current === "error" || stageRef.current === "full") return;
            setNote("The connection to the table dropped. Trying again…");
            setStage("reconnecting");
          };
          c.on("close", gone);
          c.on("error", gone);
        };
        // A friend's own link to the relay. If it fails before it ever opened (a busy relay, a
        // network blip as the page loads), start a fresh one: reconnect() only works after an open.
        const start = (attempt: number) => {
          if (!alive) return;
          const p = new PeerCtor(PEER_OPTIONS);
          peer.current = p;
          p.on("open", () => {
            setNote(`Looking for ${opts.current.hostName}'s table…`);
            dial();
          });
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
              setNote(`${opts.current.hostName}'s table isn't open yet. They need the game night page open on this same site.`);
              if (stageRef.current === "connecting") setStage("reconnecting");
              if (!knocked) {
                knocked = true;
                opts.current.onHostAway?.();
              }
              later(dial, 3000);
            } else if (TRANSIENT.includes(e.type)) {
              setNote("Can't reach the connection service yet. Trying again…");
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
      void audioCtx.current?.close().catch(() => {});
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
      note,
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
      gift,
      onFloats,
      chat,
      onChat,
      voice: { on: voiceOn, muted, noMic, toggleMute },
      race: { start: startRace, boost: boostMe, on: onRace },
    }),
    [o.role, me, o.hostName, players, phase, stage, err, note, live, snap, stateOf, publish, act, bind, startGame, backToLobby, removePlayer, react, gift, onFloats, chat, onChat, voiceOn, muted, noMic, toggleMute, startRace, boostMe, onRace],
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
