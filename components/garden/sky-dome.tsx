"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { bodyAt, compass, sunAltAz, tonightSky, type BodyId } from "@/lib/astro";
import { NightSky, type SkyMap, type SkyObject, type TourSpec } from "./night-sky";
import { SkyCard } from "./sky-card";

/**
 * What opens when the telescope is tapped: the real sky over Chennai, full screen. Drag to look around, scroll or pinch
 * to zoom, scrub the time from sunset to dawn and watch the stars turn, tap the Moon or a planet to fly to it and look
 * through the eyepiece.
 */
const HOUR = 3600_000;
const IST = 5.5 * HOUR;
const clock = (ms: number) => new Date(ms).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" });
const NOW_YEAR = new Date().getFullYear();
/** How long ago the light you see left it, in words. */
function lightStory(ly: number) {
  if (ly < 1.2) return "Its light reaches you in about a year.";
  if (ly < 1000) return `The light you see left it about ${Math.round(ly)} years ago, around the year ${NOW_YEAR - Math.round(ly)}.`;
  if (ly < 1e6) return `The light you see left it about ${(Math.round(ly / 100) * 100).toLocaleString("en-US")} years ago, before written history.`;
  return `The light you see left it about ${(ly / 1e6).toFixed(1)} million years ago, long before humans existed.`;
}
const howBright = (m: number) => (m <= 0 ? "among the brightest in the sky" : m <= 2 ? "bright and easy to spot" : m <= 4.5 ? "easy to see from a dark place" : m <= 6.5 ? "only just visible from a dark place" : "needs binoculars or a telescope");
const distance = (ly: number) => (ly >= 1e6 ? `${(ly / 1e6).toFixed(1)} million light-years` : `${ly.toLocaleString("en-US")} light-years`);

type Stop = { title: string; text: string | ((moonLit: number) => string); spec: TourSpec; fov: number };
/** A guided tour of what is worth looking at, in the order a guide would show it. Only what is above the horizon at the time is used. */
const TOUR: Stop[] = [
  { title: "The Moon", spec: { kind: "body", id: "moon" }, fov: 10, text: (lit) => `Tonight's Moon is about ${lit}% lit. Look at its dark side: it glows faintly. That is earthshine, sunlight that bounced off Earth and back.` },
  { title: "Jupiter", spec: { kind: "body", id: "jupiter" }, fov: 10, text: "The biggest planet. Through even a small telescope you can see four of its moons, which Galileo spotted in 1610. Its Great Red Spot is a storm wider than Earth that has lasted centuries." },
  { title: "Saturn", spec: { kind: "body", id: "saturn" }, fov: 10, text: "Its rings are 280,000 km across but mostly under a kilometre thick. Saturn is so light for its size that it would float in water, if you could find a big enough bath." },
  { title: "Venus", spec: { kind: "body", id: "venus" }, fov: 10, text: "The brightest planet, wrapped in clouds that trap heat. It is hotter than Mercury, about 465 °C at the surface." },
  { title: "Mars", spec: { kind: "body", id: "mars" }, fov: 10, text: "Red because its dust is rusted iron. A day on Mars is 24 hours 37 minutes, almost the same as ours." },
  { title: "The Pleiades", spec: { kind: "dso", id: "M 45" }, fov: 12, text: "The Seven Sisters: a cluster of young, hot, blue stars about 440 light-years away. They are only around 100 million years old, born while dinosaurs were alive." },
  { title: "Orion Nebula", spec: { kind: "dso", id: "M 42" }, fov: 12, text: "The fuzzy middle \"star\" of Orion's sword is a cloud of gas 1,350 light-years away where new stars are being born right now." },
  { title: "Betelgeuse", spec: { kind: "star", name: "Betelgeuse" }, fov: 16, text: "The red shoulder of Orion is a dying giant star. Put it where the Sun is and it would swell past the orbit of Mars. One day it will explode." },
  { title: "Sirius", spec: { kind: "star", name: "Sirius" }, fov: 16, text: "The brightest star in the night sky, and one of our closest neighbours at 8.6 light-years. Its light left in the year 2017." },
  { title: "Andromeda Galaxy", spec: { kind: "dso", id: "M 31" }, fov: 10, text: "The most distant thing you can see with your own eyes: 2.5 million light-years away. It is falling towards us and will merge with the Milky Way in about 4.5 billion years." },
  { title: "Heart of the Milky Way", spec: { kind: "eq", ra: 266.42, dec: -29 }, fov: 50, text: "This direction is the centre of our galaxy, 26,000 light-years away. A black hole four million times heavier than the Sun sits in the middle of that glow." },
  { title: "Polaris, the North Star", spec: { kind: "star", name: "Polaris" }, fov: 20, text: "It barely moves while everything else turns. From Chennai it sits just 13° above the northern horizon, exactly the city's latitude." },
  { title: "Canopus", spec: { kind: "star", name: "Canopus" }, fov: 20, text: "The second-brightest star of all. From Chennai it only just peeks over the southern horizon, never rising more than about 24° high." },
];

