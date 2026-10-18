"use client";

import { Bot, Check, Crown, Eraser, RotateCcw, Shuffle } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { cx } from "@/components/ui";
import { useVoiceActions } from "@/components/voice/provider";
import { beginPlay, bestCall, bingoAct, doneLines, LETTERS, LINES, newBingo, NEED, randomCard, SIZE, viewFor, type BingoAction, type BingoColor, type BingoState } from "@/lib/games/bingo";
import { type Party, usePartyGame } from "@/lib/games/party";
import { here, seatsFor } from "@/lib/games/party-rules";
import { usePeerGame } from "@/lib/games/peer-game";
import { gameKey, recordResult } from "@/lib/games/record";
import { sfx } from "@/lib/sfx";

/**
 * Bingo, the pen-and-paper way: everyone fills 1–25 into their own 5×5 card however they like, then
 * players take turns calling a number and everyone slashes it. Each complete row, column or diagonal
 * earns a letter of B-I-N-G-O; spell it first to win. Against HIVEMIND's bots on this device, or with
 * everyone at game night (up to 6). The owner's browser runs the rules; each player is sent only their
 * own card until the game is over.
 */
const COLOR: Record<BingoColor, string> = { red: "#e5484d", blue: "#2f7fe8", green: "#2fa34a", yellow: "#f5b400", purple: "#8e4ec6", orange: "#f76b15" };
const rnd = () => crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32;
const EMPTY = Array<number>(SIZE).fill(0);
const okState = (s: unknown): s is BingoState => {
  const x = s as BingoState;
  return !!x && Array.isArray(x.seats) && x.seats.length >= 2 && x.seats.length <= 6 && typeof x.cards === "object" && typeof x.ready === "object" && typeof x.by === "object" && typeof x.lines === "object" && Array.isArray(x.winners) && Array.isArray(x.called) && Array.isArray(x.log) && ["setup", "play", "over"].includes(x.phase);
};

