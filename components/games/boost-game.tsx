"use client";

import { ArrowRight, Bot, Crown, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { cx } from "@/components/ui";
import { useVoiceActions } from "@/components/voice/provider";
import {
  beginDeal,
  boostAct,
  botPass,
  MAX_PLAYERS,
  newBoost,
  nextDeal,
  NAME_MAX,
  pointsFor,
  ROUND_CHOICES,
  score,
  THEME_IDS,
  THEMES,
  triple,
  viewFor,
  type BoostAction,
  type BoostColor,
  type BoostState,
  type ThemeId,
} from "@/lib/games/boost";
import { type Party, usePartyGame } from "@/lib/games/party";
import { here, seatsFor } from "@/lib/games/party-rules";
import { usePeerGame } from "@/lib/games/peer-game";
import { gameKey, recordResult } from "@/lib/games/record";
import { sfx } from "@/lib/sfx";

/**
 * Boost (3 Roses / Allimalli): everyone writes one name in the host's theme, three cards of each name
 * are dealt, and cards go round the table one at a time. Hold three of a kind and tap BOOST first for
 * 1000 points; everyone else races to tap: 900, 800, … Against HIVEMIND's bots on this device, or with
 * everyone at game night. The owner's browser runs the rules; each player is sent only their own hand.
 */
const COLOR: Record<BoostColor, string> = { red: "#e5484d", blue: "#2f7fe8", green: "#2fa34a", yellow: "#f5b400", purple: "#8e4ec6", orange: "#f76b15" };
const rnd = () => crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32;
const okState = (s: unknown): s is BoostState => {
  const x = s as BoostState;
  return !!x && Array.isArray(x.seats) && x.seats.length >= 2 && x.seats.length <= MAX_PLAYERS && typeof x.hands === "object" && typeof x.names === "object" && typeof x.scores === "object" && typeof x.counts === "object" && Array.isArray(x.reacted) && Array.isArray(x.log) && ["names", "pass", "react", "scored", "over"].includes(x.phase);
};
/** Each name in the colour of the player who wrote it: a set of three stands out at a glance. */
const colorOfName = (s: BoostState, name: string) => {
  const writer = s.seats.find((x) => s.names[x.id] === name);
  return writer ? COLOR[writer.color] : "#6b7280";
};
/** How long HIVEMIND waits: bots pass, call and react a little slower than a quick human. */
const BOT_PASS_MS = 1100;
const BOT_CALL_MS = () => 1000 + Math.random() * 1500;
const BOT_REACT_MS = () => 500 + Math.random() * 1700;
const RACE_MS = 5000;
const SLOW_PASS_MS = 15000;
const NEXT_DEAL_MS = 4500;

export function BoostGame({ myName, party = null }: { myName: string; /** Game night: everyone in the lobby plays (up to 6). */ party?: Party | null }) {
  const isHost = party ? party.role === "host" : true;
  const me = party ? party.me : "host";
  const sRef = useRef<BoostState | null>(null);
  const publishRef = useRef<(s: BoostState) => void>(() => {});
  const apply = useCallback((fn: (s: BoostState) => BoostState) => {
    const cur = sRef.current;
    if (!cur) return;
    const next = fn(cur);
    if (next !== cur) {
      sRef.current = next;
      publishRef.current(next);
    }
  }, []);
  const onSeat = (seat: string, a: BoostAction) => apply((s) => (a && typeof a === "object" ? boostAct(s, seat, a) : s));
  const solo = usePeerGame<BoostState, BoostAction>({ role: "host", kind: "boost", room: "solo", myName, hostName: myName, accept: okState, onAction: () => {}, solo: true, off: !!party });
  const partyNet = usePartyGame<BoostState, BoostAction>(party, "boost", { accept: okState, viewFor, onAction: (from, a) => onSeat(from, a) });
  const net = partyNet ?? solo;
  const { state: s, publish, act, connected } = net;
  useEffect(() => {
    sRef.current = s;
    publishRef.current = publish;
  });

  /* ── setup (the host) ── */
  const [bots, setBots] = useState(3);
  const [theme, setTheme] = useState<ThemeId>("heroes");
  const [rounds, setRounds] = useState<number>(10);
  const people = party ? here(party.players).length : 1;
  function start(n = bots) {
    const seated = party ? seatsFor(party.players, MAX_PLAYERS) : [{ id: "host", name: myName }];
    const fill = Math.min(MAX_PLAYERS - seated.length, party ? n : Math.max(2, n));
    const game = newBoost([...seated, ...Array.from({ length: fill }, (_, i) => ({ id: `bot${i + 1}`, name: i ? `HIVEMIND ${i + 1}` : "HIVEMIND", bot: true }))], { theme, rounds }, rnd);
    if (game.seats.length < 3) return;
    sRef.current = game;
    publish(game);
    sfx.boot();
  }

  /* ── the host keeps the table moving: bots, slow or absent players, the race timer, the next deal ── */
  const phase = s?.phase;
  const seq = s?.seq ?? -1;
  const turnSeat = s && s.phase === "pass" ? s.seats[s.turn] : null;
  const turnId = turnSeat?.id;
  const away = (id: string) => !!party && id !== "host" && !s?.seats.find((x) => x.id === id)?.bot && !party.players.find((p) => p.id === id)?.online;
  const turnAway = !!turnId && away(turnId);
  const turnBot = !!turnSeat?.bot;

  // Passing: bots after a moment; a player who's away almost at once; anyone else after 15 s.
  useEffect(() => {
    if (!isHost || phase !== "pass" || !turnId || !connected) return;
    const t = setTimeout(
      () => apply((cur) => (cur.phase === "pass" && cur.seq === seq && cur.seats[cur.turn]?.id === turnId ? boostAct(cur, turnId, { type: "pass", card: botPass(cur, turnId) }) : cur)),
      turnBot ? BOT_PASS_MS : turnAway ? 2500 : SLOW_PASS_MS,
    );
    return () => clearTimeout(t);
  }, [isHost, phase, seq, turnId, turnBot, turnAway, connected, apply]);

  // A bot holding three of a kind calls BOOST (not instantly: a person gets a fair chance).
  const botWithThree = s && s.phase === "pass" ? s.seats.find((x) => x.bot && triple(s.hands[x.id]))?.id : undefined;
  useEffect(() => {
    if (!isHost || !botWithThree) return;
    const t = setTimeout(() => apply((cur) => (cur.phase === "pass" ? boostAct(cur, botWithThree, { type: "boost" }) : cur)), BOT_CALL_MS());
    return () => clearTimeout(t);
  }, [isHost, botWithThree, apply]);

  // The race: each bot taps after its own reaction time; it closes after 5 s whoever's left.
  const raceKey = s && s.phase === "react" ? `${s.round}:${s.reacted[0]}` : "";
  useEffect(() => {
    if (!isHost || !raceKey) return;
    const cur = sRef.current;
    if (!cur) return;
    const timers = cur.seats.filter((x) => x.bot && !cur.reacted.includes(x.id)).map((x) => setTimeout(() => apply((c) => (c.phase === "react" ? boostAct(c, x.id, { type: "boost" }) : c)), BOT_REACT_MS()));
    timers.push(setTimeout(() => apply((c) => (c.phase === "react" ? score(c) : c)), RACE_MS));
    return () => timers.forEach(clearTimeout);
  }, [isHost, raceKey, apply]);

  // After a deal's points, the next deal starts by itself.
  useEffect(() => {
    if (!isHost || phase !== "scored") return;
    const t = setTimeout(() => apply((cur) => nextDeal(cur, rnd)), NEXT_DEAL_MS);
    return () => clearTimeout(t);
  }, [isHost, phase, seq, apply]);

  // The owner's record.
  useEffect(() => {
    if (!isHost || !s || s.phase !== "over" || !s.winners.length) return;
    const humans = s.seats.filter((x) => !x.bot && x.id !== "host");
    recordResult(`boost-${party ? "party" : "solo"}-${gameKey(s.seq, s.winners.join("+"), ...s.seats.map((x) => x.id))}`, {
      game: "boost",
      mode: humans.length ? "friend" : "bot",
      outcome: s.winners.includes("host") ? "win" : "loss",
      vs: humans.length ? humans.map((x) => x.name).join(", ") : "HIVEMIND",
      detail: `${s.scores.host ?? 0} points · ${s.rounds} deals${s.winners.length > 1 ? " · tie" : ""}`,
    });
  }, [isHost, s, party]);

  // Sounds: a flick per pass, a fanfare when someone calls, the end.
  const passes = s?.passes ?? 0;
  useEffect(() => {
    if (passes > 0) sfx.hover();
  }, [passes]);
  useEffect(() => {
    if (phase === "react" || phase === "over") sfx.done();
  }, [phase]);

  /* ── me ── */
  const mySeat = s?.seats.find((x) => x.id === me) ?? null;
  const hand = s?.hands[me] ?? [];
  const myTurn = !!s && s.phase === "pass" && s.seats[s.turn]?.id === me;
  const haveThree = !!triple(hand);
  const iReacted = !!s?.reacted.includes(me);
  const send = (a: BoostAction) => (isHost ? apply((cur) => boostAct(cur, me, a)) : act(a));
  const [sel, setSel] = useState<number | null>(null);
  const [nope, setNope] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [nameErr, setNameErr] = useState<string | null>(null);
  // A new hand or turn: nothing picked.
  const handKey = `${s?.round}:${s?.passes}`;
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the hand changed under the pick
    setSel(null);
  }, [handKey]);

  function pass(i = sel) {
    if (!myTurn || i === null || i < 0 || i >= hand.length) return;
    send({ type: "pass", card: i });
    setSel(null);
  }
  function tapBoost() {
    if (!s || !mySeat) return;
    if (s.phase === "pass" && !haveThree) {
      // No three of a kind yet: nothing happens (no penalty), just a nudge.
      setNope(true);
      setTimeout(() => setNope(false), 900);
      return;
    }
    if (s.phase === "react" && iReacted) return;
    send({ type: "boost" });
  }
  function writeName() {
    const n = draftName.trim();
    if (!s || !n) return;
    const taken = Object.values(s.names).some((x) => x.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "") === n.toLowerCase().replace(/[^\p{L}\p{N}]/gu, ""));
    if (taken) return setNameErr(`"${n}" is taken: pick another ${THEMES[s.theme].label.toLowerCase().replace(/s$/, "")}.`);
    setNameErr(null);
    send({ type: "name", name: n });
  }

  useVoiceActions({
    boost_start: {
      description: "Boost (3 Roses) page: start a game (the owner only). input: how many HIVEMIND bots (2–5), optionally a theme (heroes, heroines, movies, foods, places, cricketers, music) and rounds (10, 15, 20).",
      run: ({ input }) => {
        if (!isHost) return { error: "Only the host starts the game." };
        const t = String(input ?? "").toLowerCase();
        const th = THEME_IDS.find((x) => t.includes(x) || t.includes(THEMES[x].label.toLowerCase()));
        if (th) setTheme(th);
        const r = ROUND_CHOICES.find((x) => t.includes(String(x)));
        if (r) setRounds(r);
        const n = Number(t.match(/\b([1-5])\b/)?.[1]);
        start(Number.isInteger(n) ? n : bots);
        return { started: true, note: "Each player then writes a name (boost_name)." };
      },
    },
    boost_name: {
      description: "Boost page: write the owner's name for this game's theme. input: the name.",
      run: ({ input }) => {
        if (!s || s.phase !== "names" || s.names[me]) return { error: "Not writing names right now." };
        send({ type: "name", name: String(input ?? "") });
        return { written: String(input ?? "") };
      },
    },
    boost_pass: {
      description: "Boost page: on the owner's turn, pass a card to the next player. input: the card's name (or its position 1–4).",
      run: ({ input }) => {
        if (!myTurn) return { error: turnSeat ? `It's ${turnSeat.name}'s turn to pass.` : "Not passing right now." };
        const t = String(input ?? "").toLowerCase().trim();
        const pos = Number(t.match(/\d/)?.[0]);
        const i = Number.isInteger(pos) && pos >= 1 && pos <= hand.length ? pos - 1 : hand.findIndex((c) => c.toLowerCase().includes(t));
        if (i < 0) return { error: `No card like "${input}". Hand: ${hand.join(", ")}` };
        pass(i);
        return { passed: hand[i] };
      },
    },
    boost_tap: {
      description: "Boost page: tap BOOST (call it with three of a kind, or join the race after someone else calls).",
      run: () => {
        tapBoost();
        return { tapped: true };
      },
    },
    boost_status: {
      description: "Boost page: the owner's hand, whose turn to pass, the deal number and the scores.",
      run: () =>
        s
          ? { phase: s.phase, deal: `${s.round} of ${s.rounds}`, your_hand: hand, your_turn: myTurn, three_of_a_kind: haveThree, scores: Object.fromEntries(s.seats.map((x) => [x.id === me ? "you" : x.name, s.scores[x.id]])) }
          : { error: "No game yet." },
    },
  });

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-3">
      {!s && !isHost && <p className="text-sm text-soft">Connected! {party?.hostName} is setting up Boost.</p>}

      {isHost && (!s || s.phase === "over") && (
        <div className="flex flex-col gap-3 rounded-xl border border-line bg-panel p-3 text-sm">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="w-full text-soft sm:mr-1 sm:w-auto">Theme:</span>
            {THEME_IDS.map((t) => (
              <button key={t} type="button" onClick={() => setTheme(t)} aria-pressed={theme === t} className={cx("min-h-9 rounded-full border px-3.5 py-1.5 text-[13px] transition-colors pointer-coarse:min-h-10", theme === t ? "border-core bg-core/15 text-core" : "border-line text-soft hover:text-fg")}>
                {THEMES[t].label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="w-full text-soft sm:mr-1 sm:w-auto">Deals:</span>
            {ROUND_CHOICES.map((r) => (
              <button key={r} type="button" onClick={() => setRounds(r)} aria-pressed={rounds === r} className={cx("min-h-9 min-w-10 rounded-full border px-3.5 py-1.5 text-[13px] transition-colors pointer-coarse:min-h-10", rounds === r ? "border-core bg-core/15 text-core" : "border-line text-soft hover:text-fg")}>
                {r}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="w-full text-soft sm:mr-1 sm:w-auto">HIVEMIND bots:</span>
            {(party ? [0, 1, 2, 3, 4, 5] : [2, 3, 4, 5]).filter((n) => n + people <= MAX_PLAYERS).map((n) => (
              <button key={n} type="button" onClick={() => setBots(n)} aria-pressed={bots === n} className={cx("min-h-9 min-w-10 rounded-full border px-3.5 py-1.5 text-[13px] transition-colors pointer-coarse:min-h-10", bots === n ? "border-core bg-core/15 text-core" : "border-line text-soft hover:text-fg")}>
                {n === 0 ? "None" : n}
              </button>
            ))}
          </div>
          <p className="text-xs text-faint">🌹 Everyone writes one {THEMES[theme].label.toLowerCase().replace(/s$/, "")}. Three cards of each name get shuffled and dealt; pass one card at a time round the table. Hold three of a kind and tap BOOST first for 1000; everyone else races to tap: 900, 800…</p>
          <button type="button" onClick={() => start()} disabled={people + bots < 3} className="inline-flex items-center gap-1.5 self-start rounded-full bg-core px-5 py-2 text-sm font-semibold text-core-ink disabled:opacity-50">
            {s?.phase === "over" ? <RotateCcw size={14} /> : null} {s?.phase === "over" ? "Play again" : "Start Boost"}
          </button>
          {people + bots < 3 && <p className="text-xs text-alert">Boost needs at least 3 players: add a HIVEMIND bot.</p>}
        </div>
      )}

      {s && (
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_280px]">
          <div className="flex min-w-0 flex-col gap-3">
            <Table s={s} me={me} />

            {/* ── writing names ── */}
            {s.phase === "names" && mySeat && !s.names[me] && (
              <form
                className="rounded-2xl border border-core/30 bg-core/[0.07] p-3 text-sm"
                onSubmit={(e) => {
                  e.preventDefault();
                  writeName();
                }}
              >
                <p className="mb-2">
                  <b>✍️ Write one {THEMES[s.theme].label.toLowerCase().replace(/s$/, "")}.</b> <span className="text-soft">It goes on three cards.</span>
                </p>
                <div className="flex gap-2">
                  <input value={draftName} onChange={(e) => setDraftName(e.target.value.slice(0, NAME_MAX))} placeholder={`e.g. ${THEMES[s.theme].names[0]}`} aria-label="Your name for the cards" className="min-h-11 min-w-0 flex-1 rounded-full border border-line bg-panel px-4 text-base" />
                  <button type="submit" disabled={!draftName.trim() || !connected} className="min-h-11 rounded-full bg-core px-5 font-bold text-core-ink disabled:opacity-40">
                    Write
                  </button>
                </div>
                {nameErr && <p className="mt-2 text-xs text-alert">{nameErr}</p>}
              </form>
            )}
            {s.phase === "names" && (s.names[me] || !mySeat) && (
              <div className="rounded-2xl border border-line bg-panel p-3 text-sm">
                {mySeat && (
                  <p>
                    <b>✅ You wrote “{s.names[me]}”.</b>{" "}
                  </p>
                )}
                {/* bots write theirs after the people, so only people are waited for */}
                <p className="text-soft">Waiting for {s.seats.filter((x) => !x.bot && !s.names[x.id]).map((x) => x.name).join(", ") || "the deal"}…</p>
                {isHost && s.seats.some((x) => !x.bot && !s.names[x.id]) && (
                  <button type="button" onClick={() => apply((cur) => beginDeal(cur, rnd))} className="mt-2 min-h-10 rounded-full border-2 border-line px-4 text-sm font-bold active:scale-95">
                    Deal now (HIVEMIND writes for anyone who hasn&apos;t)
                  </button>
                )}
              </div>
            )}

            {/* ── passing and the race ── */}
            {(s.phase === "pass" || s.phase === "react") && (
              <>
                <Status s={s} me={me} />
                {mySeat ? (
                  <>
                    <div className="flex flex-wrap justify-center gap-2 py-1">
                      {hand.map((c, i) => (
                        <Card key={`${i}-${c}`} name={c} color={colorOfName(s, c)} picked={sel === i} glow={haveThree && hand.filter((x) => x === c).length >= 3} onTap={myTurn ? () => setSel(sel === i ? null : i) : undefined} />
                      ))}
                    </div>
                    {myTurn && s.phase === "pass" && (
                      <button type="button" onClick={() => pass()} disabled={sel === null || !connected} className="mx-auto flex min-h-12 w-full max-w-xs items-center justify-center gap-2 rounded-2xl border-2 border-core bg-core/10 text-base font-bold text-core transition-transform active:scale-95 disabled:opacity-40">
                        {sel === null ? "Tap a card to pass" : <>Pass {hand[sel]} <ArrowRight size={17} /></>}
                      </button>
                    )}
                    <BoostButton phase={s.phase} ready={haveThree} done={iReacted} nope={nope} onTap={tapBoost} />
                  </>
                ) : (
                  <p className="rounded-xl border border-dashed border-line p-3 text-center text-sm text-soft">You joined after this game began: you&apos;re watching. You&apos;ll play the next one.</p>
                )}
              </>
            )}

            {/* ── a deal's points, and the end ── */}
            {(s.phase === "scored" || s.phase === "over") && <DealResult s={s} me={me} />}
            {s.phase === "over" && <Final s={s} me={me} />}
          </div>

          <div className="flex flex-col gap-3">
            <Scores s={s} me={me} />
            <div className="max-h-44 space-y-1 overflow-y-auto rounded-xl border border-line bg-panel p-3 text-sm">
              {[...s.log].reverse().map((l, i) => (
                <p key={i} className={cx(i === 0 ? "text-fg" : "text-soft")}>
                  {l}
                </p>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** One card: the name big, in its own colour. */
function Card({ name, color, picked, glow, onTap }: { name: string; color: string; picked?: boolean; glow?: boolean; onTap?: () => void }) {
  return (
    <button
      type="button"
      onClick={onTap}
      disabled={!onTap}
      aria-pressed={picked}
      className={cx(
        "relative flex h-32 w-24 flex-col items-center justify-center rounded-2xl border-2 p-2 text-center shadow-md transition-transform duration-150 sm:h-36 sm:w-28",
        picked ? "-translate-y-3 border-core" : "border-white/15",
        onTap ? "cursor-pointer active:scale-95" : "cursor-default",
        glow && "ring-4 ring-ok/60",
      )}
      style={{ background: `linear-gradient(160deg, color-mix(in oklch, ${color} 80%, white 0%), color-mix(in oklch, ${color} 45%, black))` }}
    >
      <span className="absolute top-1.5 left-2 text-xs opacity-70" aria-hidden>
        🌹
      </span>
      <span className="text-[15px] leading-tight font-bold break-words text-white sm:text-base">{name}</span>
    </button>
  );
}

/** The big button: call it with three of a kind, or race to tap once someone has. */
function BoostButton({ phase, ready, done, nope, onTap }: { phase: string; ready: boolean; done: boolean; nope: boolean; onTap: () => void }) {
  const racing = phase === "react";
  return (
    <button
      type="button"
      onClick={onTap}
      disabled={done}
      className={cx(
        "mx-auto mt-1 flex min-h-16 w-full max-w-sm items-center justify-center rounded-full text-2xl font-black tracking-widest shadow-lg transition-transform active:scale-95",
        done ? "bg-raised text-soft" : racing ? "animate-pulse bg-alert text-white" : ready ? "animate-pulse bg-ok text-black" : "bg-core text-core-ink",
        nope && "translate-x-1",
      )}
    >
      {done ? "Tapped ✓" : nope ? "Not yet!" : racing ? "BOOST! 🌹 Tap fast!" : ready ? "🌹 BOOST!" : "BOOST"}
    </button>
  );
}

/** Everyone round the table: their colour, how many cards they hold, whose turn it is. */
function Table({ s, me }: { s: BoostState; me: string }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-sm">
      {s.seats.map((x, i) => {
        const turn = (s.phase === "pass" || s.phase === "react") && s.turn === i;
        return (
          <span key={x.id} className={cx("flex items-center gap-1.5 rounded-full border px-3 py-1 transition-colors", turn ? "border-core bg-core/10" : "border-line")}>
            <span className="size-3 rounded-full" style={{ background: COLOR[x.color] }} />
            {x.bot && <Bot size={12} className="text-data" />}
            <span className="max-w-28 truncate">{x.id === me ? `${x.name} (you)` : x.name}</span>
            {s.phase !== "names" && <span className="font-mono text-xs text-faint tabular-nums">{s.counts[x.id]}🂠</span>}
            {s.reacted.includes(x.id) && <span className="text-xs text-ok">#{s.reacted.indexOf(x.id) + 1}</span>}
          </span>
        );
      })}
      {s.phase !== "names" && <span className="ml-auto text-xs text-faint">Deal {s.round} of {s.rounds} · {THEMES[s.theme].label}</span>}
    </div>
  );
}

function Status({ s, me }: { s: BoostState; me: string }) {
  if (s.phase === "react") {
    const caller = s.seats.find((x) => x.id === s.reacted[0]);
    return (
      <p className="rounded-2xl border-2 border-alert/60 bg-alert/10 p-3 text-center text-base font-bold">
        {caller?.id === me ? "You called BOOST! 🌹 1000 points" : `${caller?.name} called BOOST! Tap now!`}
      </p>
    );
  }
  const turn = s.seats[s.turn];
  const nextSeat = s.seats[(s.turn + 1) % s.seats.length];
  return (
    <p className={cx("text-center text-sm", turn.id === me ? "font-semibold text-core" : "text-soft")}>
      {turn.id === me ? `Your turn: pass one card to ${nextSeat.name}.` : `${turn.name} is passing to ${nextSeat.id === me ? "you" : nextSeat.name}…`}
    </p>
  );
}

function DealResult({ s, me }: { s: BoostState; me: string }) {
  return (
    <div className="rounded-2xl border border-line bg-panel p-3 text-sm">
      <p className="mb-2 font-semibold">Deal {s.round} 🌹</p>
      <ol className="space-y-1">
        {s.seats
          .map((x) => ({ x, place: s.reacted.indexOf(x.id) }))
          .sort((a, b) => (a.place < 0 ? 99 : a.place) - (b.place < 0 ? 99 : b.place))
          .map(({ x, place }) => (
            <li key={x.id} className="flex items-center gap-2">
              <span className="size-2.5 rounded-full" style={{ background: COLOR[x.color] }} />
              <span className="flex-1 truncate">
                {x.id === me ? "You" : x.name} <span className="text-faint">· {s.names[x.id]}</span>
              </span>
              <span className={cx("font-mono tabular-nums", place === 0 ? "text-ok" : place < 0 ? "text-faint" : "text-soft")}>{place < 0 ? "too slow" : `+${pointsFor(place)}`}</span>
            </li>
          ))}
      </ol>
      {s.phase === "scored" && <p className="mt-2 text-xs text-faint">Next deal in a moment…</p>}
    </div>
  );
}

function Scores({ s, me }: { s: BoostState; me: string }) {
  const rows = [...s.seats].sort((a, b) => (s.scores[b.id] ?? 0) - (s.scores[a.id] ?? 0));
  return (
    <div className="rounded-xl border border-line bg-panel p-3 text-sm">
      <p className="mb-2 text-xs font-medium text-faint">Scores</p>
      <ol className="space-y-1">
        {rows.map((x, i) => (
          <li key={x.id} className="flex items-center gap-2">
            <span className="w-4 text-xs text-faint tabular-nums">{i + 1}</span>
            <span className="size-2.5 rounded-full" style={{ background: COLOR[x.color] }} />
            <span className="flex-1 truncate">{x.id === me ? "You" : x.name}</span>
            <span className="font-mono tabular-nums">{s.scores[x.id] ?? 0}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function Final({ s, me }: { s: BoostState; me: string }) {
  const won = s.winners.includes(me);
  const names = s.winners.map((w) => (w === me ? "You" : s.seats.find((x) => x.id === w)?.name));
  return (
    <div className={cx("rounded-2xl border-2 p-4 text-center", won ? "border-ok/60 bg-ok/10" : "border-line bg-panel")}>
      <Crown className={cx("mx-auto mb-1", won ? "text-ok" : "text-core")} size={26} />
      <p className="text-lg font-bold">{won ? (s.winners.length > 1 ? "You share the win! 🌹" : "You win! 🌹") : `${names.join(" and ")} ${s.winners.length > 1 ? "share the win" : "wins"}!`}</p>
      <p className="text-sm text-soft">{Math.max(...s.seats.map((x) => s.scores[x.id] ?? 0))} points after {s.rounds} deals</p>
    </div>
  );
}