const MAP_URL: Record<BodyId, string> = { moon: "/sky/moon.jpg", mercury: "/sky/mercury.jpg", venus: "/sky/venus_atmosphere.jpg", mars: "/sky/mars.jpg", jupiter: "/sky/jupiter.jpg", saturn: "/sky/saturn.jpg" };
const SPIN_S: Record<BodyId, number> = { moon: 0, mercury: 40, venus: 30, mars: 20, jupiter: 9, saturn: 11 };

/** A little turning globe: the real map, a spherical shading, and the phase as the Sun lights it. */
function Globe({ id, lit, waxing, size = 34 }: { id: BodyId; lit: number; waxing: boolean; size?: number }) {
  const dir = waxing ? -1 : 1;
  const phase = lit < 0.985 && id !== "jupiter" && id !== "saturn" ? `radial-gradient(circle ${size / 2}px at ${size / 2 + dir * lit * size}px 50%, rgba(2,4,10,0.94) 96%, transparent 100%), ` : "";
  const shade = "radial-gradient(circle at 34% 30%, rgba(255,255,255,0.26), transparent 42%), radial-gradient(circle at 50% 50%, transparent 48%, rgba(0,0,0,0.65) 100%)";
  const spin = SPIN_S[id] > 0;
  const mapStyle = {
    backgroundImage: `url(${MAP_URL[id]})`,
    backgroundSize: `${size * 2}px ${size}px`,
    backgroundRepeat: "repeat-x",
    backgroundPosition: spin ? undefined : `${-size / 2}px 0`,
    animation: spin ? `globeSpin ${SPIN_S[id]}s linear infinite` : undefined,
    "--w": `${-size * 2}px`,
  } as React.CSSProperties;
  return (
    <span className="relative grid shrink-0 place-items-center" style={{ width: size, height: size }} aria-hidden>
      <span className="relative block overflow-hidden rounded-full" style={{ width: size, height: size, boxShadow: `0 0 12px ${BODY_DOT[id]}77` }}>
        <span className="absolute inset-0" style={mapStyle} />
        <span className="absolute inset-0" style={{ backgroundImage: phase + shade }} />
      </span>
      {id === "saturn" && <span className="absolute top-1/2 left-1/2 h-[36%] w-[178%] -translate-x-1/2 -translate-y-1/2 -rotate-[16deg] rounded-[50%] border-2 border-amber-100/70" />}
    </span>
  );
}

/** The surface temperature from a star's B-V colour (kelvin). */
const kelvinOf = (bv: number) => Math.round((4600 * (1 / (0.92 * bv + 1.7) + 1 / (0.92 * bv + 0.62))) / 100) * 100;
function TempBar({ bv }: { bv: number }) {
  const T = kelvinOf(bv);
  const at = (k: number) => Math.min(1, Math.max(0, (Math.log(k) - Math.log(2500)) / (Math.log(25000) - Math.log(2500))));
  return (
    <div className="mt-3">
      <div className="relative h-2 rounded-full" style={{ background: "linear-gradient(90deg,#ff7a3d,#ffb05a,#ffe9b8,#ffffff,#cfe0ff,#8fb4ff)" }}>
        <span className="absolute -top-1 h-4 w-px bg-white/70" style={{ left: `${at(5800) * 100}%` }} />
        <span className="absolute -top-1.5 h-5 w-1 rounded bg-white shadow ring-2 ring-black/40" style={{ left: `${at(T) * 100}%` }} />
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-white/50">
        <span>cooler</span>
        <span>{T.toLocaleString("en-US")} K · thin tick = our Sun</span>
        <span>hotter</span>
      </div>
    </div>
  );
}

