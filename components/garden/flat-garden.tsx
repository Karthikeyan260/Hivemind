"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Creature } from "@/components/pet/creature";
import { ErrorText, PageHeader } from "@/components/ui";
import { useVoiceActions } from "@/components/voice/provider";
import { useFetch } from "@/lib/client-api";
import { type Garden, hash01, homeSpot, islandSize, layout, pathX, type Placed } from "@/lib/garden-layout";
import type { Sky } from "@/lib/sky";

/**
 * Nova's garden: a floating island that grows with the owner. A flower for every day a habit was
 * done, trees from night check-ins, lamps from lantern walks, gems from game wins, butterflies from
 * songs. It's alive: wind rolls across it, flowers bloom in when it opens, the pet wanders about
 * (tap a flower and it walks over to it), a waterfall pours off the edge, fireflies come out at
 * night and rain splashes on the grass when it rains outside.
 */
const W = 1000;
const H = 640;
type Pt = { x: number; y: number };
/** The little label shown beside whatever was tapped. */
type Tip = { id: string; x: number; y: number; label: string };
/** The light of the day: dawn, day, golden hour, dusk, night. */
type Phase = "dawn" | "day" | "golden" | "dusk" | "night";
function phaseNow(): Phase {
  const d = new Date();
  const h = d.getHours() + d.getMinutes() / 60;
  if (h < 6 || h >= 19) return "night";
  if (h < 7.5) return "dawn";
  if (h < 16) return "day";
  if (h < 18) return "golden";
  return "dusk";
}
/** Sky colours (top, middle, horizon) and where the sun sits, for each part of the day. */
const SKY: Record<Phase, { top: string; mid: string; low: string; sun?: { x: number; y: number; c: string; glow: string } }> = {
  dawn: { top: "#283a6e", mid: "#b9768f", low: "#ffcfa3", sun: { x: 170, y: 250, c: "#ffd9a0", glow: "#ffc89a" } },
  day: { top: "#1b5c9c", mid: "#4a99cf", low: "#b3def0", sun: { x: 840, y: 95, c: "#ffe08a", glow: "#fff1c4" } },
  golden: { top: "#2a568a", mid: "#d99a5a", low: "#ffd89a", sun: { x: 830, y: 205, c: "#ffc35c", glow: "#ffd58a" } },
  dusk: { top: "#1a1d4a", mid: "#7b3d6c", low: "#f0875a", sun: { x: 860, y: 330, c: "#ff8a4a", glow: "#ff9a6a" } },
  night: { top: "#040814", mid: "#0f1a33", low: "#1a2747" },
};

