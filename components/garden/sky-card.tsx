"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { brightness, compass, heightWords, moonPhaseName, tonightSky, type Body, type Sky } from "@/lib/astro";
import { Eyepiece } from "./eyepiece";
import { drawEyepiece } from "./sky-view";

/**
 * What opens when the telescope is tapped: tonight's real sky for Chennai. The eyepiece shows the chosen Moon or
 * planet with its true phase; under it, where to look (compass bearing and height), when it rises or sets, and how
 * bright it is. Picking something also swings the telescope on the island round to point at it.
 */
const SYMBOL: Record<Body["id"], string> = { moon: "🌙", mercury: "☿", venus: "♀", mars: "♂", jupiter: "♃", saturn: "♄" };
const MOON_EMOJI = ["🌑", "🌒", "🌓", "🌔", "🌕", "🌖", "🌗", "🌘"];
const moonEmoji = (age: number) => MOON_EMOJI[Math.round((age / 29.530588853) * 8) % 8];
const clock = (d: Date) => d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true });
const day = (d: Date) => d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });

function lines(b: Body, sky: Sky): string[] {
  const out: string[] = [];
  if (b.alt > 0) out.push(`In the ${compass(b.az)}, ${heightWords(b.alt)} (${Math.round(b.alt)}° up).`);
  else out.push(`Below the horizon right now${b.rises ? `, rising in the ${compass(b.riseAz ?? b.az)} at ${clock(b.rises)}` : ""}.`);
  if (b.alt > 0 && b.sets) out.push(`Sets in the ${compass(b.setAz ?? b.az)} at ${clock(b.sets)}.`);
  if (b.alt > 0 && b.rises && !b.sets) out.push(`Rose at ${clock(b.rises)}.`);
  if (b.id === "moon") {
    out.push(`${moonPhaseName(sky.moonAge)}, ${Math.round(b.illum * 100)}% lit.`);
    out.push(`Next full moon ${day(sky.nextFull)}, new moon ${day(sky.nextNew)}.`);
  } else {
    out.push(`${brightness(b.mag).replace(/^./, (c) => c.toUpperCase())}.`);
    if (b.id === "saturn" && b.ringTilt != null) out.push(`Its rings are tilted ${Math.abs(b.ringTilt).toFixed(0)}° towards us${Math.abs(b.ringTilt) < 4 ? ", nearly edge-on" : ""}.`);
    if ((b.id === "venus" || b.id === "mercury" || b.id === "mars") && b.illum < 0.97) out.push(`${Math.round(b.illum * 100)}% lit, ${b.illum < 0.4 ? "a thin crescent" : b.illum < 0.6 ? "a half disc" : "gibbous"}.`);
    if (b.elongation < 15) out.push("Close to the Sun, so hard to see.");
  }
  return out;
}

