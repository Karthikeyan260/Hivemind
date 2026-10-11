"use client";

import { Chess, type Color, type PieceSymbol, type Square } from "chess.js";
import { Copy, Flag, Handshake, Mic, MicOff, RotateCcw, Send, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cx } from "@/components/ui";
import { usePeerGame } from "@/lib/games/peer-game";
import { sfx } from "@/lib/sfx";
import { Board, captured, Taken } from "./board";
import { endOf, MoveList, Pick, resultText, TimePicker, tcLabel, type Result, type TimeControl } from "./shared";
import { Action, PlayerBar } from "./vs-bot";

/**
 * Chess online with a friend (through the owner's game link): time controls from 1 minute to 15+10,
 * draw offers, resign, rematch with colours swapped, voice chat. The owner's browser runs the game
 * and the clock and checks every move; the clock pauses while either side is reconnecting.
 */
type Side = "host" | "guest";
type Net = {
  history: string[];
  white: Side;
  tc: TimeControl;
  /** Time left for each colour at the start of the current turn. */
  clock: { w: number; b: number } | null;
  /** Time the side to move had already used when this state was sent (the friend counts on from it). */
  used: number;
  paused: boolean;
  result: Result;
  drawOffer: Side | null;
  names: Record<Side, string>;
  seq: number;
};
type Action = { type: "move"; san: string } | { type: "resign" } | { type: "draw"; answer?: boolean };

const okState = (s: unknown): s is Net => {
  const x = s as Net;
  return !!x && Array.isArray(x.history) && (x.white === "host" || x.white === "guest") && typeof x.seq === "number";
};
const colourOf = (n: Net, side: Side): Color => (n.white === side ? "w" : "b");