const BODY_DOT: Record<BodyId, string> = { moon: "#fff3d6", mercury: "#cfc6b8", venus: "#fffaf0", mars: "#ff9a6a", jupiter: "#ffe2b0", saturn: "#f3dca4" };

/** The sky in the Sun's light: what to call this moment of the evening (or the morning). */
function skyPhase(sunAlt: number, morning: boolean) {
  if (sunAlt > 0) return "Daylight";
  if (sunAlt > -6) return morning ? "Sunrise glow" : "Sunset";
  if (sunAlt > -12) return morning ? "Dawn" : "Dusk";
  if (sunAlt > -18) return morning ? "First light" : "Late dusk";
  return "Dark night";
}

/** The whole sky at once, as if lying on your back looking up: the zenith in the middle, the horizon round the edge. */
function drawMap(cv: HTMLCanvasElement | null, m: SkyMap, az: number, alt: number, fov: number) {
  const c = cv?.getContext("2d");
  if (!cv || !c) return;
  const W = cv.width;
  const cx = W / 2;
  const R = W / 2 - 22;
  c.clearRect(0, 0, W, W);
  const P = (a: number, h: number): [number, number] => {
    const r = (R * (90 - Math.max(0, h))) / 90;
    const t = (a * Math.PI) / 180;
    return [cx - r * Math.sin(t), cx - r * Math.cos(t)];
  };
  c.lineWidth = 1.5;
  c.strokeStyle = "rgba(255,255,255,0.13)";
  for (const h of [0, 30, 60]) {
    c.beginPath();
    c.arc(cx, cx, (R * (90 - h)) / 90, 0, Math.PI * 2);
    c.stroke();
  }
  for (let i = 0; i < m.stars.length; i += 3) {
    const [x, y] = P(m.stars[i], m.stars[i + 1]);
    const mg = m.stars[i + 2];
    c.fillStyle = `rgba(210,225,255,${Math.max(0.25, Math.min(1, 1 - (mg - 1) * 0.2))})`;
    c.beginPath();
    c.arc(x, y, Math.max(1.1, 3.4 - mg * 0.6), 0, Math.PI * 2);
    c.fill();
  }
  // Where the view points.
  const [vx, vy] = P(az, alt);
  c.strokeStyle = "rgba(255,214,122,0.95)";
  c.lineWidth = 2.5;
  c.beginPath();
  c.arc(vx, vy, Math.max(7, (R * (fov / 2)) / 90), 0, Math.PI * 2);
  c.stroke();
  for (const b of m.bodies) {
    if (b.alt < 0) continue;
    const [x, y] = P(b.az, b.alt);
    c.fillStyle = BODY_DOT[b.id];
    c.shadowColor = BODY_DOT[b.id];
    c.shadowBlur = 10;
    c.beginPath();
    c.arc(x, y, b.id === "moon" ? 7 : 5, 0, Math.PI * 2);
    c.fill();
    c.shadowBlur = 0;
  }
  c.fillStyle = "rgba(255,225,185,0.8)";
  c.font = "600 17px system-ui, sans-serif";
  c.textAlign = "center";
  c.textBaseline = "middle";
  c.fillText("N", cx, 11);
  c.fillText("S", cx, W - 11);
  c.fillText("E", 11, cx);
  c.fillText("W", W - 11, cx);
}