export function SkyCard({ onAim, onClose, initial, onSelect, at }: { onAim: (az: number, alt: number) => void; onClose: () => void; at?: number; initial?: Body["id"]; onSelect?: (id: Body["id"]) => void }) {
  // `live`: it is already dark, so this is the sky right now (otherwise it is how the sky will look at 9 pm).
  const { sky, live } = useMemo(() => {
    const now = at ? new Date(at) : new Date();
    const s = tonightSky(now);
    return { sky: s, live: s.when.getTime() === now.getTime() };
  }, [at]);
  const first = sky.bodies.find((b) => b.alt > 5) ?? sky.bodies[0];
  const [pick, setPick] = useState<Body["id"]>(initial ?? first.id);
  // The dome picks bodies too (its cards, a tap on the sky): follow it, as React recommends, by adjusting state while rendering.
  const [seen, setSeen] = useState(initial);
  if (initial !== seen) {
    setSeen(initial);
    if (initial) setPick(initial);
  }
  const chosen = sky.bodies.find((b) => b.id === pick) ?? first;
  const host = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const aim = useRef(onAim);
  useEffect(() => {
    aim.current = onAim;
  });

  // The eyepiece: a real lit sphere with NASA maps (WebGL). A device that can't do WebGL gets the flat picture instead.
  const scope = useRef<Eyepiece | null>(null);
  const flat = useRef(false);
  useEffect(() => {
    // A fresh canvas each time (a canvas whose WebGL context was handed back can't be reused).
    const cv = document.createElement("canvas");
    cv.style.width = "260px";
    cv.style.height = "260px";
    cv.className = "block rounded-full";
    cv.setAttribute("role", "img");
    host.current?.appendChild(cv);
    canvas.current = cv;
    flat.current = false;
    try {
      scope.current = new Eyepiece(cv, 260);
    } catch {
      flat.current = true;
    }
    return () => {
      scope.current?.dispose();
      scope.current = null;
      cv.remove();
      canvas.current = null;
    };
  }, []);
  // Redrawn when something else is picked.
  useEffect(() => {
    const cv = canvas.current;
    if (scope.current) void scope.current.show(chosen);
    else if (flat.current && cv) {
      const ctx = cv.getContext("2d");
      if (ctx) {
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        cv.width = 260 * dpr;
        cv.height = 260 * dpr;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        drawEyepiece(ctx, 260, chosen);
      }
    }
    // The telescope on the island turns to where it is in the real sky (lifted a little if it is under the horizon).
    aim.current(chosen.az, chosen.alt > 4 ? chosen.alt : 12);
  }, [chosen]);

  // The speeded-up clock under the eyepiece.
  const [simClock, setSimClock] = useState("");
  useEffect(() => {
    const id = setInterval(() => {
      const t = scope.current?.simTime;
      if (t) setSimClock(t.toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true }));
    }, 500);
    return () => clearInterval(id);
  }, []);
  const moons = chosen.id === "jupiter" || chosen.id === "saturn";

  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose]);

  return (
    <div className="garden-sheet absolute inset-x-3 bottom-3 z-20 max-h-[82%] overflow-y-auto rounded-3xl border border-white/15 bg-[#070b17]/90 p-5 text-white shadow-2xl backdrop-blur-xl sm:inset-x-auto sm:top-6 sm:right-6 sm:bottom-6 sm:max-h-none sm:w-[380px]" role="dialog" aria-label="Tonight's sky">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] tracking-[0.3em] text-white/60 uppercase">🔭 Tonight&apos;s sky</p>
          <p className="mt-1 text-xs text-white/70">{at || !live ? `At ${clock(sky.when)}` : "Right now"} · Chennai</p>
        </div>
        <button onClick={onClose} aria-label="Close" className="-m-2 grid h-11 w-11 shrink-0 place-items-center rounded-full text-white/80 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-amber-200">
          ✕
        </button>
      </div>

      <div className="mt-3 flex justify-center">
        <div className="relative rounded-full p-[3px] shadow-[0_0_40px_rgba(120,150,255,0.18)]" style={{ background: "linear-gradient(145deg,#e1b968,#8a6a2c 55%,#c79a45)" }}>
          <div ref={host} role="img" aria-label={`${chosen.name} through the telescope`} className="rounded-full" />
          {/* The dark edge of the lens, over the picture. */}
          <div className="pointer-events-none absolute inset-[3px] rounded-full" style={{ boxShadow: "inset 0 0 38px 10px rgba(0,0,0,0.78)" }} />
        </div>
      </div>
      <div className="mt-2 flex items-center justify-center gap-2 text-white/80">
        <button onClick={() => scope.current?.zoomBy(1 / 1.5)} aria-label="Zoom out" className="grid h-9 w-9 place-items-center rounded-full bg-white/10 text-lg hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-amber-200">
          −
        </button>
        <button onClick={() => scope.current?.resetView()} aria-label="Reset the view" className="h-9 rounded-full bg-white/10 px-3 font-mono text-[10px] tracking-wider uppercase hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-amber-200">
          {simClock ? `⏩ ${simClock}` : "Reset"}
        </button>
        <button onClick={() => scope.current?.zoomBy(1.5)} aria-label="Zoom in" className="grid h-9 w-9 place-items-center rounded-full bg-white/10 text-lg hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-amber-200">
          +
        </button>
      </div>
      <p className="mt-1 text-center text-[10px] text-white/45">
        Scroll or pinch to zoom, drag to move · time runs 20 min every second{moons ? ` · zoom out to see ${chosen.id === "jupiter" ? "its four big moons" : "Titan"}` : ""}
      </p>

      <div className="mt-3 flex flex-wrap justify-center gap-1.5" role="tablist" aria-label="What to look at">
        {sky.bodies.map((b) => (
          <button
            key={b.id}
            role="tab"
            aria-selected={b.id === pick}
            onClick={() => {
              setPick(b.id);
              onSelect?.(b.id);
            }}
            className={`min-h-9 rounded-full px-3 text-xs font-medium transition focus-visible:outline-2 focus-visible:outline-amber-200 ${b.id === pick ? "bg-amber-200 text-[#3b2f1e]" : b.alt > 0 ? "bg-white/12 text-white hover:bg-white/20" : "bg-white/6 text-white/50 hover:bg-white/12"}`}
          >
            <span aria-hidden>{b.id === "moon" ? moonEmoji(sky.moonAge) : SYMBOL[b.id]}</span> {b.id === "moon" ? "Moon" : b.name}
          </button>
        ))}
      </div>

      <div className="mt-4 border-t border-white/12 pt-3">
        <p className="text-lg font-semibold">
          {chosen.name}
          {chosen.alt > 0 && <span className="ml-2 align-middle text-[11px] font-medium text-emerald-300">up now</span>}
        </p>
        <ul className="mt-1.5 space-y-1 text-sm text-white/85">
          {lines(chosen, sky).map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      </div>
      <p className="mt-3 text-[10px] text-white/40">Positions are worked out on this device from the date and Chennai&apos;s location, and match NASA&apos;s JPL Horizons to a few hundredths of a degree. Planet maps: Solar System Scope (CC BY 4.0), made from NASA data.</p>
    </div>
  );
}
