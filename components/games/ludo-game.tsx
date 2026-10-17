"use client";

import { Bot, Crown, Mic, MicOff, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { cx } from "@/components/ui";
import { useVoiceActions } from "@/components/voice/provider";
import { gameKey, recordResult } from "@/lib/games/record";
import { cellOf, HOME_CELLS, TRACK_CELLS, type Cell } from "@/lib/games/ludo-board";
import { botChoice, move, movable, newGame, roll, SAFE, type Color, type LudoState } from "@/lib/games/ludo";
import { type Party, usePartyGame } from "@/lib/games/party";
import { usePeerGame } from "@/lib/games/peer-game";
import { sfx } from "@/lib/sfx";

/**
 * Ludo online: you and a friend on your own phones (through your game link), optionally with two
 * HIVEMIND bots in the empty seats. Your browser rolls the dice and runs the rules; your friend's
 * taps are requests your side checks. Voice on, reconnects by itself (see lib/games/peer-game).
 */
type Action = { type: "roll" } | { type: "move"; token: number };

const FILL: Record<Color, string> = { red: "#e5484d", green: "#2fa34a", yellow: "#f5b400", blue: "#2f7fe8" };
const SOFT: Record<Color, string> = { red: "#fde2e3", green: "#dcf3e1", yellow: "#fff2c7", blue: "#dde9fc" };
const dice = () => (crypto.getRandomValues(new Uint32Array(1))[0] % 6) + 1;
const PIPS: Record<number, [number, number][]> = {
  1: [[50, 50]],
  2: [[28, 28], [72, 72]],
  3: [[25, 25], [50, 50], [75, 75]],
  4: [[28, 28], [72, 28], [28, 72], [72, 72]],
  5: [[25, 25], [75, 25], [50, 50], [25, 75], [75, 75]],
  6: [[28, 22], [72, 22], [28, 50], [72, 50], [28, 78], [72, 78]],
};

/** A state from the host, checked before it's shown. */
const okState = (s: unknown): s is LudoState => {
  const x = s as LudoState;
  return !!x && Array.isArray(x.seats) && x.seats.length >= 2 && x.seats.length <= 4 && typeof x.tokens === "object" && Number.isInteger(x.turn) && Array.isArray(x.log);
};

export function LudoGame({
  role,
  room,
  myName,
  hostName = "Host",
  onHostAway,
  solo = false,
  party = null,
}: {
  role: "host" | "guest";
  room: string;
  myName: string;
  hostName?: string;
  onHostAway?: () => void;
  /** Just the owner against HIVEMIND's bots, on this device. */
  solo?: boolean;
  /** Game night: the seats are the people in the lobby (up to 4), over the party's connection. */
  party?: Party | null;
}) {
  const isHost = party ? party.role === "host" : role === "host";
  const me = party ? party.me : role; // seat id
  const sRef = useRef<LudoState | null>(null);
  const publishRef = useRef<(s: LudoState) => void>(() => {});
  /** Host: apply a change to the game and send it. */
  const apply = useCallback((fn: (s: LudoState) => LudoState) => {
    const cur = sRef.current;
    if (!cur) return;
    const next = fn(cur);
    if (next !== cur) {
      sRef.current = next;
      publishRef.current(next);
    }
  }, []);
  /** Host: a seat's request (checked by the rules: only that seat's own turn counts). */
  const onSeat = (seat: string, a: Action) => apply((s) => (a.type === "roll" ? roll(s, seat, dice()) : a.type === "move" && Number.isInteger(a.token) ? move(s, seat, a.token) : s));
  const peerNet = usePeerGame<LudoState, Action>({
    role,
    kind: "ludo",
    room,
    myName,
    hostName,
    onHostAway,
    accept: okState,
    // The friend's requests, as the friend's seat only.
    onAction: (a) => onSeat("guest", a),
    solo,
    off: !!party,
  });
  const partyNet = usePartyGame<LudoState, Action>(party, "ludo", { accept: okState, onAction: (from, a) => onSeat(from, a) });
  const { stage, err, other, state, publish, act, forget, voiceOn, muted, toggleMute, noMic, knocked, audioRef, connected } = partyNet ?? peerNet;
  const s = state;
  useEffect(() => {
    sRef.current = state;
    publishRef.current = publish;
  });

  // Host settings, remembered.
  const [bots, setBots] = useState(false);
  const [quick, setQuick] = useState(false);
  const live = connected;

  function start(opt?: { bots?: boolean; quick?: boolean }) {
    const withBots = opt?.bots ?? bots;
    // Game night: the first four in the lobby, topped up to 4 with HIVEMIND bots if wanted.
    const people = party ? party.players.filter((p) => p.online || p.host).slice(0, 4).map((p) => ({ id: p.id, name: p.name })) : null;
    if (people) {
      const fill = withBots ? 4 - people.length : people.length < 2 ? 1 : 0;
      const g = newGame([...people, ...Array.from({ length: fill }, (_, i) => ({ id: `bot${i + 1}`, name: i ? `HIVEMIND ${i + 1}` : "HIVEMIND", bot: true }))], (opt?.quick ?? quick) ? 2 : 4);
      sRef.current = g;
      publish(g);
      return;
    }
    const players = solo
      ? withBots
        ? [{ id: "host", name: myName }, { id: "bot1", name: "HIVEMIND", bot: true }, { id: "bot2", name: "HIVEMIND 2", bot: true }, { id: "bot3", name: "HIVEMIND 3", bot: true }]
        : [{ id: "host", name: myName }, { id: "bot1", name: "HIVEMIND", bot: true }]
      : withBots
      ? [{ id: "host", name: myName }, { id: "bot1", name: "HIVEMIND", bot: true }, { id: "guest", name: other || "Friend" }, { id: "bot2", name: "HIVEMIND 2", bot: true }]
      : [{ id: "host", name: myName }, { id: "guest", name: other || "Friend" }];
    const g = newGame(players, (opt?.quick ?? quick) ? 2 : 4);
    sRef.current = g;
    publish(g);
  }

  // Host: HIVEMIND's bots take their turns (only while the friend is connected, so nobody misses anything).
  useEffect(() => {
    if (!isHost || !s || s.over || !live) return;
    const seat = s.seats[s.turn];
    // Game night: a player who dropped out has HIVEMIND play for them until they're back.
    const away = !!party && !seat.bot && seat.id !== "host" && !party.players.find((p) => p.id === seat.id)?.online;
    if (!seat.bot && !away) return;
    const t = setTimeout(() => apply((cur) => (cur.seq !== s.seq ? cur : !cur.rolled ? roll(cur, seat.id, dice()) : move(cur, seat.id, botChoice(cur) ?? 0))), away ? 2500 : s.rolled ? 700 : 900);
    return () => clearTimeout(t);
  }, [isHost, s, live, apply, party]);

  // The owner's record: the host's device saves each finished game once.
  useEffect(() => {
    if (!isHost || !s?.over) return;
    const place = s.finished.indexOf("host") + 1;
    recordResult(`ludo-${solo ? "solo" : room}-${gameKey(s.seq, ...s.finished)}`, {
      game: "ludo",
      mode: solo ? "bot" : "friend",
      outcome: place === 1 ? "win" : "loss",
      vs: solo ? "HIVEMIND" : other || "Friend",
      detail: place ? `#${place} of ${s.seats.length}` : undefined,
    });
  }, [isHost, room, s, other, solo]);

  const myTurn = !!s && !s.over && s.seats[s.turn]?.id === me;
  const canRoll = myTurn && !s!.rolled && live;
  const canMove = myTurn && s!.rolled && live ? movable(s!) : [];
  function doRoll() {
    if (!canRoll) return;
    if (isHost) apply((cur) => roll(cur, "host", dice()));
    else act({ type: "roll" });
  }
  function doMove(token: number) {
    if (!canMove.includes(token)) return;
    if (isHost) apply((cur) => move(cur, "host", token));
    else act({ type: "move", token });
  }
  // Voice: start, roll and move by saying so ("roll", "move token two").
  useVoiceActions({
    ludo_start: {
      description: "Ludo page: start (or restart) a game. input: optional 'bots' for a full 4-player board with HIVEMIND bots, 'quick' for 2 tokens each (e.g. 'bots quick').",
      run: ({ input }) => {
        if (!isHost || !live) return { error: "Only the host can start, once everyone's here." };
        const t = String(input ?? "").toLowerCase();
        start({ bots: /bot|four|4/.test(t) || undefined, quick: /quick|two|2 token/.test(t) || undefined });
        return { started: true };
      },
    },
    ludo_roll: {
      description: "Ludo page: roll the dice on the owner's turn.",
      run: () => {
        if (!canRoll) return { error: myTurn ? "Already rolled: pick a token to move." : `It's ${turnSeat?.name ?? "someone else"}'s turn.` };
        doRoll();
        return { rolled: true, note: "Say what they rolled once the dice settles (it's on screen)." };
      },
    },
    ludo_move: {
      description: "Ludo page: move one of the owner's tokens after rolling. input: token number 1-4 (as numbered on screen).",
      run: ({ input }) => {
        const t = Number(String(input ?? "").match(/\d/)?.[0]) - 1;
        if (!canMove.length) return { error: myTurn ? "Roll first." : "Not your turn." };
        if (!canMove.includes(t)) return { error: `Token ${t + 1} can't move. Movable: ${canMove.map((x) => x + 1).join(", ")}.` };
        doMove(t);
        return { moved: t + 1 };
      },
    },
  });

  // One movable token: moving it is the only choice, so do it (after a beat, so you see the dice).
  useEffect(() => {
    if (canMove.length !== 1 || !s) return;
    const only = canMove[0];
    const t = setTimeout(() => doMove(only), 650);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s?.seq, canMove.length]);

  const turnSeat = s && !s.over ? s.seats[s.turn] : null;
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
          ? `Connection lost. Reconnecting to ${other || "your friend"}… the game is paused.`
          : stage === "error"
            ? err
            : !s
              ? solo
                ? "You against HIVEMIND. Choose the game and start."
                : isHost
                ? `${other} is here! Choose the game and start.`
                : `Connected! ${hostName} is setting up the game.`
              : s.over
                ? ""
                : myTurn
                  ? s.rolled
                    ? canMove.length > 1
                      ? "Tap a glowing token to move it."
                      : "Moving…"
                    : "Your turn: roll the dice!"
                  : `${turnSeat?.name}'s turn…`;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-3" onPointerDown={() => audioRef.current?.srcObject && audioRef.current.paused && void audioRef.current.play().catch(() => {})}>
      <audio ref={audioRef} autoPlay playsInline />
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {s?.seats.map((seat, i) => (
          <span key={seat.id} className={cx("flex items-center gap-1.5 rounded-full border px-3 py-1", s.turn === i && !s.over ? "border-core bg-core/10" : "border-line")}>
            <span className="size-3 rounded-full" style={{ background: FILL[seat.color] }} />
            {seat.bot && <Bot size={12} className="text-data" />}
            <span className="max-w-28 truncate">{seat.id === me ? `${seat.name} (you)` : seat.name}</span>
            <b className="font-mono text-xs tabular-nums">{s.tokens[seat.id].filter((p) => p >= 56).length}/{s.tokens[seat.id].length}</b>
          </span>
        ))}
        <span className={cx("ml-auto", (solo || party) && "hidden")}>
          {voiceOn ? (
            <button type="button" onClick={toggleMute} className={cx("flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs", muted ? "border-alert text-alert" : "border-ok/50 text-ok")}>
              {muted ? <MicOff size={13} /> : <Mic size={13} />} {muted ? "Muted" : "Voice on"}
            </button>
          ) : (
            <span className={cx("flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs", noMic ? "border-alert/50 text-alert" : "border-line text-faint")}>
              {noMic ? <MicOff size={13} /> : <Mic size={13} />} {noMic ? "Mic blocked" : live ? "Voice connecting…" : "Voice"}
            </span>
          )}
        </span>
      </div>

      {status && <p className={cx("text-sm", stage === "error" ? "text-alert" : stage === "reconnecting" ? "animate-pulse text-core" : myTurn ? "font-medium text-core" : "text-soft")}>{status}</p>}


      {isHost && live && (!s || s.over) && (
        <div className="flex flex-col gap-2 rounded-xl border border-line bg-panel p-3 text-sm">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-soft">Players:</span>
            <Choice on={!bots} onClick={() => setBots(false)}>
              {solo ? "Me vs HIVEMIND" : party ? `Just us (${Math.min(4, party.players.filter((p) => p.online || p.host).length)})` : "Just us two"}
            </Choice>
            <Choice on={bots} onClick={() => setBots(true)}>
              {solo ? "Me vs 3 HIVEMIND bots" : party ? "Fill to 4 with bots" : "+ 2 HIVEMIND bots"}
            </Choice>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-soft">Tokens:</span>
            <Choice on={!quick} onClick={() => setQuick(false)}>
              4 each (classic)
            </Choice>
            <Choice on={quick} onClick={() => setQuick(true)}>
              2 each (quick)
            </Choice>
          </div>
          <button type="button" onClick={() => start()} className="inline-flex items-center gap-1.5 self-start rounded-full bg-core px-5 py-2 text-sm font-semibold text-core-ink">
            {s?.over ? <RotateCcw size={14} /> : null} {s?.over ? (solo ? "Play again" : `Play again with ${other}`) : "Start Ludo"}
          </button>
        </div>
      )}

      {s && (
        <div className={cx("grid gap-3 lg:grid-cols-[minmax(0,1fr)_280px]", stage === "reconnecting" && "pointer-events-none opacity-60")}>
          <Board s={s} me={me} canMove={canMove} onMove={doMove} />
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-center gap-4 rounded-xl border border-line bg-panel p-4">
              <Dice s={s} />
              <button
                type="button"
                onClick={doRoll}
                disabled={!canRoll}
                className={cx("rounded-full px-6 py-3 text-base font-semibold transition-opacity disabled:opacity-30", canRoll ? "animate-pulse bg-core text-core-ink" : "bg-raised text-soft")}
              >
                Roll
              </button>
            </div>
            {s.over && <Podium s={s} me={me} />}
            <div className="max-h-56 space-y-1 overflow-y-auto rounded-xl border border-line bg-panel p-3 text-sm">
              {[...s.log].reverse().map((l, i) => (
                <p key={i} className={cx(i === 0 ? "text-fg" : "text-soft", /captured|wins|home/.test(l) && "font-medium")}>
                  {l}
                </p>
              ))}
            </div>
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

function Choice({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={on} className={cx("rounded-full border px-3 py-1 text-xs", on ? "border-core bg-core/15 text-core" : "border-line text-soft hover:text-fg")}>
      {children}
    </button>
  );
}

/** The last roll, tumbling through faces for a moment whenever someone rolls. */
function Dice({ s }: { s: LudoState }) {
  const r = s.lastRoll;
  const seat = r ? s.seats.find((x) => x.id === r.seat) : null;
  const color = seat ? FILL[seat.color] : "#9aa3ad";
  const [face, setFace] = useState<number | null>(r?.value ?? null);
  const [spin, setSpin] = useState(0);
  const seen = useRef(r?.seq ?? -1);
  const rollSeq = r?.seq;
  const rollValue = r?.value;
  useEffect(() => {
    if (rollSeq === undefined || rollValue === undefined || rollSeq === seen.current) return;
    const r = { seq: rollSeq, value: rollValue };
    seen.current = r.seq;
    sfx.send();
    let n = 0;
    const t = setInterval(() => {
      n++;
      if (n >= 7) {
        clearInterval(t);
        setFace(r.value);
        if (r.value === 6) sfx.done();
        return;
      }
      setFace(1 + Math.floor(Math.random() * 6));
    }, 70);
    setSpin((x) => x + 1);
    return () => {
      clearInterval(t);
      setFace(r.value);
    };
  }, [rollSeq, rollValue]);
  return (
    <div className="flex flex-col items-center gap-1">
      <svg key={spin} viewBox="0 0 100 100" className="ludo-anim size-16" style={{ animation: spin ? "ludo-tumble 0.5s ease-out" : undefined }} aria-label={r ? `${seat?.name} rolled ${r.value}` : "Dice"}>
        <rect x="4" y="4" width="92" height="92" rx="18" fill="#fff" stroke={color} strokeWidth="6" />
        {(face ? PIPS[face] : []).map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r="8.5" fill={face === 1 ? color : "#111"} />
        ))}
        {!face && (
          <text x="50" y="62" textAnchor="middle" fontSize="34" fill="#bbb">
            ?
          </text>
        )}
      </svg>
      <span className="h-4 text-xs text-soft">{r && face === r.value ? `${seat?.name.split(" ")[0]} rolled ${r.value}` : ""}</span>
    </div>
  );
}

function Podium({ s, me }: { s: LudoState; me: string }) {
  const name = (id: string) => s.seats.find((x) => x.id === id)?.name ?? id;
  return (
    <div className="rounded-xl bg-raised p-3 text-center">
      <Crown size={22} className="mx-auto text-core" />
      <div className="mt-1 font-semibold">{s.finished[0] === me ? "You win! 🎉" : `${name(s.finished[0])} wins!`}</div>
      <div className="text-xs text-soft">{s.finished.map((id, i) => `${i + 1}. ${name(id)}`).join(" · ")}</div>
    </div>
  );
}

const key = (r: number, c: number) => `${r},${c}`;
const TRACK_INDEX = new Map(TRACK_CELLS.map(([r, c], i) => [key(r, c), i]));
const HOME_OF = new Map(Object.entries(HOME_CELLS).flatMap(([color, cells]) => cells.map(([r, c]) => [key(r, c), color as Color])));
const START_COLOR: Record<number, Color> = { 0: "red", 13: "green", 26: "yellow", 39: "blue" };

const STEP_MS = 160;
type Hop = { seq: number; seat: string; token: number; cells: Cell[]; i: number; captured: { seat: string; token: number }[] };

function Board({ s, me, canMove, onMove }: { s: LudoState; me: string; canMove: number[]; onMove: (t: number) => void }) {
  const turnId = s.seats[s.turn]?.id;
  // The move being played out, one square per step (not on first load: a restored game just shows).
  const [hop, setHop] = useState<Hop | null>(null);
  const seen = useRef(s.last?.seq ?? -1);
  const [knocked, setKnocked] = useState<{ seq: number; ids: string[] } | null>(null);
  const game = useRef(s);
  useEffect(() => {
    game.current = s;
  });
  const lastSeq = s.last?.seq;
  useEffect(() => {
    const L = game.current.last;
    const s = game.current;
    if (!L || L.seq !== lastSeq || L.seq === seen.current) return;
    seen.current = L.seq;
    const seat = s.seats.find((x) => x.id === L.seat);
    if (!seat) return;
    const steps = L.from === -1 ? [0] : Array.from({ length: L.to - L.from }, (_, k) => L.from + 1 + k);
    const cells = steps.map((p) => cellOf(seat.color, p, L.token));
    const h: Hop = { seq: L.seq, seat: L.seat, token: L.token, cells, i: 0, captured: L.captured ?? [] };
    setHop(h);
    sfx.hover();
    let i = 0;
    const t = setInterval(() => {
      i++;
      if (i >= cells.length) {
        clearInterval(t);
        setHop(null);
        if (h.captured.length) {
          sfx.error();
          setKnocked({ seq: L.seq, ids: h.captured.map((c) => `${c.seat}-${c.token}`) });
          setTimeout(() => setKnocked((k) => (k?.seq === L.seq ? null : k)), 700);
        } else if (L.to >= 56) sfx.done();
        return;
      }
      sfx.hover();
      setHop((cur) => (cur && cur.seq === h.seq ? { ...cur, i } : cur));
    }, STEP_MS);
    return () => {
      // Interrupted (a newer move, or leaving): never leave a token half-way.
      clearInterval(t);
      setHop((cur) => (cur && cur.seq === h.seq ? null : cur));
    };
  }, [lastSeq]);

  const moving = (seat: string, i: number) => hop && hop.seat === seat && hop.token === i;
  const capturedNow = (seat: string, i: number) => hop?.captured.some((c) => c.seat === seat && c.token === i);

  // Where each token is drawn right now: the moving one at its current step, a captured one still on
  // the square until the attacker lands, everything else where the game says.
  const placed: { seat: string; color: Color; i: number; r: number; c: number }[] = [];
  for (const seat of s.seats)
    s.tokens[seat.id].forEach((p, i) => {
      let cell = cellOf(seat.color, p, i);
      if (moving(seat.id, i)) cell = hop!.cells[hop!.i];
      else if (capturedNow(seat.id, i) && hop) cell = hop.cells[hop.cells.length - 1];
      placed.push({ seat: seat.id, color: seat.color, i, r: cell[0], c: cell[1] });
    });
  const groups = new Map<string, typeof placed>();
  for (const t of placed) if (!moving(t.seat, t.i)) groups.set(key(t.r, t.c), [...(groups.get(key(t.r, t.c)) ?? []), t]);
  const mover = placed.find((t) => moving(t.seat, t.i));

  const yards: [Color, number, number][] = [
    ["red", 0, 0],
    ["green", 0, 9],
    ["yellow", 9, 9],
    ["blue", 9, 0],
  ];

  const token = (t: (typeof placed)[number], k: number, n: number, isMover = false) => {
    const mine = !hop && t.seat === me && t.seat === turnId && canMove.includes(t.i);
    const size = n > 1 ? 4.4 : 5.4;
    const dx = n > 1 ? ((k % 2) - 0.5) * 2.2 : 0;
    const dy = n > 2 ? (Math.floor(k / 2) - 0.5) * 2.2 : 0;
    const id = `${t.seat}-${t.i}`;
    const isKnocked = knocked?.ids.includes(id);
    const animation = isMover ? `ludo-hop-${hop!.i % 2 ? "b" : "a"} ${STEP_MS}ms ease-out` : isKnocked ? "ludo-knock 0.6s ease-out" : undefined;
    return (
      <button
        key={id}
        type="button"
        disabled={!mine}
        onClick={() => onMove(t.i)}
        aria-label={`${t.color} token ${t.i + 1}${mine ? ", tap to move" : ""}`}
        className={cx("ludo-anim absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-md", isMover ? "z-20" : mine ? "z-10 animate-pulse ring-4 ring-core" : "")}
        style={{
          left: `calc(${((t.c + 0.5) / 15) * 100}% + ${dx}%)`,
          top: `calc(${((t.r + 0.5) / 15) * 100}% + ${dy}%)`,
          width: `${size}%`,
          height: `${size}%`,
          background: `radial-gradient(circle at 35% 30%, #ffffffaa, ${FILL[t.color]} 45%)`,
          // Steps are quick; a knocked-out token slides home more slowly.
          transition: isMover ? `left ${STEP_MS - 20}ms ease-out, top ${STEP_MS - 20}ms ease-out` : "left 450ms ease-in-out, top 450ms ease-in-out, width 200ms, height 200ms",
          animation,
        }}
      >
        {/* The number to say by voice ("move token 2"), on the tokens that can move. */}
        {mine && <span className="flex h-full w-full items-center justify-center text-[10px] font-black leading-none text-white [text-shadow:0_1px_2px_#000] sm:text-xs">{t.i + 1}</span>}
      </button>
    );
  };

  return (
    <div className="relative aspect-square w-full max-w-[min(100%,74dvh)] self-center overflow-hidden rounded-xl border-2 border-line bg-white shadow-sm">
      <div className="absolute inset-0 grid" style={{ gridTemplateColumns: "repeat(15, 1fr)", gridTemplateRows: "repeat(15, 1fr)" }}>
        {Array.from({ length: 225 }, (_, n) => {
          const r = Math.floor(n / 15);
          const c = n % 15;
          const ti = TRACK_INDEX.get(key(r, c));
          const home = HOME_OF.get(key(r, c));
          if (ti === undefined && !home) return <div key={n} />;
          const start = ti !== undefined ? START_COLOR[ti] : undefined;
          const bg = home ? FILL[home] : start ? FILL[start] : "#fff";
          return (
            <div key={n} className="relative flex items-center justify-center border-[0.5px] border-neutral-300" style={{ background: bg }}>
              {ti !== undefined && SAFE.has(ti) && !start && <span className="text-[min(2.6vw,14px)] leading-none text-neutral-400">★</span>}
            </div>
          );
        })}
      </div>
      {yards.map(([color, r, c]) => (
        <div key={color} className="absolute p-[2.2%]" style={{ top: `${(r / 15) * 100}%`, left: `${(c / 15) * 100}%`, width: "40%", height: "40%", background: FILL[color] }}>
          <div className="size-full rounded-[12%]" style={{ background: SOFT[color] }} />
        </div>
      ))}
      <div className="absolute" style={{ top: "40%", left: "40%", width: "20%", height: "20%", background: `conic-gradient(from 225deg, ${FILL.red} 0 25%, ${FILL.green} 0 50%, ${FILL.yellow} 0 75%, ${FILL.blue} 0 100%)` }} />
      {[...groups.values()].flatMap((g) => g.map((t, k) => token(t, k, g.length)))}
      {mover && token(mover, 0, 1, true)}
    </div>
  );
}