export function SkyDome({ onAim, onClose }: { onAim: (az: number, alt: number) => void; onClose: () => void }) {
  const { sky, from, to } = useMemo(() => {
    const now = new Date();
    const s = tonightSky(now);
    // Sunset to dawn around this night: 5:30 pm to 6 am, Chennai time.
    const ist = s.when.getTime() + IST;
    const midnight = Math.floor((ist - 12 * HOUR) / (24 * HOUR)) * 24 * HOUR - IST; // the Chennai midnight that starts this evening's date (before noon counts as the night before)
    return { sky: s, from: midnight + 16.75 * HOUR, to: midnight + 30 * HOUR };
  }, []);
  const start = Math.min(to, Math.max(from, sky.when.getTime()));

  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<NightSky | null>(null);
  const [failed, setFailed] = useState(false);
  const [sel, setSel] = useState<BodyId | null>(null);
  const [t, setT] = useState(start);
  const [view, setView] = useState({ az: 150, alt: 38, fov: 72 });
  const [playing, setPlaying] = useState(false);
  const [lines, setLines] = useState(true);
  const [names, setNames] = useState(true);
  const [hint, setHint] = useState(true);
  const [guides, setGuides] = useState(false);
  const [city, setCity] = useState(false);
  const [obj, setObj] = useState<SkyObject | null>(null);
  const [sunAlt, setSunAlt] = useState(-30);
  const [intro, setIntro] = useState(false);
  const [note, setNote] = useState("");
  /** The sky's clock when the card was opened, so the card describes that moment. */
  const [selAt, setSelAt] = useState(0);
  const mapRef = useRef<HTMLCanvasElement>(null);
  const [tour, setTour] = useState<{ stops: Array<{ title: string; text: string; spec: TourSpec; fov: number }>; i: number } | null>(null);
  const [tourPaused, setTourPaused] = useState(false);
  const [idle, setIdle] = useState(false);
  const [fullLight, setFullLight] = useState(false);
  const aim = useRef(onAim);
  const selRef = useRef<BodyId | null>(null);
  useEffect(() => {
    aim.current = onAim;
    selRef.current = sel;
  });

  useEffect(() => {
    // A fresh canvas each time (a canvas whose WebGL context was handed back can't be reused).
    const cv = document.createElement("canvas");
    cv.className = "block h-full w-full";
    host.current?.appendChild(cv);
    let ns: NightSky | null = null;
    try {
      ns = new NightSky(cv, start, {
        onTick: (v) => {
          setView({ az: v.az, alt: v.alt, fov: v.fov });
          setT(v.time);
          setSunAlt(v.sunAlt);
          drawMap(mapRef.current, v.map, v.az, v.alt, v.fov);
          // Looped past dawn: back to sunset.
          if (v.time > to) ns?.setTime(from);
        },
        onIntroDone: () => {
          setIntro(false);
          setPlaying(false);
        },
        onPick: (id) => {
          setObj(null);
          setSelAt(Math.round((ns?.time ?? 0) / 60000) * 60000);
          setSel(id);
          ns?.focus(id);
        },
        onPickObject: (o) => {
          setSel(null);
          setObj(o);
        },
      });
      scene.current = ns;
      // Open looking at the best thing in the sky.
      const best = sky.bodies.find((b) => b.alt > 8);
      const bestAz = best ? best.az : 160;
      const bestAlt = best ? Math.max(30, Math.min(55, best.alt)) : 40;
      if (start - from > 30 * 60_000) {
        // Open on the setting Sun, then swing round to the evening sky as the stars come out.
        const sa = sunAltAz(new Date(from));
        ns.setView(sa.az, 14, 82);
        setTimeout(() => ns?.flyTo(bestAz, bestAlt, 74), 5200);
      } else ns.flyTo(bestAz, bestAlt, 74);
      // The opening: it starts at sunset and runs on to now, so the stars and planets come out while you watch.
      if (start - from > 30 * 60_000) {
        ns.setTime(from);
        ns.playTo(start, 1500);
        setTimeout(() => {
          setIntro(true);
          setPlaying(true);
        }, 0);
      }
    } catch {
      setTimeout(() => setFailed(true), 0);
    }
    const h = setTimeout(() => setHint(false), 9000);
    return () => {
      clearTimeout(h);
      ns?.dispose();
      scene.current = null;
      cv.remove();
    };
  }, [start, from, to, sky]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !selRef.current) onClose();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose]);

  /** Go to something: if it is not up yet, jump to the time tonight when it is. */
  const goTo = (id: BodyId) => {
    const ns = scene.current;
    if (!ns) return;
    setObj(null);
    const name = sky.bodies.find((b) => b.id === id)?.name ?? id;
    if (bodyAt(id, new Date(ns.time)).alt <= 4) {
      let first: number | null = null;
      let top = -90;
      let topAt = from;
      for (let ms = from; ms <= to; ms += 10 * 60_000) {
        const a = bodyAt(id, new Date(ms)).alt;
        if (a > top) {
          top = a;
          topAt = ms;
        }
        if (first == null && a > 10) first = ms;
      }
      if (top < 4) {
        setNote(`${name} doesn't clear the horizon tonight.`);
        setTimeout(() => setNote(""), 4500);
        return;
      }
      const when = first ?? topAt;
      ns.setPlaying(false);
      setPlaying(false);
      setIntro(false);
      ns.setTime(when);
      setT(when);
      setNote(`${name} isn't up yet. Jumped to ${clock(when)}.`);
      setTimeout(() => setNote(""), 4500);
    }
    setSelAt(Math.round(ns.time / 60000) * 60000);
    setSel(id);
    ns.focus(id);
  };
  const startTour = () => {
    const ns = scene.current;
    if (!ns) return;
    setObj(null);
    setSel(null);
    const dark = from + 2.5 * HOUR; // from about 7:15 pm the sky is dark
    const seen = (ms: number) => TOUR.filter((st) => (ns.locate(st.spec, ms)?.alt ?? -90) > 10);
    let at = Math.max(ns.time, dark);
    let n = seen(at).length;
    // Stay put unless another hour of the night shows clearly more.
    for (const h of [20, 22, 23.5, 25, 27, 29]) {
      const ms = from + (h - 16.75) * HOUR;
      if (ms < dark || ms > to) continue;
      const k = seen(ms).length;
      if (k >= n + 3) {
        at = ms;
        n = k;
      }
    }
    if (at !== ns.time) {
      ns.setPlaying(false);
      setPlaying(false);
      setIntro(false);
      ns.setTime(at);
      setT(at);
    }
    const lit = Math.round((sky.bodies.find((b) => b.id === "moon")?.illum ?? 0) * 100);
    const stops = seen(at)
      .slice(0, 10)
      .map((st) => ({ title: st.title, text: typeof st.text === "function" ? st.text(lit) : st.text, spec: st.spec, fov: st.fov }));
    if (stops.length === 0) return;
    setTourPaused(false);
    setTour({ stops, i: 0 });
  };
  const endTour = () => {
    setTour(null);
    scene.current?.release();
  };
  const tourGo = (i: number) => {
    setTour((c) => (c ? { ...c, i: Math.max(0, Math.min(c.stops.length - 1, i)) } : c));
  };
  // Each stop: fly there, then move on after a while (unless paused).
  useEffect(() => {
    if (!tour) return;
    const st = tour.stops[tour.i];
    scene.current?.flyToSpec(st.spec, st.fov);
    if (tourPaused) return;
    const h = setTimeout(() => {
      if (tour.i + 1 < tour.stops.length) setTour({ ...tour, i: tour.i + 1 });
      else {
        setTour(null);
        scene.current?.release();
      }
    }, 13000);
    return () => clearTimeout(h);
  }, [tour, tourPaused]);
  // The controls fade away when you stop touching the screen, so the sky is all there is.
  useEffect(() => {
    let h: ReturnType<typeof setTimeout>;
    const wake = () => {
      setIdle(false);
      clearTimeout(h);
      h = setTimeout(() => setIdle(true), 6500);
    };
    wake();
    const ev = ["pointermove", "pointerdown", "keydown", "wheel", "touchstart"] as const;
    for (const e of ev) window.addEventListener(e, wake, { passive: true });
    return () => {
      clearTimeout(h);
      for (const e of ev) window.removeEventListener(e, wake);
    };
  }, []);
  // Where each body is at the time on the clock (to the minute).
  const minute = Math.floor(t / 60_000);
  const live = useMemo(() => new Map(sky.bodies.map((b) => [b.id, bodyAt(b.id, new Date(minute * 60_000))])), [minute, sky]);
  const morning = t > (from + to) / 2;
  const onMapTap = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const dx = e.clientX - r.left - r.width / 2;
    const dy = e.clientY - r.top - r.height / 2;
    const rr = Math.hypot(dx, dy) / ((r.width / 2) * (1 - 22 / (r.width))); // 1 = the horizon
    if (rr > 1.04) return;
    const az = ((Math.atan2(-dx, -dy) * 180) / Math.PI + 360) % 360;
    setObj(null);
    scene.current?.flyTo(az, Math.max(3, 90 - Math.min(1, rr) * 90), 62);
  };
  const toggle = (k: "lines" | "names" | "guides" | "city") => {
    if (k === "guides") {
      scene.current?.setGuides(!guides);
      setGuides(!guides);
    } else if (k === "city") {
      scene.current?.setCity(!city);
      setCity(!city);
    } else if (k === "lines") {
      scene.current?.setLines(!lines);
      setLines(!lines);
    } else {
      scene.current?.setNames(!names);
      setNames(!names);
    }
  };

  if (typeof document === "undefined") return null;
  const glass = "border border-white/12 bg-black/35 backdrop-blur-md";
  const fade = idle && !sel && !obj && !tour ? "pointer-events-none opacity-0" : "pointer-events-auto opacity-100";
  const ui = (
    <div className="fixed inset-0 z-[300] select-none overflow-hidden bg-black text-white" role="dialog" aria-label="Tonight's sky">
      <style>{`@keyframes globeSpin{from{background-position-x:0}to{background-position-x:var(--w)}}`}</style>
      <div ref={host} className="absolute inset-0" />
      {failed && <p className="absolute inset-0 grid place-items-center px-6 text-center text-sm text-white/70">This device can&apos;t draw the night sky (it needs WebGL).</p>}

      <div className="pointer-events-none absolute inset-x-0 top-0 flex flex-wrap items-start justify-between gap-3 p-4 sm:p-6">
        <div className="drop-shadow-[0_1px_6px_rgba(0,0,0,0.9)]">
          <p className="font-mono text-[10px] tracking-[0.32em] text-white/70 uppercase">Tonight over Chennai</p>
          <p className="mt-1 flex items-baseline gap-2 text-2xl font-light tracking-tight">
            {clock(t)}
            <span className="rounded-full border border-white/15 bg-black/30 px-2 py-0.5 font-mono text-[10px] tracking-widest text-amber-200/90 uppercase">{skyPhase(sunAlt, morning)}</span>
          </p>
          <p className="mt-0.5 text-xs text-white/60">
            Looking {compass(view.az)} · {Math.round(Math.max(0, view.alt))}° up · {Math.round(view.fov)}° wide
          </p>
        </div>
        <div className={`flex max-w-full flex-wrap items-center justify-end gap-2 transition-opacity duration-700 ${fade}`}>
          <button onClick={tour ? endTour : startTour} aria-pressed={!!tour} className={`h-9 rounded-full bg-amber-200/90 px-3.5 text-xs font-semibold text-[#3b2f1e] shadow-lg hover:bg-amber-100 focus-visible:outline-2 focus-visible:outline-amber-200`}>
            {tour ? "End tour" : "✦ Tour tonight"}
          </button>
          <button onClick={() => toggle("city")} aria-pressed={city} title="See the sky as it is from the city, with the glare of street lights, or from a dark place" className={`h-9 rounded-full px-3 text-xs ${glass} ${city ? "text-amber-200" : "text-white/60"} focus-visible:outline-2 focus-visible:outline-amber-200`}>
            {city ? "City sky" : "Dark sky"}
          </button>
          <button onClick={() => toggle("guides")} aria-pressed={guides} title="The ecliptic (the road the Sun, Moon and planets follow) and the celestial equator" className={`h-9 rounded-full px-3 text-xs ${glass} ${guides ? "text-amber-200" : "text-white/60"} focus-visible:outline-2 focus-visible:outline-amber-200`}>
            Guides
          </button>
          <button onClick={() => toggle("lines")} aria-pressed={lines} className={`h-9 rounded-full px-3 text-xs ${glass} ${lines ? "text-amber-200" : "text-white/60"} focus-visible:outline-2 focus-visible:outline-amber-200`}>
            Constellations
          </button>
          <button onClick={() => toggle("names")} aria-pressed={names} className={`h-9 rounded-full px-3 text-xs ${glass} ${names ? "text-amber-200" : "text-white/60"} focus-visible:outline-2 focus-visible:outline-amber-200`}>
            Star names
          </button>
          <button onClick={onClose} aria-label="Close the sky" className={`grid h-11 w-11 place-items-center rounded-full ${glass} text-white/85 hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-amber-200`}>
            ✕
          </button>
        </div>
      </div>

      <div className={`absolute inset-x-0 bottom-0 flex flex-col items-center gap-2.5 p-3 pb-4 transition-opacity duration-700 sm:p-5 ${fade} ${sel ? "sm:right-[408px] sm:items-center" : ""} ${sel ? "max-sm:hidden" : ""}`}>
        {(hint || intro) && !sel && !tour && <p className="pointer-events-none rounded-full bg-black/40 px-3 py-1 text-[11px] text-white/70 backdrop-blur">{intro ? "The Sun sets over Chennai… watch the stars come out" : "Drag to look around · scroll to zoom · tap a planet, a star or the Moon"}</p>}
        {tour && (
          <div className={`w-full max-w-xl rounded-3xl p-4 ${glass} backdrop-blur-xl`} role="region" aria-label="Tour">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-mono text-[10px] tracking-[0.25em] text-amber-200/85 uppercase">
                  Tour · {tour.i + 1} of {tour.stops.length}
                </p>
                <p className="mt-0.5 text-lg font-semibold">{tour.stops[tour.i].title}</p>
              </div>
              <button onClick={endTour} aria-label="End the tour" className="-m-1.5 grid h-9 w-9 shrink-0 place-items-center rounded-full text-white/75 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-amber-200">
                ✕
              </button>
            </div>
            <p className="mt-1.5 text-sm leading-relaxed text-white/90">{tour.stops[tour.i].text}</p>
            <div className="mt-3 flex items-center gap-3">
              <button onClick={() => tourGo(tour.i - 1)} disabled={tour.i === 0} className="h-9 rounded-full bg-white/10 px-3 text-xs hover:bg-white/20 disabled:opacity-30 focus-visible:outline-2 focus-visible:outline-amber-200">
                Back
              </button>
              <div className="flex flex-1 items-center justify-center gap-1.5" aria-hidden>
                {tour.stops.map((_, k) => (
                  <span key={k} className={`h-1.5 rounded-full transition-all ${k === tour.i ? "w-5 bg-amber-200" : "w-1.5 bg-white/30"}`} />
                ))}
              </div>
              <button onClick={() => setTourPaused((p) => !p)} className="h-9 rounded-full bg-white/10 px-3 text-xs hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-amber-200">
                {tourPaused ? "Resume" : "Pause"}
              </button>
              <button onClick={() => (tour.i + 1 < tour.stops.length ? tourGo(tour.i + 1) : endTour())} className="h-9 rounded-full bg-amber-200/90 px-3.5 text-xs font-semibold text-[#3b2f1e] hover:bg-amber-100 focus-visible:outline-2 focus-visible:outline-amber-200">
                {tour.i + 1 < tour.stops.length ? "Next" : "Finish"}
              </button>
            </div>
          </div>
        )}
        {sel && (
          <div className="flex flex-wrap items-center justify-center gap-2">
            <span className="rounded-full bg-black/45 px-3 py-1.5 text-[11px] text-white/85 backdrop-blur">↻ Drag the planet to turn it round</span>
            <button
              onClick={() => {
                scene.current?.setFullLight(!fullLight);
                setFullLight(!fullLight);
              }}
              aria-pressed={fullLight}
              className={`h-8 rounded-full px-3 text-xs ${fullLight ? "border border-amber-200 bg-amber-200/90 text-[#3b2f1e]" : `${glass} text-white/85 hover:bg-white/15`} focus-visible:outline-2 focus-visible:outline-amber-200`}
            >
              {fullLight ? "Lit all round ✓" : "Light it all round"}
            </button>
            <button onClick={() => scene.current?.resetSpin()} className={`h-8 rounded-full px-3 text-xs text-white/85 hover:bg-white/15 ${glass} focus-visible:outline-2 focus-visible:outline-amber-200`}>
              Reset
            </button>
          </div>
        )}
        {note && <p role="status" className="rounded-full bg-amber-200/90 px-3.5 py-1.5 text-xs font-medium text-[#3b2f1e] shadow-lg">{note}</p>}
        <div className={`flex max-w-full gap-2 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none] ${tour ? "hidden" : ""}`}>
          {sky.bodies.map((b) => {
            const l = live.get(b.id);
            const up = !!l && l.alt > 0;
            return (
              <button
                key={b.id}
                onClick={() => goTo(b.id)}
                className={`w-[7.4rem] shrink-0 rounded-2xl px-3 py-2 text-left transition ${sel === b.id ? "border border-amber-200 bg-amber-200/90 text-[#3b2f1e]" : `${glass} ${up ? "text-white hover:bg-white/15" : "text-white/55 hover:bg-white/12"}`} focus-visible:outline-2 focus-visible:outline-amber-200`}
              >
                <span className="flex items-center gap-1.5 text-xs font-semibold">
                  <Globe id={b.id} lit={l?.illum ?? 1} waxing={l?.waxing ?? true} size={30} />
                  {b.id === "moon" ? "Moon" : b.name}
                  {up && <span aria-label="up now" className="ml-auto h-1.5 w-1.5 rounded-full bg-emerald-300 shadow-[0_0_6px_#6ee7b7]" />}
                </span>
                <span className="mt-0.5 block truncate text-[10px] opacity-80">
                  {up && l ? `${compass(l.az)} · ${Math.round(l.alt)}° up` : b.rises ? `Rises ${clock(b.rises.getTime())}` : "Not up tonight"}
                </span>
                {b.id === "moon" && l && <span className="block text-[10px] opacity-70">{Math.round(l.illum * 100)}% lit</span>}
              </button>
            );
          })}
        </div>
        <div className={`flex w-full max-w-xl items-center gap-3 rounded-full px-3 py-1.5 ${glass}`}>
          <button
            onClick={() => {
              scene.current?.setPlaying(!playing);
              setPlaying(!playing);
              setIntro(false);
            }}
            aria-label={playing ? "Pause time" : "Let the night run"}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/12 text-sm hover:bg-white/22 focus-visible:outline-2 focus-visible:outline-amber-200"
          >
            {playing ? "❚❚" : "▶"}
          </button>
          <span className="w-14 shrink-0 text-right font-mono text-[10px] text-white/55">4:45 pm</span>
          <input
            type="range"
            min={from}
            max={to}
            step={60_000}
            value={Math.min(to, Math.max(from, t))}
            onChange={(e) => {
              const v = Number(e.target.value);
              setT(v);
              scene.current?.setPlaying(false);
              setPlaying(false);
              setIntro(false);
              scene.current?.setTime(v);
            }}
            aria-label="Time of night"
            className="h-1.5 min-w-0 flex-1 cursor-pointer accent-amber-200"
          />
          <span className="w-14 shrink-0 font-mono text-[10px] text-white/55">6:00 am</span>
        </div>
      </div>

      {!sel && (
        <div className={`absolute top-[88px] right-4 hidden transition-opacity duration-700 sm:right-6 sm:block ${fade}`} aria-label="All-sky map">
          <canvas ref={mapRef} width={336} height={336} onClick={onMapTap} className={`h-[168px] w-[168px] cursor-crosshair rounded-full ${glass}`} />
          <p className="mt-1 text-center font-mono text-[9px] tracking-[0.25em] text-white/45 uppercase">All sky · tap to look</p>
        </div>
      )}

      {obj && (
        <div className={`absolute top-[12.5rem] left-4 sm:top-28 w-[min(21rem,calc(100%-2rem))] rounded-2xl p-4 ${glass} backdrop-blur-xl`} role="region" aria-label={obj.name}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-mono text-[10px] tracking-[0.25em] text-amber-200/80 uppercase">{obj.kind === "star" ? "Star" : "Deep sky"}</p>
              <p className="mt-0.5 text-lg font-semibold">{obj.name}</p>
              <p className="text-xs text-white/65">{obj.sub}</p>
            </div>
            <button onClick={() => setObj(null)} aria-label="Close" className="-m-1.5 grid h-9 w-9 shrink-0 place-items-center rounded-full text-white/75 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-amber-200">
              ✕
            </button>
          </div>
          <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
            {obj.con && (
              <>
                <dt className="text-white/50">Constellation</dt>
                <dd>{obj.con}</dd>
              </>
            )}
            {obj.mag != null && (
              <>
                <dt className="text-white/50">Brightness</dt>
                <dd>
                  {obj.mag.toFixed(1)} · {howBright(obj.mag)}
                </dd>
              </>
            )}
            {obj.dist != null && (
              <>
                <dt className="text-white/50">Distance</dt>
                <dd>{distance(obj.dist)}</dd>
              </>
            )}
            <dt className="text-white/50">Right now</dt>
            <dd>{obj.alt > 0 ? `${compass(obj.az)}, ${Math.round(obj.alt)}° up` : "below the horizon"}</dd>
          </dl>
          {obj.bv != null && <TempBar bv={obj.bv} />}
          {obj.dist != null && <p className="mt-3 border-t border-white/10 pt-2 text-sm text-amber-100/90">{lightStory(obj.dist)}</p>}
        </div>
      )}

      {sel && (
        <SkyCard
          initial={sel}
          at={selAt || undefined}
          onAim={onAim}
          onSelect={(id) => {
            setSel(id);
            scene.current?.focus(id);
          }}
          onClose={() => {
            setSel(null);
            scene.current?.release();
          }}
        />
      )}
    </div>
  );
  return createPortal(ui, document.body);
}
