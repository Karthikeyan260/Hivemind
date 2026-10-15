"use client";

import { useEffect, useRef, useState } from "react";
import { useVoiceActions } from "@/components/voice/provider";
import { getFix } from "@/lib/location";
import { type Sky, SKY_EVENT, skyFor, skyFromWords, THUNDER_EVENT } from "@/lib/sky";

/**
 * The living sky: the weather outside, across the whole app. Rain falls over the screen when it rains
 * where the device is (or in the home city when its location isn't allowed), a storm adds lightning flashes, a clear day gets a warm shimmer, and a clear night
 * gets twinkling stars and fireflies. Faint and click-through, paused when the tab is hidden, and off
 * for reduced motion. The pet listens (umbrella, shades, a jump at thunder).
 */
const OFF_KEY = "hm-sky-off";
const REFRESH_MS = 10 * 60_000;
const PREVIEW_MS = 30_000;

/**
 * Where this device is, if the owner already allowed location (the Map asks for it); never pops up a
 * permission prompt on its own. A fix up to 15 minutes old is fine for weather.
 */
async function here(ask = false) {
  try {
    if (!ask) {
      const p = await navigator.permissions?.query({ name: "geolocation" as PermissionName });
      if (p?.state !== "granted") return null;
    }
    return await getFix(15 * 60_000);
  } catch {
    return null;
  }
}

declare global {
  interface Window {
    __hmSky?: Sky;
  }
}

