"use client";

import type { Commit } from "../git-graph";

export type SceneKind = "school" | "college" | "lab" | "desk" | "remote" | "certs" | "graduation" | "office" | "future";

export const W = 900; // width of one scene in SVG units
export const GROUND = 440;
export const STAND_X = 330; // where the character stands in each scene

/** Sky gradient per scene: a dusk-toned palette that sits well inside the dark HUD. */
export const SKY: Record<SceneKind, [string, string]> = {
  school: ["#1d3b5c", "#4b7aa0"],
  college: ["#2a2f5a", "#8a6a8f"],
  lab: ["#121c26", "#1f3342"],
  desk: ["#070d1f", "#16204a"],
  remote: ["#3a2a3f", "#b07a5a"],
  certs: ["#1f1830", "#3a2b4a"],
  graduation: ["#3b1f3f", "#d4775a"],
  office: ["#10273a", "#3f7392"],
  future: ["#02040a", "#0d1d33"],
};

/** Picks the scene for a milestone from what kind of milestone it is. */
export function sceneFor(c: Commit): SceneKind {
  const t = `${c.title} ${c.subtitle ?? ""} ${c.tags.join(" ")}`.toLowerCase();
  if (c.kind === "now") return "future";
  if (c.kind === "education") {
    if (c.mergeFrom) return "graduation";
    if (/b\.?tech|degree|college|university/.test(t)) return "college";
    return "school";
  }
  if (c.kind === "milestone") return "certs";
  if (c.kind === "project") return "desk";
  if (c.current) return "office";
  if (/iot|embedded|sensor|hardware|lab/.test(t)) return "lab";
  return "remote";
}

const clip = (s: string | undefined, n: number) => (s && s.length > n ? `${s.slice(0, n - 1)}…` : (s ?? ""));

function Tree({ x, s = 1, c = "#1f4a3a" }: { x: number; s?: number; c?: string }) {
  return (
    <g transform={`translate(${x} ${GROUND}) scale(${s})`}>
      <rect x={-6} y={-70} width={12} height={70} fill="#3b2a1f" />
      <circle cx={0} cy={-92} r={38} fill={c} />
      <circle cx={-22} cy={-72} r={26} fill={c} />
      <circle cx={22} cy={-74} r={28} fill={c} />
    </g>
  );
}

function Window({ x, y, w = 34, h = 40, lit = true }: { x: number; y: number; w?: number; h?: number; lit?: boolean }) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} fill={lit ? "#f7d98a" : "#2a3a4a"} opacity={lit ? 0.85 : 1} className={lit ? "st-flicker" : undefined} />
      <line x1={x + w / 2} y1={y} x2={x + w / 2} y2={y + h} stroke="#3b3b3b" strokeWidth={2} />
      <line x1={x} y1={y + h / 2} x2={x + w} y2={y + h / 2} stroke="#3b3b3b" strokeWidth={2} />
    </g>
  );
}

