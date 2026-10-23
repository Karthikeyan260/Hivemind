"use client";

import { Loader2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AccessoryId } from "@/lib/pet-looks";
import { catchFly, flyLine, GAME_MS, LIFE_MS, newFlyGame, tickFlies, type Fly, type FlyGame } from "@/lib/pet-fireflies";
import { sfx } from "@/lib/sfx";
import { Creature } from "./creature";

/**
 * Catch fireflies: Nova's 30-second tapping game. A night meadow with a moon, hills, pines and swaying
 * grass; winged fireflies drift and fade, tap to catch them (gold ones count three) and they burst
 * into sparks into Nova's jar. Nova itself cheers at the bottom, in whatever it is wearing. The
 * engine is lib/pet-fireflies; this only draws it.
 */
type Burst = { id: number; x: number; y: number; points: number; gold: boolean };

const STARS = Array.from({ length: 46 }, (_, i) => ({ x: (i * 41 + 7) % 100, y: (i * 29 + 3) % 62, s: 1 + (i % 3) * 0.6, d: (i * 0.37) % 4 }));
const BLADES = Array.from({ length: 34 }, (_, i) => ({ x: (i * 3.05 + (i % 3)) % 100, h: 26 + ((i * 17) % 22), d: (i * 0.23) % 3 }));

/** How many stars out of three a score earns. */
const starsFor = (score: number) => (score >= 30 ? 3 : score >= 15 ? 2 : score >= 5 ? 1 : 0);