export function LivingSky() {
  const [real, setReal] = useState<Sky>("calm");
  const [preview, setPreview] = useState<Sky | null>(null);
  const [off, setOff] = useState(false);
  const [flash, setFlash] = useState(0);
  // Where the weather is from ("Your location" or the home city), and a nudge to look again.
  const [where, setWhere] = useState("");
  const [askHere, setAskHere] = useState(0);
  const canvas = useRef<HTMLCanvasElement>(null);
  const sky = preview ?? real;

  // The weather outside (the server keeps it 10 minutes), and the saved on/off choice.
  useEffect(() => {
    let alive = true;
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- the saved choice, read once on mount
      setOff(localStorage.getItem(OFF_KEY) === "1" || matchMedia("(prefers-reduced-motion: reduce)").matches);
    } catch {}
    // ?sky=rain previews a sky (for trying it out).
    const asked = new URLSearchParams(location.search).get("sky");
    if (asked) setPreview(skyFromWords(asked));
    const load = async () => {
      const fix = await here(askHere > 0);
      const r = await fetch(fix ? `/api/tools/weather?lat=${fix.lat.toFixed(3)}&lng=${fix.lng.toFixed(3)}` : "/api/tools/weather").catch(() => null);
      const w = r?.ok ? await r.json().catch(() => null) : null;
      if (!alive || !w?.current) return;
      setReal(skyFor(Number(w.current.code ?? 3), w.current.is_day !== false, Number(w.current.rain_mm ?? 0)));
      setWhere(fix ? "your location" : (w.place ?? "home"));
    };
    void load();
    const t = setInterval(load, REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [askHere]);

  // Tell the pet (and anything else) what the sky is doing.
  useEffect(() => {
    const shown = off ? "calm" : sky;
    window.__hmSky = shown;
    window.dispatchEvent(new CustomEvent(SKY_EVENT, { detail: { sky: shown } }));
  }, [sky, off]);

  // Lightning now and then in a storm: a flash, and the pet jumps.
  useEffect(() => {
    if (off || sky !== "thunder") return;
    let t: ReturnType<typeof setTimeout>;
    const strike = () => {
      t = setTimeout(
        () => {
          if (document.visibilityState === "visible") {
            setFlash((n) => n + 1);
            window.dispatchEvent(new Event(THUNDER_EVENT));
          }
          strike();
        },
        7000 + Math.random() * 12000,
      );
    };
    t = setTimeout(() => {
      setFlash((n) => n + 1);
      window.dispatchEvent(new Event(THUNDER_EVENT));
      strike();
    }, 2500);
    return () => clearTimeout(t);
  }, [sky, off]);

  // The drawing: rain streaks, or stars and fireflies, on one canvas.
  useEffect(() => {
    const c = canvas.current;
    if (!c || off || (sky !== "rain" && sky !== "thunder" && sky !== "night")) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    let w = 0;
    let h = 0;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const size = () => {
      w = window.innerWidth;
      h = window.innerHeight;
      c.width = w * dpr;
      c.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    size();
    window.addEventListener("resize", size);
    const rnd = (a: number, b: number) => a + Math.random() * (b - a);
    const storm = sky === "thunder";
    const drops = Array.from({ length: sky === "night" ? 0 : storm ? 170 : 110 }, () => ({ x: rnd(0, w), y: rnd(-h, h), len: rnd(10, 22), v: rnd(storm ? 13 : 9, storm ? 20 : 15) }));
    const splashes: { x: number; y: number; r: number; a: number }[] = [];
    const stars = Array.from({ length: sky === "night" ? 70 : 0 }, () => ({ x: rnd(0, w), y: rnd(0, h * 0.75), r: rnd(0.5, 1.6), p: rnd(0, Math.PI * 2), s: rnd(0.6, 1.8) }));
    const flies = Array.from({ length: sky === "night" ? 9 : 0 }, () => ({ x: rnd(0, w), y: rnd(h * 0.3, h), a: rnd(0, Math.PI * 2), p: rnd(0, Math.PI * 2) }));
    let raf = 0;
    let t0 = performance.now();
    const frame = (now: number) => {
      const dt = Math.min(3, (now - t0) / 16.7);
      t0 = now;
      ctx.clearRect(0, 0, w, h);
      if (drops.length) {
        ctx.strokeStyle = storm ? "rgba(190,215,255,0.42)" : "rgba(174,214,255,0.32)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (const d of drops) {
          d.y += d.v * dt;
          d.x -= d.v * 0.18 * dt;
          if (d.y > h) {
            if (Math.random() < 0.35) splashes.push({ x: d.x, y: h - rnd(2, 40), r: 1, a: 0.5 });
            d.y = rnd(-60, -10);
            d.x = rnd(0, w + 60);
          }
          ctx.moveTo(d.x, d.y);
          ctx.lineTo(d.x + d.len * 0.18, d.y - d.len);
        }
        ctx.stroke();
        for (let i = splashes.length - 1; i >= 0; i--) {
          const s = splashes[i];
          s.r += 0.6 * dt;
          s.a -= 0.04 * dt;
          if (s.a <= 0) {
            splashes.splice(i, 1);
            continue;
          }
          ctx.strokeStyle = `rgba(174,214,255,${s.a})`;
          ctx.beginPath();
          ctx.ellipse(s.x, s.y, s.r * 1.6, s.r * 0.5, 0, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
      for (const s of stars) {
        const a = 0.35 + 0.45 * Math.sin(now / 1000 * s.s + s.p);
        ctx.fillStyle = `rgba(255,255,240,${Math.max(0.05, a)})`;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fill();
      }
      for (const f of flies) {
        f.a += rnd(-0.08, 0.08) * dt;
        f.x = (f.x + Math.cos(f.a) * 0.5 * dt + w) % w;
        f.y = Math.min(h - 10, Math.max(h * 0.25, f.y + Math.sin(f.a) * 0.4 * dt));
        const glow = 0.25 + 0.55 * Math.max(0, Math.sin(now / 700 + f.p));
        const g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, 9);
        g.addColorStop(0, `rgba(216,245,140,${glow})`);
        g.addColorStop(1, "rgba(216,245,140,0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(f.x, f.y, 9, 0, Math.PI * 2);
        ctx.fill();
      }
      raf = requestAnimationFrame(frame);
    };
    const run = () => {
      cancelAnimationFrame(raf);
      if (document.visibilityState === "visible") {
        t0 = performance.now();
        raf = requestAnimationFrame(frame);
      }
    };
    run();
    document.addEventListener("visibilitychange", run);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", size);
      document.removeEventListener("visibilitychange", run);
      ctx.clearRect(0, 0, w, h);
    };
  }, [sky, off]);

  useVoiceActions({
    living_weather: {
      description: "The living weather effects on the app screen (rain falling, lightning, sunny shimmer, night stars and fireflies, matching the weather where the device is). input: 'off', 'on', 'use my location' (asks for location permission if needed), or a sky to preview for 30 seconds: 'rain', 'thunderstorm', 'sunny', 'night'.",
      run: ({ input }) => {
        const t = String(input ?? "").toLowerCase();
        if (/location|where i am|gps|here/.test(t)) {
          setAskHere((n) => n + 1);
          return { using: "this device's location (it may ask for permission)", was: where };
        }
        if (/\boff\b|stop|disable|hide/.test(t)) {
          setOff(true);
          try {
            localStorage.setItem(OFF_KEY, "1");
          } catch {}
          return { weather_effects: "off" };
        }
        const want = skyFromWords(t);
        setOff(false);
        try {
          localStorage.removeItem(OFF_KEY);
        } catch {}
        if (want) {
          setPreview(want);
          setTimeout(() => setPreview(null), PREVIEW_MS);
          return { previewing: want, seconds: PREVIEW_MS / 1000, outside_now: real, weather_from: where };
        }
        return { weather_effects: "on", outside_now: real, weather_from: where };
      },
    },
  });

  if (off || sky === "calm") return null;
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-[25] overflow-hidden">
      {(sky === "rain" || sky === "thunder") && <div className="absolute inset-0" style={{ background: "linear-gradient(180deg, rgba(40,70,110,0.16), rgba(20,35,60,0.06))" }} />}
      {sky === "sunny" && (
        <>
          <div className="sky-sun absolute -right-24 -top-24 h-72 w-72 rounded-full" style={{ background: "radial-gradient(circle, rgba(255,214,102,0.35), rgba(255,170,60,0.08) 55%, transparent 70%)" }} />
          <div className="sky-shimmer absolute inset-x-0 top-0 h-40" style={{ background: "linear-gradient(180deg, rgba(255,200,90,0.10), transparent)" }} />
        </>
      )}
      <canvas ref={canvas} className="absolute inset-0 h-full w-full" />
      {flash > 0 && <div key={flash} className="sky-flash absolute inset-0 bg-white" />}
    </div>
  );
}
