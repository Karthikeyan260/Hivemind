"use client";

import { Bot, Crown, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { cx } from "@/components/ui";
import { useVoiceActions } from "@/components/voice/provider";
import { BOARD, botAction, bizAct, buildable, houseCost, JAIL_FINE, netWorth, newBusiness, rentTable, ringCell, type BizAction, type BizColor, type BizState, type Group } from "@/lib/games/business";
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
  const sendRef = useRef(send);
  useEffect(() => {
    sendRef.current = send;
  });
  const [sel, setSel] = useState<number | null>(null);
  const turnSeat = s && !s.over ? s.seats[s.turn] : null;
  const myBuild = s && myTurn && s.phase !== "buy" ? buildable(s, me) : [];
  // Nothing left to do this turn (no houses to build): it ends by itself, a beat after landing so the
  // move and any rent or card can be seen. Only with houses to build is there a "Done" to tap.
  const nothingToDo = myTurn && s?.phase === "end" && !myBuild.length;
  const endSeq = s?.seq;
  useEffect(() => {
    if (!nothingToDo) return;
    const t = setTimeout(() => sendRef.current({ type: "end" }), 1300);
    return () => clearTimeout(t);
  }, [nothingToDo, endSeq]);

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
        <div className="flex items-center gap-2 text-sm">
          <span className="font-mono text-xs text-faint">{s.maxRounds ? `Round ${Math.min(s.round, s.maxRounds)} of ${s.maxRounds}` : `Round ${s.round}`}</span>
          <span className="ml-auto text-xs text-faint">Tap any square to see its card.</span>
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
            <Middle s={s} me={me} myTurn={myTurn} sel={sel} canBuild={myBuild} send={send} onSel={setSel} />
          </Board>
          <div className="flex flex-col gap-3">
            {s.over && <Podium s={s} me={me} />}
            <Players s={s} me={me} onSel={setSel} />
            <div className="max-h-56 space-y-1 overflow-y-auto rounded-xl border border-line bg-panel p-3 text-sm">
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
    <div className="rounded-xl border border-core/40 bg-core/10 p-3 text-center">
      <Crown size={24} className="mx-auto text-core" />
      <div className="mt-1 text-lg font-bold">{s.winner === me ? "You win! 🎉" : `${order[0]?.name} wins!`}</div>
      <ol className="mt-2 space-y-0.5 text-sm">
        {order.map((x, i) => (
          <li key={x.id} className="flex justify-between gap-2 text-soft">
            <span>
              {i + 1}. {x.name}
            </span>
            <span className="font-mono">{s.out.includes(x.id) ? "bankrupt" : rs(netWorth(s, x.id))}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** Everyone at the table: cash, what they own (as colour chips), jail, bankrupt; whose turn it is. */
function Players({ s, me, onSel }: { s: BizState; me: string; onSel: (i: number) => void }) {
  return (
    <div className="flex flex-col gap-2">
      {s.seats.map((seat, i) => {
        const owned = Object.entries(s.owner)
          .filter(([, w]) => w === seat.id)
          .map(([k]) => Number(k))
          .sort((a, b) => a - b);
        const turn = s.turn === i && !s.over;
        const out = s.out.includes(seat.id);
        return (
          <div key={seat.id} className={cx("rounded-xl border bg-panel p-2.5 transition-colors", turn ? "border-core shadow-[0_0_0_1px_var(--color-core)]" : "border-line", out && "opacity-45")}>
            <div className="flex items-center gap-2">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full border-2 border-white text-xs font-black text-white shadow" style={{ background: FILL[seat.color] }}>
                {seat.name.slice(0, 1).toUpperCase()}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                {seat.bot && <Bot size={12} className="mr-1 inline text-data" />}
                {seat.id === me ? "You" : seat.name}
                {s.jail[seat.id] !== undefined && <span className="ml-1 text-xs">🚔</span>}
                {out && <span className="ml-1 text-xs text-alert">bankrupt</span>}
              </span>
              <b className={cx("font-mono text-sm tabular-nums", s.cash[seat.id] < 2000 ? "text-alert" : "text-ok")}>{rs(s.cash[seat.id])}</b>
            </div>
            {owned.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {owned.map((k) => {
                  const q = BOARD[k];
                  const h = s.houses[k] ?? 0;
                  return (
                    <button key={k} type="button" onClick={() => onSel(k)} title={q.name} className="flex h-5 items-center gap-0.5 rounded px-1.5 text-[10px] font-semibold text-white shadow-sm hover:brightness-110" style={{ background: q.kind === "city" ? GROUP[q.group] : "#64748b" }}>
                      {q.kind === "city" ? q.name.slice(0, 3) : q.kind === "station" ? STATION_ICON[q.name] : "💡"}
                      {h > 0 && <span>{h === 5 ? "🏨" : `×${h}`}</span>}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
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
function Die({ v, spin }: { v: number; spin: number }) {
  return (
    <svg key={spin} viewBox="0 0 100 100" className="drop-shadow-md" style={{ width: "8.5cqw", height: "8.5cqw", animation: spin ? "ludo-tumble 0.5s ease-out" : undefined }}>
      <rect x="4" y="4" width="92" height="92" rx="20" fill="#fff" stroke="#d6d3d1" strokeWidth="3" />
      {PIPS[v].map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r="9" fill={v === 1 ? "#dc2626" : "#1c1917"} />
      ))}
    </svg>
  );
}

/** A property's title deed: the colour, the price, every rent, the house cost, and who owns it. */
function Deed({ s, sq, me }: { s: BizState; sq: number; me: string }) {
  const q = BOARD[sq];
  if (q.kind !== "city" && q.kind !== "station" && q.kind !== "utility") return null;
  const who = s.owner[sq] ? s.seats.find((x) => x.id === s.owner[sq]) : null;
  const h = s.houses[sq] ?? 0;
  const head = q.kind === "city" ? GROUP[q.group] : "#334155";
  return (
    <div className="overflow-hidden rounded-md border border-stone-300 bg-white text-stone-800 shadow-xl" style={{ width: "44cqw", fontSize: "1.75cqw" }}>
      <div className="px-[3%] py-[2.5%] text-center text-white" style={{ background: head }}>
        <div className="tracking-[0.2em] opacity-90" style={{ fontSize: "1.3cqw" }}>
          {q.kind === "city" ? "TITLE DEED" : q.kind === "station" ? "TRANSPORT" : "UTILITY"}
        </div>
        <div className="font-black uppercase leading-tight" style={{ fontSize: "2.7cqw" }}>
          {q.kind === "station" ? `${STATION_ICON[q.name]} ` : q.kind === "utility" ? "💡 " : ""}
          {q.name}
        </div>
      </div>
      <div className="space-y-[1.2%] px-[5%] py-[3%]">
        {rentTable(sq).map((r, i) => (
          <div key={r.label} className={cx("flex justify-between gap-2", q.kind === "city" && i === h + (h ? 1 : 0) && who && "font-bold text-stone-950", r.label.startsWith("Each") && "mt-[2%] border-t border-stone-200 pt-[2%]")}>
            <span>{r.label}</span>
            <span className="font-mono">{r.amount}</span>
          </div>
        ))}
        <div className="flex justify-between gap-2 border-t border-stone-200 pt-[2%] font-semibold">
          <span>{who ? "Owner" : "Price"}</span>
          <span className="flex items-center gap-1">
            {who ? (
              <>
                <span className="inline-block size-[1.6cqw] rounded-full" style={{ background: FILL[who.color] }} />
                {who.id === me ? "You" : who.name}
                {h > 0 && ` · ${h === 5 ? "hotel" : `${h} house${h > 1 ? "s" : ""}`}`}
              </>
            ) : (
              rs(q.price)
            )}
          </span>
        </div>
      </div>
    </div>
  );
}

/** The middle of the board: the logo, the dice, whose turn, a card drawn, and what can be done now. */
function Middle({ s, me, myTurn, sel, canBuild, send, onSel }: { s: BizState; me: string; myTurn: boolean; sel: number | null; canBuild: number[]; send: (a: BizAction) => void; onSel: (i: number | null) => void }) {
  // Someone watching (joined after the game began) has no square.
  const here = s.pos[me] !== undefined ? BOARD[s.pos[me]] : null;
  const price = here && (here.kind === "city" || here.kind === "station" || here.kind === "utility") ? here.price : 0;
  const card = s.card && s.card.seq >= (s.lastRoll?.seq ?? 0) ? s.card : null;
  const turnSeat = s.seats[s.turn];
  const buying = myTurn && s.phase === "buy";
  const deed = buying ? s.pos[me] : sel;
  const showDeed = deed !== null && deed !== undefined && ["city", "station", "utility"].includes(BOARD[deed].kind);
  const last = s.log[s.log.length - 1];
  const btn = "rounded-full font-bold shadow-md transition-transform active:scale-95";
  const big = { fontSize: "2.1cqw", padding: "1.3cqw 3.2cqw" };
  return (
    <div className="relative flex h-full flex-col items-center justify-between overflow-hidden py-[3%]" style={{ background: "radial-gradient(circle at 50% 40%, #e8f5e1 0%, #c9e6c0 70%, #b5d9aa 100%)" }}>
      {/* The two card piles, in the corners of the middle. */}
      <div className="absolute left-[6%] top-[8%] flex -rotate-12 items-center justify-center rounded-md border-2 border-white bg-[#f97316] font-black text-white shadow-lg" style={{ width: "11cqw", height: "15cqw", fontSize: "5cqw" }} aria-hidden>
        ?
      </div>
      <div className="absolute right-[6%] bottom-[8%] flex rotate-12 items-center justify-center rounded-md border-2 border-white bg-[#0ea5e9] text-white shadow-lg" style={{ width: "11cqw", height: "15cqw", fontSize: "5cqw" }} aria-hidden>
        💰
      </div>

      <div className="z-10 -rotate-6 rounded-md bg-[#c81e1e] px-[4%] py-[1%] font-black tracking-[0.15em] text-white shadow-lg" style={{ fontSize: "4.2cqw" }}>
        BUSINESS
      </div>

      <div className="z-10 flex w-full flex-col items-center gap-[1.5cqw] px-[4%]">
        {showDeed ? (
          <div className="relative">
            <Deed s={s} sq={deed!} me={me} />
            {!buying && (
              <button type="button" onClick={() => onSel(null)} aria-label="Close" className="absolute -top-[1.5cqw] -right-[1.5cqw] flex size-[4cqw] items-center justify-center rounded-full bg-stone-800 text-white" style={{ fontSize: "2cqw" }}>
                ✕
              </button>
            )}
          </div>
        ) : card ? (
          <div className={cx("rounded-lg border-2 border-white p-[2.5%] text-center text-white shadow-xl", card.deck === "chance" ? "bg-[#f97316]" : "bg-[#0ea5e9]")} style={{ width: "48cqw", fontSize: "2cqw" }}>
            <div className="font-black tracking-widest" style={{ fontSize: "1.6cqw" }}>
              {card.deck === "chance" ? "❓ CHANCE" : "💰 TREASURE"}
            </div>
            <div className="mt-[2%] font-semibold leading-snug">{card.text}</div>
          </div>
        ) : s.lastRoll ? (
          <div className="flex items-center gap-[2cqw]">
            <Die v={s.lastRoll.dice[0]} spin={s.lastRoll.seq} />
            <Die v={s.lastRoll.dice[1]} spin={s.lastRoll.seq} />
          </div>
        ) : (
          <p className="text-center text-stone-600" style={{ fontSize: "2cqw" }}>
            Roll the dice to start!
          </p>
        )}
        {!showDeed && last && (
          <p className="line-clamp-2 max-w-[90%] text-center text-stone-700" style={{ fontSize: "1.8cqw" }}>
            {last}
          </p>
        )}
      </div>

      <div className="z-10 flex flex-col items-center gap-[1.2cqw]">
        {!s.over && (
          <span className="flex items-center gap-[1cqw] rounded-full bg-white/80 px-[2.5cqw] py-[0.6cqw] font-semibold text-stone-800 shadow" style={{ fontSize: "1.9cqw" }}>
            <span className="inline-block rounded-full" style={{ width: "2cqw", height: "2cqw", background: FILL[turnSeat.color] }} />
            {turnSeat.id === me ? "Your turn" : `${turnSeat.name}'s turn`}
            {myTurn && here && s.phase !== "roll" && <span className="font-normal text-stone-500">· on {here.name}</span>}
          </span>
        )}
        {myTurn && (
          <div className="flex flex-wrap justify-center gap-[1.5cqw]">
            {s.phase === "roll" && s.jail[me] !== undefined && s.cash[me] >= JAIL_FINE && (
              <button type="button" onClick={() => send({ type: "payJail" })} className={cx(btn, "border-2 border-stone-700 bg-white text-stone-800")} style={big}>
                Pay {rs(JAIL_FINE)}
              </button>
            )}
            {s.phase === "roll" && (
              <button type="button" onClick={() => send({ type: "roll" })} className={cx(btn, "animate-pulse bg-core text-core-ink")} style={big}>
                🎲 {s.jail[me] !== undefined ? "Roll for doubles" : "Roll"}
              </button>
            )}
            {s.phase === "buy" && here && (
              <>
                <button type="button" onClick={() => send({ type: "buy" })} disabled={s.cash[me] < price} className={cx(btn, "bg-[#16a34a] text-white disabled:opacity-50")} style={big}>
                  Buy {rs(price)}
                </button>
                <button type="button" onClick={() => send({ type: "skip" })} className={cx(btn, "border-2 border-stone-700 bg-white text-stone-800")} style={big}>
                  Skip
                </button>
              </>
            )}
            {s.phase === "end" && canBuild.length > 0 && (
              <button type="button" onClick={() => send({ type: "end" })} className={cx(btn, "bg-core text-core-ink")} style={big}>
                {canBuild.length ? (s.again ? "Done · roll again" : "Done") : s.again ? "🎲 Doubles: roll again" : "…"}
              </button>
            )}
            {sel !== null && canBuild.includes(sel) && !buying && (
              <button type="button" onClick={() => send({ type: "build", sq: sel })} className={cx(btn, "bg-[#16a34a] text-white")} style={big}>
                🏠 Build {(s.houses[sel] ?? 0) === 4 ? "hotel" : "house"} {rs(houseCost(sel))}
              </button>
            )}
            {sel !== null && s.owner[sel] === me && (s.houses[sel] ?? 0) > 0 && !buying && (
              <button type="button" onClick={() => send({ type: "sell", sq: sel })} className={cx(btn, "border-2 border-stone-700 bg-white text-stone-800")} style={big}>
                Sell a house
              </button>
            )}
          </div>
        )}
        {myTurn && canBuild.length > 0 && (sel === null || !canBuild.includes(sel)) && !buying && (
          <p className="text-stone-700" style={{ fontSize: "1.7cqw" }}>
            🏠 You own a full colour set: tap one of its cities to build.
          </p>
        )}
      </div>
    </div>
  );
}

/* ── the board ── */

const STEP_MS = 140;
// Corners are bigger than the other squares, as on a real board.
const CORNER = 1.45;
const SPAN = CORNER * 2 + 7;
const mid = (k: number) => (k === 0 ? CORNER / 2 : k === 8 ? SPAN - CORNER / 2 : CORNER + (k - 1) + 0.5);
const pct = (k: number) => (mid(k) / SPAN) * 100;
type Side = "b" | "l" | "t" | "r";
const sideOf = (i: number): Side => (i < 8 ? "b" : i < 16 ? "l" : i < 24 ? "t" : "r");
const CORNER_LOOK: Record<number, { bg: string; icon: string; label: string; sub?: string }> = {
  0: { bg: "linear-gradient(135deg,#fde68a,#fbbf24)", icon: "🏁", label: "START", sub: `Collect ₹1,500` },
  8: { bg: "repeating-linear-gradient(45deg,#fed7aa 0 6px,#fdba74 6px 12px)", icon: "🚔", label: "JAIL", sub: "Just visiting" },
  16: { bg: "linear-gradient(135deg,#bbf7d0,#86efac)", icon: "🛖", label: "REST HOUSE", sub: "Free stop" },
  24: { bg: "linear-gradient(135deg,#fecaca,#f87171)", icon: "👮", label: "GO TO JAIL" },
};

function Board({ s, me, sel, onSel, children }: { s: BizState; me: string; sel: number | null; onSel: (i: number | null) => void; children: React.ReactNode }) {
  // The last move, played out square by square (a long jump, like to jail, just goes there).
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
  const live = s.seats.filter((x) => !s.out.includes(x.id));
  const fr = `${CORNER}fr repeat(7, 1fr) ${CORNER}fr`;

  return (
    <div className="relative aspect-square w-full max-w-[min(100%,80dvh)] self-center rounded-2xl bg-[#14532d] p-[1.4%] shadow-xl [container-type:inline-size]">
      <div className="relative size-full overflow-hidden rounded-lg bg-[#fffaf0]">
        <div className="absolute inset-0 grid" style={{ gridTemplateColumns: fr, gridTemplateRows: fr }}>
          {BOARD.map((q, i) => {
            const { r, c } = ringCell(i);
            const owner = s.owner[i] ? s.seats.find((x) => x.id === s.owner[i]) : null;
            const h = s.houses[i] ?? 0;
            const side = sideOf(i);
            const vertical = side === "b" || side === "t";
            const corner = i % 8 === 0;
            const look = CORNER_LOOK[i];
            const band = q.kind === "city" ? GROUP[q.group] : null;
            const priced = q.kind === "city" || q.kind === "station" || q.kind === "utility";
            return (
              <button
                key={i}
                type="button"
                onClick={() => onSel(sel === i ? null : i)}
                aria-label={`${q.name}${owner ? `, owned by ${owner.id === me ? "you" : owner.name}` : priced ? `, for sale` : ""}`}
                className={cx("relative flex overflow-hidden border-[0.5px] border-[#c8b48a] text-stone-800 transition-[filter] hover:brightness-95", sel === i && "z-10 outline outline-[3px] outline-core")}
                style={{
                  gridRow: r + 1,
                  gridColumn: c + 1,
                  background: look?.bg ?? "#fffaf0",
                  flexDirection: corner ? "column" : side === "b" ? "column" : side === "t" ? "column-reverse" : side === "l" ? "row-reverse" : "row",
                }}
              >
                {corner && look ? (
                  <span className="flex size-full flex-col items-center justify-center gap-[3%] text-center">
                    <span style={{ fontSize: "4.6cqw", lineHeight: 1 }}>{look.icon}</span>
                    <span className="font-black leading-none tracking-wide" style={{ fontSize: "1.55cqw" }}>
                      {look.label}
                    </span>
                    {look.sub && <span style={{ fontSize: "1.15cqw" }}>{look.sub}</span>}
                  </span>
                ) : (
                  <>
                    {/* The colour band, on the edge facing the middle; houses sit on it. */}
                    <span className="flex shrink-0 items-center justify-center gap-[6%]" style={{ background: band ?? "transparent", [vertical ? "height" : "width"]: band ? "24%" : "0", flexDirection: vertical ? "row" : "column" }}>
                      {h > 0 && h < 5 && Array.from({ length: h }, (_, k) => <span key={k} className="rounded-[1px] bg-[#16a34a] ring-1 ring-white" style={{ width: "1.2cqw", height: "1.2cqw" }} />)}
                      {h === 5 && <span className="rounded-[2px] bg-[#dc2626] ring-1 ring-white" style={{ width: "2.6cqw", height: "1.4cqw" }} />}
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col items-center justify-center px-[4%] text-center leading-tight">
                      {q.kind !== "city" && <span style={{ fontSize: "3cqw", lineHeight: 1.05 }}>{q.kind === "station" ? STATION_ICON[q.name] : ICON[q.kind]}</span>}
                      <span className="font-bold" style={{ fontSize: q.kind === "city" ? (q.name.length > 9 ? "1.18cqw" : q.name.length > 7 ? "1.3cqw" : "1.45cqw") : "1.15cqw" }}>
                        {q.kind === "city" ? q.name.toUpperCase() : q.name}
                      </span>
                      {priced && !owner && (
                        <span className="mt-[4%] font-mono text-stone-500" style={{ fontSize: "1.2cqw" }}>
                          {rs(q.price)}
                        </span>
                      )}
                      {q.kind === "tax" && (
                        <span className="mt-[4%] font-mono text-stone-500" style={{ fontSize: "1.2cqw" }}>
                          {rs(q.amount)}
                        </span>
                      )}
                    </span>
                    {/* Owned: the owner's colour along the outer edge. */}
                    {owner && <span className="absolute" style={{ background: FILL[owner.color], ...(side === "b" ? { left: 0, right: 0, bottom: 0, height: "11%" } : side === "t" ? { left: 0, right: 0, top: 0, height: "11%" } : side === "l" ? { top: 0, bottom: 0, left: 0, width: "9%" } : { top: 0, bottom: 0, right: 0, width: "9%" }) }} />}
                  </>
                )}
              </button>
            );
          })}
          <div className="overflow-hidden border-[0.5px] border-[#c8b48a]" style={{ gridRow: "2 / 9", gridColumn: "2 / 9" }}>
            {children}
          </div>
        </div>
        {/* The pawns: they glide from square to square. */}
        {live.map((seat) => {
          const at = posOf(seat.id);
          const { r, c } = ringCell(at);
          const together = live.filter((x) => posOf(x.id) === at);
          const k = together.indexOf(seat);
          const n = together.length;
          const dx = n > 1 ? ((k % 3) - (Math.min(n, 3) - 1) / 2) * 2.6 : 0;
          const dy = n > 3 ? (Math.floor(k / 3) - 0.5) * 2.6 : 0;
          const isTurn = seat.id === turnId && !s.over;
          return (
            <span
              key={seat.id}
              aria-hidden
              className={cx("pointer-events-none absolute flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-white font-black text-white shadow-[0_2px_4px_rgba(0,0,0,.45)]", isTurn && "z-20 biz-pawn-turn")}
              style={{
                left: `calc(${pct(c)}% + ${dx}%)`,
                top: `calc(${pct(r)}% + ${dy}%)`,
                width: "3.6cqw",
                height: "3.6cqw",
                fontSize: "1.7cqw",
                background: `radial-gradient(circle at 35% 30%, #ffffffaa, ${FILL[seat.color]} 50%)`,
                transition: `left ${STEP_MS - 20}ms ease-out, top ${STEP_MS - 20}ms ease-out`,
              }}
            >
              {seat.id === me ? "★" : seat.name.slice(0, 1).toUpperCase()}
            </span>
          );
        })}
      </div>
    </div>
  );
}
