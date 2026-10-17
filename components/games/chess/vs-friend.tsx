"use client";

import { Chess, type Color, type PieceSymbol, type Square } from "chess.js";
import { Flag, Handshake, Mic, MicOff, RotateCcw, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cx } from "@/components/ui";
import { useVoiceActions } from "@/components/voice/provider";
import { type Party, usePartyGame } from "@/lib/games/party";
import { usePeerGame } from "@/lib/games/peer-game";
import { sfx } from "@/lib/sfx";
import { Board, captured, Taken } from "./board";
import { gameKey, recordResult } from "@/lib/games/record";
import { endOf, MoveList, Pick, resultText, spokenMove, TimePicker, tcLabel, type Result, type TimeControl } from "./shared";
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
  /** Game night: which friend plays the "guest" side (everyone else watches). */
  guestId?: string;
  seq: number;
};
type Action = { type: "move"; san: string } | { type: "resign" } | { type: "draw"; answer?: boolean };

const okState = (s: unknown): s is Net => {
  const x = s as Net;
  return !!x && Array.isArray(x.history) && (x.white === "host" || x.white === "guest") && typeof x.seq === "number";
};
const colourOf = (n: Net, side: Side): Color => (n.white === side ? "w" : "b");

export function ChessVsFriend({
  role,
  room,
  myName,
  hostName = "Host",
  onHostAway,
  party = null,
}: {
  role: Side;
  room: string;
  myName: string;
  hostName?: string;
  onHostAway?: () => void;
  /** Game night: the owner plays one friend they pick; everyone else watches. */
  party?: Party | null;
}) {
  const isHost = party ? party.role === "host" : role === "host";
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

  const peerNet = usePeerGame<Net, Action>({ role, kind: "chess", room, myName, hostName, onHostAway, accept: okState, onAction: (a) => onAction("guest", a), off: !!party });
  // Game night: only the friend playing the other side may move; watchers' taps are ignored.
  const partyNet = usePartyGame<Net, Action>(party, "chess", { accept: okState, onAction: (from, a) => from === stateRef.current?.guestId && onAction("guest", a) });
  const net = partyNet ?? peerNet;
  const { stage, err, state: s, publish, forget, voiceOn, muted, toggleMute, noMic, knocked, audioRef } = net;
  // At game night "the other player" is the friend picked to play; the clock pauses while they're away.
  const opponent = party && s?.guestId ? party.players.find((p) => p.id === s.guestId) : null;
  const other = party ? (opponent?.name ?? "") : net.other;
  const connected = party ? net.connected && (isHost ? !s || !!opponent?.online : true) : net.connected;
  // Who I am in this game: a side, or (game night, not playing) a watcher.
  const me: Side | null = isHost ? "host" : !party ? role : s?.guestId === party.me ? "guest" : null;
  useEffect(() => {
    stateRef.current = s;
    publishRef.current = publish;
  });

  // The owner's record: the host's device saves each finished game once.
  useEffect(() => {
    if (!isHost || !s?.result) return;
    const mine = colourOf(s, "host");
    recordResult(`chess-friend-${room}-${gameKey(...s.history, s.result.reason, s.white)}`, {
      game: "chess",
      mode: "friend",
      outcome: !s.result.winner ? "draw" : s.result.winner === mine ? "win" : "loss",
      vs: s.names.guest,
      detail: s.result.reason,
    });
  }, [isHost, room, s]);

  // Host settings for a new game.
  const [tcPick, setTc] = useState<TimeControl>({ base: 10, inc: 0 });
  const [colourPick, setColour] = useState<"w" | "b" | "random">("random");
  const friends = party ? party.players.filter((p) => !p.host && p.online) : [];
  const [rival, setRival] = useState("");
  const rivalId = friends.some((f) => f.id === rival) ? rival : (friends[0]?.id ?? "");
  /** `o`: settings said by voice, used at once (the pickers' state only changes on the next render). */
  function start(rematch = false, o: { tc?: TimeControl; colour?: "w" | "b" | "random"; rival?: string } = {}) {
    const prev = stateRef.current;
    const tc = o.tc !== undefined ? o.tc : tcPick;
    const colour = o.colour ?? colourPick;
    const gid = party ? (rematch && prev?.guestId ? prev.guestId : (o.rival ?? rivalId)) : undefined;
    const gname = party ? (party.players.find((p) => p.id === gid)?.name ?? "Friend") : other || "Friend";
    const hostWhite = rematch && prev ? prev.white !== "host" : colour === "random" ? Math.random() < 0.5 : colour === "w";
    const t = rematch && prev ? prev.tc : tc;
    turnStart.current = Date.now();
    const g: Net = { history: [], white: hostWhite ? "host" : "guest", tc: t, clock: t ? { w: t.base * 60_000, b: t.base * 60_000 } : null, used: 0, paused: false, result: null, drawOffer: null, names: { host: myName, guest: gname }, guestId: gid, seq: (prev?.seq ?? 0) + 1 };
    stateRef.current = g;
    publish(g);
    sfx.boot();
  }

  // Host: the clock pauses while the friend is away, and a flag falls at zero.
  useEffect(() => {
    if (!isHost) return;
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
  }, [isHost, connected, apply, s?.seq]);
  useEffect(() => {
    if (!isHost || !s?.clock || s.result || s.paused) return;
    const t = setInterval(() => {
      const cur = stateRef.current;
      if (!cur?.clock || cur.result || cur.paused) return;
      const c = new Chess();
      for (const m of cur.history) c.move(m);
      const turn = c.turn();
      if (cur.clock[turn] - (Date.now() - turnStart.current) <= 0) apply((x) => ({ ...x, clock: { ...x.clock!, [turn]: 0 }, result: { winner: turn === "w" ? "b" : "w", reason: "time" }, seq: x.seq + 1 }));
    }, 200);
    return () => clearInterval(t);
  }, [isHost, s?.clock, s?.result, s?.paused, apply]);

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
  // A watcher sees the board from White's side.
  const myColour: Color = s && me ? colourOf(s, me) : "w";
  const oppColour: Color = myColour === "w" ? "b" : "w";
  const turn = game.turn();
  const live = connected && !!s && !s.result && !s.paused && !!me;

  function onMove(from: Square, to: Square, promotion?: PieceSymbol) {
    const m = game.moves({ verbose: true }).find((x) => x.from === from && x.to === to && (!x.promotion || x.promotion === (promotion ?? "q")));
    if (!m) return;
    if (isHost) move("host", m.san);
    else if (me) net.act({ type: "move", san: m.san });
  }
  const send = (a: Action) => (isHost ? onAction("host", a) : me ? net.act(a) : undefined);

  // (Voice calls start through a ref: it reads the clock and dice, so it can't be called while rendering.)
  const startRef = useRef(start);
  useEffect(() => {
    startRef.current = start;
  });
  // Voice: the owner plays a friend by speaking ("play Priya as white with 5 minutes", "knight to f3", "offer a draw").
  useVoiceActions({
    chess_friend_start: {
      description: "Chess page (vs a friend, or Chess at game night): start a game. input: in words, any of a colour (white, black, random), a clock ('5 min', '3 plus 2', 'no clock') and, at game night, the friend's name to play.",
      run: ({ input }) => {
        if (!isHost) return { error: "Only the host starts the game." };
        const t = String(input ?? "").toLowerCase();
        const pick = party ? friends.find((f) => t.includes(f.name.toLowerCase())) : undefined;
        if (party && !pick && !rivalId) return { error: "No friend is here to play yet." };
        if (!party && !connected) return { error: "Your friend isn't here yet." };
        const colour = /black/.test(t) ? "b" : /white/.test(t) ? "w" : /random/.test(t) ? "random" : undefined;
        const clock = t.match(/(\d+)\s*(?:min\w*)?\s*(?:\||plus|\+)\s*(\d+)/) ?? t.match(/(\d+)\s*min/);
        const tc: TimeControl | undefined = clock ? { base: Number(clock[1]), inc: Number(clock[2] ?? 0) } : /no clock|without/.test(t) ? null : undefined;
        if (pick) setRival(pick.id);
        if (colour) setColour(colour);
        if (tc !== undefined) setTc(tc);
        startRef.current(false, { tc, colour, rival: pick?.id });
        return { started: true, against: pick?.name ?? other ?? "your friend" };
      },
    },
    chess_friend_move: {
      description: "Chess page (vs a friend): make the owner's move. input: the move as said, e.g. 'e4', 'knight to f3', 'e2 to e4', 'castle kingside'. If it asks 'which one', ask the owner.",
      run: ({ input }) => {
        if (!s) return { error: "No game yet." };
        if (!me) return { error: "You're watching this game." };
        if (s.result) return { error: "The game is over." };
        if (!live) return { error: "The game is paused until your friend is back." };
        if (turn !== myColour) return { error: `Wait: it's ${s.names[me === "host" ? "guest" : "host"]}'s turn.` };
        const r = spokenMove(game, String(input ?? ""));
        if ("error" in r) return r;
        if (isHost) move("host", r.san);
        else net.act({ type: "move", san: r.san });
        return { played: r.san };
      },
    },
    chess_friend_status: {
      description: "Chess page (vs a friend): the game in words: who plays which colour, last moves, whose turn, check, clocks, result, any draw offer.",
      run: () => {
        // The latest state (a move or offer said a moment ago may not have re-rendered yet).
        const s = stateRef.current;
        if (!s) return { error: "No game yet." };
        const game = new Chess();
        for (const m of s.history) game.move(m);
        const turn = game.turn();
        const nameOf = (c: Color) => (s.white === "host" ? (c === "w" ? s.names.host : s.names.guest) : c === "w" ? s.names.guest : s.names.host);
        return {
          white: nameOf("w"),
          black: nameOf("b"),
          you: me ? (myColour === "w" ? "white" : "black") : "watching",
          last_moves: s.history.slice(-4),
          turn: s.result ? "game over" : nameOf(turn),
          in_check: game.inCheck(),
          clocks_seconds: s.clock ? { white: Math.round((clockOf("w") ?? 0) / 1000), black: Math.round((clockOf("b") ?? 0) / 1000) } : null,
          result: s.result ? `${resultText(s.result, myColour, { [myColour]: "You", [oppColour]: other || "Friend" } as Record<Color, string>).title} (${s.result.reason})` : null,
          draw_offer: s.drawOffer ? (s.drawOffer === me ? "you offered a draw" : "your opponent offers a draw") : null,
        };
      },
    },
    chess_friend_draw: {
      description: "Chess page (vs a friend): offer a draw, or answer the friend's offer. input: 'offer', 'accept' or 'decline'.",
      run: ({ input }) => {
        if (!s || s.result || !me) return { error: "No game to draw." };
        const t = String(input ?? "").toLowerCase();
        if (s.drawOffer && s.drawOffer !== me) {
          const yes = /accept|yes|agree|ok/.test(t);
          send({ type: "draw", answer: yes });
          return { draw: yes ? "accepted" : "declined" };
        }
        if (s.drawOffer === me) return { error: "You already offered a draw." };
        send({ type: "draw" });
        return { offered: true };
      },
    },
    chess_friend_resign: {
      description: "Chess page (vs a friend): resign. Only when the owner clearly says to resign.",
      run: () => (s && !s.result && me ? (send({ type: "resign" }), { resigned: true }) : { error: "No game to resign." }),
    },
  });

  // Clock faces: the side to move counts down from the start of its turn.
  const clockOf = (c: Color): number | null => {
    if (!s?.clock) return null;
    if (s.result || s.paused || turn !== c) return s.clock[c];
    const since = tick && base.seq === s.seq ? tick - base.at : s.used;
    return s.clock[c] - Math.max(0, since);
  };

  const status =
    stage === "connecting"
      ? "Connecting…"
      : stage === "waiting"
        ? isHost
          ? "Waiting for your friend to open the link…"
          : knocked
            ? `Waiting for ${hostName}… we sent them a notification, it connects as soon as they open the game.`
            : `Waiting for ${hostName} to open the game…`
        : stage === "reconnecting"
          ? `Connection lost. Reconnecting to ${other || "your friend"}… the clock is paused.`
          : stage === "error"
            ? err
            : !s
              ? isHost
                ? `${other} is here! Choose the time and start.`
                : `Connected! ${hostName} is setting up the game.`
              : !me && s
                ? `Watching: ${s.names.host} vs ${s.names.guest}`
                : "";
  const names: Record<Color, string> = s ? { [colourOf(s, "host")]: s.names.host, [colourOf(s, "guest")]: s.names.guest } as Record<Color, string> : { w: "", b: "" };
  const end = s?.result ? resultText(s.result, myColour, names) : null;
  const { taken, lead } = captured(s?.history ?? []);

  return (
    <div className="flex flex-col gap-3" onPointerDown={() => audioRef.current?.srcObject && audioRef.current.paused && void audioRef.current.play().catch(() => {})}>
      <audio ref={audioRef} autoPlay playsInline />
      <div className="flex items-center gap-2">
        {status && <p className={cx("text-sm", stage === "error" ? "text-alert" : stage === "reconnecting" ? "animate-pulse text-core" : "text-soft")}>{status}</p>}
        <span className={cx("ml-auto", party && "hidden")}>
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


      {isHost && (party ? !s : connected && !s) && (
        <div className="flex flex-col gap-4 rounded-2xl border border-line bg-panel p-4">
          {party && (
            <div>
              <p className="mb-2 text-sm font-semibold">Play against</p>
              {friends.length ? (
                <Pick options={friends.map((f) => ({ value: f.id, label: f.name }))} value={rivalId} onChange={setRival} />
              ) : (
                <p className="text-sm text-soft">Waiting for a friend in the lobby…</p>
              )}
              <p className="mt-1 text-xs text-faint">Everyone else watches the game live.</p>
            </div>
          )}
          <div>
            <p className="mb-2 text-sm font-semibold">Time control</p>
            <TimePicker value={tcPick} onChange={setTc} />
          </div>
          <div>
            <p className="mb-2 text-sm font-semibold">You play</p>
            <Pick
              options={[
                { value: "w", label: "♔ White" },
                { value: "b", label: "♚ Black" },
                { value: "random", label: "🎲 Random" },
              ]}
              value={colourPick}
              onChange={setColour}
            />
          </div>
          <button type="button" onClick={() => start()} disabled={!!party && !rivalId} className="self-start rounded-full bg-core px-6 py-2.5 text-base font-bold text-core-ink shadow-lg transition-transform hover:scale-105 disabled:opacity-50">
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
                  {s.drawOffer === me || !me ? (
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
                  {isHost ? (
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
            <PlayerBar name={me ? `${myName} (you)` : names[myColour]} active={!s.result && turn === myColour} clock={clockOf(myColour)} taken={<Taken pieces={taken[myColour]} by={myColour} lead={myColour === "w" ? lead : -lead} />} />
          </div>
          <div className="flex flex-col gap-3">
            <div className="text-xs text-soft">
              {tcLabel(s.tc)} · {me ? `you play ${myColour === "w" ? "White" : "Black"}` : "you're watching"}
              {s.paused && " · paused"}
            </div>
            <div className={cx("grid grid-cols-2 gap-2", !me && "hidden")}>
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