export function ChessVsFriend({ role, room, myName, hostName = "Host", onHostAway }: { role: Side; room: string; myName: string; hostName?: string; onHostAway?: () => void }) {
  const me = role;
  const stateRef = useRef<Net | null>(null);
  const publishRef = useRef<(s: Net) => void>(() => {});
  /** Host: when the side to move started (this device's clock). */
  const turnStart = useRef(0);
  const usedNow = () => (stateRef.current && !stateRef.current.paused ? Date.now() - turnStart.current : 0);
  const apply = useCallback((fn: (s: Net) => Net) => {
    const cur = stateRef.current;
    if (!cur) return;
    const next = fn(cur);
    if (next !== cur) {
      stateRef.current = next;
      publishRef.current({ ...next, used: usedNow() });
    }
  }, []);

  /** Host: a move by `by`, checked; clock with increment; the end of the game. */
  const move = useCallback(
    (by: Side, san: string) =>
      apply((s) => {
        if (s.result || s.paused) return s;
        const c = new Chess();
        for (const m of s.history) c.move(m);
        const colour = c.turn();
        if (colourOf(s, by) !== colour) return s;
        let m;
        try {
          m = c.move(san);
        } catch {
          return s;
        }
        let clock = s.clock;
        if (clock && s.tc) clock = { ...clock, [colour]: clock[colour] - (Date.now() - turnStart.current) + s.tc.inc * 1000 };
        turnStart.current = Date.now();
        return { ...s, history: [...s.history, m.san], clock, result: endOf(c), drawOffer: null, seq: s.seq + 1 };
      }),
    [apply],
  );
  const onAction = useCallback(
    (by: Side, a: Action) => {
      if (a.type === "move" && typeof a.san === "string") move(by, a.san.slice(0, 10));
      else if (a.type === "resign") apply((s) => (s.result ? s : { ...s, result: { winner: colourOf(s, by) === "w" ? "b" : "w", reason: "resignation" }, seq: s.seq + 1 }));
      else if (a.type === "draw")
        apply((s) => {
          if (s.result) return s;
          if (a.answer === undefined) return s.drawOffer ? s : { ...s, drawOffer: by, seq: s.seq + 1 };
          // Only the other side answers an offer.
          if (!s.drawOffer || s.drawOffer === by) return s;
          return a.answer ? { ...s, result: { winner: null, reason: "agreement" }, drawOffer: null, seq: s.seq + 1 } : { ...s, drawOffer: null, seq: s.seq + 1 };
        });
    },
    [apply, move],
  );

  const net = usePeerGame<Net, Action>({ role, kind: "chess", room, myName, hostName, onHostAway, accept: okState, onAction: (a) => onAction("guest", a) });
  const { stage, err, other, state: s, publish, forget, voiceOn, muted, toggleMute, noMic, knocked, audioRef, connected } = net;
  useEffect(() => {
    stateRef.current = s;
    publishRef.current = publish;
  });

  // Host settings for a new game.
  const [tc, setTc] = useState<TimeControl>({ base: 10, inc: 0 });
  const [colour, setColour] = useState<"w" | "b" | "random">("random");
  const [copied, setCopied] = useState(false);
  function start(rematch = false) {
    const prev = stateRef.current;
    const hostWhite = rematch && prev ? prev.white !== "host" : colour === "random" ? Math.random() < 0.5 : colour === "w";
    const t = rematch && prev ? prev.tc : tc;
    turnStart.current = Date.now();
    const g: Net = { history: [], white: hostWhite ? "host" : "guest", tc: t, clock: t ? { w: t.base * 60_000, b: t.base * 60_000 } : null, used: 0, paused: false, result: null, drawOffer: null, names: { host: myName, guest: other || "Friend" }, seq: (prev?.seq ?? 0) + 1 };
    stateRef.current = g;
    publish(g);
    sfx.boot();
  }

  // Host: the clock pauses while the friend is away, and a flag falls at zero.
  useEffect(() => {
    if (role !== "host") return;
    const cur = stateRef.current;
    if (!cur || cur.result || !cur.clock) return;
    const c = new Chess();
    for (const m of cur.history) c.move(m);
    const turn = c.turn();
    if (!connected && !cur.paused) {
      apply((x) => ({ ...x, paused: true, clock: { ...x.clock!, [turn]: x.clock![turn] - (Date.now() - turnStart.current) }, seq: x.seq + 1 }));
    } else if (connected && cur.paused) {
      turnStart.current = Date.now();
      apply((x) => ({ ...x, paused: false, seq: x.seq + 1 }));
    }
  }, [role, connected, apply, s?.seq]);
  useEffect(() => {
    if (role !== "host" || !s?.clock || s.result || s.paused) return;
    const t = setInterval(() => {
      const cur = stateRef.current;
      if (!cur?.clock || cur.result || cur.paused) return;
      const c = new Chess();
      for (const m of cur.history) c.move(m);
      const turn = c.turn();
      if (cur.clock[turn] - (Date.now() - turnStart.current) <= 0) apply((x) => ({ ...x, clock: { ...x.clock!, [turn]: 0 }, result: { winner: turn === "w" ? "b" : "w", reason: "time" }, seq: x.seq + 1 }));
    }, 200);
    return () => clearInterval(t);
  }, [role, s?.clock, s?.result, s?.paused, apply]);

  // Both sides: the clock face ticks; the friend counts on from what the host sent.
  const [tick, setTick] = useState(0);
  // When the side to move started, on this device's clock (from the time it had already used).
  const [base, setBase] = useState({ seq: -1, at: 0 });
  useEffect(() => {
    if (!s?.clock || s.result) return;
    const t = setInterval(() => setTick(Date.now()), 100);
    return () => clearInterval(t);
  }, [s?.clock, s?.result]);
  const seq = s?.seq;
  const used = s?.used ?? 0;
  useEffect(() => {
    if (seq === undefined) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- a new game state just arrived
    setBase({ seq, at: Date.now() - used });
  }, [seq, used]);

  // Sounds for moves and the end.
  const n = s?.history.length ?? 0;
  const lastSan = s?.history[n - 1];
  useEffect(() => {
    if (!lastSan) return;
    if (lastSan.includes("#")) sfx.done();
    else if (lastSan.includes("x")) sfx.send();
    else if (lastSan.includes("+")) sfx.lock();
    else sfx.hover();
  }, [n, lastSan]);

  const history = s?.history;
  const game = useMemo(() => {
    const c = new Chess();
    for (const m of history ?? []) c.move(m);
    return c;
  }, [history]);
  const myColour: Color = s ? colourOf(s, me) : "w";
  const oppColour: Color = myColour === "w" ? "b" : "w";
  const turn = game.turn();
  const live = connected && !!s && !s.result && !s.paused;

  function onMove(from: Square, to: Square, promotion?: PieceSymbol) {
    const m = game.moves({ verbose: true }).find((x) => x.from === from && x.to === to && (!x.promotion || x.promotion === (promotion ?? "q")));
    if (!m) return;
    if (role === "host") move("host", m.san);
    else net.act({ type: "move", san: m.san });
  }
  const send = (a: Action) => (role === "host" ? onAction("host", a) : net.act(a));

  // Clock faces: the side to move counts down from the start of its turn.
  const clockOf = (c: Color): number | null => {
    if (!s?.clock) return null;
    if (s.result || s.paused || turn !== c) return s.clock[c];
    const since = tick && base.seq === s.seq ? tick - base.at : s.used;
    return s.clock[c] - Math.max(0, since);
  };

  const invite = typeof window === "undefined" ? "" : `${location.origin}/play/${room}?g=chess&from=${encodeURIComponent(myName)}`;
  const status =
    stage === "connecting"
      ? "Connecting…"
      : stage === "waiting"
        ? role === "host"
          ? "Waiting for your friend to open the link…"
          : knocked
            ? `Waiting for ${hostName}… we sent them a notification, it connects as soon as they open the game.`
            : `Waiting for ${hostName} to open the game…`
        : stage === "reconnecting"
          ? `Connection lost. Reconnecting to ${other || "your friend"}… the clock is paused.`
          : stage === "error"
            ? err
            : !s
              ? role === "host"
                ? `${other} is here! Choose the time and start.`
                : `Connected! ${hostName} is setting up the game.`
              : "";
  const names: Record<Color, string> = s ? { [colourOf(s, "host")]: s.names.host, [colourOf(s, "guest")]: s.names.guest } as Record<Color, string> : { w: "", b: "" };
  const end = s?.result ? resultText(s.result, myColour, names) : null;
  const { taken, lead } = captured(s?.history ?? []);

  return (
    <div className="flex flex-col gap-3" onPointerDown={() => audioRef.current?.srcObject && audioRef.current.paused && void audioRef.current.play().catch(() => {})}>
      <audio ref={audioRef} autoPlay playsInline />
      <div className="flex items-center gap-2">
        {status && <p className={cx("text-sm", stage === "error" ? "text-alert" : stage === "reconnecting" ? "animate-pulse text-core" : "text-soft")}>{status}</p>}
        <span className="ml-auto">
          {voiceOn ? (
            <button type="button" onClick={toggleMute} className={cx("flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs", muted ? "border-alert text-alert" : "border-ok/50 text-ok")}>
              {muted ? <MicOff size={13} /> : <Mic size={13} />} {muted ? "Muted" : "Voice on"}
            </button>
          ) : (
            <span className={cx("flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs", noMic ? "border-alert/50 text-alert" : "border-line text-faint")}>
              {noMic ? <MicOff size={13} /> : <Mic size={13} />} {noMic ? "Mic blocked" : connected ? "Voice connecting…" : "Voice"}
            </span>
          )}
        </span>
      </div>

      {role === "host" && stage === "waiting" && !s && (
        <div className="flex flex-wrap gap-2">
          <a href={`https://wa.me/?text=${encodeURIComponent(`${myName} challenges you to chess on HIVEMIND! Tap to play: ${invite}`)}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-full bg-ok/90 px-4 py-2 text-sm font-medium text-black">
            <Send size={14} /> Invite on WhatsApp
          </a>
          <button type="button" onClick={() => void navigator.clipboard?.writeText(invite).then(() => setCopied(true))} className="inline-flex items-center gap-1.5 rounded-full border border-line px-4 py-2 text-sm text-soft">
            <Copy size={14} /> {copied ? "Link copied" : "Copy link"}
          </button>
        </div>
      )}

      {role === "host" && connected && !s && (
        <div className="flex flex-col gap-4 rounded-2xl border border-line bg-panel p-4">
          <div>
            <p className="mb-2 text-sm font-semibold">Time control</p>
            <TimePicker value={tc} onChange={setTc} />
          </div>
          <div>
            <p className="mb-2 text-sm font-semibold">You play</p>
            <Pick
              options={[
                { value: "w", label: "♔ White" },
                { value: "b", label: "♚ Black" },
                { value: "random", label: "🎲 Random" },
              ]}
              value={colour}
              onChange={setColour}
            />
          </div>
          <button type="button" onClick={() => start()} className="self-start rounded-full bg-core px-6 py-2.5 text-base font-bold text-core-ink shadow-lg transition-transform hover:scale-105">
            Start game
          </button>
        </div>
      )}

      {s && (
        <div className={cx("grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]", stage === "reconnecting" && "opacity-70")}>
          <div className="flex flex-col gap-2">
            <PlayerBar name={names[oppColour] || other} active={!s.result && turn === oppColour} clock={clockOf(oppColour)} taken={<Taken pieces={taken[oppColour]} by={oppColour} lead={oppColour === "w" ? lead : -lead} />} />
            <div className="relative">
              <Board history={s.history} orientation={myColour} canMove={live} onMove={onMove} />
              {s.drawOffer && !s.result && (
                <div className="absolute inset-x-3 top-3 z-10 flex flex-wrap items-center justify-center gap-2 rounded-xl bg-black/80 p-3 text-sm text-white">
                  {s.drawOffer === me ? (
                    "You offered a draw…"
                  ) : (
                    <>
                      <Handshake size={18} /> {names[oppColour]} offers a draw.
                      <button type="button" onClick={() => send({ type: "draw", answer: true })} className="rounded-full bg-ok px-3 py-1 font-bold text-black">
                        Accept
                      </button>
                      <button type="button" onClick={() => send({ type: "draw", answer: false })} className="rounded-full border border-white/40 px-3 py-1">
                        <X size={13} className="inline" /> Decline
                      </button>
                    </>
                  )}
                </div>
              )}
              {end && (
                <div className="absolute inset-0 z-10 flex flex-col items-center justify-center rounded-lg bg-black/55 backdrop-blur-[2px]">
                  <div className="text-3xl font-black text-white drop-shadow">{end.title}</div>
                  <div className="mt-1 text-sm text-white/80">{end.sub}</div>
                  {role === "host" ? (
                    connected && (
                      <button type="button" onClick={() => start(true)} className="mt-4 flex items-center gap-1.5 rounded-full bg-core px-5 py-2 font-bold text-core-ink">
                        <RotateCcw size={16} /> Rematch (swap colours)
                      </button>
                    )
                  ) : (
                    <div className="mt-3 text-sm text-white/80">{hostName} can start a rematch.</div>
                  )}
                </div>
              )}
            </div>
            <PlayerBar name={`${myName} (you)`} active={!s.result && turn === myColour} clock={clockOf(myColour)} taken={<Taken pieces={taken[myColour]} by={myColour} lead={myColour === "w" ? lead : -lead} />} />
          </div>
          <div className="flex flex-col gap-3">
            <div className="text-xs text-soft">
              {tcLabel(s.tc)} · you play {myColour === "w" ? "White" : "Black"}
              {s.paused && " · paused"}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Action onClick={() => send({ type: "draw" })} disabled={!live || !!s.drawOffer || s.history.length < 2} icon={<Handshake size={16} />}>
                Offer draw
              </Action>
              <Action onClick={() => confirm("Resign this game?") && send({ type: "resign" })} disabled={!!s.result || !connected} icon={<Flag size={16} />} danger>
                Resign
              </Action>
            </div>
            <MoveList history={s.history} />
          </div>
        </div>
      )}

      {(stage === "reconnecting" || stage === "error") && s && (
        <button
          type="button"
          onClick={() => {
            forget();
            location.reload();
          }}
          className="self-start text-xs text-soft underline hover:text-fg"
        >
          Leave this game and start fresh
        </button>
      )}
    </div>
  );
}
