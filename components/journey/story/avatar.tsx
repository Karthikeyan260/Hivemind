"use client";

import { cx } from "@/components/ui";

export type Age = "kid" | "teen" | "student" | "grad" | "pro" | "future";

// Drawn from the owner's photo: warm medium-brown skin, thick black side-swept hair, strong brows,
// mustache + small goatee as an adult, mint-green shirt today. Flat-vector, front view, feet at (0,0).
const SKIN = "#b27a52";
const SKIN_SHADE = "#9a6440";
const HAIR = "#141414";

const OUTFIT: Record<Age, { shirt: string; shirtShade: string; pants: string; shoes: string }> = {
  kid: { shirt: "#f4f6f8", shirtShade: "#d9dee4", pants: "#1f2d52", shoes: "#111" },
  teen: { shirt: "#f4f6f8", shirtShade: "#d9dee4", pants: "#1f2d52", shoes: "#111" },
  student: { shirt: "#2c8c8f", shirtShade: "#23706f", pants: "#3b5a85", shoes: "#e8e8e8" },
  grad: { shirt: "#1c1f2b", shirtShade: "#141722", pants: "#1c1f2b", shoes: "#111" },
  pro: { shirt: "#bff0c8", shirtShade: "#a3dcae", pants: "#2b3038", shoes: "#1a1a1a" },
  future: { shirt: "#5ec8e8", shirtShade: "#5ec8e8", pants: "#5ec8e8", shoes: "#5ec8e8" },
};
const SCALE: Record<Age, number> = { kid: 0.7, teen: 0.86, student: 1, grad: 1, pro: 1, future: 1 };

