"use client";

import type { Sky } from "@/lib/sky";
import type { Phase } from "./phase";

/**
 * The garden's light, as a dial: a sun (or moon) rides an arc from dawn to night. Drag it, or tap a stop, and the
 * whole garden changes light with it (the sky, the shadows, the lamps). Weather sits underneath. "Live" goes back to
 * the real hour and the real sky.
 */
const PHASES: Phase[] = ["dawn", "day", "golden", "dusk", "night"];
const META: Record<Phase, { icon: string; name: string; glow: string; line: string }> = {
  dawn: { icon: "🌅", name: "Dawn", glow: "255,170,140", line: "Soft pink light, dew on the grass" },
  day: { icon: "☀️", name: "Daytime", glow: "130,190,255", line: "Bright and clear" },
  golden: { icon: "🌇", name: "Golden hour", glow: "255,190,110", line: "Long, warm light" },
  dusk: { icon: "🌆", name: "Dusk", glow: "195,140,195", line: "The lamps start to glow" },
  night: { icon: "🌙", name: "Night", glow: "95,125,225", line: "Fireflies and lantern light" },
};
const W = 360;
const H = 168;
const CX = 180;
const CY = 154;
const R = 140;
/** Where each stop sits on the arc, in degrees (180 is the far left, 0 the far right). */
const ANGLE = [166, 130, 94, 58, 22];
const at = (deg: number) => [CX + R * Math.cos((deg * Math.PI) / 180), CY - R * Math.sin((deg * Math.PI) / 180)] as const;
const WEATHER: Array<{ sky: Sky; name: string; icon: string }> = [
  { sky: "calm", name: "Clear", icon: "☀️" },
  { sky: "rain", name: "Rain", icon: "🌧️" },
  { sky: "thunder", name: "Storm", icon: "⛈️" },
];

export function SkyDial({ phase, sky, live, onPhase, onSky, onLive, onClose }: { phase: Phase; sky: Sky; live: boolean; onPhase: (p: Phase) => void; onSky: (s: Sky) => void; onLive: () => void; onClose: () => void }) {
  const m = META[phase];
  const idx = PHASES.indexOf(phase);
  const [kx, ky] = at(ANGLE[idx]);
  const clear = sky !== "rain" && sky !== "thunder";

  /** Turn a pointer position on the arc into the nearest stop. */
  const pick = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const sx = ((e.clientX - r.left) / r.width) * W;
    const sy = ((e.clientY - r.top) / r.height) * H;
    const deg = Math.max(0, Math.min(180, (Math.atan2(CY - sy, sx - CX) * 180) / Math.PI));
    let best = 0;
    for (let i = 1; i < ANGLE.length; i++) if (Math.abs(ANGLE[i] - deg) < Math.abs(ANGLE[best] - deg)) best = i;
    if (PHASES[best] !== phase) onPhase(PHASES[best]);
  };

  return (
    <div
      className="garden-rise relative w-[min(25rem,calc(100vw-3rem))] overflow-hidden rounded-3xl border border-white/15 p-3 pt-4 text-white shadow-[0_28px_70px_-26px_rgba(0,0,0,.8),inset_0_1px_0_rgba(255,255,255,.16)] backdrop-blur-2xl"
      style={{ backgroundColor: "rgba(11,18,32,0.62)", backgroundImage: `radial-gradient(120% 95% at 50% 110%, rgba(${m.glow},0.4), transparent 66%)`, transition: "background .9s ease", animationDelay: "0.35s" }}
    >
      <button onClick={onClose} aria-label="Close" className="absolute top-2.5 right-2.5 z-10 grid size-7 place-items-center rounded-full text-xs text-white/70 transition hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-amber-200">
        ✕
      </button>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="block w-full touch-none select-none"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          pick(e);
        }}
        onPointerMove={(e) => e.buttons && pick(e)}
        role="group"
        aria-label="Time of day"
      >
        <defs>
          <linearGradient id="dial-track" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0%" stopColor="#ffb08a" />
            <stop offset="25%" stopColor="#7ec4ff" />
            <stop offset="50%" stopColor="#ffc27a" />
            <stop offset="75%" stopColor="#b48fb6" />
            <stop offset="100%" stopColor="#4a5fb0" />
          </linearGradient>
        </defs>
        <path d={`M ${CX - R} ${CY} A ${R} ${R} 0 0 1 ${CX + R} ${CY}`} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="10" strokeLinecap="round" />
        <path d={`M ${CX - R} ${CY} A ${R} ${R} 0 0 1 ${CX + R} ${CY}`} fill="none" stroke="url(#dial-track)" strokeWidth="6" strokeLinecap="round" opacity="0.9" />
        {PHASES.map((p, i) => {
          const [x, y] = at(ANGLE[i]);
          const on = i === idx;
          return (
            <g key={p} role="button" tabIndex={0} aria-label={META[p].name} aria-pressed={on} onClick={() => onPhase(p)} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onPhase(p)} className="cursor-pointer outline-none">
              <circle cx={x} cy={y} r={on ? 0 : 6} fill="rgba(10,14,28,0.7)" stroke="rgba(255,255,255,0.7)" strokeWidth="1.5" style={{ transition: "r .3s" }} />
              <circle cx={x} cy={y} r="16" fill="transparent" />
            </g>
          );
        })}
        {/* The sun or moon, riding the arc with a little overshoot. */}
        <g style={{ transform: `translate(${kx}px, ${ky}px)`, transition: "transform .85s cubic-bezier(.3,1.35,.4,1)" }} pointerEvents="none">
          <circle r="22" fill={`rgba(${m.glow},0.28)`} className="garden-pulse" />
          <circle r="15" fill="rgba(12,16,32,0.85)" stroke={`rgba(${m.glow},0.9)`} strokeWidth="2" />
          <text textAnchor="middle" dominantBaseline="central" fontSize="17">
            {m.icon}
          </text>
        </g>
      </svg>
      <div className="-mt-12 text-center">
        <p className="font-serif text-2xl leading-none">{m.name}</p>
        <p className="mt-1 text-[11px] text-white/65">{m.line}</p>
      </div>
      <div className="mt-3 flex items-center justify-center gap-1.5">
        {WEATHER.map((w) => {
          const on = w.sky === "calm" ? clear : sky === w.sky;
          return (
            <button key={w.sky} onClick={() => onSky(w.sky)} aria-pressed={on} className={`flex h-8 items-center gap-1.5 rounded-full px-3 text-xs transition focus-visible:outline-2 focus-visible:outline-amber-200 ${on ? "border border-amber-200 bg-amber-200/90 font-medium text-[#3b2f1e]" : "border border-white/15 bg-white/[0.07] text-white/85 hover:bg-white/15"}`}>
              <span aria-hidden>{w.icon}</span>
              {w.name}
            </button>
          );
        })}
        {!live && (
          <button onClick={onLive} className="ml-1 flex h-8 items-center gap-1 rounded-full border border-emerald-300/40 bg-emerald-300/15 px-3 text-xs text-emerald-100 transition hover:bg-emerald-300/25 focus-visible:outline-2 focus-visible:outline-amber-200">
            ↺ Live
          </button>
        )}
      </div>
    </div>
  );
}