/** One scene's props (sky and ground are drawn globally). Local coords: 0..W wide. */
export function Scene({ kind, commit }: { kind: SceneKind; commit: Commit }) {
  switch (kind) {
    case "school":
      return (
        <g>
          <Tree x={90} s={1.1} />
          <rect x={470} y={250} width={360} height={190} fill="#e9dcc2" />
          <path d="M 455 252 L 650 180 L 845 252 Z" fill="#9b3b32" />
          <rect x={620} y={360} width={60} height={80} fill="#5b3a26" />
          {[500, 560, 710, 770].map((x) => (
            <Window key={x} x={x} y={290} lit={false} />
          ))}
          <rect x={530} y={214} width={240} height={26} fill="#1f2d52" />
          <text x={650} y={232} textAnchor="middle" fontSize={13} fontWeight={700} fill="#fff" fontFamily="sans-serif">
            {clip(commit.subtitle || "SCHOOL", 30).toUpperCase()}
          </text>
          {/* flag pole */}
          <line x1={440} y1={440} x2={440} y2={230} stroke="#cfd6de" strokeWidth={3} />
          <g className="st-flag">
            <rect x={442} y={232} width={42} height={9} fill="#ff9933" />
            <rect x={442} y={241} width={42} height={9} fill="#fff" />
            <rect x={442} y={250} width={42} height={9} fill="#138808" />
            <circle cx={463} cy={245.5} r={3} fill="#000080" />
          </g>
        </g>
      );
    case "college":
      return (
        <g>
          <Tree x={70} s={1.2} c="#274e3f" />
          <Tree x={860} s={1} c="#274e3f" />
          <rect x={450} y={220} width={390} height={220} fill="#d9d2c4" />
          <rect x={440} y={200} width={410} height={24} fill="#b9ae9a" />
          {[480, 560, 640, 720, 800].map((x) => (
            <rect key={x} x={x - 8} y={224} width={16} height={216} fill="#efe9dd" />
          ))}
          <rect x={612} y={350} width={66} height={90} fill="#4a3526" />
          <rect x={500} y={170} width={290} height={28} rx={3} fill="#2a2f5a" />
          <text x={645} y={189} textAnchor="middle" fontSize={13} fontWeight={700} fill="#f0b45a" fontFamily="sans-serif">
            {clip(commit.subtitle?.split("·").pop()?.trim() || "COLLEGE", 34).toUpperCase()}
          </text>
          <rect x={170} y={404} width={90} height={8} fill="#6b4a33" />
          <rect x={176} y={412} width={6} height={28} fill="#6b4a33" />
          <rect x={248} y={412} width={6} height={28} fill="#6b4a33" />
        </g>
      );
    case "lab":
      return (
        <g>
          <rect x={0} y={120} width={W} height={320} fill="#1b2a36" />
          <rect x={480} y={330} width={380} height={16} fill="#8a9aa8" />
          <rect x={500} y={346} width={12} height={94} fill="#5b6a78" />
          <rect x={828} y={346} width={12} height={94} fill="#5b6a78" />
          {/* smart dustbin with Wi-Fi */}
          <rect x={560} y={260} width={70} height={70} rx={6} fill="#3f8f5a" />
          <rect x={554} y={250} width={82} height={14} rx={4} fill="#2f6f45" className="st-lid" />
          <g className="st-wifi" transform="translate(595 236)">
            {[10, 20, 30].map((r) => (
              <path key={r} d={`M ${-r} 0 A ${r} ${r} 0 0 1 ${r} 0`} stroke="#5ec8e8" strokeWidth={3} fill="none" />
            ))}
          </g>
          {/* breadboard with blinking LEDs */}
          <rect x={670} y={306} width={120} height={24} rx={3} fill="#f1efe6" />
          {[690, 715, 740, 765].map((x, i) => (
            <circle key={x} cx={x} cy={300} r={5} fill={["#ff5a5a", "#5fe3a1", "#5ec8e8", "#f0b45a"][i]} className="st-led" style={{ animationDelay: `${i * 0.3}s` }} />
          ))}
          <text x={660} y={170} textAnchor="middle" fontSize={16} fontWeight={700} fill="#5ec8e8" fontFamily="monospace">
            IoT LAB
          </text>
          <text x={660} y={192} textAnchor="middle" fontSize={11} fill="#8fb3d9" fontFamily="sans-serif">
            {clip(commit.subtitle, 56)}
          </text>
        </g>
      );
    case "desk":
      return (
        <g>
          <rect x={0} y={120} width={W} height={320} fill="#101831" />
          {/* window with moon */}
          <rect x={80} y={170} width={150} height={120} fill="#0a1128" stroke="#2c3a66" strokeWidth={6} />
          <circle cx={190} cy={205} r={16} fill="#f3eecf" />
          {[110, 140, 125, 170].map((x, i) => (
            <circle key={i} cx={x} cy={190 + i * 17} r={1.6} fill="#fff" className="st-twinkle" style={{ animationDelay: `${i * 0.4}s` }} />
          ))}
          <rect x={470} y={340} width={380} height={14} fill="#5a4030" />
          <rect x={490} y={354} width={10} height={86} fill="#4a3526" />
          <rect x={820} y={354} width={10} height={86} fill="#4a3526" />
          {/* monitor with code */}
          <rect x={570} y={220} width={200} height={120} rx={6} fill="#0b0f18" stroke="#b59cff" strokeWidth={3} />
          <text x={670} y={246} textAnchor="middle" fontSize={13} fontWeight={700} fill="#b59cff" fontFamily="monospace">
            {clip(commit.title, 24)}
          </text>
          <g className="st-code">
            {[0, 1, 2, 3, 4].map((i) => (
              <rect key={i} x={588 + (i % 2) * 14} y={262 + i * 13} width={[120, 90, 140, 70, 110][i]} height={5} rx={2} fill={["#5ec8e8", "#5fe3a1", "#f0b45a", "#b59cff", "#5ec8e8"][i]} opacity={0.8} />
            ))}
          </g>
          <rect x={655} y={340} width={30} height={6} fill="#333" />
          {/* lamp */}
          <path d="M 800 340 L 800 280 L 780 262" stroke="#888" strokeWidth={4} fill="none" />
          <path d="M 766 258 L 796 250 L 792 270 Z" fill="#f0b45a" />
          <circle cx={784} cy={272} r={40} fill="#f0b45a" opacity={0.12} />
        </g>
      );
    case "remote":
      return (
        <g>
          <rect x={0} y={120} width={W} height={320} fill="#3a2c38" />
          <rect x={500} y={330} width={320} height={14} fill="#c89a6a" />
          <rect x={650} y={344} width={14} height={96} fill="#8a6440" />
          {/* laptop with React logo */}
          <path d="M 560 330 L 580 250 L 720 250 L 700 330 Z" fill="#20252e" />
          <g className="st-spin" transform="translate(650 290)">
            <ellipse rx={22} ry={8} stroke="#5ec8e8" strokeWidth={2.5} fill="none" />
            <ellipse rx={22} ry={8} stroke="#5ec8e8" strokeWidth={2.5} fill="none" transform="rotate(60)" />
            <ellipse rx={22} ry={8} stroke="#5ec8e8" strokeWidth={2.5} fill="none" transform="rotate(-60)" />
            <circle r={3.5} fill="#5ec8e8" />
          </g>
          {/* coffee with steam */}
          <rect x={750} y={306} width={26} height={24} rx={4} fill="#eee" />
          {[756, 766].map((x, i) => (
            <path key={x} d={`M ${x} 300 q -6 -10 0 -20 q 6 -10 0 -20`} stroke="#ddd" strokeWidth={2} fill="none" className="st-steam" style={{ animationDelay: `${i * 0.6}s` }} />
          ))}
          <text x={650} y={190} textAnchor="middle" fontSize={16} fontWeight={700} fill="#5ec8e8" fontFamily="monospace">
            {clip(commit.subtitle?.split("·")[0]?.trim(), 30).toUpperCase()}
          </text>
          <text x={650} y={212} textAnchor="middle" fontSize={11} fill="#e8c9a8" fontFamily="sans-serif">
            {clip(commit.title, 40)}
          </text>
        </g>
      );
    case "certs":
      return (
        <g>
          <rect x={0} y={120} width={W} height={320} fill="#241c34" />
          {Array.from({ length: 12 }, (_, i) => (
            <g key={i} transform={`translate(${480 + (i % 4) * 90} ${160 + Math.floor(i / 4) * 70})`}>
              <rect width={70} height={52} fill="#f4ecd8" stroke="#c9a34a" strokeWidth={3} />
              <rect x={12} y={12} width={46} height={4} fill="#8a7a5a" />
              <rect x={18} y={22} width={34} height={3} fill="#b8a888" />
              <circle cx={35} cy={38} r={6} fill="#d4403a" className="st-shine" style={{ animationDelay: `${i * 0.25}s` }} />
            </g>
          ))}
          {/* trophy */}
          <g transform="translate(420 440)">
            <rect x={-18} y={-14} width={36} height={14} fill="#8a6a2a" />
            <rect x={-5} y={-40} width={10} height={26} fill="#d4a93a" />
            <path d="M -26 -86 L 26 -86 Q 24 -44 0 -40 Q -24 -44 -26 -86 Z" fill="#f0c24a" className="st-shine" />
          </g>
          <text x={660} y={390} textAnchor="middle" fontSize={15} fontWeight={700} fill="#f0b45a" fontFamily="sans-serif">
            {clip(commit.title, 44)}
          </text>
        </g>
      );
    case "graduation":
      return (
        <g>
          <rect x={440} y={380} width={430} height={60} fill="#5a2f3a" />
          <rect x={470} y={200} width={370} height={40} rx={4} fill="#2a1830" />
          <text x={655} y={226} textAnchor="middle" fontSize={16} fontWeight={700} fill="#f0b45a" fontFamily="sans-serif">
            {`CLASS OF ${commit.at.slice(0, 4)}`}
          </text>
          <text x={655} y={262} textAnchor="middle" fontSize={12} fill="#f6d9c4" fontFamily="sans-serif">
            {clip(commit.subtitle, 50)}
          </text>
          <rect x={620} y={320} width={70} height={60} fill="#3a1f2a" />
          {/* confetti */}
          {Array.from({ length: 28 }, (_, i) => (
            <rect
              key={i}
              x={20 + ((i * 131) % 860)}
              y={-20}
              width={6}
              height={10}
              fill={["#f0b45a", "#5ec8e8", "#b59cff", "#5fe3a1", "#ff7a7a"][i % 5]}
              className="st-confetti"
              style={{ animationDelay: `${(i % 9) * 0.35}s`, animationDuration: `${3 + (i % 4) * 0.6}s` }}
            />
          ))}
        </g>
      );
    case "office":
      return (
        <g>
          <rect x={0} y={120} width={W} height={320} fill="#132c40" />
          {/* skyline through glass */}
          <rect x={40} y={150} width={260} height={220} fill="#0d1f2e" stroke="#3f7392" strokeWidth={5} />
          {[60, 95, 130, 170, 210, 250].map((x, i) => (
            <rect key={x} x={x} y={370 - [90, 150, 110, 180, 130, 160][i]} width={28} height={[90, 150, 110, 180, 130, 160][i]} fill="#1c3b55" />
          ))}
          {[70, 105, 140, 180, 220, 260].map((x, i) => (
            <rect key={x} x={x} y={260 + (i % 3) * 25} width={6} height={6} fill="#f7d98a" className="st-flicker" style={{ animationDelay: `${i * 0.5}s` }} />
          ))}
          {/* company sign */}
          <rect x={500} y={150} width={320} height={46} rx={6} fill="#0b1a26" stroke="#5fe3a1" strokeWidth={2} />
          <text x={660} y={181} textAnchor="middle" fontSize={20} fontWeight={800} letterSpacing={4} fill="#5fe3a1" fontFamily="sans-serif">
            {clip(commit.subtitle?.split("·")[0]?.trim(), 18).toUpperCase()}
          </text>
          {/* desk + monitor with agent graph */}
          <rect x={500} y={340} width={340} height={14} fill="#dfe6ec" />
          <rect x={560} y={230} width={200} height={110} rx={6} fill="#0b0f18" stroke="#5fe3a1" strokeWidth={3} />
          {[
            [600, 262],
            [660, 250],
            [720, 272],
            [630, 310],
            [700, 316],
          ].map(([x, y], i, all) => (
            <g key={i}>
              {i > 0 && <line x1={all[0][0]} y1={all[0][1]} x2={x} y2={y} stroke="#5fe3a1" strokeOpacity={0.5} />}
              <circle cx={x} cy={y} r={6} fill="#5fe3a1" className="st-led" style={{ animationDelay: `${i * 0.35}s` }} />
            </g>
          ))}
          {/* plant */}
          <rect x={830} y={400} width={30} height={40} fill="#6b4a33" />
          <path d="M 845 400 q -20 -30 -6 -60 M 845 400 q 18 -26 8 -58 M 845 400 q 0 -34 0 -64" stroke="#3f8f5a" strokeWidth={6} fill="none" strokeLinecap="round" />
        </g>
      );
    case "future":
      return (
        <g>
          {Array.from({ length: 40 }, (_, i) => (
            <circle key={i} cx={(i * 197) % W} cy={30 + ((i * 89) % 380)} r={1.3} fill="#cfe7ff" className="st-twinkle" style={{ animationDelay: `${(i % 7) * 0.4}s` }} />
          ))}
          {/* portal door */}
          <g transform="translate(650 300)">
            {[70, 90, 110].map((r, i) => (
              <ellipse key={r} rx={r * 0.62} ry={r} fill="none" stroke={i === 1 ? "#b8ffe0" : "#5fe3a1"} strokeWidth={3} className="st-portal" style={{ animationDelay: `${i * 0.5}s` }} />
            ))}
            <ellipse rx={40} ry={66} fill="#5fe3a1" opacity={0.25} className="st-portal" />
          </g>
          <text x={650} y={440 - 6} textAnchor="middle" fontSize={14} fontWeight={700} letterSpacing={4} fill="#5fe3a1" fontFamily="monospace">
            FUTURE
          </text>
        </g>
      );
  }
}