export function Avatar({
  age,
  walking,
  talking,
  waving,
  className,
}: {
  age: Age;
  walking?: boolean;
  talking?: boolean;
  waving?: boolean;
  className?: string;
}) {
  const o = OUTFIT[age];
  const holo = age === "future";
  const adult = age === "pro" || age === "future";
  const young = age === "kid" || age === "teen";
  // Kids have proportionally bigger heads.
  const head = age === "kid" ? 1.16 : age === "teen" ? 1.06 : 1;

  return (
    <g
      className={cx("av", walking && "is-walking", talking && "is-talking", waving && "is-waving", holo && "is-holo", className)}
      transform={`scale(${SCALE[age]})`}
      style={holo ? { filter: "url(#av-holo)" } : undefined}
      opacity={holo ? 0.85 : 1}
    >
      <ellipse cx={0} cy={0} rx={36} ry={6} fill="#000" opacity={0.28} className="av-shadow" />
      <g className="av-body">
        {/* Legs (pivot at the hip) */}
        {[-12, 12].map((x, i) => (
          <g key={x} className={i ? "av-leg-r" : "av-leg-l"}>
            <rect x={x - 9} y={-96} width={18} height={88} rx={7} fill={o.pants} />
            <ellipse cx={x + (i ? 4 : -4)} cy={-6} rx={13} ry={6.5} fill={o.shoes} />
          </g>
        ))}

        {/* Back arm */}
        <g className="av-arm-l">
          <rect x={-40} y={-162} width={15} height={62} rx={7} fill={age === "grad" ? o.shirt : o.shirtShade} />
          <circle cx={-32.5} cy={-96} r={8} fill={SKIN} />
        </g>

        {/* Torso */}
        {age === "grad" ? (
          <path d="M -30 -168 Q 0 -178 30 -168 L 40 -30 Q 0 -22 -40 -30 Z" fill={o.shirt} />
        ) : (
          <path d="M -30 -168 Q 0 -176 30 -168 L 28 -92 Q 0 -86 -28 -92 Z" fill={o.shirt} className="av-torso" />
        )}
        {/* Collar / neckline */}
        {age === "student" ? (
          <path d="M -10 -171 Q 0 -160 10 -171" stroke={o.shirtShade} strokeWidth={4} fill="none" />
        ) : (
          <>
            <path d="M -12 -172 L 0 -156 L -4 -150 L -16 -166 Z" fill={holo ? o.shirt : "#ffffff"} opacity={0.9} />
            <path d="M 12 -172 L 0 -156 L 4 -150 L 16 -166 Z" fill={holo ? o.shirt : "#ffffff"} opacity={0.9} />
            {!holo && age !== "grad" && <line x1={0} y1={-154} x2={0} y2={-94} stroke={o.shirtShade} strokeWidth={1.5} />}
          </>
        )}
        {/* School tie */}
        {young && <path d="M -4 -156 L 4 -156 L 6 -118 L 0 -110 L -6 -118 Z" fill="#1f2d52" />}
        {/* Lab coat for internships is drawn by the scene; ID card for the office */}
        {adult && !holo && (
          <>
            <path d="M -9 -168 L 6 -126" stroke="#2f6fd6" strokeWidth={2} />
            <path d="M 9 -168 L 6 -126" stroke="#2f6fd6" strokeWidth={2} />
            <rect x={-1} y={-127} width={14} height={18} rx={2} fill="#fff" />
            <rect x={1.5} y={-123} width={9} height={5} fill="#5fe3a1" />
          </>
        )}
        {/* Backpack straps (student) / school bag strap (kids) */}
        {age === "student" && (
          <>
            <path d="M -24 -168 L -20 -110" stroke="#1d2733" strokeWidth={5} strokeLinecap="round" />
            <path d="M 24 -168 L 20 -110" stroke="#1d2733" strokeWidth={5} strokeLinecap="round" />
          </>
        )}
        {young && <path d="M -26 -168 L 26 -100" stroke="#8b2e2e" strokeWidth={5} strokeLinecap="round" />}

        {/* Front arm (waves) */}
        <g className="av-arm-r">
          <rect x={25} y={-162} width={15} height={62} rx={7} fill={age === "grad" ? o.shirt : o.shirt} stroke={o.shirtShade} strokeWidth={age === "pro" ? 1 : 0} />
          <circle cx={32.5} cy={-96} r={8} fill={SKIN} />
        </g>

        {/* Neck */}
        <rect x={-7} y={-184} width={14} height={16} fill={SKIN_SHADE} />

        {/* Head */}
        <g className="av-head" transform={`translate(0 -212) scale(${head}) translate(0 212)`}>
          <ellipse cx={-24} cy={-208} rx={5} ry={8} fill={SKIN} />
          <ellipse cx={24} cy={-208} rx={5} ry={8} fill={SKIN} />
          <path d="M -23 -222 Q -24 -186 0 -180 Q 24 -186 23 -222 Q 22 -246 0 -246 Q -22 -246 -23 -222 Z" fill={SKIN} />
          {/* Stubble / beard shadow */}
          {(age === "student" || age === "grad") && <path d="M -18 -200 Q -14 -182 0 -180 Q 14 -182 18 -200 Q 10 -188 0 -187 Q -10 -188 -18 -200 Z" fill="#3a2a20" opacity={0.25} />}
          {/* Hair: thick, swept to one side with volume */}
          <path
            d={
              young
                ? "M -25 -218 Q -28 -250 -2 -254 Q 24 -254 26 -226 Q 22 -238 8 -240 Q -6 -236 -14 -240 Q -20 -234 -25 -218 Z"
                : "M -26 -214 Q -32 -254 -2 -260 Q 30 -262 28 -224 Q 24 -236 14 -238 Q 8 -230 -4 -236 Q -12 -226 -20 -230 Q -22 -222 -26 -214 Z"
            }
            fill={HAIR}
          />
          {!young && <path d="M -18 -240 Q 4 -262 26 -236 Q 14 -246 2 -244 Z" fill="#2a2a2a" opacity={0.6} />}
          {/* Brows */}
          <path d="M -17 -222 Q -10 -226 -4 -222" stroke={HAIR} strokeWidth={3.2} strokeLinecap="round" fill="none" />
          <path d="M 4 -222 Q 10 -226 17 -222" stroke={HAIR} strokeWidth={3.2} strokeLinecap="round" fill="none" />
          {/* Eyes (blink) */}
          <g className="av-eyes">
            <ellipse cx={-10} cy={-213} rx={3.6} ry={3} fill="#fff" />
            <ellipse cx={10} cy={-213} rx={3.6} ry={3} fill="#fff" />
            <circle cx={-9.5} cy={-213} r={2.1} fill="#3a2418" />
            <circle cx={10.5} cy={-213} r={2.1} fill="#3a2418" />
          </g>
          {/* Nose */}
          <path d="M 0 -210 Q -3 -200 1 -199" stroke={SKIN_SHADE} strokeWidth={1.8} fill="none" strokeLinecap="round" />
          {/* Mustache + goatee (adult) */}
          {(adult || age === "grad") && <path d="M -11 -193 Q -5 -198 0 -195 Q 5 -198 11 -193 Q 5 -194 0 -192 Q -5 -194 -11 -193 Z" fill={HAIR} />}
          {adult && <path d="M -3 -185 Q 0 -179 3 -185 Q 0 -183 -3 -185 Z" fill={HAIR} />}
          {/* Mouth: smile, opens while talking */}
          <path className="av-mouth-closed" d="M -6 -189 Q 0 -185 6 -189" stroke="#5a2a22" strokeWidth={2} fill="none" strokeLinecap="round" />
          <ellipse className="av-mouth-open" cx={0} cy={-188} rx={4.5} ry={3} fill="#5a2a22" />
          {/* Graduation cap */}
          {age === "grad" && (
            <g>
              <path d="M -30 -252 L 0 -266 L 30 -252 L 0 -238 Z" fill="#111" />
              <rect x={-14} y={-252} width={28} height={10} fill="#111" />
              <path d="M 22 -254 L 26 -236" stroke="#f0b45a" strokeWidth={2} />
              <circle cx={26} cy={-235} r={2.5} fill="#f0b45a" />
            </g>
          )}
        </g>
      </g>
    </g>
  );
}

/** Shared SVG defs (hologram glow for Future You). Render once inside the <svg>. */
export function AvatarDefs() {
  return (
    <defs>
      <filter id="av-holo" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="3" result="b" />
        <feMerge>
          <feMergeNode in="b" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
    </defs>
  );
}