export function FireflyGame({ name, stage, wear, best, onFinish, onClose }: { name: string; stage: number; wear: AccessoryId | null; best: number; onFinish: (score: number) => Promise<{ best: number; newBest: boolean } | null>; onClose: () => void }) {
  const [phase, setPhase] = useState<"ready" | "play" | "over">("ready");
  const [g, setG] = useState<FlyGame>(newFlyGame);
  const [bursts, setBursts] = useState<Burst[]>([]);
  const [cheer, setCheer] = useState(0);
  const [result, setResult] = useState<{ best: number; newBest: boolean } | null>(null);
  const [saving, setSaving] = useState(false);
  const game = useRef(g);
  const burstId = useRef(0);

  const start = useCallback(() => {
    const fresh = newFlyGame();
    game.current = fresh;
    setG(fresh);
    setBursts([]);
    setResult(null);
    setPhase("play");
  }, []);

  // The clock: a frame at a time, moving the game on by the real time that passed.
  useEffect(() => {
    if (phase !== "play") return;
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(80, now - last);
      last = now;
      game.current = tickFlies(game.current, dt);
      setG(game.current);
      if (game.current.over) {
        setPhase("over");
        return;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [phase]);

  // Nova's cheer lasts a moment after each catch.
  useEffect(() => {
    if (!cheer) return;
    const t = setTimeout(() => setCheer(0), 520);
    return () => clearTimeout(t);
  }, [cheer]);

  // The end: keep the score (and the best).
  useEffect(() => {
    if (phase !== "over") return;
    sfx.done();
    let alive = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the round just ended: saving its score
    setSaving(true);
    void onFinish(game.current.score)
      .then((r) => alive && setResult(r))
      .finally(() => alive && setSaving(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per finished round
  }, [phase]);

  function tap(f: Fly) {
    const { game: next, points } = catchFly(game.current, f.id);
    if (!points) return;
    game.current = next;
    setG(next);
    if (points > 1) sfx.send();
    else sfx.hover();
    const b = { id: ++burstId.current, x: f.x, y: f.y, points, gold: f.gold };
    setBursts((p) => [...p.slice(-8), b]);
    setCheer((n) => n + 1);
    setTimeout(() => setBursts((p) => p.filter((q) => q.id !== b.id)), 800);
  }

  const left = Math.max(0, Math.ceil((GAME_MS - g.t) / 1000));
  const shownBest = Math.max(best, result?.best ?? 0, phase === "over" ? g.score : 0);
  // The jar fills up with the score (full at 30).
  const jar = Math.min(1, g.score / 30);
  const stars = starsFor(g.score);

  return (
    <div className="fixed inset-0 z-[80] select-none overflow-hidden text-white" role="dialog" aria-label="Catch fireflies" style={{ background: "linear-gradient(180deg,#050816 0%,#0b1633 42%,#123252 74%,#1b4a52 100%)" }}>
      {/* Stars and the moon. */}
      {STARS.map((s, i) => (
        <span key={i} aria-hidden className="ff-twinkle absolute rounded-full bg-white" style={{ left: `${s.x}%`, top: `${s.y}%`, width: s.s, height: s.s, animationDelay: `${s.d}s` }} />
      ))}
      <div aria-hidden className="absolute right-[12%] top-[9%] size-16 rounded-full" style={{ background: "radial-gradient(circle at 36% 34%,#fffbea 0%,#f3e6b8 55%,#d9c88a 100%)", boxShadow: "0 0 40px 14px rgba(255,244,200,.28), 0 0 120px 50px rgba(255,244,200,.12)" }} />

      {/* Far hills, pines, and the meadow: drawn back to front. */}
      <svg aria-hidden viewBox="0 0 400 220" preserveAspectRatio="none" className="pointer-events-none absolute inset-x-0 bottom-0 h-[34%] w-full">
        <path d="M0 120 Q60 70 130 100 T260 90 T400 110 L400 220 L0 220 Z" fill="#0d2238" />
        <g fill="#0a1b2c">
          {[24, 58, 92, 140, 196, 244, 300, 348, 382].map((x, i) => (
            <g key={x} transform={`translate(${x} ${96 + ((i * 11) % 18)}) scale(${0.8 + ((i * 7) % 5) / 10})`}>
              <path d="M0 -34 L11 -8 L5 -8 L14 14 L-14 14 L-5 -8 L-11 -8 Z" />
            </g>
          ))}
        </g>
        <path d="M0 150 Q80 120 170 142 T330 136 T400 148 L400 220 L0 220 Z" fill="#0a1a26" />
        <path d="M0 184 Q100 160 210 180 T400 176 L400 220 L0 220 Z" fill="#071019" />
      </svg>
      {/* A thin mist over the meadow. */}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-[16%] h-24 opacity-60" style={{ background: "linear-gradient(180deg,transparent,rgba(120,200,210,.12),transparent)" }} />

      {/* Fireflies. */}
      {g.flies.map((f) => {
        const fade = Math.max(0, Math.min(1, f.age / 260, (LIFE_MS - f.age) / 800));
        const size = f.gold ? 72 : 64;
        const heading = (Math.atan2(f.vy, f.vx) * 180) / Math.PI + 90;
        return (
          <button
            key={f.id}
            type="button"
            aria-label={f.gold ? "A golden firefly" : "A firefly"}
            onPointerDown={(e) => {
              e.preventDefault();
              tap(f);
            }}
            className="absolute grid touch-manipulation place-items-center rounded-full"
            style={{ left: `${f.x * 100}%`, top: `${f.y * 100}%`, width: size, height: size, marginLeft: -size / 2, marginTop: -size / 2, opacity: fade }}
          >
            <Bug gold={f.gold} heading={heading} />
          </button>
        );
      })}

      {/* Catch bursts: sparks and the points. */}
      {bursts.map((b) => (
        <div key={b.id} className="pointer-events-none absolute" style={{ left: `${b.x * 100}%`, top: `${b.y * 100}%` }}>
          {Array.from({ length: b.gold ? 12 : 8 }, (_, k) => {
            const a = (k / (b.gold ? 12 : 8)) * Math.PI * 2;
            const r = 34 + (k % 3) * 12;
            return <span key={k} className="ff-spark absolute size-1.5 rounded-full" style={{ background: b.gold ? "#ffd43b" : "#d9ff8a", boxShadow: `0 0 8px 2px ${b.gold ? "rgba(255,212,59,.8)" : "rgba(190,255,90,.8)"}`, ["--dx" as string]: `${Math.cos(a) * r}px`, ["--dy" as string]: `${Math.sin(a) * r}px` }} />;
          })}
          <span className="ff-pop absolute -translate-x-1/2 text-lg font-black text-amber-100 drop-shadow-[0_0_8px_rgba(255,212,59,.9)]">+{b.points}</span>
        </div>
      ))}

      {/* The meadow's grass, swaying, in front. */}
      <svg aria-hidden viewBox="0 0 100 40" preserveAspectRatio="none" className="pointer-events-none absolute inset-x-0 bottom-0 h-[11%] w-full">
        {BLADES.map((b, i) => (
          <path key={i} className="ff-grass" d={`M${b.x} 40 Q${b.x - 0.6} ${40 - b.h * 0.6} ${b.x + 0.7} ${40 - b.h} Q${b.x + 0.9} ${40 - b.h * 0.5} ${b.x + 1.2} 40 Z`} fill={i % 3 ? "#0b2a22" : "#103a2d"} style={{ animationDelay: `${b.d}s`, transformOrigin: `${b.x}px 40px` }} />
        ))}
      </svg>

      {/* Nova cheering, with the jar of fireflies beside it. */}
      <div className="pointer-events-none absolute bottom-[calc(10%+env(safe-area-inset-bottom))] left-1/2 flex -translate-x-1/2 items-end gap-3">
        <div className="relative size-28">
          <Creature stage={stage} mood="happy" look={{ x: 0, y: 0 }} eating={cheer > 0} evolving={false} poked={false} wear={wear} />
        </div>
        <div aria-label={`${g.score} in the jar`} className="relative mb-2 h-16 w-11 overflow-hidden rounded-b-2xl rounded-t-md border border-white/30 bg-white/5 backdrop-blur-[1px]">
          <div className="absolute inset-x-0 bottom-0 transition-[height] duration-300" style={{ height: `${jar * 100}%`, background: "linear-gradient(180deg,rgba(217,255,138,.55),rgba(255,212,59,.75))", boxShadow: "0 0 18px 4px rgba(217,255,138,.5) inset" }} />
          <div className="absolute inset-x-0 -top-px h-1.5 bg-white/25" />
        </div>
      </div>

      {/* The top bar: the score, the best, the time, and a way out. */}
      <div className="absolute inset-x-0 top-0 px-4 pt-[max(0.9rem,env(safe-area-inset-top))]">
        <div className="flex items-center gap-3">
          <div className="rounded-2xl border border-white/15 bg-black/30 px-4 py-1.5 backdrop-blur-md">
            <div className="text-3xl font-black leading-none tabular-nums drop-shadow-[0_0_10px_rgba(217,255,138,.5)]">{g.score}</div>
            <div className="mt-0.5 font-mono text-[10px] tracking-wider text-white/60">BEST {shownBest}</div>
          </div>
          {phase === "play" && <div className="ml-auto rounded-full border border-white/15 bg-black/30 px-3 py-1 font-mono text-sm tabular-nums backdrop-blur-md">{left}s</div>}
          <button type="button" onClick={onClose} aria-label="Close" className={`grid size-10 place-items-center rounded-full border border-white/15 bg-black/30 backdrop-blur-md hover:bg-white/15 ${phase === "play" ? "" : "ml-auto"}`}>
            <X size={17} />
          </button>
        </div>
        {phase === "play" && (
          <div className="mt-2.5 h-2 overflow-hidden rounded-full bg-white/10" aria-label={`${left} seconds left`}>
            <div className="h-full rounded-full" style={{ width: `${(1 - g.t / GAME_MS) * 100}%`, background: left <= 5 ? "linear-gradient(90deg,#ff8a5c,#ffb347)" : "linear-gradient(90deg,#9be15d,#ffd43b)" }} />
          </div>
        )}
      </div>

      {phase !== "play" && (
        <div className="absolute inset-0 grid place-items-center bg-black/30 px-6">
          <div className="w-full max-w-sm rounded-3xl border border-white/15 bg-[#0a1428]/85 p-6 text-center shadow-[0_20px_60px_-10px_rgba(0,0,0,.7)] backdrop-blur-lg">
            {phase === "ready" ? (
              <>
                <div className="mx-auto flex w-fit items-end gap-1">
                  <Bug gold={false} heading={0} small />
                  <Bug gold heading={20} small />
                  <Bug gold={false} heading={-15} small />
                </div>
                <h2 className="mt-3 text-2xl font-semibold tracking-tight">Catch fireflies</h2>
                <p className="mt-2 text-sm leading-relaxed text-white/75">{name} lost its sparks in the meadow. Tap the fireflies before they fade: you have 30 seconds. Golden ones count three.</p>
                {best > 0 && <p className="mt-3 font-mono text-xs text-amber-200">Your best: {best}</p>}
                <button type="button" onClick={start} className="mt-5 rounded-full bg-gradient-to-b from-amber-200 to-amber-400 px-8 py-3 text-sm font-bold text-[#2a1c00] shadow-[0_6px_24px_-4px_rgba(255,200,60,.6)] hover:brightness-105">
                  Start
                </button>
              </>
            ) : (
              <>
                <div className="flex justify-center gap-1.5 text-4xl" aria-label={`${stars} of 3 stars`}>
                  {[0, 1, 2].map((k) => (
                    <span key={k} className={k < stars ? "drop-shadow-[0_0_12px_rgba(255,212,59,.9)]" : "opacity-25 grayscale"}>
                      ⭐
                    </span>
                  ))}
                </div>
                <h2 className="mt-2 text-5xl font-black tabular-nums">{g.score}</h2>
                <p className="text-sm text-white/65">{g.caught} caught</p>
                {result?.newBest && <p className="mt-1 inline-block rounded-full bg-amber-300/15 px-3 py-0.5 font-mono text-[11px] uppercase tracking-widest text-amber-200">New best</p>}
                <p className="mt-2 min-h-5 text-sm">{saving ? <Loader2 size={14} className="mx-auto animate-spin" /> : flyLine(g.score, result?.best ?? shownBest, !!result?.newBest)}</p>
                <p className="mt-1 font-mono text-xs text-white/50">best {shownBest}</p>
                <div className="mt-5 flex justify-center gap-2">
                  <button type="button" onClick={start} className="rounded-full bg-gradient-to-b from-amber-200 to-amber-400 px-6 py-2.5 text-sm font-bold text-[#2a1c00] shadow-[0_6px_24px_-4px_rgba(255,200,60,.6)] hover:brightness-105">
                    Again
                  </button>
                  <button type="button" onClick={onClose} className="rounded-full border border-white/25 px-6 py-2.5 text-sm hover:bg-white/10">
                    Done
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** A firefly: two flapping wings, a dark body and a glowing tail, turned the way it flies. */
function Bug({ gold, heading, small = false }: { gold: boolean; heading: number; small?: boolean }) {
  const glow = gold ? "#ffd43b" : "#caff6b";
  const px = small ? 38 : gold ? 52 : 44;
  return (
    <svg viewBox="0 0 40 40" width={px} height={px} className="overflow-visible" style={{ transform: `rotate(${heading}deg)`, filter: `drop-shadow(0 0 ${gold ? 12 : 9}px ${glow}) drop-shadow(0 0 ${gold ? 26 : 18}px ${gold ? "rgba(255,170,0,.55)" : "rgba(120,220,60,.45)"})` }} aria-hidden>
      <g className="ff-wing-l" style={{ transformOrigin: "20px 17px" }}>
        <ellipse cx="11" cy="14" rx="7.5" ry="4" transform="rotate(-28 11 14)" fill="white" opacity="0.5" />
      </g>
      <g className="ff-wing-r" style={{ transformOrigin: "20px 17px" }}>
        <ellipse cx="29" cy="14" rx="7.5" ry="4" transform="rotate(28 29 14)" fill="white" opacity="0.5" />
      </g>
      <ellipse cx="20" cy="17" rx="3" ry="6" fill="#2b3a22" />
      <circle cx="20" cy="10.2" r="2.7" fill="#1f2a18" />
      <path d="M19 8.2 Q16 4.5 13.5 5 M21 8.2 Q24 4.5 26.5 5" stroke="#1f2a18" strokeWidth="0.9" fill="none" strokeLinecap="round" />
      <ellipse className="ff-glow" cx="20" cy="26.5" rx="4.4" ry="5.6" fill={glow} />
      <ellipse cx="19" cy="25" rx="1.6" ry="2.4" fill="white" opacity="0.7" />
    </svg>
  );
}
