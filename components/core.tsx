// Rounded so server and browser trig agree (avoids hydration mismatches).
const r2 = (n: number) => Math.round(n * 100) / 100;

export type CoreState = "idle" | "thinking" | "answering";

/**
 * HIVEMIND's presence. Boots in on mount (rings draw themselves), orbits slowly at rest,
 * sweeps a radar arm while searching, and breathes while answering.
 */
export function Core({ state = "idle", size = 160 }: { state?: CoreState; size?: number }) {
  const ticks = Array.from({ length: 72 }, (_, i) => i);
  const hex = [0, 1, 2, 3, 4, 5].map((i) => {
    const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
    return [r2(100 + Math.cos(a) * 28), r2(100 + Math.sin(a) * 28)] as const;
  });
  const small = size < 60;

  return (
    <svg
      data-state={state}
      width={size}
      height={size}
      viewBox="0 0 200 200"
      role="img"
      aria-label={state === "idle" ? "HIVEMIND ready" : state === "thinking" ? "HIVEMIND thinking" : "HIVEMIND answering"}
      className="core shrink-0 overflow-visible"
    >
      <defs>
        <radialGradient id="core-fill" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="oklch(0.97 0.05 85)" />
          <stop offset="35%" stopColor="oklch(0.8 0.14 72)" />
          <stop offset="100%" stopColor="oklch(0.8 0.14 72 / 0)" />
        </radialGradient>
        <radialGradient id="core-halo" cx="50%" cy="50%" r="50%">
          <stop offset="55%" stopColor="oklch(0.8 0.14 72 / 0)" />
          <stop offset="80%" stopColor="oklch(0.8 0.14 72 / 0.12)" />
          <stop offset="100%" stopColor="oklch(0.8 0.14 72 / 0)" />
        </radialGradient>
        <linearGradient id="core-sweep" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="oklch(0.84 0.085 215 / 0)" />
          <stop offset="100%" stopColor="oklch(0.84 0.085 215 / 0.35)" />
        </linearGradient>
      </defs>

      {!small && <circle className="core-halo" cx="100" cy="100" r="100" fill="url(#core-halo)" />}

      {!small && (
        <g className="core-ticks" opacity="0.55">
          {ticks.map((i) => {
            const a = (i / 72) * Math.PI * 2;
            const long = i % 6 === 0;
            const r1 = long ? 87 : 91;
            return (
              <line
                key={i}
                x1={r2(100 + Math.cos(a) * r1)}
                y1={r2(100 + Math.sin(a) * r1)}
                x2={r2(100 + Math.cos(a) * 95)}
                y2={r2(100 + Math.sin(a) * 95)}
                stroke="oklch(0.84 0.085 215)"
                strokeWidth={long ? 1.2 : 0.6}
                style={{ animationDelay: `${i * 6}ms` }}
              />
            );
          })}
        </g>
      )}

      {/* Radar sweep: only visible while searching */}
      <g className="core-ring core-sweep">
        <path d="M100 100 L100 22 A78 78 0 0 1 167.5 61 Z" fill="url(#core-sweep)" />
      </g>

      <g className="core-ring core-ring--a">
        <circle className="core-draw" pathLength={100} cx="100" cy="100" r="76" fill="none" stroke="oklch(0.8 0.14 72)" strokeWidth="2" strokeDasharray="22 8 6 8 22 8 6 20" strokeLinecap="round" />
        {!small && <circle cx="176" cy="100" r="2.6" fill="oklch(0.9 0.1 80)" />}
      </g>
      <g className="core-ring core-ring--b">
        <circle className="core-draw core-draw--late" cx="100" cy="100" r="62" fill="none" stroke="oklch(0.84 0.085 215)" strokeWidth="1" strokeDasharray="3 7" opacity="0.75" />
        {!small && <circle cx="38" cy="100" r="1.8" fill="oklch(0.84 0.085 215)" />}
      </g>
      <circle cx="100" cy="100" r="48" fill="none" stroke="oklch(0.8 0.14 72 / 0.35)" strokeWidth="1" />

      <circle className="core-glow" cx="100" cy="100" r="44" fill="url(#core-fill)" />
      <g className="core-nucleus">
        <circle cx="100" cy="100" r="13" fill="oklch(0.97 0.04 85)" />
        {hex.map(([x, y], i) => (
          <circle key={i} className="core-cell" cx={x} cy={y} r="3.4" fill="oklch(0.97 0.04 85)" style={{ animationDelay: `${i * 120}ms` }} />
        ))}
      </g>
    </svg>
  );
}
