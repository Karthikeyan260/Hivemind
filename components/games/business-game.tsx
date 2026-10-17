"use client";

import { Bot, Crown, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { cx } from "@/components/ui";
import { useVoiceActions } from "@/components/voice/provider";
import { BOARD, botAction, bizAct, buildable, houseCost, JAIL_FINE, netWorth, newBusiness, rentOf, ringCell, type BizAction, type BizColor, type BizState, type Group } from "@/lib/games/business";
import { type Party, usePartyGame } from "@/lib/games/party";
import { here, seatsFor } from "@/lib/games/party-rules";
import { usePeerGame } from "@/lib/games/peer-game";
import { gameKey, recordResult } from "@/lib/games/record";
import { sfx } from "@/lib/sfx";

/**
 * Business (the Indian property game): against HIVEMIND's bots on this device, or with everyone at game
 * night (up to 6). The owner's browser rolls the dice, draws the cards and runs the rules; friends'
 * taps are requests it checks.
 */
const FILL: Record<BizColor, string> = { red: "#e5484d", blue: "#2f7fe8", green: "#2fa34a", yellow: "#f5b400", purple: "#8e4ec6", orange: "#f76b15" };
const GROUP: Record<Group, string> = { brown: "#8b5a2b", sky: "#38bdf8", pink: "#ec4899", orange: "#f97316", red: "#dc2626", yellow: "#eab308", green: "#16a34a", blue: "#1d4ed8" };
const ICON: Partial<Record<string, string>> = { start: "🏁", jail: "🚔", rest: "🛖", gotojail: "👮", chance: "❓", treasure: "💰", tax: "🧾", station: "🚉", utility: "💡" };
const STATION_ICON: Record<string, string> = { Railways: "🚆", Airways: "✈️", Waterways: "🚢", Roadways: "🚌" };
const rs = (n: number) => `₹${n.toLocaleString("en-IN")}`;
const rnd = (n: number) => crypto.getRandomValues(new Uint32Array(1))[0] % n;
const luck = () => ({ d1: rnd(6) + 1, d2: rnd(6) + 1, pick: rnd(1000) });
const okState = (s: unknown): s is BizState => {
  const x = s as BizState;
  return !!x && Array.isArray(x.seats) && x.seats.length >= 2 && x.seats.length <= 6 && typeof x.cash === "object" && typeof x.owner === "object" && Number.isInteger(x.turn) && Array.isArray(x.log);
};

export function BusinessGame({ myName, party = null }: { myName: string; /** Game night: everyone in the lobby plays (up to 6). */ party?: Party | null }) {
  const isHost = party ? party.role === "host" : true;
  const me = party ? party.me : "host";
  const sRef = useRef<BizState | null>(null);
  const publishRef = useRef<(s: BizState) => void>(() => {});
  const apply = useCallback((fn: (s: BizState) => BizState) => {
    const cur = sRef.current;
    if (!cur) return;
    const next = fn(cur);
    if (next !== cur) {
      sRef.current = next;
      publishRef.current(next);
    }
  }, []);
  const onSeat = (seat: string, a: BizAction) => apply((s) => bizAct(s, seat, a, luck()));
  const solo = usePeerGame<BizState, BizAction>({ role: "host", kind: "business", room: "solo", myName, hostName: myName, accept: okState, onAction: () => {}, solo: true, off: !!party });
  const partyNet = usePartyGame<BizState, BizAction>(party, "business", { accept: okState, onAction: (from, a) => a && typeof a === "object" && onSeat(from, a) });
  const net = partyNet ?? solo;
  const { state: s, publish, act, connected } = net;
  useEffect(() => {
    sRef.current = s;
    publishRef.current = publish;
  });

  const [bots, setBots] = useState(1);
  const [rounds, setRounds] = useState(20);
  function start(n = bots, r = rounds) {
    const people = party ? seatsFor(party.players, 6) : [{ id: "host", name: myName }];
    const fill = Math.min(6 - people.length, party ? n : Math.max(1, n));
    const g = newBusiness([...people, ...Array.from({ length: fill }, (_, i) => ({ id: `bot${i + 1}`, name: i ? `HIVEMIND ${i + 1}` : "HIVEMIND", bot: true }))], r);
    if (g.seats.length < 2) return;
    sRef.current = g;
    publish(g);
    sfx.boot();
  }

  // Host: HIVEMIND plays its bots, and a friend who dropped out (until they're back).
  useEffect(() => {
    if (!isHost || !s || s.over || !connected) return;
    const seat = s.seats[s.turn];
    const away = !!party && !seat.bot && seat.id !== "host" && !party.players.find((p) => p.id === seat.id)?.online;
    if (!seat.bot && !away) return;
    const t = setTimeout(() => apply((cur) => (cur.seq !== s.seq ? cur : bizAct(cur, seat.id, botAction(cur), luck()))), away ? 2200 : s.phase === "roll" ? 1100 : 900);
    return () => clearTimeout(t);
  }, [isHost, s, connected, apply, party]);

  useEffect(() => {
    if (!isHost || !s?.over || !s.winner) return;
    const humans = s.seats.filter((x) => !x.bot && x.id !== "host");
    recordResult(`business-${party ? "party" : "solo"}-${gameKey(s.seq, s.winner, ...s.seats.map((x) => x.id))}`, {
      game: "business",
      mode: humans.length ? "friend" : "bot",
      outcome: s.winner === "host" ? "win" : "loss",
      vs: humans.length ? humans.map((x) => x.name).join(", ") : "HIVEMIND",
      detail: `${s.seats.length} players · ${s.round} rounds`,
    });
  }, [isHost, s, party]);

  const myTurn = !!s && !s.over && s.seats[s.turn]?.id === me && !s.out.includes(me);
  function send(a: BizAction) {
    if (!myTurn) return;
    if (isHost) apply((cur) => bizAct(cur, me, a, luck()));
    else act(a);
  }
  const [sel, setSel] = useState<number | null>(null);
  const turnSeat = s && !s.over ? s.seats[s.turn] : null;
  const myBuild = s && myTurn && s.phase !== "buy" ? buildable(s, me) : [];

  // Voice: the whole game by speaking.
  const cityNamed = (t: string) => BOARD.findIndex((q) => q.kind === "city" && t.toLowerCase().includes(q.name.toLowerCase()));
  useVoiceActions({
    business_start: {
      description: "Business page: start a game (the owner only). input: how many HIVEMIND bots (0–5) and a round limit ('20 rounds', or 'no limit').",
      run: ({ input }) => {
        if (!isHost) return { error: "Only the host starts the game." };
        const t = String(input ?? "").toLowerCase();
        const b = Number(t.match(/(\d)\s*bots?/)?.[1] ?? bots);
        const r = /no limit|unlimited|full/.test(t) ? 0 : Number(t.match(/(\d+)\s*rounds?/)?.[1] ?? rounds);
        start(b, r);
        return { started: true, rounds: r || "no limit" };
      },
    },
    business_roll: {
      description: "Business page: roll the dice on the owner's turn.",
      run: () => (myTurn && s!.phase === "roll" ? (send({ type: "roll" }), { rolled: true, note: "Then say where they landed (business_status)." }) : { error: myTurn ? `Now: ${s!.phase === "buy" ? "buy or skip" : "end your turn"}.` : "Not your turn." }),
    },
    business_buy: {
      description: "Business page: buy the property the owner just landed on.",
      run: () => (myTurn && s!.phase === "buy" ? (send({ type: "buy" }), { bought: BOARD[s!.pos[me]]?.name }) : { error: "Nothing to buy right now." }),
    },
    business_skip: {
      description: "Business page: don't buy the property just landed on.",
      run: () => (myTurn && s!.phase === "buy" ? (send({ type: "skip" }), { skipped: true }) : { error: "Nothing to skip." }),
    },
    business_build: {
      description: "Business page: build a house (5th = hotel) on one of the owner's cities. input: the city's name.",
      run: ({ input }) => {
        const i = cityNamed(String(input ?? ""));
        if (i < 0) return { error: "Say a city's name." };
        if (!myBuild.includes(i)) return { error: `Can't build on ${BOARD[i].name} now (needs the whole colour group, even building, and the cash).`, can_build_on: myBuild.map((k) => BOARD[k].name) };
        send({ type: "build", sq: i });
        return { built_on: BOARD[i].name };
      },
    },
    business_jail: {
      description: "Business page: pay ₹500 to get out of jail.",
      run: () => (myTurn && s!.phase === "roll" && s!.jail[me] !== undefined ? (send({ type: "payJail" }), { paid: true }) : { error: "You're not in jail." }),
    },
    business_end: {
      description: "Business page: end the owner's turn.",
      run: () => (myTurn && s!.phase === "end" ? (send({ type: "end" }), { ended: true }) : { error: "Can't end the turn yet." }),
    },
    business_status: {
      description: "Business page: cash, properties, where everyone is, whose turn and what to do now, the last card.",
      run: () =>
        s
          ? {
              players: s.seats.map((x) => ({ name: x.id === me ? "you" : x.name, cash: s.cash[x.id], square: BOARD[s.pos[x.id]]?.name, properties: Object.entries(s.owner).filter(([, w]) => w === x.id).map(([k]) => BOARD[Number(k)].name), in_jail: s.jail[x.id] !== undefined, out: s.out.includes(x.id) })),
              turn: s.over ? "game over" : turnSeat?.id === me ? `yours: ${s.phase}` : turnSeat?.name,
              round: s.maxRounds ? `${s.round} of ${s.maxRounds}` : s.round,
              last: s.log.slice(-3),
              winner: s.winner ? s.seats.find((x) => x.id === s.winner)?.name : null,
            }
          : { error: "No game yet." },
    },
  });

  const people = party ? here(party.players).length : 1;
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-3">
      {s && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {s.seats.map((seat, i) => (
            <span key={seat.id} className={cx("flex items-center gap-1.5 rounded-full border px-3 py-1", s.turn === i && !s.over ? "border-core bg-core/10" : "border-line", s.out.includes(seat.id) && "opacity-50 line-through")}>
              <span className="size-3 rounded-full" style={{ background: FILL[seat.color] }} />
              {seat.bot && <Bot size={12} className="text-data" />}
              <span className="max-w-24 truncate">{seat.id === me ? "You" : seat.name}</span>
              <b className="font-mono text-xs tabular-nums">{rs(s.cash[seat.id])}</b>
              {s.jail[seat.id] !== undefined && <span title="In jail">🚔</span>}
            </span>
          ))}
          <span className="ml-auto font-mono text-xs text-faint">{s.maxRounds ? `Round ${Math.min(s.round, s.maxRounds)}/${s.maxRounds}` : `Round ${s.round}`}</span>
        </div>
      )}
      {!s && !isHost && <p className="text-sm text-soft">Connected! {party?.hostName} is setting up Business.</p>}

      {isHost && (!s || s.over) && (
        <div className="flex flex-col gap-2 rounded-xl border border-line bg-panel p-3 text-sm">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-soft">HIVEMIND bots:</span>
            {(party ? [0, 1, 2, 3, 4, 5] : [1, 2, 3, 4, 5]).filter((n) => n + people <= 6).map((n) => (
              <Choice key={n} on={bots === n} onClick={() => setBots(n)}>
                {n === 0 ? "None" : n}
              </Choice>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-soft">Game length:</span>
            {[
              [10, "Quick · 10 rounds"],
              [20, "20 rounds"],
              [40, "40 rounds"],
              [0, "Till one is left"],
            ].map(([n, label]) => (
              <Choice key={n} on={rounds === n} onClick={() => setRounds(n as number)}>
                {label}
              </Choice>
            ))}
          </div>
          <p className="text-xs text-faint">With a round limit, the richest (cash + property) wins when the rounds are up.</p>
          <button type="button" onClick={() => start()} disabled={people + bots < 2} className="inline-flex items-center gap-1.5 self-start rounded-full bg-core px-5 py-2 text-sm font-semibold text-core-ink disabled:opacity-50">
            {s?.over ? <RotateCcw size={14} /> : null} {s?.over ? "Play again" : "Start Business"}
          </button>
        </div>
      )}

      {s && (
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_280px]">
          <Board s={s} me={me} sel={sel} onSel={setSel}>
            <Middle s={s} me={me} myTurn={myTurn} sel={sel} canBuild={myBuild} send={send} turnName={turnSeat?.id === me ? "Your" : `${turnSeat?.name ?? ""}'s`} />
          </Board>
          <div className="flex flex-col gap-3">
            {s.over && <Podium s={s} me={me} />}
            <Mine s={s} me={me} onSel={setSel} />
            <div className="max-h-64 space-y-1 overflow-y-auto rounded-xl border border-line bg-panel p-3 text-sm">
              {[...s.log].reverse().map((l, i) => (
                <p key={i} className={cx(i === 0 ? "text-fg" : "text-soft", /bought|bankrupt|wins|jail/.test(l) && "font-medium")}>
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

function Choice({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={on} className={cx("rounded-full border px-3 py-1 text-xs", on ? "border-core bg-core/15 text-core" : "border-line text-soft hover:text-fg")}>
      {children}
    </button>
  );
}

function Podium({ s, me }: { s: BizState; me: string }) {
  const order = [...s.seats].sort((a, b) => (a.id === s.winner ? -1 : b.id === s.winner ? 1 : netWorth(s, b.id) - netWorth(s, a.id)));
  return (
    <div className="rounded-xl bg-raised p-3 text-center">
      <Crown size={22} className="mx-auto text-core" />
      <div className="mt-1 font-semibold">{s.winner === me ? "You win! 🎉" : `${order[0]?.name} wins!`}</div>
      <div className="text-xs text-soft">{order.map((x, i) => `${i + 1}. ${x.name} ${s.out.includes(x.id) ? "(bankrupt)" : rs(netWorth(s, x.id))}`).join(" · ")}</div>
    </div>
  );
}

/** The owner's properties, by colour group (tap one to see it on the board). */
function Mine({ s, me, onSel }: { s: BizState; me: string; onSel: (i: number) => void }) {
  const mine = Object.entries(s.owner)
    .filter(([, w]) => w === me)
    .map(([k]) => Number(k))
    .sort((a, b) => a - b);
  if (!mine.length) return null;
  return (
    <div className="rounded-xl border border-line bg-panel p-3 text-sm">
      <p className="mb-2 font-mono text-[10.5px] uppercase tracking-wider text-faint">Your properties · worth {rs(netWorth(s, me))}</p>
      <div className="flex flex-wrap gap-1.5">
        {mine.map((i) => {
          const q = BOARD[i];
          const h = s.houses[i] ?? 0;
          return (
            <button key={i} type="button" onClick={() => onSel(i)} className="flex items-center gap-1 rounded-md border border-line px-2 py-1 text-xs hover:border-core">
              <span className="size-2.5 rounded-sm" style={{ background: q.kind === "city" ? GROUP[q.group] : "#888" }} />
              {q.name}
              {h > 0 && <span className="text-[10px]">{h === 5 ? "🏨" : "🏠".repeat(h)}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

const PIPS: Record<number, [number, number][]> = {
  1: [[50, 50]],
  2: [[28, 28], [72, 72]],
  3: [[25, 25], [50, 50], [75, 75]],
  4: [[28, 28], [72, 28], [28, 72], [72, 72]],
  5: [[25, 25], [75, 25], [50, 50], [25, 75], [75, 75]],
  6: [[28, 22], [72, 22], [28, 50], [72, 50], [28, 78], [72, 78]],
};
function Die({ v }: { v: number }) {
  return (
    <svg viewBox="0 0 100 100" className="size-9 sm:size-11">
      <rect x="4" y="4" width="92" height="92" rx="18" fill="#fff" stroke="#c9a96e" strokeWidth="5" />
      {PIPS[v].map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r="9" fill="#111" />
      ))}
    </svg>
  );
}

/** The middle of the board: dice, whose turn, the card drawn, and the buttons for what can be done now. */
function Middle({ s, me, myTurn, sel, canBuild, send, turnName }: { s: BizState; me: string; myTurn: boolean; sel: number | null; canBuild: number[]; send: (a: BizAction) => void; turnName: string }) {
  // Someone watching (joined after the game began) has no square.
  const here = s.pos[me] !== undefined ? BOARD[s.pos[me]] : null;
  const price = here && (here.kind === "city" || here.kind === "station" || here.kind === "utility") ? here.price : 0;
  const card = s.card && s.card.seq >= (s.lastRoll?.seq ?? 0) ? s.card : null;
  const q = sel !== null ? BOARD[sel] : null;
  const btn = "rounded-full px-3 py-1.5 text-xs font-semibold sm:px-4 sm:text-sm";
  return (
    <div className="flex h-full flex-col items-center justify-center gap-1.5 p-1 text-center sm:gap-2">
      <p className="font-black tracking-[0.2em] text-[#7a5520] text-[10px] sm:text-sm">BUSINESS</p>
      {s.lastRoll && (
        <div className="flex gap-1.5">
          <Die v={s.lastRoll.dice[0]} />
          <Die v={s.lastRoll.dice[1]} />
        </div>
      )}
      {card && (
        <p className={cx("max-w-[95%] rounded-md px-2 py-1 text-[10px] leading-tight text-white sm:text-xs", card.deck === "chance" ? "bg-[#f97316]" : "bg-[#0ea5e9]")}>
          {card.deck === "chance" ? "❓ Chance" : "💰 Treasure"}: {card.text}
        </p>
      )}
      {!s.over && <p className="text-[11px] font-medium text-[#3b2a12] sm:text-sm">{turnName} turn</p>}
      {myTurn && (
        <div className="flex flex-wrap justify-center gap-1.5">
          {s.phase === "roll" && s.jail[me] !== undefined && s.cash[me] >= JAIL_FINE && (
            <button type="button" onClick={() => send({ type: "payJail" })} className={cx(btn, "border border-[#7a5520] text-[#7a5520]")}>
              Pay {rs(JAIL_FINE)}
            </button>
          )}
          {s.phase === "roll" && (
            <button type="button" onClick={() => send({ type: "roll" })} className={cx(btn, "animate-pulse bg-core text-core-ink")}>
              {s.jail[me] !== undefined ? "Roll for doubles" : "Roll"}
            </button>
          )}
          {s.phase === "buy" && (
            <>
              <button type="button" onClick={() => send({ type: "buy" })} className={cx(btn, "bg-ok text-black")}>
                Buy {here?.name} {rs(price)}
              </button>
              <button type="button" onClick={() => send({ type: "skip" })} className={cx(btn, "border border-[#7a5520] text-[#7a5520]")}>
                Skip
              </button>
            </>
          )}
          {s.phase === "end" && (
            <button type="button" onClick={() => send({ type: "end" })} className={cx(btn, "bg-core text-core-ink")}>
              {s.again ? "Doubles: roll again" : "End turn"}
            </button>
          )}
        </div>
      )}
      {q && sel !== null && (q.kind === "city" || q.kind === "station" || q.kind === "utility") && (
        <div className="w-[92%] rounded-md border border-[#c9a96e] bg-white/70 p-1.5 text-[10px] text-[#3b2a12] sm:text-xs">
          <b>{q.name}</b> · {rs(q.price)} · {s.owner[sel] ? `owned by ${s.owner[sel] === me ? "you" : s.seats.find((x) => x.id === s.owner[sel])?.name}` : "for sale"}
          {s.owner[sel] && <> · rent now {q.kind === "utility" ? "dice × 40/100" : rs(rentOf(s, sel, 7))}</>}
          {q.kind === "city" && <> · house {rs(houseCost(sel))}</>}
          {canBuild.includes(sel) && (
            <button type="button" onClick={() => send({ type: "build", sq: sel })} className="ml-1 rounded-full bg-ok px-2 py-0.5 font-semibold text-black">
              Build {(s.houses[sel] ?? 0) === 4 ? "hotel" : "house"}
            </button>
          )}
          {myTurn && s.owner[sel] === me && (s.houses[sel] ?? 0) > 0 && (
            <button type="button" onClick={() => send({ type: "sell", sq: sel })} className="ml-1 rounded-full border border-[#7a5520] px-2 py-0.5">
              Sell house
            </button>
          )}
        </div>
      )}
      {myTurn && canBuild.length > 0 && sel === null && <p className="text-[10px] text-[#3b2a12] sm:text-xs">🏠 You can build: tap a city of yours.</p>}
    </div>
  );
}

const STEP_MS = 120;

function Board({ s, me, sel, onSel, children }: { s: BizState; me: string; sel: number | null; onSel: (i: number | null) => void; children: React.ReactNode }) {
  // The last move played out square by square (a long jump, like to jail, just goes there).
  const [walk, setWalk] = useState<{ seat: string; at: number } | null>(null);
  const seen = useRef(s.last?.seq ?? -1);
  const game = useRef(s);
  useEffect(() => {
    game.current = s;
  });
  const lastSeq = s.last?.seq;
  useEffect(() => {
    const L = game.current.last;
    if (!L || L.seq !== lastSeq || L.seq === seen.current) return;
    seen.current = L.seq;
    const n = (L.to - L.from + BOARD.length) % BOARD.length;
    if (!n || n > 12) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (let k = 1; k <= n; k++)
      timers.push(
        setTimeout(() => {
          sfx.hover();
          setWalk(k === n ? null : { seat: L.seat, at: (L.from + k) % BOARD.length });
        }, k * STEP_MS),
      );
    setWalk({ seat: L.seat, at: L.from });
    return () => {
      timers.forEach(clearTimeout);
      setWalk(null);
    };
  }, [lastSeq]);

  const posOf = (id: string) => (walk?.seat === id ? walk.at : s.pos[id]);
  const turnId = s.seats[s.turn]?.id;
  return (
    <div className="relative aspect-square w-full max-w-[min(100%,76dvh)] self-center overflow-hidden rounded-xl border-2 border-[#c9a96e] bg-[#fdf3dc] shadow-sm">
      <div className="absolute inset-0 grid" style={{ gridTemplateColumns: "repeat(9, 1fr)", gridTemplateRows: "repeat(9, 1fr)" }}>
        {BOARD.map((q, i) => {
          const { r, c } = ringCell(i);
          const owner = s.owner[i] ? s.seats.find((x) => x.id === s.owner[i]) : null;
          const h = s.houses[i] ?? 0;
          const tokens = s.seats.filter((x) => !s.out.includes(x.id) && posOf(x.id) === i);
          const corner = i % 8 === 0;
          return (
            <button
              key={i}
              type="button"
              onClick={() => onSel(sel === i ? null : i)}
              aria-label={`${q.name}${owner ? `, owned by ${owner.id === me ? "you" : owner.name}` : ""}`}
              className={cx("relative flex flex-col items-center justify-start overflow-hidden border-[0.5px] border-[#d9bf8c] text-[#3b2a12]", sel === i && "z-10 ring-2 ring-core")}
              style={{ gridRow: r + 1, gridColumn: c + 1, background: corner ? "#f6e3b4" : "#fffaf0", boxShadow: owner ? `inset 0 0 0 2px ${FILL[owner.color]}` : undefined }}
            >
              {q.kind === "city" && <span className="h-[18%] w-full shrink-0" style={{ background: GROUP[q.group] }} />}
              {q.kind === "city" ? (
                <span className="mt-[6%] px-px text-[clamp(5px,1.25vw,9px)] leading-none font-semibold">{q.name}</span>
              ) : (
                <span className={cx("leading-none", corner ? "mt-[10%] text-[clamp(12px,3vw,24px)]" : "mt-[8%] text-[clamp(10px,2.4vw,18px)]")}>{q.kind === "station" ? STATION_ICON[q.name] : ICON[q.kind]}</span>
              )}
              {q.kind !== "city" && <span className="px-px text-[clamp(5px,1.1vw,8px)] leading-tight">{q.name}</span>}
              {(q.kind === "city" || q.kind === "station" || q.kind === "utility") && !owner && <span className="mt-auto mb-[4%] text-[clamp(5px,1.1vw,8px)] leading-none text-[#7a5520]">{rs(q.price)}</span>}
              {h > 0 && <span className="mt-auto mb-[3%] text-[clamp(5px,1.2vw,9px)] leading-none">{h === 5 ? "🏨" : "🏠".repeat(h)}</span>}
              {tokens.length > 0 && (
                <span className="absolute inset-x-0 bottom-[22%] flex flex-wrap justify-center gap-px">
                  {tokens.map((x) => (
                    <span key={x.id} title={x.name} className={cx("size-2.5 rounded-full border border-white shadow sm:size-3.5", x.id === turnId && !s.over && "ring-1 ring-black")} style={{ background: FILL[x.color] }} />
                  ))}
                </span>
              )}
            </button>
          );
        })}
        <div className="flex flex-col" style={{ gridRow: "2 / 9", gridColumn: "2 / 9" }}>
          {children}
        </div>
      </div>
    </div>
  );
}
