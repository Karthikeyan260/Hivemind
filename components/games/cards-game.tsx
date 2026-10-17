"use client";

import {
  Bot,
  Crown,
  Hand,
  Layers,
  Megaphone,
  Mic,
  MicOff,
  RotateCcw,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { cx } from "@/components/ui";
import { useVoiceActions } from "@/components/voice/provider";
import { gameKey, recordResult } from "@/lib/games/record";
import {
  botMove,
  callLast,
  CARD_COLORS,
  draw,
  newCardGame,
  pass,
  play,
  playable,
  viewFor,
  type Card,
  type CardColor,
  type CardsState,
} from "@/lib/games/cards";
import { type Party, usePartyGame } from "@/lib/games/party";
import { usePeerGame } from "@/lib/games/peer-game";
import { sfx } from "@/lib/sfx";

/**
 * Colour Clash online (the colour-matching card game, Uno-style): you and a friend on your own
 * phones, optionally with two HIVEMIND bots. Your browser shuffles, deals and checks every move; your
 * friend only ever receives their own cards (and how many everyone else holds).
 */
type Action =
  | { type: "play"; card: number; color: CardColor | null }
  | { type: "draw" }
  | { type: "pass" }
  | { type: "last" };

const HEX: Record<CardColor, string> = {
  red: "#e5484d",
  yellow: "#f5b400",
  green: "#2fa34a",
  blue: "#2f7fe8",
};
const rand = () => crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32;
const okState = (s: unknown): s is CardsState => {
  const x = s as CardsState;
  return (
    !!x &&
    Array.isArray(x.seats) &&
    typeof x.hands === "object" &&
    Array.isArray(x.discard) &&
    x.discard.length > 0 &&
    Number.isInteger(x.turn)
  );
};

/** A card in words, for the voice: "blue 7", "red skip", "wild +4". */
const cardName = (c: Card) =>
  c.kind === "num" ? `${c.color} ${c.n}` : c.kind === "wild" ? "wild" : c.kind === "wild4" ? "wild +4" : `${c.color} ${c.kind === "draw2" ? "+2" : c.kind}`;

export function CardsGame({
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
  /** Game night: the seats are the people in the lobby, over the party's connection. */
  party?: Party | null;
}) {
  const isHost = party ? party.role === "host" : role === "host";
  const me = party ? party.me : role;
  const sRef = useRef<CardsState | null>(null);
  const publishRef = useRef<(s: CardsState) => void>(() => {});
  const apply = useCallback((fn: (s: CardsState) => CardsState) => {
    const cur = sRef.current;
    if (!cur) return;
    const next = fn(cur);
    if (next !== cur) {
      sRef.current = next;
      publishRef.current(next);
    }
  }, []);
  /** Host: a move by a seat (the friend's requests arrive as the guest seat). */
  const act = useCallback(
    (seat: string, a: Action) =>
      apply((s) =>
        a.type === "play" && Number.isInteger(a.card)
          ? play(
              s,
              seat,
              a.card,
              a.color && CARD_COLORS.includes(a.color) ? a.color : null,
              rand,
            )
          : a.type === "draw"
            ? draw(s, seat, rand)
            : a.type === "pass"
              ? pass(s, seat)
              : a.type === "last"
                ? callLast(s, seat)
                : s,
      ),
    [apply],
  );
  const peerNet = usePeerGame<CardsState, Action>({
    role,
    kind: "cards",
    room,
    myName,
    hostName,
    onHostAway,
    accept: okState,
    viewForGuest: (s) => viewFor(s, "guest"),
    onAction: (a) => act("guest", a),
    solo,
    off: !!party,
  });
  // Game night: each player sees only their own hand; a move counts for the seat that sent it.
  const partyNet = usePartyGame<CardsState, Action>(party, "cards", { accept: okState, viewFor: (st, id) => viewFor(st, id), onAction: (from, a) => act(from, a) });
  const net = partyNet ?? peerNet;
  const {
    stage,
    err,
    other,
    state: s,
    publish,
    forget,
    voiceOn,
    muted,
    toggleMute,
    noMic,
    knocked,
    audioRef,
    connected,
  } = net;
  useEffect(() => {
    sRef.current = s;
    publishRef.current = publish;
  });

  const [bots, setBots] = useState(false);
  const [picking, setPicking] = useState<number | null>(null);
  function start(withBots = bots) {
    // Game night: everyone in the lobby (up to 6), topped up to 4 with HIVEMIND bots if wanted.
    const people = party ? party.players.filter((p) => p.online || p.host).slice(0, 6).map((p) => ({ id: p.id, name: p.name })) : null;
    if (people) {
      const fill = withBots ? Math.max(0, 4 - people.length) : people.length < 2 ? 1 : 0;
      const g = newCardGame([...people, ...Array.from({ length: fill }, (_, i) => ({ id: `bot${i + 1}`, name: i ? `HIVEMIND ${i + 1}` : "HIVEMIND", bot: true }))], rand);
      sRef.current = g;
      publish(g);
      return;
    }
    const players = solo
      ? withBots
        ? [
            { id: "host", name: myName },
            { id: "bot1", name: "HIVEMIND", bot: true },
            { id: "bot2", name: "HIVEMIND 2", bot: true },
            { id: "bot3", name: "HIVEMIND 3", bot: true },
          ]
        : [
            { id: "host", name: myName },
            { id: "bot1", name: "HIVEMIND", bot: true },
          ]
      : withBots
      ? [
          { id: "host", name: myName },
          { id: "bot1", name: "HIVEMIND", bot: true },
          { id: "guest", name: other || "Friend" },
          { id: "bot2", name: "HIVEMIND 2", bot: true },
        ]
      : [
          { id: "host", name: myName },
          { id: "guest", name: other || "Friend" },
        ];
    const g = newCardGame(players, rand);
    sRef.current = g;
    publish(g);
  }

  // Host: HIVEMIND's bots play their turns (only while the friend is connected).
  useEffect(() => {
    if (!isHost || !s || s.winner || !connected) return;
    const seat = s.seats[s.turn];
    // Game night: a player who dropped out has HIVEMIND play for them until they're back.
    const away = !!party && !seat.bot && seat.id !== "host" && !party.players.find((p) => p.id === seat.id)?.online;
    if (!seat.bot && !away) return;
    const t = setTimeout(() => {
      const cur = sRef.current;
      if (!cur || cur.seq !== s.seq) return;
      const m = botMove(cur);
      if (m.type === "play") {
        if (m.call) act(seat.id, { type: "last" });
        act(seat.id, { type: "play", card: m.card, color: m.color });
      } else act(seat.id, m);
    }, away ? 2500 : 1100);
    return () => clearTimeout(t);
  }, [isHost, s, connected, act, party]);

  // Sounds for what just happened.
  const lastSeq = s?.last?.seq;
  const lastType = s?.last?.type;
  useEffect(() => {
    if (lastSeq === undefined) return;
    if (lastType === "play") sfx.send();
    else if (lastType === "draw") sfx.hover();
    else if (lastType === "penalty") sfx.error();
  }, [lastSeq, lastType]);
  const won = s?.winner;
  useEffect(() => {
    if (won) sfx.done();
  }, [won]);
  // The owner's record: the host's device saves each finished game once.
  useEffect(() => {
    if (!isHost || !s?.winner) return;
    const bots = s.seats.some((x) => x.bot);
    recordResult(`cards-${solo ? "solo" : room}-${gameKey(s.seq, s.winner, ...s.seats.map((x) => x.id))}`, {
      game: "cards",
      mode: solo ? "bot" : "friend",
      outcome: s.winner === "host" ? "win" : "loss",
      vs: solo ? "HIVEMIND" : other || "Friend",
      detail: s.winner === "host" ? (bots ? "with HIVEMIND bots" : undefined) : `${s.seats.find((x) => x.id === s.winner)?.name ?? "?"} won`,
    });
  }, [isHost, room, s, other, solo]);

  const myTurn = !!s && !s.winner && s.seats[s.turn]?.id === me && connected;
  const mine = s?.hands[me] ?? [];
  const canPlayIds = new Set(myTurn ? playable(s!).map((c) => c.id) : []);
  function doAct(a: Action) {
    if (!myTurn) return;
    if (isHost) act("host", a);
    else net.act(a);
  }
  function tapCard(c: Card) {
    if (!canPlayIds.has(c.id)) return;
    if (!c.color) return setPicking(c.id);
    doAct({ type: "play", card: c.id, color: null });
  }

  const turnSeat = s && !s.winner ? s.seats[s.turn] : null;
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
                ? "You against HIVEMIND. Choose and deal."
                : isHost
                ? `${other} is here! Choose and start.`
                : `Connected! ${hostName} is setting up the game.`
              : s.winner
                ? ""
                : myTurn
                  ? s.drew !== null
                    ? "You drew a card that fits: play it or keep it."
                    : canPlayIds.size
                      ? "Your turn: tap a glowing card."
                      : "No card fits: draw one."
                  : `${turnSeat?.name}'s turn…`;
  const others = s ? s.seats.filter((x) => x.id !== me) : [];
  const top = s?.discard[s.discard.length - 1];

  // Voice: everything a tap does ("play blue seven", "wild green", "draw", "last card").
  useVoiceActions({
    cards_deal: {
      description: "Colour Clash page: deal a new game. input: 'bots' for a 4-player table with HIVEMIND bots, else just the two players.",
      run: ({ input }) => {
        if (!isHost || !connected) return { error: "Only the host can deal, once everyone's here." };
        start(/bot|four|4/i.test(String(input ?? "")));
        return { dealt: true };
      },
    },
    cards_hand: {
      description: "Colour Clash page: the owner's cards, which they can play now, and the card on the pile (to read out or decide).",
      run: () =>
        s
          ? {
              your_turn: myTurn,
              on_pile: top ? cardName(top) : null,
              colour_to_match: s.color,
              cards: mine.map(cardName),
              playable: mine.filter((c) => canPlayIds.has(c.id)).map(cardName),
              others: others.map((o) => `${o.name}: ${s.counts[o.id] ?? "?"} cards`),
            }
          : { error: "No game yet." },
    },
    cards_play: {
      description: "Colour Clash page: play a card from the owner's hand. input: the card in words, e.g. 'blue 7', 'red skip', 'green reverse', 'yellow +2', 'wild blue', '+4 red' (for wild cards, the colour to choose).",
      run: ({ input }) => {
        if (!myTurn) return { error: s?.winner ? "The game is over." : `It's ${turnSeat?.name ?? "someone else"}'s turn.` };
        const t = String(input ?? "").toLowerCase();
        const colour = CARD_COLORS.find((c) => t.includes(c)) ?? null;
        const kind: Card["kind"] = /\+ ?4|plus four|wild ?4|draw ?4|draw four/.test(t)
          ? "wild4"
          : /wild/.test(t)
            ? "wild"
            : /\+ ?2|plus two|draw ?2|draw two/.test(t)
              ? "draw2"
              : /skip/.test(t)
                ? "skip"
                : /reverse/.test(t)
                  ? "reverse"
                  : "num";
        const words = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
        const digit = t.match(/\d/)?.[0];
        const n = kind === "num" ? (digit ? Number(digit) : words.findIndex((w) => new RegExp(`\\b${w}\\b`).test(t))) : undefined;
        const c = mine.find((x) => x.kind === kind && (kind !== "num" || x.n === n) && (x.color === null || x.color === colour));
        if (!c) return { error: `You don't have ${t || "that card"}.`, cards: mine.map(cardName) };
        if (!canPlayIds.has(c.id)) return { error: `${cardName(c)} doesn't fit on ${top ? cardName(top) : "the pile"}.`, playable: mine.filter((x) => canPlayIds.has(x.id)).map(cardName) };
        if (!c.color && !colour) return { error: "Which colour? Say e.g. 'wild blue'." };
        doAct({ type: "play", card: c.id, color: c.color ? null : colour });
        return { played: cardName(c) + (c.color ? "" : ` (${colour})`) };
      },
    },
    cards_draw: { description: "Colour Clash page: draw a card.", run: () => (myTurn ? (doAct({ type: "draw" }), { drew: true }) : { error: "Not your turn." }) },
    cards_keep: { description: "Colour Clash page: keep the card just drawn (pass) instead of playing it.", run: () => (myTurn ? (doAct({ type: "pass" }), { kept: true }) : { error: "Not your turn." }) },
    cards_last: { description: "Colour Clash page: call 'Last card!' (before playing the second-last card).", run: () => (myTurn ? (doAct({ type: "last" }), { called: true }) : { error: "Not your turn." }) },
  });
  const lastCall = mine.length === 2 && myTurn && !s?.called[me];

  // Room for the fanned hand: the table's width on a phone, more on bigger screens.
  const [fanRoom, setFanRoom] = useState(330);
  useEffect(() => {
    const fit = () => setFanRoom(Math.min(720, window.innerWidth - 150));
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);
  // Big word for what just landed on the pile.
  const burst =
    s?.last?.type === "play" && s.last.card
      ? BURST[s.last.card.kind]
      : s?.last?.type === "penalty"
        ? "+2 penalty!"
        : null;

  return (
    <div
      className="mx-auto flex w-full max-w-4xl flex-col gap-3"
      onPointerDown={() =>
        audioRef.current?.srcObject &&
        audioRef.current.paused &&
        void audioRef.current.play().catch(() => {})
      }
    >
      <audio ref={audioRef} autoPlay playsInline />
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="bg-gradient-to-r from-[#e5484d] via-[#f5b400] to-[#2f7fe8] bg-clip-text text-lg font-black italic tracking-tight text-transparent">
          COLOUR CLASH
        </span>
        <span className={cx("ml-auto", (solo || party) && "hidden")}>
          {voiceOn ? (
            <button
              type="button"
              onClick={toggleMute}
              className={cx(
                "flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs",
                muted ? "border-alert text-alert" : "border-ok/50 text-ok",
              )}
            >
              {muted ? <MicOff size={13} /> : <Mic size={13} />}{" "}
              {muted ? "Muted" : "Voice on"}
            </button>
          ) : (
            <span
              className={cx(
                "flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs",
                noMic ? "border-alert/50 text-alert" : "border-line text-faint",
              )}
            >
              {noMic ? <MicOff size={13} /> : <Mic size={13} />}{" "}
              {noMic
                ? "Mic blocked"
                : connected
                  ? "Voice connecting…"
                  : "Voice"}
            </span>
          )}
        </span>
      </div>
      {status && !(s && stage === "connected" && !s.winner) && (
        <p
          className={cx(
            "text-sm",
            stage === "error"
              ? "text-alert"
              : stage === "reconnecting"
                ? "animate-pulse text-core"
                : "text-soft",
          )}
        >
          {status}
        </p>
      )}

      {isHost && connected && (!s || s.winner) && (
        <div className="flex flex-col gap-3 rounded-2xl border border-line bg-panel p-4 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="mr-1 text-soft">Players:</span>
            {[false, true].map((b) => (
              <button
                key={String(b)}
                type="button"
                onClick={() => setBots(b)}
                aria-pressed={bots === b}
                className={cx(
                  "rounded-full border-2 px-4 py-1.5 text-sm font-semibold",
                  bots === b
                    ? "border-core bg-core/15 text-core"
                    : "border-line text-soft hover:text-fg",
                )}
              >
                {solo ? (b ? "🤖🤖🤖 vs 3 HIVEMIND bots" : "🤖 Just me vs HIVEMIND") : party ? (b ? "🤖 Fill the table to 4 with bots" : `👥 Just us (${party.players.filter((p) => p.online || p.host).length})`) : b ? "🤖 + 2 HIVEMIND bots" : "👥 Just us two"}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => start()}
            className="inline-flex items-center gap-2 self-start rounded-full bg-gradient-to-r from-[#e5484d] via-[#f5b400] to-[#2fa34a] px-6 py-2.5 text-base font-black uppercase tracking-wide text-black shadow-lg transition-transform hover:scale-105"
          >
            {s?.winner ? <RotateCcw size={16} /> : <Layers size={16} />}{" "}
            {s?.winner ? (solo ? "Play again" : `Play again with ${other}`) : "Deal the cards"}
          </button>
        </div>
      )}

      {s && top && (
        <div
          className={cx(
            "relative overflow-hidden rounded-[2rem] border-[10px] border-[#5b3a1e] p-3 shadow-[inset_0_0_60px_rgba(0,0,0,0.55),0_10px_30px_rgba(0,0,0,0.5)] sm:p-5",
            stage === "reconnecting" && "pointer-events-none opacity-60",
          )}
          style={{
            background:
              "radial-gradient(ellipse at 50% 40%, #1f8a4c 0%, #146b39 45%, #0b4425 100%)",
          }}
        >
          {/* Opponents around the table. */}
          <div className="flex flex-wrap items-start justify-center gap-4 sm:gap-8">
            {others.map((o) => {
              const n = s.counts[o.id] ?? 0;
              const turn = turnSeat?.id === o.id;
              return (
                <div key={o.id} className="flex flex-col items-center gap-1.5">
                  <div className="relative">
                    <div
                      className={cx(
                        "flex size-12 items-center justify-center rounded-full border-[3px] text-lg font-black text-white shadow-lg sm:size-14",
                        turn
                          ? "border-core shadow-[0_0_20px_rgba(250,204,21,0.7)]"
                          : "border-white/40",
                      )}
                      style={{ background: avatarColor(o.id) }}
                    >
                      {o.bot ? <Bot size={22} /> : initials(o.name)}
                    </div>
                    {turn && (
                      <span className="absolute -inset-1 animate-ping rounded-full border-2 border-core/70" />
                    )}
                    <span
                      className={cx(
                        "absolute -bottom-1 -right-2 min-w-6 rounded-full border-2 border-[#0b4425] px-1.5 text-center font-mono text-xs font-black",
                        n === 1
                          ? "animate-bounce bg-alert text-white"
                          : "bg-white text-black",
                      )}
                    >
                      {n}
                    </span>
                  </div>
                  <div className="flex h-10 items-end">
                    {Array.from({ length: Math.min(n, 10) }, (_, i) => (
                      <span
                        key={i}
                        className="-ml-5 first:ml-0"
                        style={{
                          transform: `rotate(${(i - (Math.min(n, 10) - 1) / 2) * 6}deg) translateY(${Math.abs(i - (Math.min(n, 10) - 1) / 2) * 1.5}px)`,
                        }}
                      >
                        <CardBack small />
                      </span>
                    ))}
                  </div>
                  <span className="max-w-28 truncate text-xs font-semibold text-white/90">
                    {o.name}
                  </span>
                  {n === 1 && (
                    <span className="rounded-full bg-alert px-2 py-0.5 text-[10px] font-black uppercase text-white">
                      Last card!
                    </span>
                  )}
                </div>
              );
            })}
          </div>

          {/* The middle of the table: deck, the pile, colour and direction. */}
          <div className="relative my-5 flex items-center justify-center gap-7 sm:my-7 sm:gap-12">
            <button
              type="button"
              onClick={() => doAct({ type: "draw" })}
              disabled={!myTurn || s.drew !== null}
              aria-label="Draw a card"
              className="group relative disabled:cursor-default"
            >
              {[3, 2, 1].map((k) => (
                <span
                  key={k}
                  className="absolute"
                  style={{ left: k * 2, top: -k * 2 }}
                >
                  <CardBack />
                </span>
              ))}
              <span
                className={cx(
                  "relative block transition-transform",
                  myTurn && s.drew === null && "group-hover:-translate-y-1",
                )}
              >
                <CardBack />
              </span>
              <span className="absolute -bottom-6 left-1/2 -translate-x-1/2 rounded-full bg-black/40 px-2 font-mono text-[11px] text-white/80">
                {s.deckCount}
              </span>
            </button>
            <div className="relative">
              {/* The colour to match, glowing round the pile, and the direction of play. */}
              <div
                className="absolute -inset-6 rounded-full opacity-70 blur-xl"
                style={{ background: HEX[s.color] }}
              />
              <svg
                viewBox="0 0 100 100"
                className="absolute -inset-8 size-[calc(100%+4rem)] text-white/40"
                style={{
                  animation: `spin ${s.dir === 1 ? "6s" : "6s"} linear infinite${s.dir === 1 ? "" : " reverse"}`,
                }}
                aria-hidden
              >
                <path
                  d="M50 4 A46 46 0 0 1 96 50"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeDasharray="4 5"
                  markerEnd="url(#arrow)"
                />
                <path
                  d="M50 96 A46 46 0 0 1 4 50"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeDasharray="4 5"
                  markerEnd="url(#arrow)"
                />
                <defs>
                  <marker
                    id="arrow"
                    viewBox="0 0 10 10"
                    refX="5"
                    refY="5"
                    markerWidth="5"
                    markerHeight="5"
                    orient="auto-start-reverse"
                  >
                    <path d="M0 0L10 5L0 10z" fill="currentColor" />
                  </marker>
                </defs>
              </svg>
              {s.discard.slice(-4, -1).map((c) => (
                <span
                  key={c.id}
                  className="absolute inset-0"
                  style={{
                    transform: `rotate(${tilt(c.id)}deg) translate(${tilt(c.id + 7) / 3}px, ${tilt(c.id + 3) / 4}px)`,
                  }}
                >
                  <CardFace c={c} big />
                </span>
              ))}
              <div
                key={s.last?.type === "play" ? s.last.seq : "start"}
                className="card-anim relative"
                style={{
                  ["--tilt" as string]: `${tilt(top.id) / 2}deg`,
                  transform: `rotate(${tilt(top.id) / 2}deg)`,
                  animation:
                    s.last?.type === "play"
                      ? "card-in 0.45s ease-out"
                      : undefined,
                }}
              >
                <CardFace c={top} big shownColor={s.color} />
              </div>
              {burst && (
                <span
                  key={`burst-${s.last?.seq}`}
                  className="card-anim pointer-events-none absolute left-1/2 top-1/2 z-20 whitespace-nowrap text-4xl font-black italic text-white drop-shadow-[0_3px_0_rgba(0,0,0,0.6)]"
                  style={{
                    animation: "burst 1.1s ease-out forwards",
                    WebkitTextStroke: "1.5px #000",
                  }}
                >
                  {burst}
                </span>
              )}
            </div>
            <div className="flex flex-col items-center gap-1">
              <span
                className="size-7 rounded-full border-[3px] border-white shadow-lg"
                style={{ background: HEX[s.color] }}
                title={`Colour: ${s.color}`}
              />
              <span className="text-[10px] font-bold uppercase tracking-wider text-white/70">
                {s.color}
              </span>
            </div>
          </div>

          {/* Whose turn, and the big action buttons. */}
          <div className="flex min-h-12 flex-wrap items-center justify-center gap-3">
            {myTurn ? (
              <span className="animate-pulse rounded-full bg-core px-4 py-1.5 text-sm font-black uppercase tracking-wider text-core-ink shadow-[0_0_20px_rgba(250,204,21,0.6)]">
                Your turn
              </span>
            ) : !s.winner && turnSeat ? (
              <span className="rounded-full bg-black/35 px-4 py-1.5 text-sm font-semibold text-white/90">
                {turnSeat.name}&apos;s turn…
              </span>
            ) : null}
            {myTurn && s.drew === null && !canPlayIds.size && (
              <button
                type="button"
                onClick={() => doAct({ type: "draw" })}
                className="flex items-center gap-2 rounded-full border-[3px] border-white bg-gradient-to-b from-[#3b82f6] to-[#1d4ed8] px-6 py-2.5 text-base font-black uppercase tracking-wide text-white shadow-[0_5px_0_#1e3a8a,0_8px_20px_rgba(0,0,0,0.4)] transition-transform active:translate-y-1 active:shadow-[0_2px_0_#1e3a8a]"
              >
                <Layers size={18} /> Draw a card
              </button>
            )}
            {lastCall && (
              <button
                type="button"
                onClick={() => doAct({ type: "last" })}
                className="card-anim flex items-center gap-2 rounded-full border-[3px] border-white bg-gradient-to-b from-[#ff5a5f] to-[#c81e1e] px-7 py-3 text-lg font-black uppercase italic tracking-wide text-white shadow-[0_5px_0_#7f1d1d,0_0_30px_rgba(239,68,68,0.7)] transition-transform active:translate-y-1"
                style={{ animation: "wiggle 0.9s ease-in-out infinite" }}
              >
                <Megaphone size={20} /> Last card!
              </button>
            )}
            {myTurn && s.drew !== null && (
              <button
                type="button"
                onClick={() => doAct({ type: "pass" })}
                className="flex items-center gap-2 rounded-full border-[3px] border-white bg-gradient-to-b from-[#fbbf24] to-[#d97706] px-7 py-3 text-lg font-black uppercase tracking-wide text-black shadow-[0_5px_0_#92400e,0_8px_20px_rgba(0,0,0,0.4)] transition-transform active:translate-y-1"
              >
                <Hand size={20} /> Keep card
              </button>
            )}
          </div>

          {/* My hand, fanned. */}
          <div className="mt-2 flex flex-col items-center">
            <div
              key={
                s.last?.type === "penalty" && s.last.seat === me
                  ? s.last.seq
                  : "hand"
              }
              className="card-anim w-full overflow-x-auto px-4 pb-2 pt-8"
              style={{
                animation:
                  s.last?.type === "penalty" && s.last.seat === me
                    ? "card-shake 0.4s"
                    : undefined,
              }}
            >
              {/* Centred when it fits, scrollable from the first card when it doesn't. */}
              <div className="mx-auto flex w-max px-4">
                {mine.map((c, i) => {
                  const ok = canPlayIds.has(c.id);
                  const mid = (mine.length - 1) / 2;
                  const spread = Math.min(7, 40 / Math.max(1, mine.length));
                  // The more cards, the more they overlap, so the whole hand fits the screen.
                  const overlap =
                    mine.length > 1
                      ? Math.min(
                          56,
                          Math.max(14, 74 - (fanRoom - 74) / (mine.length - 1)),
                        )
                      : 0;
                  const isNew =
                    s.last &&
                    (s.last.type === "draw" || s.last.type === "penalty") &&
                    s.last.seat === me &&
                    i >= mine.length - (s.last.count ?? 1);
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => tapCard(c)}
                      disabled={!ok}
                      aria-label={`${c.color ?? ""} ${c.kind === "num" ? c.n : c.kind}${ok ? ", tap to play" : ""}`}
                      className={cx(
                        "card-anim group relative shrink-0",
                        ok ? "z-10 cursor-pointer" : "cursor-default",
                      )}
                      style={{
                        marginLeft: i ? -overlap : undefined,
                        transform: `rotate(${(i - mid) * spread}deg) translateY(${Math.abs(i - mid) * spread * 0.9 - (ok ? 14 : 0)}px)`,
                        transformOrigin: "50% 120%",
                        transition: "transform 200ms",
                        animation: isNew
                          ? `card-deal 0.4s ease-out ${(i - (mine.length - (s.last?.count ?? 1))) * 0.08}s both`
                          : undefined,
                      }}
                    >
                      <span
                        className={cx(
                          "block transition-transform duration-200",
                          ok && "group-hover:-translate-y-4",
                        )}
                      >
                        <CardFace c={c} glow={ok} dim={myTurn && !ok} />
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
            <span
              className={cx(
                "mt-1 rounded-full px-3 py-0.5 text-xs font-bold",
                turnSeat?.id === me
                  ? "bg-core text-core-ink"
                  : "bg-black/35 text-white/90",
              )}
            >
              {myName} (you) · {mine.length}{" "}
              {mine.length === 1 ? "card" : "cards"}
            </span>
          </div>

          {s.winner && (
            <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-black/55 backdrop-blur-[2px]">
              {Array.from({ length: 28 }, (_, i) => (
                <span
                  key={i}
                  className="card-anim absolute top-0 size-2.5 rounded-sm"
                  style={{
                    left: `${(i * 37) % 100}%`,
                    background: Object.values(HEX)[i % 4],
                    animation: `confetti ${2 + (i % 5) * 0.4}s linear ${(i % 7) * 0.2}s infinite`,
                  }}
                />
              ))}
              <Crown size={44} className="text-core drop-shadow-lg" />
              <div className="mt-2 text-3xl font-black italic text-white drop-shadow">
                {s.winner === me
                  ? "YOU WIN! 🎉"
                  : `${s.seats.find((x) => x.id === s.winner)?.name} wins!`}
              </div>
              {!isHost && (
                <div className="mt-1 text-sm text-white/80">
                  {hostName} can start the next game.
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {s && (
        <div className="max-h-28 space-y-0.5 overflow-y-auto rounded-xl border border-line bg-panel p-2 text-xs">
          {[...s.log].reverse().map((l, i) => (
            <p
              key={i}
              className={cx(i === 0 ? "font-medium text-fg" : "text-soft")}
            >
              {l}
            </p>
          ))}
        </div>
      )}

      {/* Choosing a Wild's colour: a four-colour wheel. */}
      {picking !== null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={() => setPicking(null)}
        >
          <div
            className="flex flex-col items-center gap-4"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-lg font-black uppercase tracking-wide text-white">
              Pick a colour
            </p>
            <div className="grid size-64 grid-cols-2 overflow-hidden rounded-full border-[6px] border-white shadow-2xl">
              {CARD_COLORS.map((col, i) => (
                <button
                  key={col}
                  type="button"
                  aria-label={col}
                  onClick={() => {
                    doAct({ type: "play", card: picking, color: col });
                    setPicking(null);
                  }}
                  className="flex items-center justify-center text-sm font-black uppercase text-white transition-[filter] hover:brightness-125"
                  style={{
                    background: HEX[col],
                    borderRight: i % 2 === 0 ? "3px solid white" : undefined,
                    borderBottom: i < 2 ? "3px solid white" : undefined,
                  }}
                >
                  {col}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setPicking(null)}
              className="text-sm text-white/70 underline"
            >
              Cancel
            </button>
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

const SYMBOL: Record<Card["kind"], string> = {
  num: "",
  skip: "⊘",
  reverse: "⇄",
  draw2: "+2",
  wild: "★",
  wild4: "+4",
};
const BURST: Record<Card["kind"], string | null> = {
  num: null,
  skip: "SKIP!",
  reverse: "REVERSE!",
  draw2: "+2!",
  wild: "WILD!",
  wild4: "+4!!",
};
/** A small, steady tilt per card so the pile looks thrown, not stacked. */
const tilt = (id: number) => ((id * 37) % 25) - 12;
const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
const avatarColor = (id: string) =>
  ["#7c3aed", "#0891b2", "#db2777", "#ea580c"][
    [...id].reduce((n, ch) => n + ch.charCodeAt(0), 0) % 4
  ];

function CardFace({
  c,
  big,
  glow,
  dim,
  shownColor,
}: {
  c: Card;
  big?: boolean;
  glow?: boolean;
  dim?: boolean;
  shownColor?: CardColor;
}) {
  const bg = c.color ? HEX[c.color] : "#18181b";
  const text = c.kind === "num" ? String(c.n) : SYMBOL[c.kind];
  return (
    <div
      className={cx(
        "relative flex select-none items-center justify-center overflow-hidden rounded-xl border-[3px] border-white shadow-[0_4px_10px_rgba(0,0,0,0.45)]",
        big ? "h-36 w-24" : "h-28 w-[4.6rem]",
        glow && "shadow-[0_0_0_3px_#facc15,0_0_22px_rgba(250,204,21,0.8)]",
        dim && "brightness-[0.6] saturate-50",
      )}
      style={{
        background: `linear-gradient(145deg, ${bg} 0%, ${bg} 55%, color-mix(in oklab, ${bg} 70%, black) 100%)`,
      }}
    >
      {!c.color && (
        <div
          className="absolute inset-0"
          style={{
            background: `conic-gradient(${HEX.red} 0 25%, ${HEX.yellow} 0 50%, ${HEX.green} 0 75%, ${HEX.blue} 0 100%)`,
            opacity: shownColor ? 0.35 : 1,
          }}
        />
      )}
      {!c.color && shownColor && (
        <div
          className="absolute inset-[18%] rounded-full"
          style={{ background: HEX[shownColor] }}
        />
      )}
      <div className="absolute inset-x-[10%] inset-y-[18%] -rotate-[28deg] rounded-[50%] bg-white shadow-[inset_0_-4px_8px_rgba(0,0,0,0.15)]" />
      <span
        className={cx(
          "relative font-black italic",
          big ? "text-5xl" : "text-[2.1rem]",
        )}
        style={{
          color: c.color ? bg : "#111",
          textShadow: "2px 2px 0 rgba(0,0,0,0.25)",
        }}
      >
        {text}
      </span>
      <span className="absolute left-1.5 top-0.5 text-xs font-black italic text-white drop-shadow">
        {text}
      </span>
      <span className="absolute bottom-0.5 right-1.5 rotate-180 text-xs font-black italic text-white drop-shadow">
        {text}
      </span>
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-white/25 via-transparent to-transparent" />
    </div>
  );
}

function CardBack({ small }: { small?: boolean }) {
  return (
    <div
      className={cx(
        "flex items-center justify-center rounded-lg border-2 border-white bg-[radial-gradient(circle_at_30%_25%,#2a2a2e,#0a0a0b)] shadow-[0_3px_8px_rgba(0,0,0,0.5)]",
        small ? "h-11 w-8" : "h-36 w-24 rounded-xl border-[3px]",
      )}
    >
      <div
        className={cx(
          "flex -rotate-[28deg] items-center justify-center rounded-[50%] bg-gradient-to-br from-[#ff5a5f] to-[#b91c1c]",
          small ? "h-6 w-5" : "h-20 w-14",
        )}
      >
        <span
          className={cx(
            "font-black italic text-[#facc15] drop-shadow",
            small ? "text-[7px]" : "text-lg",
          )}
        >
          HM
        </span>
      </div>
    </div>
  );
}
