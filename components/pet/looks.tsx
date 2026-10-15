import type { AccessoryId, Festival } from "@/lib/pet-looks";
import type { Sky } from "@/lib/sky";

/**
 * Outfits drawn over the lantern sprite (same 100x100 box as one sprite cell: the handle ring sits
 * around y 5-22, the eyes near y 48, the base around y 75). Drawn, not emoji, so they match the art.
 * A festival hat replaces a head accessory; the weather outside wins over both (an umbrella in the
 * rain, shades on a sunny day); everything else layers.
 */
export function Looks({ festival, wear, sky = "calm" }: { festival: Festival | null; wear: AccessoryId | null; sky?: Sky }) {
  const id = festival?.id;
  const wet = sky === "rain" || sky === "thunder";
  const hat = wet ? <Umbrella /> : id === "christmas" ? <SantaHat /> : id === "newyear" ? <PartyHat /> : null;
  return (
    <svg viewBox="0 0 100 100" className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" aria-hidden>
      {/* Behind-and-around pieces first. */}
      {id === "puthandu" && <Thoranam />}
      {id === "deepavali" && (
        <>
          <Diya x={12} y={84} />
          <Diya x={88} y={84} delay={0.6} />
          <Sparks colors={["#ffd43b", "#ff922b", "#fff3bf"]} />
        </>
      )}
      {id === "karthigai" && [16, 33, 50, 67, 84].map((x, i) => <Diya key={x} x={x} y={i % 2 ? 96 : 99} small delay={i * 0.3} />)}
      {id === "pongal" && (
        <>
          <Sugarcane />
          <PongalPot />
        </>
      )}
      {id === "newyear" && <Sparks colors={["#da77f2", "#4dabf7", "#ffd43b", "#69db7c", "#ff8787"]} />}
      {id === "christmas" && <Snow />}
      {id === "india" && <Flag />}

      {/* On the lantern. */}
      {wear === "garland" && <Garland />}
      {(wear === "shades" || sky === "sunny") && <Shades />}
      {hat ?? (wear === "bow" ? <Bow /> : null)}
    </svg>
  );
}

function Bow() {
  return (
    <g transform="translate(50 15)">
      <path d="M0 0 L-11 -6 Q-13 0 -11 6 Z" fill="#ff6b9d" stroke="#c2255c" strokeWidth="0.8" />
      <path d="M0 0 L11 -6 Q13 0 11 6 Z" fill="#ff6b9d" stroke="#c2255c" strokeWidth="0.8" />
      <path d="M-1 1 L-5 11 M1 1 L5 11" stroke="#ff6b9d" strokeWidth="2.2" strokeLinecap="round" />
      <circle r="2.8" fill="#f06595" stroke="#c2255c" strokeWidth="0.8" />
    </g>
  );
}

function Garland() {
  // Jasmine (white) with marigold (orange) every few, hung across the lantern's base.
  const n = 13;
  return (
    <g>
      {Array.from({ length: n }, (_, i) => {
        const t = i / (n - 1);
        const x = 27 + t * 46;
        const y = 70 + Math.sin(t * Math.PI) * 9;
        const marigold = i % 4 === 0;
        return <circle key={i} cx={x} cy={y} r={marigold ? 3.2 : 2.5} fill={marigold ? "#ff922b" : "#fffdf5"} stroke={marigold ? "#e8590c" : "#dee2e6"} strokeWidth="0.6" />;
      })}
      <path d="M50 79 l-2 7 M50 79 l2 7" stroke="#2f9e44" strokeWidth="1.2" strokeLinecap="round" />
    </g>
  );
}

function Shades() {
  return (
    <g>
      <rect x="31" y="43" width="16" height="9" rx="4" fill="#111418" opacity="0.92" />
      <rect x="53" y="43" width="16" height="9" rx="4" fill="#111418" opacity="0.92" />
      <path d="M47 46 Q50 44 53 46" stroke="#111418" strokeWidth="1.8" fill="none" />
      <path d="M34 45 l5 0" stroke="#fff" strokeWidth="1.2" strokeLinecap="round" opacity="0.7" />
      <path d="M56 45 l5 0" stroke="#fff" strokeWidth="1.2" strokeLinecap="round" opacity="0.7" />
    </g>
  );
}

function PartyHat() {
  return (
    <g transform="rotate(-12 50 18)">
      <path d="M38 22 L50 -2 L62 22 Z" fill="#9775fa" stroke="#5f3dc4" strokeWidth="0.8" />
      <path d="M44 10 L56 10 M41 16 L59 16" stroke="#ffd43b" strokeWidth="2" />
      <circle cx="50" cy="-3" r="3.4" fill="#ffd43b" />
    </g>
  );
}

function SantaHat() {
  return (
    <g transform="rotate(-10 50 18)">
      <path d="M36 21 Q48 -6 66 6 Q58 8 62 21 Z" fill="#e03131" stroke="#a51111" strokeWidth="0.8" />
      <rect x="34" y="18" width="30" height="6" rx="3" fill="#f8f9fa" />
      <circle cx="67" cy="6" r="3.6" fill="#f8f9fa" />
    </g>
  );
}

