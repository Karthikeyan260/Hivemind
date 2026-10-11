"use client";

import type { DataConnection, MediaConnection, Peer } from "peerjs";
import { useCallback, useEffect, useRef, useState } from "react";
import { checkHost, proveHost, type PeerKind } from "@/lib/peer-auth";

/**
 * Two-player online games (browser to browser over PeerJS), the host-runs-everything way: the owner's
 * browser holds the game state and sends all of it to the friend after every change; the friend only
 * sends requests ("roll", "move token 2") that the host checks. So a dropped connection or a reload
 * just needs the latest state sent again. Also: the friend checks the host is the owner's real
 * browser (lib/peer-auth), voice chat rides along, both sides reconnect on their own, and each side
 * keeps the game in its tab (sessionStorage) so a reload carries on.
 */
export type PeerStage = "connecting" | "waiting" | "connected" | "reconnecting" | "error";
type Wire<S, A> =
  | { t: "challenge"; nonce: string }
  | { t: "proof"; proof: string }
  | { t: "hello"; name: string; id?: string }
  | { t: "state"; s: S }
  | { t: "act"; a: A };

const GIVE_UP_MS = 3 * 60_000;
const KEEP_MS = 45 * 60_000;
const cleanName = (v: unknown) => String(v ?? "").slice(0, 20).replace(/[^\p{L}\p{N} .'-]/gu, "").trim();
const TRANSIENT = ["network", "disconnected", "server-error", "socket-error", "socket-closed"];

type Opts<S, A> = {
  role: "host" | "guest";
  kind: PeerKind;
  room: string;
  myName: string;
  hostName: string;
  /** Host: a request from the friend (already known to come from the friend in the game). */
  onAction?: (a: A) => void;
  /** Guest: the host isn't in the game yet (called once, to knock). */
  onHostAway?: () => void;
  /** Guest: checks a state from the host before it's shown (the host is verified, but be safe). */
  accept?: (s: unknown) => s is S;
  /** Host: what the friend may see of the game (e.g. not the others' cards). The host keeps it all. */
  viewForGuest?: (s: S) => S;
};

export function usePeerGame<S, A>(o: Opts<S, A>) {
  const KEY = `hm-${o.kind}-${o.role}-${o.room}`;
  const [saved] = useState(() => {
    try {
      const v = JSON.parse(sessionStorage.getItem(KEY) ?? "null") as { at: number; state: S | null; other: string; guestId?: string } | null;
      return v && Date.now() - v.at < KEEP_MS ? v : null;
    } catch {
      return null;
    }
  });
  const [stage, setStage] = useState<PeerStage>(saved?.state ? "reconnecting" : "connecting");
  const [err, setErr] = useState("");
  const [other, setOther] = useState(saved?.other || (o.role === "guest" ? o.hostName : ""));
  const [state, setLocal] = useState<S | null>(saved?.state ?? null);
  const [voiceOn, setVoiceOn] = useState(false);
  const [muted, setMuted] = useState(false);
  const [noMic, setNoMic] = useState(false);
  const [knocked, setKnocked] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const peer = useRef<Peer | null>(null);
  const conn = useRef<DataConnection | null>(null);
  const call = useRef<MediaConnection | null>(null);
  const mic = useRef<MediaStream | null>(null);
  const verified = useRef(false);
  const nonce = useRef("");
  const guestId = useRef(saved?.guestId ?? "");
  const myId = useRef("");
  const giveUp = useRef<ReturnType<typeof setTimeout> | null>(null);
  const knockedRef = useRef(false);
  const stateRef = useRef<S | null>(state);
  const otherRef = useRef(other);
  const stageRef = useRef(stage);
  const opts = useRef(o);
  useEffect(() => {
    opts.current = o;
    otherRef.current = other;
    stageRef.current = stage;
  });

  const save = useCallback(() => {
    try {
      sessionStorage.setItem(KEY, JSON.stringify({ at: Date.now(), state: stateRef.current, other: otherRef.current, guestId: guestId.current || undefined }));
    } catch {}
  }, [KEY]);

  /** Host: the new game state, shown here and sent to the friend. */
  const publish = useCallback(
    (s: S) => {
      stateRef.current = s;
      setLocal(s);
      if (conn.current?.open && o.role === "host") conn.current.send({ t: "state", s: opts.current.viewForGuest ? opts.current.viewForGuest(s) : s } satisfies Wire<S, A>);
      save();
    },
    [o.role, save],
  );
  /** Guest: ask the host to do something. */
  const act = useCallback((a: A) => {
    if (conn.current?.open && verified.current) conn.current.send({ t: "act", a } satisfies Wire<S, A>);
  }, []);
  /** Forget this tab's game (start fresh). */
  const forget = useCallback(() => {
    stateRef.current = null;
    try {
      sessionStorage.removeItem(KEY);
    } catch {}
  }, [KEY]);

  const playVoice = useCallback((stream: MediaStream) => {
    if (audioRef.current) {
      audioRef.current.srcObject = stream;
      void audioRef.current.play().catch(() => {});
    }
    setVoiceOn(true);
  }, []);
  const toggleMute = useCallback(() => {
    setMuted((m) => {
      mic.current?.getAudioTracks().forEach((t) => (t.enabled = m));
      return !m;
    });
  }, []);

  const lost = useCallback(() => {
    if (stageRef.current === "error") return;
    setStage("reconnecting");
    if (!giveUp.current)
      giveUp.current = setTimeout(() => {
        giveUp.current = null;
        if (stageRef.current !== "reconnecting") return;
        setErr(`Lost ${otherRef.current || "the other player"} for a few minutes. Open the game again to carry on.`);
        setStage("error");
      }, GIVE_UP_MS);
  }, []);
  const back = useCallback(() => {
    if (giveUp.current) clearTimeout(giveUp.current);
    giveUp.current = null;
    setStage("connected");
  }, []);

  useEffect(() => {
    const { role, kind, room } = opts.current;
    let alive = true;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const later = (fn: () => void, ms: number) => {
      const t = setTimeout(() => {
        timers.delete(t);
        if (alive) fn();
      }, ms);
      timers.add(t);
    };
    const hostId = `hivemind-${kind}-${room}`;
    let dial: () => void = () => {};

    const onData = (c: DataConnection, m: Wire<S, A>) => {
      if (!m || typeof m !== "object") return;
      if (role === "host") {
        if (m.t === "challenge") {
          void proveHost(kind, room, String(m.nonce).slice(0, 64)).then((proof) => proof && c.open && c.send({ t: "proof", proof } satisfies Wire<S, A>));
          return;
        }
        if (m.t === "hello") {
          const id = String(m.id ?? "").slice(0, 64);
          // Another friend while one is still connected: this game is taken.
          if (conn.current && conn.current !== c && conn.current.open && guestId.current && id !== guestId.current) return void c.close();
          if (conn.current && conn.current !== c) conn.current.close();
          conn.current = c;
          if (id) guestId.current = id;
          setOther(cleanName(m.name) || "Guest");
          back();
          c.send({ t: "hello", name: opts.current.myName } satisfies Wire<S, A>);
          if (stateRef.current) c.send({ t: "state", s: opts.current.viewForGuest ? opts.current.viewForGuest(stateRef.current) : stateRef.current } satisfies Wire<S, A>);
          return;
        }
        if (m.t === "act" && c === conn.current) opts.current.onAction?.(m.a);
        return;
      }
      // Guest: nothing counts until the host proves it's the owner (on every connection).
      if (!verified.current) {
        if (m.t !== "proof") return;
        void checkHost(kind, room, nonce.current, m.proof).then((ok) => {
          if (c !== conn.current) return;
          if (!ok) {
            setErr("This link isn't answered by its owner right now. Try again later.");
            setStage("error");
            c.close();
            return;
          }
          verified.current = true;
          c.send({ t: "hello", name: opts.current.myName, id: myId.current } satisfies Wire<S, A>);
          const p = peer.current;
          if (p && mic.current) {
            call.current?.close();
            const mc = p.call(hostId, mic.current);
            call.current = mc;
            mc.on("stream", playVoice);
          }
        });
        return;
      }
      if (m.t === "hello") {
        setOther(cleanName(m.name) || opts.current.hostName);
        back();
      } else if (m.t === "state" && (!opts.current.accept || opts.current.accept(m.s))) {
        stateRef.current = m.s;
        setLocal(m.s);
        save();
        back();
      }
    };

    const wire = (c: DataConnection) => {
      c.on("data", (d) => onData(c, d as Wire<S, A>));
      c.on("open", () => {
        if (role === "host") return;
        verified.current = false;
        nonce.current = crypto.randomUUID();
        c.send({ t: "challenge", nonce: nonce.current } satisfies Wire<S, A>);
      });
      c.on("close", () => c === conn.current && lost());
      c.on("error", () => c === conn.current && lost());
    };

    const wake = () => {
      if (document.hidden || !alive) return;
      const p = peer.current;
      if (p && !p.destroyed && p.disconnected) p.reconnect();
      if (role === "guest" && !conn.current?.open) dial();
    };
    const hide = () => document.hidden && save();
    document.addEventListener("visibilitychange", wake);
    document.addEventListener("visibilitychange", hide);
    window.addEventListener("online", wake);
    window.addEventListener("pagehide", save);

    (async () => {
      mic.current = (await navigator.mediaDevices?.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }).catch(() => null)) ?? null;
      if (!mic.current) setNoMic(true);
      const { default: PeerCtor } = await import("peerjs");
      if (!alive) return;
      if (role === "host") {
        const open = (attempt: number) => {
          if (!alive) return;
          const p = new PeerCtor(hostId);
          peer.current = p;
          p.on("open", () => setStage((s) => (s === "connecting" ? "waiting" : s)));
          p.on("connection", wire);
          p.on("call", (mc) => {
            call.current?.close();
            call.current = mc;
            mc.answer(mic.current ?? undefined);
            mc.on("stream", playVoice);
          });
          p.on("error", (e) => {
            if (!alive) return;
            if (e.type === "unavailable-id") {
              // After a reload the old tab's claim lingers a little: keep trying for a minute.
              p.destroy();
              if (attempt < 20) return later(() => open(attempt + 1), 3000);
              setErr("This game is already open in another tab.");
              setStage("error");
            } else if (TRANSIENT.includes(e.type)) later(() => !p.destroyed && p.disconnected && p.reconnect(), 2000);
            else {
              setErr("Couldn't open the game. Check your connection.");
              setStage("error");
            }
          });
          p.on("disconnected", () => later(() => !p.destroyed && p.disconnected && p.reconnect(), 1000));
        };
        open(0);
      } else {
        try {
          myId.current = localStorage.getItem("hm-play-id") || crypto.randomUUID();
          localStorage.setItem("hm-play-id", myId.current);
        } catch {
          myId.current ||= crypto.randomUUID();
        }
        const p = new PeerCtor();
        peer.current = p;
        let lastDial = 0;
        dial = () => {
          if (!alive || p.destroyed || p.disconnected || Date.now() - lastDial < 2500) return;
          lastDial = Date.now();
          const old = conn.current;
          conn.current = null;
          old?.close();
          const c = p.connect(hostId, { reliable: true });
          conn.current = c;
          wire(c);
        };
        p.on("open", dial);
        p.on("disconnected", () => later(() => !p.destroyed && p.disconnected && p.reconnect(), 1000));
        p.on("error", (e) => {
          if (!alive) return;
          if (e.type === "peer-unavailable") {
            if (stageRef.current === "connecting") setStage("waiting");
            if (opts.current.onHostAway && !stateRef.current && !knockedRef.current) {
              knockedRef.current = true;
              opts.current.onHostAway();
              setKnocked(true);
            }
            later(dial, 3000);
          } else if (TRANSIENT.includes(e.type)) later(() => (!p.destroyed && p.disconnected ? p.reconnect() : dial()), 2000);
          else {
            setErr("Couldn't join the game. Check your connection.");
            setStage("error");
          }
        });
      }
    })();

    const redial = setInterval(() => {
      if (role === "guest" && alive && (stageRef.current === "reconnecting" || stageRef.current === "waiting") && !conn.current?.open) dial();
    }, 4000);

    return () => {
      alive = false;
      timers.forEach(clearTimeout);
      clearInterval(redial);
      if (giveUp.current) clearTimeout(giveUp.current);
      document.removeEventListener("visibilitychange", wake);
      document.removeEventListener("visibilitychange", hide);
      window.removeEventListener("online", wake);
      window.removeEventListener("pagehide", save);
      call.current?.close();
      const c = conn.current;
      conn.current = null;
      c?.close();
      peer.current?.destroy();
      mic.current?.getTracks().forEach((t) => t.stop());
    };
  }, [back, lost, playVoice, save]);

  return { stage, err, other, state, publish, act, forget, voiceOn, muted, toggleMute, noMic, knocked, audioRef, connected: stage === "connected" };
}
