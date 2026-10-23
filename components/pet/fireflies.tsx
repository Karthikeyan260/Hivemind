"use client";

import { Loader2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { catchFly, flyLine, GAME_MS, LIFE_MS, newFlyGame, tickFlies, type FlyGame } from "@/lib/pet-fireflies";
import { sfx } from "@/lib/sfx";

/**
 * Catch fireflies: Nova's 30-second tapping game. A dark, starry screen; fireflies drift and fade, tap
 * to catch them (gold ones count three). The engine is lib/pet-fireflies; this only draws it.
 */
type Pop = { id: number; x: number; y: number; points: number };

export function FireflyGame({ name, best, onFinish, onClose }: { name: string; best: number; onFinish: (score: number) => Promise<{ best: number; newBest: boolean } | null>; onClose: () => void }) {
  const [phase, setPhase] = useState<"ready" | "play" | "over">("ready");
  const [g, setG] = useState<FlyGame>(newFlyGame);
  const [pops, setPops] = useState<Pop[]>([]);
  const [result, setResult] = useState<{ best: number; newBest: boolean } | null>(null);
  const [saving, setSaving] = useState(false);
  const game = useRef(g);
  const popId = useRef(0);

  const start = useCallback(() => {
    const fresh = newFlyGame();
    game.current = fresh;
    setG(fresh);
    setPops([]);
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

  function tap(id: number, x: number, y: number) {
    const { game: next, points } = catchFly(game.current, id);
    if (!points) return;
    game.current = next;
    setG(next);
    if (points > 1) sfx.send();
    else sfx.hover();
    const pop = { id: ++popId.current, x, y, points };
    setPops((p) => [...p.slice(-6), pop]);
    setTimeout(() => setPops((p) => p.filter((q) => q.id !== pop.id)), 650);
  }

  const left = Math.max(0, Math.ceil((GAME_MS - g.t) / 1000));
  const shownBest = Math.max(best, result?.best ?? 0, phase === "over" ? g.score : 0);

  return (
    <div className="fixed inset-0 z-[80] select-none overflow-hidden bg-[radial-gradient(ellipse_at_50%_20%,#13213f_0%,#070b18_70%)] text-white" role="dialog" aria-label="Catch fireflies">
      {/* Stars. */}
      {Array.from({ length: 28 }, (_, i) => (
        <span key={i} aria-hidden className="absolute size-[2px] rounded-full bg-white/50" style={{ left: `${(i * 37) % 100}%`, top: `${(i * 53) % 70}%`, opacity: 0.3 + ((i * 7) % 5) / 10 }} />
      ))}
      <div className="absolute inset-x-0 top-0 flex items-center gap-3 px-4 pt-[max(1rem,env(safe-area-inset-top))]">
        <div className="font-mono text-[11px] tracking-[0.2em] text-white/70">✨ FIREFLIES</div>
        <div className="ml-auto text-right">
          <div className="text-2xl font-black tabular-nums leading-none">{g.score}</div>
          <div className="font-mono text-[10px] text-white/60">best {shownBest}</div>
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className="grid size-9 place-items-center rounded-full bg-white/10 hover:bg-white/20">
          <X size={16} />
        </button>
      </div>
      {phase === "play" && (
        <div className="absolute inset-x-4 top-[calc(max(1rem,env(safe-area-inset-top))+3.2rem)] h-1.5 overflow-hidden rounded-full bg-white/10" aria-label={`${left} seconds left`}>
          <div className="h-full rounded-full bg-amber-300" style={{ width: `${(1 - g.t / GAME_MS) * 100}%` }} />
        </div>
      )}

      {g.flies.map((f) => {
        const fade = Math.min(1, f.age / 300, (LIFE_MS - f.age) / 800);
        const size = f.gold ? 64 : 56;
        return (
          <button
            key={f.id}
            type="button"
            aria-label={f.gold ? "A golden firefly" : "A firefly"}
            onPointerDown={(e) => {
              e.preventDefault();
              tap(f.id, f.x, f.y);
            }}
            className="absolute grid touch-manipulation place-items-center rounded-full"
            style={{ left: `${f.x * 100}%`, top: `${f.y * 100}%`, width: size, height: size, marginLeft: -size / 2, marginTop: -size / 2, opacity: Math.max(0, fade) }}
          >
            <span
              className="rounded-full"
              style={{
                width: f.gold ? 16 : 12,
                height: f.gold ? 16 : 12,
                background: f.gold ? "#ffd43b" : "#d9ff8a",
                boxShadow: f.gold ? "0 0 22px 10px rgba(255,212,59,.75), 0 0 48px 20px rgba(255,170,0,.35)" : "0 0 18px 8px rgba(190,255,90,.7), 0 0 40px 16px rgba(120,220,60,.3)",
              }}
            />
          </button>
        );
      })}
      {pops.map((p) => (
        <span key={p.id} className="pointer-events-none absolute font-black text-amber-200 [animation:fly-pop_0.65s_ease-out_forwards]" style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }}>
          +{p.points}
        </span>
      ))}

      {phase !== "play" && (
        <div className="absolute inset-0 grid place-items-center bg-black/35 px-6">
          <div className="w-full max-w-sm rounded-3xl border border-white/15 bg-[#0c1426]/90 p-6 text-center shadow-2xl backdrop-blur-md">
            {phase === "ready" ? (
              <>
                <div className="text-4xl">🐛✨</div>
                <h2 className="mt-2 text-xl font-semibold">Catch fireflies</h2>
                <p className="mt-2 text-sm text-white/75">{name} lost its sparks. Tap the fireflies before they fade: 30 seconds. Golden ones count three!</p>
                {best > 0 && <p className="mt-2 font-mono text-xs text-amber-200">Your best: {best}</p>}
                <button type="button" onClick={start} className="mt-4 rounded-full bg-amber-300 px-6 py-2.5 text-sm font-bold text-black hover:bg-amber-200">
                  Start
                </button>
              </>
            ) : (
              <>
                <div className="text-4xl">{result?.newBest ? "🏆" : "🌟"}</div>
                <h2 className="mt-2 text-3xl font-black tabular-nums">{g.score}</h2>
                <p className="text-sm text-white/70">{g.caught} caught</p>
                <p className="mt-2 text-sm">{saving ? <Loader2 size={14} className="mx-auto animate-spin" /> : flyLine(g.score, result?.best ?? shownBest, !!result?.newBest)}</p>
                <p className="mt-1 font-mono text-xs text-amber-200">best {shownBest}</p>
                <div className="mt-4 flex justify-center gap-2">
                  <button type="button" onClick={start} className="rounded-full bg-amber-300 px-5 py-2 text-sm font-bold text-black hover:bg-amber-200">
                    Again
                  </button>
                  <button type="button" onClick={onClose} className="rounded-full border border-white/25 px-5 py-2 text-sm hover:bg-white/10">
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
