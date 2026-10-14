"use client";

import { Bot, Crown, Mic, MicOff, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { cx } from "@/components/ui";
import { useVoiceActions } from "@/components/voice/provider";
import { botLine, drawLine, leaders, lineAt, newDots, scores, type DotsState, type GridSize } from "@/lib/games/dots";
import { usePeerGame } from "@/lib/games/peer-game";
import { gameKey, recordResult } from "@/lib/games/record";
import { sfx } from "@/lib/sfx";

/**
 * Dots and Boxes: with a friend on their own phone through your game link (voice on), or against
 * HIVEMIND on this device. Your browser runs the rules; the friend's taps are requests it checks.
 * Each line's tap area is the diamond between its two dots, so the whole board is tappable on a phone.
 */
type Action = { type: "line"; line: number };

const COLORS = ["#f5b400", "#2f7fe8", "#e5484d", "#2fa34a"];
const SIZES: { n: GridSize; label: string }[] = [
  { n: 3, label: "3×3 quick" },
  { n: 4, label: "4×4" },
  { n: 5, label: "5×5" },
  { n: 6, label: "6×6 long" },
];

/** A state from the host, checked before it's shown. */
const okState = (s: unknown): s is DotsState => {
  const x = s as DotsState;
  return (
    !!x &&
    Number.isInteger(x.rows) &&
    Number.isInteger(x.cols) &&
    x.rows >= 2 &&
    x.rows <= 8 &&
    x.cols >= 2 &&
    x.cols <= 8 &&
    Array.isArray(x.seats) &&
    x.seats.length >= 2 &&
    x.seats.length <= 4 &&
    Array.isArray(x.lines) &&
    x.lines.length === (x.rows + 1) * x.cols + x.rows * (x.cols + 1) &&
    Array.isArray(x.boxes) &&
    x.boxes.length === x.rows * x.cols &&
    Number.isInteger(x.turn) &&
    Array.isArray(x.log)
  );
};

export function DotsGame({
  role,
  room,
  myName,
  hostName = "Host",
  onHostAway,
  solo = false,
}: {
  role: "host" | "guest";
  room: string;
  myName: string;
  hostName?: string;
  onHostAway?: () => void;
  /** Just the owner against HIVEMIND, on this device. */
  solo?: boolean;
}) {
  const me = role; // seat id
  const sRef = useRef<DotsState | null>(null);
  const publishRef = useRef<(s: DotsState) => void>(() => {});
  const apply = useCallback((fn: (s: DotsState) => DotsState) => {
    const cur = sRef.current;
    if (!cur) return;
    const next = fn(cur);
    if (next !== cur) {
      sRef.current = next;
      publishRef.current(next);
    }
  }, []);
  const { stage, err, other, state: s, publish, act, forget, voiceOn, muted, toggleMute, noMic, knocked, audioRef, connected } = usePeerGame<DotsState, Action>({
    role,
    kind: "dots",
    room,
    myName,
    hostName,
    onHostAway,
    accept: okState,
    // The friend's taps, as the friend's seat only.
    onAction: (a) => apply((cur) => (a?.type === "line" ? drawLine(cur, "guest", Number(a.line)) : cur)),
    solo,
  });
  useEffect(() => {
    sRef.current = s;
    publishRef.current = publish;
  });

  // Host settings.
  const [bots, setBots] = useState(false);
  const [size, setSize] = useState<GridSize>(4);

  function start(opt?: { bots?: boolean; size?: GridSize }) {
    const withBots = opt?.bots ?? bots;
    const players = solo
      ? withBots
        ? [
            { id: "host", name: myName },
            { id: "bot1", name: "HIVEMIND", bot: true },
            { id: "bot2", name: "HIVEMIND 2", bot: true },
          ]
        : [
            { id: "host", name: myName },
            { id: "bot1", name: "HIVEMIND", bot: true },
          ]
      : withBots
        ? [
            { id: "host", name: myName },
            { id: "guest", name: other || "Friend" },
            { id: "bot1", name: "HIVEMIND", bot: true },
          ]
        : [
            { id: "host", name: myName },
            { id: "guest", name: other || "Friend" },
          ];
    const g = newDots(players, opt?.size ?? size);
    sRef.current = g;
    publish(g);
    sfx.boot();
  }

  // Host: HIVEMIND takes its turns (only while the friend is connected, so nobody misses anything).
  useEffect(() => {
    if (role !== "host" || !s || s.over || !connected) return;
    const seat = s.seats[s.turn];
    if (!seat?.bot) return;
    const t = setTimeout(() => apply((cur) => (cur.seq !== s.seq ? cur : drawLine(cur, seat.id, botLine(cur) ?? -1))), 650);
    return () => clearTimeout(t);
  }, [role, s, connected, apply]);

  // Sounds: a line, a box, the end.
  const lastSeq = s?.last?.seq;
  const lastClosed = s?.last?.closed ?? 0;
  const over = !!s?.over;
  useEffect(() => {
    if (lastSeq === undefined) return;
    if (lastClosed) sfx.send();
    else sfx.hover();
  }, [lastSeq, lastClosed]);
  useEffect(() => {
    if (over) sfx.done();
  }, [over]);

  // The owner's record: the host's device saves each finished game once.
  useEffect(() => {
    if (role !== "host" || !s?.over) return;
    const top = leaders(s);
    const sc = scores(s);
    const mine = sc[0];
    const theirs = Math.max(...sc.filter((_, i) => i !== 0));
    recordResult(`dots-${solo ? "solo" : room}-${s.id ?? gameKey(s.seq, ...s.boxes)}`, {
      game: "dots",
      mode: solo ? "bot" : "friend",
      outcome: top.length > 1 && top.includes(0) ? "draw" : top[0] === 0 ? "win" : "loss",
      vs: solo ? "HIVEMIND" : other || "Friend",
      detail: `${mine} – ${theirs}`,
    });
  }, [role, room, s, other, solo]);

  const myIndex = s ? s.seats.findIndex((x) => x.id === me) : -1;
  const myTurn = !!s && !s.over && s.turn === myIndex && connected;
  function doLine(i: number) {
    if (!myTurn || !s || s.lines[i] >= 0) return;
    if (role === "host") apply((cur) => drawLine(cur, "host", i));
    else act({ type: "line", line: i });
  }

  // Voice: dots are named like a chessboard (columns a, b, c… left to right; rows 1, 2, 3… top to
  // bottom, as labelled on the board), so "a1 to b1" draws that line.
  useVoiceActions({
    dots_start: {
      description: "Dots & Boxes page: start a game. input: in words, a board size (3, 4, 5 or 6) and 'bots' for extra HIVEMIND players.",
      run: ({ input }) => {
        if (role !== "host" || !connected) return { error: "Only the host can start, once everyone's here." };
        const t = String(input ?? "");
        const n = Number(t.match(/[3-6]/)?.[0]);
        start({ size: (n >= 3 && n <= 6 ? n : undefined) as GridSize | undefined, bots: /bot/i.test(t) || undefined });
        return { started: true };
      },
    },
    dots_line: {
      description: "Dots & Boxes page: draw a line between two neighbouring dots on the owner's turn. input: the two dots, e.g. 'a1 to b1' or 'c2 c3' (columns a.. left to right, rows 1.. top to bottom, as labelled).",
      run: ({ input }) => {
        if (!s) return { error: "No game yet." };
        if (!myTurn) return { error: s.over ? "The game is over." : `It's ${turnSeat?.name ?? "someone else"}'s turn.` };
        const dots = String(input ?? "").toLowerCase().match(/[a-h]\s?[1-8]/g)?.map((d) => ({ c: d.charCodeAt(0) - 97, r: Number(d.replace(/\D/g, "")) - 1 }));
        if (!dots || dots.length < 2) return { error: "Say two dots, like 'a1 to b1'." };
        const [p, q] = dots;
        const H = (s.rows + 1) * s.cols;
        const i =
          p.r === q.r && Math.abs(p.c - q.c) === 1 && p.r <= s.rows && Math.max(p.c, q.c) <= s.cols
            ? p.r * s.cols + Math.min(p.c, q.c)
            : p.c === q.c && Math.abs(p.r - q.r) === 1 && p.c <= s.cols && Math.max(p.r, q.r) <= s.rows
              ? H + Math.min(p.r, q.r) * (s.cols + 1) + p.c
              : -1;
        if (i < 0) return { error: "Those dots aren't next to each other." };
        if (s.lines[i] >= 0) return { error: "That line is already drawn." };
        doLine(i);
        return { drawn: true };
      },
    },
    dots_suggest: {
      description: "Dots & Boxes page: a good next line for the owner (takes a box if one is open, else one that gives nothing away), in dot names.",
      run: () => {
        if (!s || !myTurn) return { error: "Not your turn." };
        const i = botLine(s);
        if (i === null) return { error: "No lines left." };
        const { dir, r, c } = lineAt(s, i);
        const name = (cc: number, rr: number) => `${String.fromCharCode(97 + cc)}${rr + 1}`;
        return { suggest: dir === "h" ? `${name(c, r)} to ${name(c + 1, r)}` : `${name(c, r)} to ${name(c, r + 1)}` };
      },
    },
    dots_status: {
      description: "Dots & Boxes page: the score and whose turn it is.",
      run: () => (s ? { scores: s.seats.map((x, k) => `${x.name}: ${scores(s)[k]}`), turn: s.over ? "game over" : s.seats[s.turn]?.name, boxes_left: s.boxes.filter((b) => b < 0).length } : { error: "No game yet." }),
    },
  });

  const turnSeat = s && !s.over ? s.seats[s.turn] : null;
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
          ? `Connection lost. Reconnecting to ${other || "your friend"}… the game is paused.`
          : stage === "error"
            ? err
            : !s
              ? solo
                ? "You against HIVEMIND. Pick a board and start."
                : role === "host"
                  ? `${other} is here! Pick a board and start.`
                  : `Connected! ${hostName} is setting up the game.`
              : s.over
                ? ""
                : myTurn
                  ? s.last?.closed && s.last.seat === myIndex
                    ? "Box! Your turn again."
                    : "Your turn: tap between two dots."
                  : `${turnSeat?.name}'s turn…`;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-3" onPointerDown={() => audioRef.current?.srcObject && audioRef.current.paused && void audioRef.current.play().catch(() => {})}>
      <audio ref={audioRef} autoPlay playsInline />
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {s?.seats.map((seat, i) => (
          <span key={seat.id} className={cx("flex items-center gap-1.5 rounded-full border px-3 py-1 transition-colors", s.turn === i && !s.over ? "border-core bg-core/10" : "border-line")}>
            <span className="size-3 rounded-full" style={{ background: COLORS[i] }} />
            {seat.bot && <Bot size={12} className="text-data" />}
            <span className="max-w-28 truncate">{seat.id === me ? `${seat.name} (you)` : seat.name}</span>
            <b className="font-mono text-xs tabular-nums">{scores(s)[i]}</b>
          </span>
        ))}
        {!s && <span className="text-lg font-black tracking-tight">DOTS &amp; BOXES</span>}
        <span className={cx("ml-auto", solo && "hidden")}>
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

      {status && <p className={cx("text-sm", stage === "error" ? "text-alert" : stage === "reconnecting" ? "animate-pulse text-core" : myTurn ? "font-medium text-core" : "text-soft")}>{status}</p>}

      {s?.over && <Result s={s} me={myIndex} />}

      {role === "host" && connected && (!s || s.over) && (
        <div className="flex flex-col gap-2 rounded-xl border border-line bg-panel p-3 text-sm">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-soft">Players:</span>
            <Choice on={!bots} onClick={() => setBots(false)}>
              {solo ? "Me vs HIVEMIND" : "Just us two"}
            </Choice>
            <Choice on={bots} onClick={() => setBots(true)}>
              {solo ? "Me vs 2 HIVEMIND bots" : "+ HIVEMIND"}
            </Choice>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-soft">Board:</span>
            {SIZES.map((z) => (
              <Choice key={z.n} on={size === z.n} onClick={() => setSize(z.n)}>
                {z.label}
              </Choice>
            ))}
          </div>
          <button type="button" onClick={() => start()} className="inline-flex items-center gap-1.5 self-start rounded-full bg-core px-5 py-2 text-sm font-semibold text-core-ink">
            {s?.over ? <RotateCcw size={14} /> : null} {s?.over ? (solo ? "Play again" : `Play again with ${other}`) : "Start"}
          </button>
        </div>
      )}

      {s && (
        <div className={cx("grid gap-3 md:grid-cols-[minmax(0,1fr)_240px]", stage === "reconnecting" && "pointer-events-none opacity-60")}>
          <Board s={s} canPlay={myTurn} onLine={doLine} />
          <div className="flex flex-col gap-3">
            <div className="max-h-48 space-y-1 overflow-y-auto rounded-xl border border-line bg-panel p-3 text-sm">
              {[...s.log].reverse().map((l, i) => (
                <p key={i} className={cx(i === 0 ? "text-fg" : "text-soft", /wins|tie/i.test(l) && "font-medium")}>
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

/** The board: boxes, lines, dots; each free line's tap area is the diamond between its two dots. */
function Board({ s, canPlay, onLine }: { s: DotsState; canPlay: boolean; onLine: (i: number) => void }) {
  const [hover, setHover] = useState<number | null>(null);
  const M = 0.5;
  const ends = (i: number) => {
    const { dir, r, c } = lineAt(s, i);
    return dir === "h" ? [M + c, M + r, M + c + 1, M + r] : [M + c, M + r, M + c, M + r + 1];
  };
  const diamond = (i: number) => {
    const [x1, y1, x2, y2] = ends(i);
    const mx = (x1 + x2) / 2;
    const my = (y1 + y2) / 2;
    return x1 === x2 ? `${x1},${y1} ${mx + 0.5},${my} ${x2},${y2} ${mx - 0.5},${my}` : `${x1},${y1} ${mx},${my - 0.5} ${x2},${y2} ${mx},${my + 0.5}`;
  };
  const turnColor = COLORS[s.turn] ?? COLORS[0];
  return (
    <svg viewBox={`0 0 ${s.cols + 2 * M} ${s.rows + 2 * M}`} className="mx-auto w-full max-w-[560px] touch-manipulation select-none rounded-2xl border border-line bg-panel" role="group" aria-label="Dots and Boxes board">
      {/* Claimed boxes. */}
      {s.boxes.map((owner, b) =>
        owner >= 0 ? (
          <g key={`b${b}`}>
            <rect x={M + (b % s.cols) + 0.06} y={M + Math.floor(b / s.cols) + 0.06} width={0.88} height={0.88} rx={0.08} fill={COLORS[owner]} opacity={0.28} className="dots-pop" />
            <text x={M + (b % s.cols) + 0.5} y={M + Math.floor(b / s.cols) + 0.5} textAnchor="middle" dominantBaseline="central" fontSize={0.42} fontWeight={800} fill={COLORS[owner]}>
              {(s.seats[owner]?.name ?? "?")[0].toUpperCase()}
            </text>
          </g>
        ) : null,
      )}
      {/* Free lines: faint guides, the hovered one previewed in the player's colour. */}
      {s.lines.map((v, i) => {
        if (v >= 0) return null;
        const [x1, y1, x2, y2] = ends(i);
        return <line key={`g${i}`} x1={x1} y1={y1} x2={x2} y2={y2} stroke={hover === i && canPlay ? turnColor : "currentColor"} strokeOpacity={hover === i && canPlay ? 0.6 : 0.08} strokeWidth={0.08} strokeLinecap="round" className="text-fg" />;
      })}
      {/* Drawn lines; the newest one draws itself in. */}
      {s.lines.map((v, i) => {
        if (v < 0) return null;
        const [x1, y1, x2, y2] = ends(i);
        const newest = s.last?.line === i;
        return <line key={`l${i}${newest ? `-${s.last?.seq}` : ""}`} x1={x1} y1={y1} x2={x2} y2={y2} stroke={COLORS[v]} strokeWidth={newest ? 0.13 : 0.1} strokeLinecap="round" pathLength={1} className={newest ? "dots-draw" : undefined} />;
      })}
      {/* Dots. */}
      {Array.from({ length: (s.rows + 1) * (s.cols + 1) }, (_, k) => (
        <circle key={`d${k}`} cx={M + (k % (s.cols + 1))} cy={M + Math.floor(k / (s.cols + 1))} r={0.085} className="fill-fg" />
      ))}
      {/* Dot names for voice ("a1 to b1"): letters along the top, numbers down the left. */}
      {Array.from({ length: s.cols + 1 }, (_, c) => (
        <text key={`cl${c}`} x={M + c} y={M - 0.3} textAnchor="middle" dominantBaseline="central" fontSize={0.17} className="fill-faint font-mono">
          {String.fromCharCode(97 + c)}
        </text>
      ))}
      {Array.from({ length: s.rows + 1 }, (_, r) => (
        <text key={`rl${r}`} x={M - 0.3} y={M + r} textAnchor="middle" dominantBaseline="central" fontSize={0.17} className="fill-faint font-mono">
          {r + 1}
        </text>
      ))}
      {/* Tap areas on top. */}
      {canPlay &&
        s.lines.map((v, i) =>
          v < 0 ? (
            <polygon key={`t${i}`} points={diamond(i)} fill="transparent" className="cursor-pointer" onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover((h) => (h === i ? null : h))} onClick={() => onLine(i)}>
              <title>Draw this line</title>
            </polygon>
          ) : null,
        )}
    </svg>
  );
}

function Result({ s, me }: { s: DotsState; me: number }) {
  const top = leaders(s);
  const sc = scores(s);
  const tie = top.length > 1;
  return (
    <div className="rounded-xl bg-raised p-3 text-center">
      <Crown size={22} className="mx-auto text-core" />
      <div className="mt-1 font-semibold">{tie ? "It's a tie! 🤝" : top[0] === me ? "You win! 🎉" : `${s.seats[top[0]].name} wins!`}</div>
      <div className="text-xs text-soft">{s.seats.map((x, i) => `${x.name} ${sc[i]}`).join(" · ")}</div>
    </div>
  );
}
