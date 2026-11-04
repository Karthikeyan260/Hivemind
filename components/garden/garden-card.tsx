"use client";

import { useEffect, useState } from "react";

/** A number that counts up to its value when it appears (and again when it changes). */
function useCountUp(target: number, ms = 1200) {
  const [v, setV] = useState(0);
  useEffect(() => {
    let raf = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      const k = Math.min(1, (now - t0) / ms);
      setV(Math.round(target * (1 - Math.pow(1 - k, 3))));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return v;
}

function Count({ value }: { value: number | string }) {
  const n = useCountUp(typeof value === "number" ? value : 0);
  return <>{typeof value === "number" ? n : value}</>;
}

/**
 * "Grown so far": everything that has grown on the island, counted up as the card appears, with the last two weeks as
 * bars that rise one after another. The card leans towards your pointer, like a thing held in the hand.
 */
export function GardenCard({ total, streak, days, stats }: { total: number; streak: number; days: number[]; stats: Array<[string, number | string, string, string]> }) {
  const [tilt, setTilt] = useState({ x: 0, y: 0 });
  const peak = Math.max(1, ...days);
  return (
    <div style={{ perspective: 800 }} className="garden-rise">
      <div
        onPointerMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setTilt({ x: -((e.clientY - r.top) / r.height - 0.5) * 12, y: ((e.clientX - r.left) / r.width - 0.5) * 14 });
        }}
        onPointerLeave={() => setTilt({ x: 0, y: 0 })}
        className="w-[13.5rem] rounded-3xl border border-white/15 bg-[#0b1220]/60 p-4 text-white shadow-[0_28px_70px_-26px_rgba(0,0,0,.8),inset_0_1px_0_rgba(255,255,255,.16)] backdrop-blur-2xl"
        style={{ transform: `rotateX(${tilt.x}deg) rotateY(${tilt.y}deg)`, transition: "transform .18s ease-out", transformStyle: "preserve-3d" }}
      >
        <p className="font-mono text-[9px] tracking-[0.3em] text-white/60 uppercase">Grown so far</p>
        <p className="mt-1 font-serif text-[3.1rem] leading-none tabular-nums" style={{ transform: "translateZ(24px)" }}>
          <Count value={total} />
        </p>
        <p className="mt-1 text-[11px] text-white/65">{streak > 0 ? `${streak}-day streak · ` : ""}things on the island</p>
        <div className="mt-3 flex h-12 items-end gap-[3px]" role="img" aria-label="What grew each day in the last two weeks">
          {days.map((n, i) => (
            <span key={i} className="garden-bar flex-1 rounded-t-[3px] bg-gradient-to-t from-amber-300/70 to-amber-100/90" style={{ height: `${Math.max(7, (n / peak) * 100)}%`, animationDelay: `${0.5 + i * 0.045}s`, opacity: n ? 1 : 0.3 }} />
          ))}
        </div>
        <p className="mt-1 text-[9px] tracking-[0.2em] text-white/45 uppercase">last two weeks</p>
        <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2.5 border-t border-white/10 pt-3">
          {stats.map(([e, num, what, why]) => (
            <div key={what} title={why} className="flex items-center gap-2">
              <span className="text-base leading-none">{e}</span>
              <div className="min-w-0">
                <dd className="font-serif text-lg leading-none tabular-nums">
                  <Count value={num} />
                </dd>
                <dt className="truncate text-[9px] tracking-[0.12em] text-white/55 uppercase">{what}</dt>
              </div>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