export function BingoGame({ myName, party = null }: { myName: string; /** Game night: everyone in the lobby plays (up to 6). */ party?: Party | null }) {
  const isHost = party ? party.role === "host" : true;
  const me = party ? party.me : "host";
  const sRef = useRef<BingoState | null>(null);
  const publishRef = useRef<(s: BingoState) => void>(() => {});
  const apply = useCallback((fn: (s: BingoState) => BingoState) => {
    const cur = sRef.current;
    if (!cur) return;
    const next = fn(cur);
    if (next !== cur) {
      sRef.current = next;
      publishRef.current(next);
    }
  }, []);
  const onSeat = (seat: string, a: BingoAction) => apply((s) => (a && typeof a === "object" ? bingoAct(s, seat, a) : s));
  const solo = usePeerGame<BingoState, BingoAction>({ role: "host", kind: "bingo", room: "solo", myName, hostName: myName, accept: okState, onAction: () => {}, solo: true, off: !!party });
  const partyNet = usePartyGame<BingoState, BingoAction>(party, "bingo", { accept: okState, viewFor, onAction: (from, a) => onSeat(from, a) });
  const net = partyNet ?? solo;
  const { state: s, publish, act, connected } = net;
  useEffect(() => {
    sRef.current = s;
    publishRef.current = publish;
  });

  const [bots, setBots] = useState(1);
  function start(n = bots) {
    const people = party ? seatsFor(party.players, 6) : [{ id: "host", name: myName }];
    const fill = Math.min(6 - people.length, party ? n : Math.max(1, n));
    const game = newBingo([...people, ...Array.from({ length: fill }, (_, i) => ({ id: `bot${i + 1}`, name: i ? `HIVEMIND ${i + 1}` : "HIVEMIND", bot: true }))], rnd);
    if (game.seats.length < 2) return;
    sRef.current = game;
    publish(game);
    sfx.boot();
  }

  // Host: HIVEMIND calls for its bots, for a friend who dropped out, and for anyone who takes too long.
  const phase = s?.phase;
  const calledN = s?.called.length ?? -1;
  const turnSeat = s && s.phase === "play" ? s.seats[s.turn] : null;
  const turnId = turnSeat?.id;
  const turnAway = !!party && !!turnSeat && !turnSeat.bot && turnSeat.id !== "host" && !party.players.find((p) => p.id === turnSeat.id)?.online;
  const turnBot = !!turnSeat?.bot;
  useEffect(() => {
    if (!isHost || phase !== "play" || !turnId || !connected) return;
    const t = setTimeout(
      () =>
        apply((cur) => {
          if (cur.phase !== "play" || cur.called.length !== calledN || cur.seats[cur.turn]?.id !== turnId) return cur;
          const n = bestCall(cur, turnId);
          return n === null ? cur : bingoAct(cur, turnId, { type: "call", n });
        }),
      turnBot ? 1900 : turnAway ? 2500 : 35000,
    );
    return () => clearTimeout(t);
  }, [isHost, phase, calledN, turnId, turnBot, turnAway, connected, apply]);

  // The owner's record.
  useEffect(() => {
    if (!isHost || !s || s.phase !== "over" || !s.winners.length) return;
    const humans = s.seats.filter((x) => !x.bot && x.id !== "host");
    recordResult(`bingo-${party ? "party" : "solo"}-${gameKey(s.seq, s.winners.join("+"), ...s.seats.map((x) => x.id))}`, {
      game: "bingo",
      mode: humans.length ? "friend" : "bot",
      outcome: s.winners.includes("host") ? "win" : "loss",
      vs: humans.length ? humans.map((x) => x.name).join(", ") : "HIVEMIND",
      detail: `${s.called.length} numbers called${s.winners.length > 1 ? " · tie" : ""}`,
    });
  }, [isHost, s, party]);

  // A tick as each number is called; a fanfare at the end.
  useEffect(() => {
    if (calledN > 0) sfx.hover();
  }, [calledN]);
  useEffect(() => {
    if (phase === "over") sfx.done();
  }, [phase]);

  /* ── my card ── */
  const mySeat = s?.seats.find((x) => x.id === me) ?? null;
  const card = s?.cards[me] ?? null;
  const calledSet = new Set(s?.called ?? []);
  const myTurn = !!s && s.phase === "play" && s.seats[s.turn]?.id === me;
  const send = (a: BingoAction) => (isHost ? apply((cur) => bingoAct(cur, me, a)) : act(a));

  // Setting up: write 1–25 into the boxes (tap a box to write the next number; tap a written box to pick it up, then another to swap or an empty one to move it).
  const [draft, setDraft] = useState<number[]>(EMPTY);
  const [pick, setPick] = useState<number | null>(null);
  const freshSetup = s?.phase === "setup" && s.seq === 0 && !s.ready[me];
  useEffect(() => {
    if (!freshSetup) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- a new game: start with a blank card
    setDraft(EMPTY);
    setPick(null);
  }, [freshSetup]);
  const placed = new Set(draft);
  const nextNum = Array.from({ length: SIZE }, (_, k) => k + 1).find((n) => !placed.has(n)) ?? null;
  function tapDraft(i: number) {
    const d = [...draft];
    if (d[i] === 0) {
      if (pick !== null) {
        d[i] = d[pick];
        d[pick] = 0;
        setPick(null);
      } else if (nextNum !== null) d[i] = nextNum;
      else return;
    } else if (pick === null) {
      setPick(i);
      return;
    } else if (pick === i) {
      d[i] = 0;
      setPick(null);
    } else {
      [d[i], d[pick]] = [d[pick], d[i]];
      setPick(null);
    }
    setDraft(d);
  }
  const full = draft.every((n) => n > 0);

  // Playing: tap a box to choose the number, then call it.
  const [sel, setSel] = useState<number | null>(null);
  const selNum = sel !== null && !calledSet.has(sel) ? sel : null;
  function callIt() {
    if (!myTurn || selNum === null) return;
    send({ type: "call", n: selNum });
    setSel(null);
  }

  useVoiceActions({
    bingo_start: {
      description: "Bingo page: start a game (the owner only). input: how many HIVEMIND bots (0–5).",
      run: ({ input }) => {
        if (!isHost) return { error: "Only the host starts the game." };
        const n = Number(String(input ?? "").match(/\d/)?.[0]);
        start(Number.isInteger(n) ? n : bots);
        return { started: true, note: "Then bingo_fill to fill the owner's card (random), or fill it by tapping." };
      },
    },
    bingo_fill: {
      description: "Bingo page: fill the owner's card with 1–25 in a random order and get ready.",
      run: () => {
        if (!s || s.phase !== "setup" || s.ready[me]) return { error: "Nothing to fill right now." };
        send({ type: "ready", card: randomCard(rnd) });
        return { ready: true };
      },
    },
    bingo_call: {
      description: "Bingo page: call a number on the owner's turn (everyone slashes it). input: a number 1–25, or 'best' for the best one.",
      run: ({ input }) => {
        if (!s || s.phase !== "play") return { error: "No round on." };
        if (!myTurn) return { error: `It's ${turnSeat?.name ?? "someone else"}'s turn.` };
        const said = Number(String(input ?? "").match(/\d+/)?.[0]);
        const n = Number.isInteger(said) && said > 0 ? said : bestCall(s, me);
        if (n === null || n < 1 || n > SIZE || calledSet.has(n)) return { error: `${n ?? "That"} can't be called (already called, or not 1–25).` };
        send({ type: "call", n });
        return { called: n };
      },
    },
    bingo_status: {
      description: "Bingo page: whose turn, the last number, how many lines (letters of BINGO) everyone has, and the owner's numbers not yet called.",
      run: () =>
        s
          ? {
              phase: s.phase,
              turn: s.phase === "play" ? (turnId === me ? "yours" : turnSeat?.name) : null,
              last: s.called[s.called.length - 1] ?? null,
              letters: Object.fromEntries(s.seats.map((x) => [x.id === me ? "you" : x.name, LETTERS.slice(0, s.lines[x.id]).join("") || "-"])),
              your_numbers_left: card ? card.filter((n) => !calledSet.has(n)) : null,
              winners: s.winners.map((w) => s.seats.find((x) => x.id === w)?.name),
            }
          : { error: "No game yet." },
    },
  });

  const people = party ? here(party.players).length : 1;
  const lastCall = s && s.called.length ? { n: s.called[s.called.length - 1], by: s.seats.find((x) => x.id === s.by[s.called[s.called.length - 1]]) } : null;
  const waiting = s?.seats.filter((x) => !s.ready[x.id]) ?? [];
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-3">
      {!s && !isHost && <p className="text-sm text-soft">Connected! {party?.hostName} is setting up Bingo.</p>}

      {isHost && (!s || s.phase === "over") && (
        <div className="flex flex-col gap-2 rounded-xl border border-line bg-panel p-3 text-sm">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-soft">HIVEMIND bots:</span>
            {(party ? [0, 1, 2, 3, 4, 5] : [1, 2, 3, 4, 5]).filter((n) => n + people <= 6).map((n) => (
              <button key={n} type="button" onClick={() => setBots(n)} aria-pressed={bots === n} className={cx("rounded-full border px-3 py-1 text-xs", bots === n ? "border-core bg-core/15 text-core" : "border-line text-soft hover:text-fg")}>
                {n === 0 ? "None" : n}
              </button>
            ))}
          </div>
          <p className="text-xs text-faint">✍️ Everyone writes 1–25 into their own card, then you take turns calling numbers. Each complete row, column or diagonal is a letter of B-I-N-G-O: spell it first to win.</p>
          <button type="button" onClick={() => start()} disabled={people + bots < 2} className="inline-flex items-center gap-1.5 self-start rounded-full bg-core px-5 py-2 text-sm font-semibold text-core-ink disabled:opacity-50">
            {s?.phase === "over" ? <RotateCcw size={14} /> : null} {s?.phase === "over" ? "Play again" : "Start Bingo"}
          </button>
        </div>
      )}

      {s && (
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="mx-auto flex w-full min-w-0 max-w-lg flex-col gap-3">
            {/* ── setting up ── */}
            {s.phase === "setup" && mySeat && !card && (
              <>
                <div className="rounded-2xl border border-core/30 bg-core/[0.07] p-3 text-sm">
                  <b>✍️ Fill your card.</b> <span className="text-soft">{nextNum !== null ? <>Tap a box to write <b className="font-mono text-fg">{nextNum}</b> there ({SIZE - placed.size + (placed.has(0) ? 1 : 0)} to go).</> : "All 25 are in! Tap a number to pick it up and swap it, or hit Ready."}</span>
                </div>
                <Grid cells={draft} color={COLOR[mySeat.color]} pick={pick} onTap={tapDraft} />
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => { setDraft(randomCard(rnd)); setPick(null); }} className="flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-full border-2 border-line px-4 text-sm font-bold active:scale-95">
                    <Shuffle size={15} /> Random
                  </button>
                  <button type="button" onClick={() => { setDraft(EMPTY); setPick(null); }} className="flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-full border-2 border-line px-4 text-sm font-bold active:scale-95">
                    <Eraser size={15} /> Clear
                  </button>
                  <button type="button" disabled={!full || !connected} onClick={() => send({ type: "ready", card: draft })} className="flex min-h-11 basis-full items-center justify-center gap-1.5 rounded-full bg-core px-4 text-base font-black text-core-ink shadow-md active:scale-95 disabled:opacity-40">
                    <Check size={18} /> Ready
                  </button>
                </div>
              </>
            )}
            {s.phase === "setup" && mySeat && card && (
              <>
                <div className="rounded-2xl border border-line bg-panel p-3 text-sm">
                  <b>✅ You&apos;re ready.</b> <span className="text-soft">{waiting.length ? `Waiting for ${waiting.map((x) => x.name).join(", ")}…` : "Starting…"}</span>
                </div>
                <Grid cells={card} color={COLOR[mySeat.color]} />
                {isHost && waiting.length > 0 && (
                  <button type="button" onClick={() => apply((cur) => beginPlay(cur, rnd))} className="min-h-11 rounded-full border-2 border-line px-4 text-sm font-bold active:scale-95">
                    Start now (anyone not ready gets a random card)
                  </button>
                )}
              </>
            )}
            {s.phase === "setup" && !mySeat && <p className="rounded-xl border border-dashed border-line p-3 text-center text-sm text-soft">You joined after this round was set up: you&apos;re watching. You&apos;ll play the next one.</p>}

            {/* ── playing ── */}
            {s.phase === "play" && (
              <>
                <Turn s={s} me={me} last={lastCall} />
                {mySeat && card ? (
                  <>
                    <Letters lines={s.lines[me] ?? 0} big />
                    <Grid cells={card} color={COLOR[mySeat.color]} called={calledSet} lines={doneLines(card, calledSet)} sel={myTurn ? selNum : null} onTap={myTurn ? (i) => !calledSet.has(card[i]) && setSel(card[i] === sel ? null : card[i]) : undefined} />
                    {myTurn ? (
                      <button type="button" onClick={callIt} disabled={selNum === null || !connected} className="min-h-14 rounded-2xl bg-core text-xl font-black tracking-wide text-core-ink shadow-lg transition-transform active:scale-95 disabled:opacity-50">
                        {selNum === null ? "Tap a number on your card" : `Call ${selNum}`}
                      </button>
                    ) : (
                      <p className="text-center text-sm text-soft">{turnSeat?.name}&apos;s picking a number…</p>
                    )}
                  </>
                ) : (
                  <p className="rounded-xl border border-dashed border-line p-3 text-center text-sm text-soft">You joined after this round began: you&apos;re watching. You&apos;ll play the next one.</p>
                )}
              </>
            )}

            {/* ── the end ── */}
            {s.phase === "over" && <Result s={s} me={me} />}
          </div>

          <div className="flex flex-col gap-3">
            <Players s={s} me={me} />
            <Called s={s} />
            <div className="max-h-44 space-y-1 overflow-y-auto rounded-xl border border-line bg-panel p-3 text-sm">
              {[...s.log].reverse().slice(0, 12).map((l, i) => (
                <p key={i} className={cx(i === 0 ? "text-fg" : "text-soft", /BINGO|completes a line/.test(l) && "font-medium")}>
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

/** B-I-N-G-O: a letter lights up for each complete line. */
function Letters({ lines, big = false, color }: { lines: number; big?: boolean; color?: string }) {
  return (
    <div className={cx("flex justify-center", big ? "gap-2" : "gap-0.5")} aria-label={`${Math.min(lines, NEED)} of ${NEED} letters`}>
      {LETTERS.map((L, i) => {
        const on = i < lines;
        return (
          <span
            key={L}
            className={cx("flex items-center justify-center rounded-lg border-2 font-black transition-all", big ? "size-11 text-2xl sm:size-12" : "size-5 rounded text-[10px]", on ? "scale-105 border-white text-white shadow-md" : "border-line text-faint")}
            style={on ? { background: color ?? "var(--color-core)" } : undefined}
          >
            {L}
          </span>
        );
      })}
    </div>
  );
}

/** A 5×5 card. Called numbers are slashed; boxes in a complete line are tinted. */
function Grid({ cells, color, called, lines, sel, pick, onTap, mini = false }: { cells: number[]; color: string; called?: Set<number>; lines?: number[]; sel?: number | null; pick?: number | null; onTap?: (i: number) => void; mini?: boolean }) {
  const inLine = new Set((lines ?? []).flatMap((k) => LINES[k]));
  return (
    <div className={cx("mx-auto grid w-full grid-cols-5 rounded-2xl border border-line bg-panel shadow-sm", mini ? "gap-0.5 rounded-lg p-1" : "gap-1.5 p-2 sm:p-3")} style={mini ? undefined : { maxWidth: "max(17rem, min(100%, calc(100dvh - 25rem)))" }}>
      {cells.map((n, i) => {
        const isCalled = !!called?.has(n) && n > 0;
        const tappable = !!onTap && (isCalled ? false : true);
        return (
          <button
            key={i}
            type="button"
            disabled={!tappable}
            onClick={() => onTap?.(i)}
            aria-label={n ? `${n}${isCalled ? ", called" : ""}` : "Empty box"}
            className={cx(
              "relative flex aspect-square items-center justify-center overflow-hidden border font-black tabular-nums transition-colors",
              mini ? "rounded text-[10px]" : "rounded-xl text-2xl sm:text-3xl",
              n === 0 ? "border-dashed border-line bg-sunken" : "border-line bg-sunken",
              inLine.has(i) && "border-transparent",
              sel === n && n > 0 && "bingo-hint border-[#facc15] bg-[#facc15]/15",
              pick === i && "border-[#facc15] bg-[#facc15]/25",
              tappable && !mini && "active:scale-95",
            )}
            style={inLine.has(i) ? { background: `${color}38` } : undefined}
          >
            <span className={cx(isCalled && "opacity-45")}>{n || ""}</span>
            {isCalled && (
              <svg viewBox="0 0 100 100" className="bingo-slash pointer-events-none absolute inset-0 size-full" aria-hidden>
                <line x1="14" y1="86" x2="86" y2="14" stroke={color} strokeWidth={mini ? 10 : 7} strokeLinecap="round" pathLength={100} />
              </svg>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** Whose turn it is, and the number just called. */
function Turn({ s, me, last }: { s: BingoState; me: string; last: { n: number; by?: BingoState["seats"][number] } | null }) {
  const seat = s.seats[s.turn];
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-line bg-panel p-3">
      {last ? (
        <span key={last.n} className="bingo-pop flex size-16 shrink-0 items-center justify-center rounded-full border-4 border-white text-3xl font-black text-white shadow-lg" style={{ background: last.by ? COLOR[last.by.color] : "var(--color-core)" }}>
          {last.n}
        </span>
      ) : (
        <span className="flex size-16 shrink-0 items-center justify-center rounded-full border-2 border-dashed border-line text-2xl">🎱</span>
      )}
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold">{seat.id === me ? "Your turn: call a number!" : `${seat.name}'s turn`}</div>
        <div className="mt-0.5 text-xs text-soft">{last ? `${last.by?.id === me ? "You" : (last.by?.name ?? "Someone")} called ${last.n}: slashed on every card.` : "Nothing called yet."}</div>
        <div className="mt-1 font-mono text-[11px] text-faint">{s.called.length}/{SIZE} called</div>
      </div>
    </div>
  );
}

/** The end: who spelled BINGO, then every card. */
function Result({ s, me }: { s: BingoState; me: string }) {
  const names = s.winners.map((w) => s.seats.find((x) => x.id === w)?.name ?? "?");
  const set = new Set(s.called);
  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-2xl border border-core/40 bg-core/10 p-3 text-center">
        <Crown size={26} className="mx-auto text-core" />
        <div className="mt-1 text-xl font-black">{s.winners.includes(me) ? (s.winners.length > 1 ? "You share the win! 🎉" : "BINGO! You win! 🎉") : `${names.join(" & ")} spell${s.winners.length > 1 ? "" : "s"} BINGO!`}</div>
        <div className="mt-2">
          <Letters lines={NEED} big />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {s.seats.filter((x) => s.cards[x.id]).map((x) => (
          <div key={x.id} className={cx("rounded-xl border p-1.5", s.winners.includes(x.id) ? "border-core" : "border-line")}>
            <div className="mb-1 flex items-center gap-1 px-1 text-xs font-semibold">
              <span className="size-2.5 rounded-full" style={{ background: COLOR[x.color] }} />
              <span className="min-w-0 flex-1 truncate">{x.id === me ? `${x.name} (you)` : x.name}</span>
              {s.winners.includes(x.id) && <Crown size={12} className="text-core" />}
            </div>
            <Grid cells={s.cards[x.id]} color={COLOR[x.color]} called={set} lines={doneLines(s.cards[x.id], set)} mini />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Everyone at the table: their letters so far, and who's ready or on turn. */
function Players({ s, me }: { s: BingoState; me: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      {s.seats.map((seat, i) => {
        const turn = s.phase === "play" && s.turn === i;
        return (
          <div key={seat.id} className={cx("flex items-center gap-2 rounded-xl border bg-panel px-3 py-2", turn ? "border-core shadow-[0_0_0_1px_var(--color-core)]" : s.winners.includes(seat.id) ? "border-core" : "border-line")}>
            <span className="size-3 shrink-0 rounded-full" style={{ background: COLOR[seat.color] }} />
            <span className="min-w-0 flex-1 truncate text-sm font-medium">
              {seat.bot && <Bot size={12} className="mr-1 inline text-data" />}
              {seat.id === me ? `${seat.name} (you)` : seat.name}
            </span>
            {s.phase === "setup" ? <span className={cx("text-xs", s.ready[seat.id] ? "text-ok" : "text-faint")}>{s.ready[seat.id] ? "ready ✓" : "filling in…"}</span> : <Letters lines={s.lines[seat.id] ?? 0} color={COLOR[seat.color]} />}
          </div>
        );
      })}
    </div>
  );
}

/** 1–25, the called ones filled in the colour of whoever called them. */
function Called({ s }: { s: BingoState }) {
  const last = s.called[s.called.length - 1];
  return (
    <div className="rounded-xl border border-line bg-panel p-2">
      <div className="mb-1.5 px-1 text-xs font-semibold text-soft">Called numbers</div>
      <div className="grid grid-cols-5 gap-1">
        {Array.from({ length: SIZE }, (_, k) => k + 1).map((n) => {
          const by = s.seats.find((x) => x.id === s.by[n]);
          return (
            <span key={n} className={cx("flex h-7 items-center justify-center rounded-md text-xs font-bold tabular-nums", by ? "text-white" : "bg-sunken text-faint", n === last && "ring-2 ring-white")} style={by ? { background: COLOR[by.color] } : undefined}>
              {n}
            </span>
          );
        })}
      </div>
    </div>
  );
}