export function FlatGarden() {
  const feed = useFetch<{ garden: Garden }>("/api/pet/garden");
  const g = feed.data?.garden;
  const placed = useMemo(() => (g ? layout(g.items) : []), [g]);
  // Bloom order: oldest first, so the garden grows in the order it was planted.
  const bloom = useMemo(() => {
    const order = [...placed].sort((a, b) => ("date" in a ? a.date : "").localeCompare("date" in b ? b.date : ""));
    // After the island has risen (about 0.8 s in).
    return new Map(order.map((p, i) => [p.id, 0.8 + Math.min(2.6, i * 0.014)]));
  }, [placed]);
  // Flowers are gathered into wind groups (a row on part of the island) so a few dozen animations
  // move them all, not one per flower. Other things stay single, in their back-to-front place.
  const chunks = useMemo(() => {
    type Wind = { kind: "wind"; key: string; x: number; y: number; ps: Placed[] };
    const out: ({ kind: "one"; p: Placed } | Wind)[] = [];
    const groups = new Map<string, Wind>();
    for (const p of placed) {
      if (p.kind !== "flower") {
        out.push({ kind: "one", p });
        continue;
      }
      const row = Math.round(p.y / 14);
      const band = Math.floor(p.x / (W / 6));
      const key = `${row}:${band}`;
      let w = groups.get(key);
      if (!w) {
        w = { kind: "wind", key, x: (band + 0.5) * (W / 6), y: row * 14, ps: [] };
        groups.set(key, w);
        out.push(w);
      }
      w.ps.push(p);
    }
    return out;
  }, [placed]);
  const [sel, setSel] = useState<Tip | null>(null);
  const [night, setNight] = useState(false);
  const [phase, setPhase] = useState<Phase>("day");
  // A little sparkle burst where something was tapped.
  const [burst, setBurst] = useState<{ x: number; y: number; k: number } | null>(null);
  // The opening: clouds part and the island rises into view.
  const [intro, setIntro] = useState(true);
  // Where Nova looks when it's standing still: towards your pointer (-1..1, in steps).
  const [lookAt, setLookAt] = useState(0);
  const frame = useRef<HTMLDivElement>(null);
  const [sky, setSky] = useState<Sky>("calm");
  const n = g?.items.length ?? 0;
  const isl = islandSize(n);
  const home = homeSpot(n);
  const door = { x: home.x, y: home.y + 5 };
  const [pet, setPet] = useState<Pt | null>(null);
  const [facing, setFacing] = useState(0);
  const [walking, setWalking] = useState(false);
  const [love, setLove] = useState(false);
  // Inside its cottage (napping by day, asleep at night).
  const [inside, setInside] = useState(false);
  const insideRef = useRef(false);
  const busy = useRef(0);
  const awake = useRef(0);
  const petAt = useRef<Pt | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const later = (fn: () => void, ms: number) => timers.current.push(setTimeout(fn, ms));
  const isNight = () => {
    const h = new Date().getHours();
    return h < 6 || h >= 19;
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the clock and the sky, read on mount
    setNight(isNight());
    setPhase(phaseNow());
    setSky((window as unknown as { __hmSky?: Sky }).__hmSky ?? "calm");
    const on = (e: Event) => setSky((e as CustomEvent<{ sky: Sky }>).detail?.sky ?? "calm");
    window.addEventListener("hivemind:sky", on);
    const all = timers.current;
    const done = setTimeout(() => setIntro(false), 2600);
    // On a phone, tilting it moves the layers (no permission prompt: skipped where one is needed).
    let raf = 0;
    const tilt = (e: DeviceOrientationEvent) => {
      if (e.gamma == null || e.beta == null) return;
      const x = Math.max(-1, Math.min(1, e.gamma / 25));
      const y = Math.max(-1, Math.min(1, (e.beta - 45) / 25));
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setDepth(x, y));
    };
    if (matchMedia("(pointer: coarse)").matches) window.addEventListener("deviceorientation", tilt);
    return () => {
      window.removeEventListener("hivemind:sky", on);
      window.removeEventListener("deviceorientation", tilt);
      cancelAnimationFrame(raf);
      clearTimeout(done);
      all.forEach(clearTimeout);
    };
  }, []);

  /** Parallax: near layers slide further than far ones (set as CSS variables, no re-render). */
  function setDepth(x: number, y: number) {
    frame.current?.style.setProperty("--px", x.toFixed(3));
    frame.current?.style.setProperty("--py", y.toFixed(3));
  }
  function onPointer(e: React.PointerEvent<HTMLDivElement>) {
    if (e.pointerType !== "mouse") return;
    const r = e.currentTarget.getBoundingClientRect();
    const fx = (e.clientX - r.left) / r.width;
    const fy = (e.clientY - r.top) / r.height;
    setDepth((fx - 0.5) * 2, (fy - 0.5) * 2);
    // Nova turns its eyes towards the pointer.
    const at = petAt.current;
    if (at) {
      const v = Math.round(Math.max(-1, Math.min(1, (fx * W - at.x) / 160)) * 3) / 3;
      setLookAt((o) => (o === v ? o : v));
    }
  }

  function walkTo(to: Pt) {
    const from = petAt.current;
    if (from) setFacing(Math.sign(to.x - from.x));
    petAt.current = to;
    setPet(to);
    setWalking(true);
    later(() => {
      setWalking(false);
      setFacing(0);
    }, 2400);
  }
  function enter(v: boolean) {
    insideRef.current = v;
    setInside(v);
  }
  /** A free spot on the island to stroll to (not into the cottage). */
  function strollSpot(): Pt {
    const { cx, cy, rx, ry } = isl;
    for (;;) {
      const a = Math.random() * Math.PI * 2;
      const r = 0.15 + Math.random() * 0.55;
      const to = { x: cx + Math.cos(a) * r * rx, y: cy + Math.sin(a) * r * ry };
      if (to.y > home.y + 22 || Math.abs(to.x - home.x) > 95) return to;
    }
  }
  function goHome(napMs: number) {
    busy.current = Date.now() + 2600 + napMs;
    walkTo(door);
    later(() => enter(true), 2450);
  }
  function comeOut(then?: Pt) {
    enter(false);
    busy.current = Date.now() + 3200;
    later(() => walkTo(then ?? strollSpot()), 450);
  }

  // Its day: strolls about, now and then goes home for a nap; at night it sleeps in its cottage.
  const islKey = `${isl.cx},${isl.cy},${isl.rx}`;
  useEffect(() => {
    if (!g) return;
    const sleeping = isNight();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- it starts at its door once the island is known
    setPet(door);
    petAt.current = door;
    enter(sleeping);
    if (!sleeping) later(() => comeOut(), 900);
    let t: ReturnType<typeof setTimeout>;
    const tick = () => {
      t = setTimeout(
        () => {
          if (Date.now() > busy.current) {
            const nightNow = isNight() && Date.now() > awake.current;
            if (insideRef.current) {
              if (!nightNow) comeOut();
            } else if (nightNow || Math.random() < 0.16) goHome(nightNow ? 0 : 6000 + Math.random() * 4000);
            else walkTo(strollSpot());
          }
          tick();
        },
        4500 + Math.random() * 3500,
      );
    };
    tick();
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-plan only when the island itself changes
  }, [g, islKey]);

  function tap(p: Placed) {
    setSel(p);
    setBurst({ x: p.x, y: p.y - 12, k: Date.now() });
    // The pet goes to look at it, and loves it.
    const to = { x: p.x + (p.x > isl.cx ? -26 : 26), y: p.y + 4 };
    const wait = insideRef.current ? 450 : 0;
    if (insideRef.current) {
      awake.current = Date.now() + 40_000;
      enter(false);
    }
    busy.current = Date.now() + 6000 + wait;
    later(() => walkTo(to), wait);
    later(() => {
      setLove(true);
      later(() => setLove(false), 1800);
    }, 2400 + wait);
  }

  function tapHome() {
    const name = g?.pet ?? "Nova";
    setBurst({ x: home.x, y: home.y - 40, k: Date.now() });
    if (insideRef.current) {
      // Knock knock: it comes out (and stays up a while, even at night).
      awake.current = Date.now() + 40_000;
      setSel({ id: "home", x: home.x, y: home.y - 50, label: `🏠 ${name}'s cottage · ${name} is coming out!` });
      comeOut();
    } else {
      setSel({ id: "home", x: home.x, y: home.y - 50, label: `🏠 ${name}'s cottage · time for a nap 💤` });
      awake.current = 0;
      goHome(8000);
    }
  }

  const selId = sel?.id;
  const field = useMemo(() => {
    const draw = (list: typeof chunks) =>
      list.map((ch) =>
        ch.kind === "one" ? (
          <Item key={ch.p.id} p={ch.p} night={night} picked={selId === ch.p.id} delay={bloom.get(ch.p.id) ?? 0} onTap={tap} />
        ) : (
          <g key={ch.key} className="garden-wind" style={{ transformOrigin: `${ch.x}px ${ch.y}px`, animationDelay: `${(ch.x / W) * 1.8 - 12 + hash01(ch.key) * 0.4}s` }}>
            {ch.ps.map((p) => (
              <Item key={p.id} p={p} night={night} picked={selId === p.id} delay={bloom.get(p.id) ?? 0} onTap={tap} />
            ))}
          </g>
        ),
      );
    const yOf = (ch: (typeof chunks)[number]) => (ch.kind === "one" ? ch.p.y : ch.y);
    return { back: draw(chunks.filter((ch) => yOf(ch) < home.y)), front: draw(chunks.filter((ch) => yOf(ch) >= home.y)) };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- tap only uses refs and setters
  }, [chunks, night, selId, bloom, home.y]);

  useVoiceActions({
    garden_describe: {
      description: "Nova's garden page: what has grown on the island (flowers from habits, trees from night check-ins, lamps from lantern walks, gems from game wins, butterflies from songs).",
      run: () => (g ? { ...g.counts, pet: g.pet, note: "Say it warmly in one or two sentences." } : { error: "The garden is still loading." }),
    },
  });

  const wet = sky === "rain" || sky === "thunder";
  const c = g?.counts;
  const rim = { x: isl.cx + isl.rx * 0.86, y: isl.cy + isl.ry * 0.5 };
  const pal = wet ? (night ? SKY.night : { top: "#18273a", mid: "#2a3c50", low: "#4a5d72" }) : SKY[phase];
  const sun = !wet && !night ? SKY[phase].sun : undefined;
  // Far things take on the colour of the air.
  const haze = night ? "#18264a" : wet ? "#55687e" : pal.low;

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader eyebrow="Pocket pet" title={`${g?.pet ?? "Nova"}'s garden`} subtitle="Everything you keep up with grows here. Tap anything on the island: Nova will go and have a look." />
      <ErrorText error={feed.error} />

      {/*
        Built from stacked layers so the moving parts are cheap: the graphics card slides whole layers
        (clouds, stars, rain, the floating island) instead of redrawing the scene every frame.
      */}
      <div
        ref={frame}
        data-garden
        role="img"
        aria-label={`${g?.pet ?? "Nova"}'s garden`}
        onPointerMove={onPointer}
        onPointerLeave={() => setDepth(0, 0)}
        className="relative aspect-[1000/640] overflow-hidden rounded-2xl border border-line shadow-[0_20px_60px_-20px_rgba(0,0,0,.6)] select-none"
      >
        {/* The sky: a still picture (gradient, sun or moon, a sea of clouds far below). */}
        <svg viewBox={`0 0 ${W} ${H}`} className="absolute inset-0 h-full w-full">
          <defs>
            <linearGradient id="g-sky" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={pal.top} />
              <stop offset="0.62" stopColor={pal.mid} />
              <stop offset="1" stopColor={pal.low} />
            </linearGradient>
            <radialGradient id="g-sun">
              <stop offset="0" stopColor={sun?.glow ?? "#fff"} stopOpacity="0.6" />
              <stop offset="1" stopColor={sun?.glow ?? "#fff"} stopOpacity="0" />
            </radialGradient>
            <linearGradient id="g-haze" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={haze} stopOpacity="0" />
              <stop offset="1" stopColor={night ? "#24345c" : "#ffffff"} stopOpacity={night ? 0.5 : 0.45} />
            </linearGradient>
          </defs>
          <rect width={W} height={H} fill="url(#g-sky)" />
          {night ? (
            <>
              <circle cx="840" cy="90" r="90" fill="#dfe6ff" opacity="0.06" />
              <circle cx="840" cy="90" r="34" fill="#f1f3f9" opacity="0.94" />
              <circle cx="852" cy="82" r="30" fill={pal.top} opacity="0.9" />
              <circle cx="826" cy="98" r="3" fill="#cfd6e6" opacity="0.6" />
            </>
          ) : (
            sun && (
              <>
                <circle cx={sun.x} cy={sun.y} r="150" fill="url(#g-sun)" />
                <circle cx={sun.x} cy={sun.y} r="44" fill={sun.c} opacity="0.95" />
                <circle cx={sun.x - 12} cy={sun.y - 12} r="18" fill="#fff" opacity="0.18" />
              </>
            )
          )}
          {/* Haze towards the horizon and a sea of clouds far below the island. */}
          <rect y={H * 0.55} width={W} height={H * 0.45} fill="url(#g-haze)" />
          {Array.from({ length: 14 }, (_, i) => (
            <ellipse key={i} cx={i * 80 - 20 + hash01(`sc${i}`) * 30} cy={H - 10 + hash01(`sy${i}`) * 18} rx={70 + hash01(`sr${i}`) * 40} ry={30 + hash01(`sq${i}`) * 14} fill={night ? "#26355a" : wet ? "#8495a8" : "#ffffff"} opacity={night ? 0.55 : 0.6} />
          ))}
        </svg>

        <div className="garden-depth absolute inset-0 pointer-events-none" style={{ ["--k" as string]: 3 }}>
        {/* Faraway islands, drifting in the haze. */}
        {[
          [150, 430, 62, 9, 0],
          [905, 480, 44, 11, 3],
          [640, 265, 20, 8, 5],
        ].map(([x, y, r, dur, d], i) => (
          <svg key={i} viewBox={`0 0 ${W} ${H}`} className="garden-bob pointer-events-none absolute inset-0 h-full w-full" style={{ animationDuration: `${dur}s`, animationDelay: `${-d}s` }} opacity={night ? 0.8 : 0.55}>
            <path d={`M ${x - r} ${y} Q ${x - r * 0.4} ${y + r * 1.4} ${x} ${y + r * 1.6} Q ${x + r * 0.5} ${y + r * 1.2} ${x + r} ${y} Z`} fill={night ? "#121c36" : haze} style={{ filter: "brightness(0.7)" }} />
            <ellipse cx={x} cy={y} rx={r} ry={r * 0.28} fill={night ? "#1a2a40" : haze} style={{ filter: "brightness(0.85) saturate(1.4)" }} />
            <circle cx={x - r * 0.35} cy={y - r * 0.32} r={r * 0.3} fill={night ? "#16263a" : haze} style={{ filter: "brightness(0.75) saturate(1.6)" }} />
            <circle cx={x + r * 0.2} cy={y - r * 0.25} r={r * 0.22} fill={night ? "#16263a" : haze} style={{ filter: "brightness(0.8) saturate(1.6)" }} />
          </svg>
        ))}

        {/* Twinkling stars: three layers fading in turn. */}
        {night &&
          [0, 1, 2].map((k) => (
            <svg key={k} viewBox={`0 0 ${W} ${H}`} className="garden-twinkle absolute inset-0 h-full w-full" style={{ animationDelay: `${-k * 1.3}s`, animationDuration: `${3.4 + k * 0.9}s` }}>
              {Array.from({ length: 24 }, (_, j) => {
                const i = j * 3 + k;
                return <circle key={i} cx={(i * 263 + 37) % W} cy={(i * 97 + 11) % 330} r={(i % 4) * 0.4 + 0.6} fill="#fff" />;
              })}
            </svg>
          ))}
        {night && (
          <svg viewBox={`0 0 ${W} ${H}`} className="garden-shoot absolute inset-0 h-full w-full">
            <line x1="0" y1="0" x2="70" y2="18" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" opacity="0.85" />
          </svg>
        )}
        {/* Northern lights, some nights. */}
        {night && !wet && (
          <svg viewBox={`0 0 ${W} ${H}`} className="garden-aurora absolute inset-0 h-full w-full">
            <defs>
              <linearGradient id="g-aur" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#7dffc8" stopOpacity="0" />
                <stop offset="0.5" stopColor="#7dffc8" stopOpacity="0.35" />
                <stop offset="1" stopColor="#7dffc8" stopOpacity="0" />
              </linearGradient>
              <linearGradient id="g-aur2" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#b48cff" stopOpacity="0" />
                <stop offset="0.5" stopColor="#b48cff" stopOpacity="0.28" />
                <stop offset="1" stopColor="#b48cff" stopOpacity="0" />
              </linearGradient>
            </defs>
            <path d="M -220 150 C 150 50 300 170 500 90 S 850 30 1220 110 L 1220 190 C 850 110 650 220 500 170 S 150 140 -220 230 Z" fill="url(#g-aur)" />
            <path d="M -220 80 C 200 10 380 120 560 50 S 880 0 1220 60 L 1220 120 C 880 60 700 160 540 110 S 200 80 -220 150 Z" fill="url(#g-aur2)" />
          </svg>
        )}
        {/* A rainbow by day when the sky is clear. */}
        {sun && (phase === "day" || phase === "golden") && (
          <svg viewBox={`0 0 ${W} ${H}`} className="garden-beam absolute inset-0 h-full w-full" style={{ animationDuration: "12s" }}>
            {["#ff6b6b", "#ffa94d", "#ffe066", "#69db7c", "#4dabf7", "#9775fa"].map((c, i) => (
              <path key={c} d={`M ${-150 + i * 7} ${H} A ${400 - i * 7} ${400 - i * 7} 0 0 1 ${650 - i * 7} ${H}`} stroke={c} strokeWidth="7" fill="none" opacity="0.2" />
            ))}
          </svg>
        )}
        </div>
        {/* Slowly turning sun rays, on a square layer around the sun. */}
        {sun && (
          <svg viewBox="-240 -240 480 480" className="garden-rays absolute" style={{ left: `${(sun.x / W) * 100 - 24}%`, top: `${(sun.y / H) * 100 - 37.5}%`, width: "48%", aspectRatio: "1" }}>
            {Array.from({ length: 12 }, (_, i) => {
              const a = (i * Math.PI) / 6;
              return <path key={i} d={`M 0 0 L ${Math.cos(a) * 240} ${Math.sin(a) * 240} L ${Math.cos(a + 0.09) * 240} ${Math.sin(a + 0.09) * 240} Z`} fill="#fff3c4" opacity="0.07" />;
            })}
          </svg>
        )}
        <div className="garden-depth absolute inset-0 pointer-events-none" style={{ ["--k" as string]: 7 }}>
        {/* Clouds, far ones slow and faint, near ones faster: each on its own sliding layer. */}
        {[
          [90, 70, 0.6, 120],
          [520, 52, 0.45, 150],
          [300, 150, 1, 75],
          [760, 120, 0.85, 90],
        ].map(([x, y, s, dur], i) => (
          <svg key={i} viewBox={`0 0 ${W} ${H}`} className="garden-cloud absolute inset-0 h-full w-full" style={{ animationDuration: `${dur}s`, animationDelay: `${-((x + 150) / 1300) * dur}s` }} opacity={wet ? 0.8 : night ? 0.22 : s < 0.7 ? 0.45 : 0.65}>
            <g transform={`translate(100 ${y}) scale(${s})`}>
              <ellipse cx="0" cy="10" rx="70" ry="17" fill={wet ? "#9aabbd" : "#eef5fb"} />
              <ellipse cx="-25" cy="0" rx="34" ry="20" fill={wet ? "#a3b3c4" : "#f4f9fd"} />
              <ellipse cx="22" cy="-4" rx="40" ry="24" fill={wet ? "#aab9c9" : "#ffffff"} />
            </g>
          </svg>
        ))}
        {/* A few birds crossing the sky by day. */}
        {!night && !wet && (
          <svg viewBox={`0 0 ${W} ${H}`} className="garden-birds pointer-events-none absolute inset-0 h-full w-full">
            {[
              [0, 150, 1],
              [-26, 138, 0.8],
              [-22, 166, 0.75],
              [-50, 128, 0.6],
            ].map(([x, y, s], i) => (
              <g key={i} transform={`translate(${x} ${y}) scale(${s})`}>
                <path d="M -9 0 Q -4 -6 0 0 Q 4 -6 9 0" stroke={phase === "dusk" ? "#2a1830" : "#1d2b3a"} strokeWidth="2" fill="none" strokeLinecap="round" className="garden-flap" style={{ animationDelay: `${-i * 0.17}s` }} />
              </g>
            ))}
          </svg>
        )}
        </div>
        <div className="garden-depth absolute inset-0 pointer-events-none" style={{ ["--k" as string]: 11 }}>
        {/* Little rocks floating around the island, each bobbing in its own time. */}
        {[
          [isl.cx - isl.rx - 50, isl.cy + 60, 16, 0],
          [isl.cx + isl.rx + 40, isl.cy + 20, 12, 1.4],
          [isl.cx - isl.rx * 0.55, isl.cy + isl.depth + 20, 10, 2.6],
        ].map(([x, y, r, d], i) => (
          <svg key={i} viewBox={`0 0 ${W} ${H}`} className="garden-bob pointer-events-none absolute inset-0 h-full w-full" style={{ animationDelay: `${-d}s`, animationDuration: `${5 + i}s` }}>
            <path d={`M ${x - r} ${y} Q ${x} ${y + r * 1.6} ${x + r} ${y} Z`} fill="#5a3e27" />
            <ellipse cx={x} cy={y} rx={r} ry={r * 0.45} fill={night ? "#2c5a33" : "#4ea547"} />
          </svg>
        ))}

        </div>
        {/* The island and everything on it (the pet too), floating as one layer. */}
        <div className="garden-depth absolute inset-0" style={{ ["--k" as string]: 14 }}>
        <div className="garden-rise absolute inset-0">
        <div className="garden-bob absolute inset-0">
          <svg viewBox={`0 0 ${W} ${H}`} className="absolute inset-0 h-full w-full">
            <defs>
              <radialGradient id="g-grass" cx="45%" cy="35%" r="70%">
                <stop offset="0" stopColor={night ? "#4a8a55" : "#86d672"} />
                <stop offset="0.7" stopColor={night ? "#2f6339" : "#4ea547"} />
                <stop offset="1" stopColor={night ? "#244c2c" : "#3a8a39"} />
              </radialGradient>
              <linearGradient id="g-rock" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#8a6440" />
                <stop offset="0.5" stopColor="#5a3e27" />
                <stop offset="1" stopColor="#24180f" />
              </linearGradient>
              <radialGradient id="g-glow">
                <stop offset="0" stopColor="#ffd166" stopOpacity="0.95" />
                <stop offset="1" stopColor="#ffd166" stopOpacity="0" />
              </radialGradient>
              <radialGradient id="g-crystal">
                <stop offset="0" stopColor="currentColor" stopOpacity="1" />
                <stop offset="1" stopColor="currentColor" stopOpacity="0" />
              </radialGradient>
              <linearGradient id="g-water" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#bfe8ff" stopOpacity="0.95" />
                <stop offset="1" stopColor="#7cc4ff" stopOpacity="0" />
              </linearGradient>
            </defs>
            <path
              d={`M ${isl.cx - isl.rx} ${isl.cy} Q ${isl.cx - isl.rx * 0.8} ${isl.cy + isl.depth * 0.85} ${isl.cx - isl.rx * 0.3} ${isl.cy + isl.depth * 0.94} L ${isl.cx} ${isl.cy + isl.depth} L ${isl.cx + isl.rx * 0.3} ${isl.cy + isl.depth * 0.92} Q ${isl.cx + isl.rx * 0.85} ${isl.cy + isl.depth * 0.8} ${isl.cx + isl.rx} ${isl.cy} Z`}
              fill="url(#g-rock)"
            />
            {/* Rock facets: light from the upper left. */}
            {Array.from({ length: 7 }, (_, k) => {
              const x0 = isl.cx - isl.rx + (k * 2 * isl.rx) / 7;
              const x1 = x0 + (2 * isl.rx) / 7;
              const tip = { x: isl.cx + ((x0 + x1) / 2 - isl.cx) * 0.35, y: isl.cy + isl.depth * (0.75 + hash01(`fc${k}`) * 0.2) };
              return <path key={k} d={`M ${x0} ${isl.cy + 8} L ${x1} ${isl.cy + 8} L ${tip.x} ${tip.y} Z`} fill={k % 2 ? "#000" : "#fff"} opacity={k % 2 ? 0.1 : 0.05} />;
            })}
            {/* Rock strata. */}
            {[0.3, 0.55].map((f) => (
              <path key={f} d={`M ${isl.cx - isl.rx * (0.95 - f * 0.5)} ${isl.cy + isl.depth * f * 0.6} Q ${isl.cx} ${isl.cy + isl.depth * f * 0.9} ${isl.cx + isl.rx * (0.95 - f * 0.5)} ${isl.cy + isl.depth * f * 0.55}`} stroke="#3d2a1a" strokeOpacity="0.35" strokeWidth="2" fill="none" />
            ))}
            {[-0.5, -0.15, 0.2, 0.55].map((f, i) => (
              <path key={i} d={`M ${isl.cx + f * isl.rx} ${isl.cy + isl.depth * 0.6} q 6 ${20 + i * 6} -2 ${40 + i * 8}`} stroke="#3d2a1a" strokeWidth="2" fill="none" className="garden-root" style={{ animationDelay: `${-i}s` }} />
            ))}
            {/* Crystals in the rock: they glow at night. */}
            {[
              [-0.4, 0.58, 190],
              [0.1, 0.78, 280],
              [0.48, 0.52, 160],
            ].map(([f, d, hue], i) => {
              const x = isl.cx + f * isl.rx;
              const y = isl.cy + isl.depth * d;
              return (
                <g key={i}>
                  {night && (
                    <g opacity="0.3">
                      <circle cx={x} cy={y - 8} r="24" fill="url(#g-crystal)" style={{ color: `hsl(${hue} 90% 70%)` }} className="garden-flicker" />
                    </g>
                  )}
                  <path d={`M ${x - 7} ${y} L ${x - 4} ${y - 16} L ${x} ${y - 22} L ${x + 3} ${y - 14} L ${x + 2} ${y} Z`} fill={`hsl(${hue} 80% ${night ? 72 : 62}%)`} />
                  <path d={`M ${x + 1} ${y} L ${x + 5} ${y - 11} L ${x + 9} ${y - 6} L ${x + 8} ${y} Z`} fill={`hsl(${hue} 70% ${night ? 62 : 50}%)`} />
                  <path d={`M ${x - 3} ${y - 4} L ${x - 1} ${y - 17}`} stroke="#fff" strokeOpacity="0.6" strokeWidth="1.2" />
                </g>
              );
            })}
            {/* Vines hanging off the rim, swaying. */}
            {[-0.78, -0.55, -0.2, 0.3, 0.62].map((f, i) => {
              const x = isl.cx + f * isl.rx;
              const y = isl.cy + isl.ry * Math.sqrt(1 - f * f) + 6;
              const len = 34 + hash01(`vn${i}`) * 50;
              return (
                <g key={i} className="garden-root" style={{ animationDelay: `${-i * 0.8}s`, animationDuration: `${4 + i * 0.5}s` }}>
                  <path d={`M ${x} ${y} q 6 ${len * 0.5} -2 ${len}`} stroke={night ? "#2c5a33" : "#3f8f45"} strokeWidth="1.8" fill="none" />
                  {Array.from({ length: Math.floor(len / 12) }, (_, k) => (
                    <ellipse key={k} cx={x + (k % 2 ? 3.5 : -2)} cy={y + 8 + k * 11} rx="3.4" ry="2" fill={night ? "#34683c" : "#55b34f"} transform={`rotate(${k % 2 ? 30 : -30} ${x + (k % 2 ? 3.5 : -2)} ${y + 8 + k * 11})`} />
                  ))}
                  {i % 2 === 0 && <circle cx={x - 2} cy={y + len} r="2.6" fill={night ? "#c9a7ff" : "#ff9ec4"} />}
                </g>
              );
            })}
            {/* The waterfall off the right edge. */}
            <path d={`M ${rim.x} ${rim.y} q 10 40 6 ${H - rim.y + 12}`} stroke="url(#g-water)" strokeWidth="14" fill="none" opacity="0.75" />
            <path d={`M ${rim.x} ${rim.y} q 10 40 6 ${H - rim.y + 12}`} stroke="#ffffff" strokeWidth="3" fill="none" strokeDasharray="10 18" className="garden-flow" opacity="0.7" />
            <path d={`M ${rim.x - 4} ${rim.y} q 9 40 5 ${H - rim.y + 12}`} stroke="#d8f1ff" strokeWidth="2" fill="none" strokeDasharray="6 22" className="garden-flow" style={{ animationDuration: "0.9s" }} opacity="0.6" />
            {/* Where it starts: a little foam on the rim. */}
            {[0, 1, 2].map((i) => (
              <circle key={i} cx={rim.x + 2 + (i - 1) * 5} cy={rim.y + 4} r="6" fill="#ffffff" opacity="0.7" className="garden-splash" style={{ animationDelay: `${-i * 0.45}s` }} />
            ))}

            {/* The grass lip curling over the front edge. */}
            {Array.from({ length: 28 }, (_, i) => {
              const a = 0.04 + (i / 27) * (Math.PI - 0.08);
              return <ellipse key={i} cx={isl.cx + Math.cos(a) * isl.rx * 0.985} cy={isl.cy + Math.sin(a) * isl.ry + 7} rx={13 + hash01(`lip${i}`) * 6} ry={8 + hash01(`lq${i}`) * 5} fill={night ? "#244c2c" : "#2e6b33"} />;
            })}
            <ellipse cx={isl.cx} cy={isl.cy + 6} rx={isl.rx} ry={isl.ry} fill="#2e6b33" />
            <ellipse cx={isl.cx} cy={isl.cy} rx={isl.rx} ry={isl.ry} fill="url(#g-grass)" />
            <ellipse cx={isl.cx - isl.rx * 0.2} cy={isl.cy - isl.ry * 0.35} rx={isl.rx * 0.55} ry={isl.ry * 0.35} fill="#ffffff" opacity={night ? 0.03 : 0.08} />
            {/* Grass tufts. */}
            {Array.from({ length: 44 }, (_, i) => {
              const a = hash01(`tf${i}`) * Math.PI * 2;
              const r = 0.2 + Math.sqrt(hash01(`tr${i}`)) * 0.72;
              const x = isl.cx + Math.cos(a) * r * isl.rx;
              const y = isl.cy + Math.sin(a) * r * isl.ry;
              return <path key={i} d={`M ${x - 4} ${y} q 1 -5 3 -8 M ${x} ${y} q 0 -6 1 -10 M ${x + 4} ${y} q -1 -5 -3 -7`} stroke={night ? "#3a7a44" : "#3f9a42"} strokeWidth="1.4" fill="none" strokeLinecap="round" />;
            })}
            {/* Stepping stones from the cottage door down to the edge. */}
            {Array.from({ length: Math.max(0, Math.floor((isl.cy + isl.ry * 0.9 - door.y - 8) / 17)) }, (_, i) => {
              const y = door.y + 10 + i * 17;
              const x = pathX(n, y) + (i % 2 ? 4 : -4);
              const w = 11 + i * 0.5;
              return (
                <g key={i}>
                  <ellipse cx={x} cy={y + 1.5} rx={w} ry={w * 0.4} fill="#000" opacity="0.18" />
                  <ellipse cx={x} cy={y} rx={w} ry={w * 0.4} fill={night ? "#9a9384" : "#e2d6bd"} />
                  <ellipse cx={x - w * 0.25} cy={y - 1} rx={w * 0.45} ry={w * 0.14} fill="#fff" opacity="0.25" />
                </g>
              );
            })}

            {/* Flowers sway in wind groups (a row across part of the island); the gust rolls left to right. */}
            {field.back}
            <Cottage x={home.x} y={home.y} s={Math.min(1.25, Math.max(0.95, isl.rx / 300))} lit={night || inside} night={night} sleeping={inside && night} name={g?.pet ?? "Nova"} onTap={tapHome} />
            {field.front}

            {wet &&
              Array.from({ length: 16 }, (_, i) => {
                const a = hash01(`r${i}`) * Math.PI * 2;
                const r = Math.sqrt(hash01(`q${i}`)) * 0.9;
                return <ellipse key={i} cx={isl.cx + Math.cos(a) * r * isl.rx} cy={isl.cy + Math.sin(a) * r * isl.ry} rx="7" ry="2.2" fill="none" stroke="#cfe9ff" strokeWidth="1" className="garden-splash" style={{ animationDelay: `${-hash01(`w${i}`) * 1.4}s` }} />;
              })}

            {/* Butterflies from the songs played: wing flaps on a wandering path. */}
            {Array.from({ length: g?.butterflies ?? 0 }, (_, i) => {
              const hue = (i * 47 + 300) % 360;
              const y0 = isl.cy - 60 - (i % 4) * 22;
              return (
                <g key={i}>
                  <g className="garden-wing-l">
                    <path d="M0 0 C -9 -12 -16 -4 -10 2 C -14 8 -6 10 0 2" fill={`hsl(${hue} 85% 68%)`} />
                  </g>
                  <g className="garden-wing-r">
                    <path d="M0 0 C 9 -12 16 -4 10 2 C 14 8 6 10 0 2" fill={`hsl(${hue} 85% 74%)`} />
                  </g>
                  <ellipse cx="0" cy="1" rx="1.2" ry="4" fill="#2b2b2b" />
                  <animateMotion
                    dur={`${16 + i * 3}s`}
                    repeatCount="indefinite"
                    rotate="0"
                    begin={`${-i * 2.3}s`}
                    path={`M ${isl.cx - isl.rx * 0.7} ${y0} C ${isl.cx - 150} ${y0 - 110} ${isl.cx + 40} ${y0 + 60} ${isl.cx + 120} ${y0 - 30} S ${isl.cx + isl.rx * 0.8} ${y0 - 70} ${isl.cx + isl.rx * 0.6} ${y0 + 10} S ${isl.cx - 60} ${y0 + 40} ${isl.cx - isl.rx * 0.7} ${y0}`}
                  />
                </g>
              );
            })}
          </svg>

          {/* The pet, walking around its island (moved with transforms only: smooth and cheap). */}
          {g && pet && (
            <div
              className="pointer-events-none absolute top-0 left-0"
              style={{
                width: "10%",
                aspectRatio: "1",
                // Width is 10% of the frame and height equals width, so these percentages land on (x, y).
                transform: `translate(calc(${(pet.x / W) * 1000}% - 50%), calc(${(pet.y / H) * 640}% - 88%))`,
                transition: "transform 2.4s cubic-bezier(.45,.05,.35,1)",
                willChange: "transform",
              }}
            >
              <div className="h-full w-full" style={{ opacity: inside ? 0 : 1, transform: inside ? "scale(0.55) translateY(-6%)" : "none", transformOrigin: "50% 90%", transition: "opacity .45s ease, transform .45s ease" }}>
                <div className="absolute inset-x-[18%] bottom-[6%] h-[10%] rounded-[50%] bg-black/25 blur-[2px]" />
                {walking &&
                  [0, 1, 2].map((i) => <span key={i} className="garden-dust absolute bottom-[6%] left-1/2 h-[9%] w-[9%] rounded-full bg-white/60" style={{ animationDelay: `${i * 0.18}s` }} />)}
                <div className={walking ? "garden-walk h-full w-full" : love ? "garden-hop h-full w-full" : "h-full w-full"}>
                  <Creature stage={g.stage} mood={night ? "sleepy" : "happy"} look={{ x: walking ? facing * 2.4 : lookAt * 2.4, y: 0 }} eating={love} evolving={false} poked={false} sky={sky} />
                </div>
              </div>
            </div>
          )}

          {burst && (
            <div key={burst.k} className="pointer-events-none absolute" style={{ left: `${(burst.x / W) * 100}%`, top: `${(burst.y / H) * 100}%` }}>
              {Array.from({ length: 8 }, (_, i) => (
                <span key={i} className="garden-burst absolute h-1.5 w-1.5 rounded-full" style={{ ["--a" as string]: `${i * 45}deg`, background: i % 2 ? "#ffe08a" : "#ffffff", boxShadow: "0 0 6px #ffe08a" }} />
              ))}
            </div>
          )}
          {/* What the tapped thing is, right next to it. */}
          {sel && (
            <div key={sel.id} className="pet-pop pointer-events-none absolute -translate-x-1/2 rounded-lg border border-line bg-[#0b1016]/90 px-2.5 py-1 text-xs whitespace-nowrap text-fg shadow-lg" style={{ left: `${(sel.x / W) * 100}%`, top: `calc(${(sel.y / H) * 100}% - 64px)` }}>
              {sel.label}
            </div>
          )}
        </div>

        </div>
        </div>
        <div className="garden-depth absolute inset-0 pointer-events-none" style={{ ["--k" as string]: 20 }}>
        {/* Fireflies at night: small glowing dots, each its own drifting layer. */}
        {night &&
          Array.from({ length: 16 }, (_, i) => (
            <div
              key={i}
              className="garden-firefly pointer-events-none absolute rounded-full"
              style={{
                left: `${((isl.cx + (hash01(`fx${i}`) - 0.5) * isl.rx * 2) / W) * 100}%`,
                top: `${((isl.cy - 30 - hash01(`fy${i}`) * 160) / H) * 100}%`,
                width: "1.4%",
                aspectRatio: "1",
                background: "radial-gradient(circle, #f4ffb8 0%, #e9ff9a 25%, rgba(233,255,154,0) 70%)",
                animationDelay: `${-hash01(`fd${i}`) * 9}s`,
                animationDuration: `${7 + hash01(`fs${i}`) * 6}s`,
              }}
            />
          ))}
        {/* Petals and leaves drifting past on the breeze (by day). */}
        {!night &&
          !wet &&
          Array.from({ length: 9 }, (_, i) => (
            <span
              key={i}
              className="garden-petal pointer-events-none absolute"
              style={{
                left: `${20 + hash01(`pl${i}`) * 90}%`,
                top: "-4%",
                width: "1%",
                aspectRatio: "1.4",
                borderRadius: "70% 0 70% 0",
                background: i % 3 ? `hsl(${330 + i * 6} 85% 80%)` : "#8fd16e",
                animationDuration: `${11 + hash01(`pd${i}`) * 9}s`,
                animationDelay: `${-hash01(`pe${i}`) * 20}s`,
              }}
            />
          ))}
        </div>
        {/* Soft beams of light through the air. */}
        {sun && (
          <div
            className="garden-beam pointer-events-none absolute inset-0"
            style={{ background: `linear-gradient(${sun.x > 500 ? 245 : 115}deg, transparent 30%, ${sun.glow}22 38%, transparent 46%, transparent 55%, ${sun.glow}18 61%, transparent 68%)` }}
          />
        )}
        <div className="garden-depth absolute inset-0 pointer-events-none" style={{ ["--k" as string]: 28 }}>
        {/* Mist drifting in front of the island's underside. */}
        <svg viewBox={`0 0 ${W} ${H}`} className="garden-cloud pointer-events-none absolute inset-0 h-full w-full" style={{ animationDuration: "140s", animationDelay: "-60s" }} opacity={night ? 0.45 : 0.6}>
          <defs>
            <radialGradient id="g-mist">
              <stop offset="0" stopColor={night ? "#2c3c64" : "#ffffff"} stopOpacity="0.9" />
              <stop offset="1" stopColor={night ? "#2c3c64" : "#ffffff"} stopOpacity="0" />
            </radialGradient>
          </defs>
          {[0, 1, 2, 3].map((i) => (
            <ellipse key={i} cx={40 + i * 70} cy={H - 8 + (i % 2) * 10} rx={110} ry={34} fill="url(#g-mist)" />
          ))}
        </svg>

        </div>
        {/* Rain: two sheets of drops sliding down (near ones faster), looping seamlessly. */}
        {wet &&
          [
            [46, 0.75, 0.5, 1.3],
            [34, 1.25, 0.28, 1],
          ].map(([n, dur, op, sw], k) => (
            <svg key={k} viewBox={`0 0 ${W} ${H * 2}`} className="garden-rain pointer-events-none absolute left-0 w-full" style={{ top: "-100%", height: "200%", animationDuration: `${dur}s` }}>
              {Array.from({ length: n * 2 }, (_, j) => {
                const i = (j % n) * 2 + k;
                const x = (i * 173 + k * 61) % W;
                const y = ((i * 59) % H) + (j >= n ? H : 0);
                return <line key={j} x1={x} y1={y} x2={x - 6} y2={y + 22} stroke="#a5d8ff" strokeOpacity={op} strokeWidth={sw} strokeLinecap="round" />;
              })}
            </svg>
          ))}

        {/* The opening: a curtain of cloud parting to show the island. */}
        {intro &&
          [-1, 1].map((side) => (
            <svg key={side} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className={`${side < 0 ? "garden-part-l" : "garden-part-r"} pointer-events-none absolute inset-0 h-full w-full`}>
              {Array.from({ length: 9 }, (_, i) => (
                <ellipse key={i} cx={side < 0 ? 120 + (i % 3) * 140 : 880 - (i % 3) * 140} cy={40 + i * 72} rx={260 - (i % 3) * 40} ry={120} fill={night ? "#2a3756" : "#f4f8fc"} />
              ))}
            </svg>
          ))}
        {/* A soft vignette, so the eye lands on the island. */}
        <div className="pointer-events-none absolute inset-0" style={{ background: "radial-gradient(ellipse at 50% 45%, transparent 55%, rgba(0,0,0,.32) 100%)" }} />
        {g && !g.items.length && (
          <div className="pointer-events-none absolute inset-x-0 bottom-6 text-center text-sm text-fg/90">The island is waiting. Finish a habit today to plant the first flower 🌱</div>
        )}
      </div>

      <div className="mt-4 flex flex-wrap gap-2 text-xs">
        {[
          ["🌸", c?.flowers ?? 0, "flowers", "a day a habit was done"],
          ["🌳", c?.trees ?? 0, "trees", "4 night check-ins each"],
          ["🏮", c?.lamps ?? 0, "lamps", "lantern walks"],
          ["💎", c?.gems ?? 0, "gems", "games won"],
          ["🦋", c?.butterflies ?? 0, "butterflies", "songs you played"],
        ].map(([e, n, what, why]) => (
          <span key={String(what)} className="rounded-full border border-line px-3 py-1.5" title={String(why)}>
            {e} <b>{n}</b> {what} <span className="text-faint">· {why}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/** The pet's cottage: warm windows when it's home or dark out, smoke from the chimney, Zzz while it sleeps. */
function Cottage({ x, y, s, lit, night, sleeping, name, onTap }: { x: number; y: number; s: number; lit: boolean; night: boolean; sleeping: boolean; name: string; onTap: () => void }) {
  const glass = lit ? "#ffd27a" : night ? "#1d2a44" : "#9fd3f0";
  const wall = night ? "#c9b48f" : "#f4e2bd";
  const roof = night ? "#9c3f2e" : "#d45a40";
  return (
    <g onClick={onTap} className="cursor-pointer">
      {/* Name sign by the path. */}
      <g transform={`translate(${x + 74 * s} ${y + 16})`}>
        <rect x="-1.5" y="-22" width="3" height="22" fill="#6b4226" />
        <rect x="-24" y="-34" width="48" height="16" rx="3" fill="#a9763f" stroke="#6b4226" strokeWidth="1.5" />
        <text x="0" y="-22.5" textAnchor="middle" fontSize="10" fontWeight="700" fill="#fff6e0" style={{ fontFamily: "inherit" }}>
          {name.length > 8 ? `${name.slice(0, 7)}…` : name}
        </text>
      </g>
      <g transform={`translate(${x} ${y}) scale(${s})`}>
        <ellipse cx="0" cy="3" rx="62" ry="10" fill="#000" opacity="0.22" />
        {lit && <ellipse cx="0" cy="-22" rx="70" ry="40" fill="url(#g-glow)" opacity={night ? 0.35 : 0.12} />}
        {/* Chimney and its smoke (or the Zzz of a sleeping pet). */}
        <rect x="20" y="-92" width="13" height="30" fill="#8a5a44" />
        <rect x="18" y="-95" width="17" height="5" rx="1.5" fill="#6e4636" />
        {sleeping
          ? [0, 1, 2].map((i) => (
              <text key={i} x="34" y="-100" fontSize={9 + i * 3} fontWeight="700" fill="#dfe8ff" className="garden-zzz" style={{ animationDelay: `${i * 1.1}s` }}>
                z
              </text>
            ))
          : [0, 1, 2].map((i) => <circle key={i} cx="27" cy="-100" r={4 + i} fill="#ffffff" opacity="0.5" className="garden-smoke" style={{ animationDelay: `${i * 1.3}s` }} />)}
        {/* Walls, stone footing, shading. */}
        <path d="M -44 0 L -44 -48 L 44 -48 L 44 0 Z" fill={wall} />
        <path d="M 22 0 L 22 -48 L 44 -48 L 44 0 Z" fill="#000" opacity="0.07" />
        <path d="M -47 2 Q 0 6 47 2 L 47 -7 Q 0 -4 -47 -7 Z" fill="#a39684" />
        {[-36, -18, 0, 18, 36].map((sx) => (
          <ellipse key={sx} cx={sx} cy="-2" rx="7" ry="3" fill="#8c806f" opacity="0.6" />
        ))}
        {/* Roof with shingle rows and a little round attic window. */}
        <path d="M -60 -42 L 0 -96 L 60 -42 Q 0 -36 -60 -42 Z" fill={roof} />
        <path d="M -60 -42 L 0 -96 L 60 -42" fill="none" stroke="#7a2f22" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
        {[-58, -72].map((ry, i) => (
          <path key={ry} d={`M ${-30 + i * 14} ${ry + 2} Q 0 ${ry + 6} ${30 - i * 14} ${ry + 2}`} stroke="#000" strokeOpacity="0.15" strokeWidth="2" fill="none" />
        ))}
        <circle cx="0" cy="-64" r="7" fill={glass} stroke="#7a2f22" strokeWidth="2" />
        {/* Windows with boxes of flowers. */}
        {[-28, 28].map((wx) => (
          <g key={wx}>
            <rect x={wx - 9} y="-36" width="18" height="16" rx="3" fill={glass} stroke="#7a5a3a" strokeWidth="2" />
            <path d={`M ${wx} -36 L ${wx} -20 M ${wx - 9} -28 L ${wx + 9} -28`} stroke="#7a5a3a" strokeWidth="1.5" />
            <rect x={wx - 11} y="-19" width="22" height="5" rx="1.5" fill="#8a5a3a" />
            {[-7, -2, 3, 8].map((fx, k) => (
              <circle key={fx} cx={wx + fx} cy="-20" r="2.4" fill={["#ff8fab", "#ffd166", "#9bf6ff", "#ff8fab"][k]} />
            ))}
          </g>
        ))}
        {/* Round-topped door with a lantern beside it. */}
        <path d="M -11 0 L -11 -24 A 11 11 0 0 1 11 -24 L 11 0 Z" fill="#7a4a2a" stroke="#5a341c" strokeWidth="2" />
        <circle cx="6" cy="-12" r="1.6" fill="#ffd166" />
        <rect x="14" y="-30" width="6" height="8" rx="2" fill={lit ? "#ffcf6b" : "#c9a86a"} stroke="#6b4226" strokeWidth="1" />
      </g>
    </g>
  );
}

/** A flower's head; each habit has its own kind: daisy, tulip, pompom or sunflower. */
function Bloom({ kind, hue, night }: { kind: number; hue: number; night: boolean }) {
  const c = `hsl(${hue} 80% ${night ? 62 : 70}%)`;
  const dark = `hsl(${hue} 70% ${night ? 48 : 56}%)`;
  if (kind === 1)
    return (
      <g>
        <path d="M -5.5 -21 Q -6.5 -12 0 -11 Q 6.5 -12 5.5 -21 L 2.7 -17 L 0 -22.5 L -2.7 -17 Z" fill={c} />
        <path d="M 0 -22.5 L -2.7 -17 L 0 -12 Z" fill={dark} opacity="0.6" />
      </g>
    );
  if (kind === 2)
    return (
      <g>
        <circle cx="0" cy="-18" r="6" fill={dark} />
        <circle cx="-1.6" cy="-19.5" r="4.4" fill={c} />
        <circle cx="-2.6" cy="-21" r="1.6" fill="#fff" opacity="0.55" />
      </g>
    );
  if (kind === 3)
    return (
      <g>
        {Array.from({ length: 10 }, (_, i) => (
          <ellipse key={i} cx="0" cy="-23" rx="1.7" ry="4.2" fill={c} transform={`rotate(${i * 36} 0 -17)`} />
        ))}
        <circle cx="0" cy="-17" r="3.4" fill="#6b3f1d" />
        <circle cx="-1" cy="-18" r="1.2" fill="#a0683a" />
      </g>
    );
  return (
    <g>
      {[0, 72, 144, 216, 288].map((a) => (
        <ellipse key={a} cx={Math.cos((a * Math.PI) / 180) * 4.4} cy={-17 + Math.sin((a * Math.PI) / 180) * 4.4} rx="3.8" ry="3.2" transform={`rotate(${a} ${Math.cos((a * Math.PI) / 180) * 4.4} ${-17 + Math.sin((a * Math.PI) / 180) * 4.4})`} fill={c} />
      ))}
      <circle cx="0" cy="-17" r="2.5" fill="#ffd43b" />
    </g>
  );
}

/** One tappable thing, popping in at its bloom time. */
function Item({ p, night, picked, delay, onTap }: { p: Placed; night: boolean; picked: boolean; delay: number; onTap: (p: Placed) => void }) {
  return (
    <g onClick={() => onTap(p)} className="cursor-pointer">
      <g className="garden-pop" style={{ animationDelay: `${delay}s` }}>
        <Thing p={p} night={night} picked={picked} />
      </g>
    </g>
  );
}

/** One thing on the island. Flowers move with their wind group; trees, lamps and gems have their own life. */
function Thing({ p, night, picked }: { p: Placed; night: boolean; picked: boolean }) {
  const { x, y } = p;
  const phase = hash01(p.id, 3);
  const sway = { animationDelay: `${-(phase * 3) + (x / W) * 2.2}s`, animationDuration: `${4.4 + phase * 1.8}s` };
  if (p.kind === "flower") {
    const s = 0.85 + phase * 0.35;
    // Leaning a little either way, so a field of them doesn't look planted with a ruler.
    const lean = (hash01(p.id, 5) - 0.5) * 14;
    return (
      <g transform={`translate(${x} ${y}) scale(${s}) rotate(${lean})`}>
        <g className={picked ? "garden-boing" : ""}>
          <ellipse cx="0" cy="0.5" rx="4" ry="1.3" fill="#000" opacity="0.15" />
          <path d="M 0 0 q 2 -8 0 -16" stroke="#3c8d3a" strokeWidth="2" fill="none" />
          <path d="M 0 -6 q 6 -2 7 -6 q -5 0 -7 4" fill="#4caf50" />
          <Bloom kind={Math.floor(hash01(p.id.split(":")[1] ?? "", 11) * 4)} hue={p.hue} night={night} />
        </g>
      </g>
    );
  }
  if (p.kind === "tree") {
    const s = 0.55 + p.size * 0.65;
    const kind = hash01(p.id, 9);
    if (kind > 0.45)
      return (
        <g transform={`translate(${x} ${y}) scale(${s})`} opacity={p.size < 1 ? 0.88 : 1}>
          <ellipse cx="0" cy="2" rx="16" ry="5" fill="#000" opacity="0.18" />
          <rect x="-3.5" y="-16" width="7" height="16" rx="2" fill="#5e3a22" />
          {kind > 0.75 ? (
            // A blossom tree.
            <g className="garden-canopy" style={sway}>
              <rect x="-3.5" y="-34" width="7" height="20" rx="2" fill="#6b4226" />
              <circle cx="0" cy="-46" r="20" fill={night ? "#a0607e" : "#f4a6c4"} />
              <circle cx="-14" cy="-36" r="13" fill={night ? "#8e5270" : "#ec8fb4"} />
              <circle cx="14" cy="-38" r="13" fill={night ? "#a86a88" : "#f8b9d0"} />
              <circle cx="-6" cy="-54" r="8" fill="#ffffff" opacity={night ? 0.05 : 0.25} />
              {[-10, 4, 12, -2].map((bx, k) => (
                <circle key={k} cx={bx} cy={-40 - k * 4} r="2" fill="#fff" opacity="0.7" />
              ))}
            </g>
          ) : (
            // A pine.
            <g className="garden-canopy" style={sway}>
              {[0, 1, 2].map((k) => (
                <path key={k} d={`M ${-20 + k * 4} ${-12 - k * 15} L 0 ${-40 - k * 15} L ${20 - k * 4} ${-12 - k * 15} Z`} fill={night ? ["#1f4a2c", "#245532", "#2a5e38"][k] : ["#2d7a42", "#348a4b", "#3d9a55"][k]} />
              ))}
              <path d="M -2 -66 L 0 -72 L 2 -66 Z" fill="#fff" opacity={night ? 0.1 : 0.35} />
            </g>
          )}
        </g>
      );
    return (
      <g transform={`translate(${x} ${y}) scale(${s})`} opacity={p.size < 1 ? 0.88 : 1}>
        <ellipse cx="0" cy="2" rx="18" ry="5" fill="#000" opacity="0.18" />
        <rect x="-4" y="-34" width="8" height="34" rx="2" fill="#6b4226" />
        <g className="garden-canopy" style={sway}>
          <circle cx="0" cy="-48" r="21" fill={night ? "#2f6b3a" : "#3f9a4b"} />
          <circle cx="-14" cy="-37" r="14" fill={night ? "#2a5f34" : "#378a42"} />
          <circle cx="14" cy="-39" r="14" fill={night ? "#336f3e" : "#46a653"} />
          <circle cx="-6" cy="-56" r="9" fill="#ffffff" opacity={night ? 0.04 : 0.12} />
        </g>
      </g>
    );
  }
  if (p.kind === "lamp")
    return (
      <g>
        <ellipse cx={x} cy={y + 1} rx="8" ry="2.5" fill="#000" opacity="0.2" />
        <circle cx={x} cy={y - 30} r={night ? 24 : 13} fill="url(#g-glow)" className="garden-flicker" style={{ animationDelay: `${-phase * 3}s` }} />
        <line x1={x} y1={y} x2={x} y2={y - 26} stroke="#4a3b2a" strokeWidth="2.5" />
        <rect x={x - 5} y={y - 37} width="10" height="12" rx="3" fill="#ffcf6b" stroke="#7a5a2a" strokeWidth="1.2" className="garden-flicker" style={{ animationDelay: `${-phase * 3}s` }} />
      </g>
    );
  return (
    <g>
      <ellipse cx={x} cy={y + 1} rx="6" ry="2" fill="#000" opacity="0.18" />
      <g className="garden-float" style={{ animationDelay: `${-phase * 4}s` }}>
        <path d={`M ${x} ${y - 18} L ${x + 7} ${y - 10} L ${x} ${y - 2} L ${x - 7} ${y - 10} Z`} fill={`hsl(${p.hue} 85% 65%)`} stroke={`hsl(${p.hue} 70% 40%)`} strokeWidth="1" />
        <path d={`M ${x - 3} ${y - 12} L ${x} ${y - 16}`} stroke="#fff" strokeWidth="1.2" opacity="0.85" />
        <path d={`M ${x + 9} ${y - 20} l 1.5 -4 l 1.5 4 l 4 1.5 l -4 1.5 l -1.5 4 l -1.5 -4 l -4 -1.5 Z`} fill="#fff" className="garden-sparkle" style={{ animationDelay: `${-phase * 5}s` }} />
      </g>
    </g>
  );
}