function Diya({ x, y, small = false, delay = 0 }: { x: number; y: number; small?: boolean; delay?: number }) {
  const k = small ? 0.75 : 1;
  return (
    <g transform={`translate(${x} ${y}) scale(${k})`}>
      <path d="M-8 0 Q0 9 8 0 Z" fill="#c2410c" stroke="#7c2d12" strokeWidth="0.8" />
      <path d="M-8 0 L8 0" stroke="#f59f00" strokeWidth="1.2" />
      <path d="M0 -10 Q4 -4 0 -1 Q-4 -4 0 -10 Z" fill="#ffd43b" className="pet-glow" style={{ animationDelay: `${delay}s` }} />
      <circle cy="-4" r="6" fill="#ffd43b" opacity="0.25" className="pet-glow" style={{ animationDelay: `${delay}s` }} />
    </g>
  );
}

function PongalPot() {
  return (
    <g transform="translate(88 80)">
      <ellipse cy="2" rx="9" ry="8" fill="#c2410c" stroke="#7c2d12" strokeWidth="0.8" />
      <path d="M-9 0 Q0 4 9 0" stroke="#ffd43b" strokeWidth="1.4" fill="none" />
      <rect x="-6" y="-8" width="12" height="3" rx="1.5" fill="#a63e0f" />
      <path d="M-6 -8 Q-8 -14 -3 -13 Q-1 -18 3 -14 Q8 -15 6 -9" fill="#fffdf5" stroke="#dee2e6" strokeWidth="0.6" />
    </g>
  );
}

function Sugarcane() {
  return (
    <g transform="translate(10 52) rotate(-8)">
      <rect x="-2" y="0" width="4" height="40" rx="2" fill="#7950f2" />
      {[8, 18, 28].map((y) => (
        <path key={y} d={`M-2 ${y} L2 ${y}`} stroke="#5f3dc4" strokeWidth="1.2" />
      ))}
      <path d="M0 0 Q-8 -8 -12 -6 M0 0 Q6 -10 10 -9 M0 0 Q0 -10 2 -14" stroke="#40c057" strokeWidth="1.6" fill="none" strokeLinecap="round" />
    </g>
  );
}

function Thoranam() {
  return (
    <g>
      <path d="M8 4 Q50 14 92 4" stroke="#8d6e63" strokeWidth="1" fill="none" />
      {Array.from({ length: 9 }, (_, i) => {
        const t = (i + 0.5) / 9;
        const x = 8 + t * 84;
        const y = 4 + Math.sin(t * Math.PI) * 10;
        return <path key={i} d={`M${x} ${y} q-3 6 0 12 q3 -6 0 -12`} fill="#40c057" stroke="#2b8a3e" strokeWidth="0.5" />;
      })}
    </g>
  );
}

function Sparks({ colors }: { colors: string[] }) {
  const at = [
    [8, 30],
    [92, 24],
    [16, 60],
    [86, 58],
    [24, 10],
    [78, 8],
  ];
  return (
    <g>
      {at.map(([x, y], i) => (
        <rect key={i} x={x} y={y} width="3" height="3" rx="0.6" fill={colors[i % colors.length]} className="pet-note" style={{ animationDelay: `${i * 0.35}s` }} transform={`rotate(${i * 25} ${x} ${y})`} />
      ))}
    </g>
  );
}

function Snow() {
  return (
    <g fill="#f8f9fa">
      {[
        [10, 20],
        [90, 14],
        [20, 50],
        [84, 46],
        [50, -4],
      ].map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r="1.8" className="pet-rain" style={{ animationDelay: `${i * 0.3}s`, animationDuration: "2.4s" }} />
      ))}
    </g>
  );
}

function Flag() {
  return (
    <g transform="translate(84 22)">
      <path d="M0 0 L0 34" stroke="#868e96" strokeWidth="1.4" />
      <rect x="0" y="0" width="16" height="4" fill="#ff922b" />
      <rect x="0" y="4" width="16" height="4" fill="#f8f9fa" />
      <rect x="0" y="8" width="16" height="4" fill="#2f9e44" />
      <circle cx="8" cy="6" r="1.4" fill="none" stroke="#1c7ed6" strokeWidth="0.6" />
    </g>
  );
}

function Umbrella() {
  // A little umbrella held over the lantern, swaying (its stick hooks down beside the handle).
  return (
    <g className="pet-umbrella">
      <path d="M50 2 L50 -4" stroke="#495057" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M20 22 Q22 2 50 0 Q78 2 80 22 Q75 18 70 22 Q65 18 60 22 Q55 18 50 22 Q45 18 40 22 Q35 18 30 22 Q25 18 20 22 Z" fill="#4dabf7" stroke="#1971c2" strokeWidth="0.9" />
      <path d="M50 0 Q42 10 40 22 M50 0 Q58 10 60 22" stroke="#ffd43b" strokeWidth="2.2" fill="none" opacity="0.9" />
      <path d="M78 21 L78 46 Q78 51 73 51" stroke="#495057" strokeWidth="1.8" fill="none" strokeLinecap="round" />
    </g>
  );
}
