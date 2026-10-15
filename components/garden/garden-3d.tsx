"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Creature } from "@/components/pet/creature";
import { ErrorText } from "@/components/ui";
import { useVoiceActions } from "@/components/voice/provider";
import { useFetch } from "@/lib/client-api";
import { type Garden, homeSpot, islandSize, layout } from "@/lib/garden-layout";
import type { Sky } from "@/lib/sky";
import type { GardenScene } from "./garden-scene";
import { type Phase, phaseNow } from "./phase";

/**
 * Nova's garden in 3D. The page owns what the pet does (strolls, naps in its cottage, sleeps at
 * night, goes to look at whatever was tapped); the scene draws the island and reports each frame
 * where the pet and the label are on screen, and the page moves them there without re-rendering.
 */
type Pt = { x: number; y: number };
const PHASE_NAME: Record<Phase, string> = { dawn: "Dawn", day: "Daytime", golden: "Golden hour", dusk: "Dusk", night: "Night" };

export function Garden3D({ onFail }: { onFail: () => void }) {
  const feed = useFetch<{ garden: Garden }>("/api/pet/garden");
  const g = feed.data?.garden;
  const placed = useMemo(() => (g ? layout(g.items) : []), [g]);
  const n = g?.items.length ?? 0;
  const isl = islandSize(n);
  const home = homeSpot(n);
  const door = { x: home.x, y: home.y + 5 };

  const box = useRef<HTMLDivElement>(null);
  // Holds the canvas. Each scene gets a fresh canvas: a canvas whose WebGL context was released
  // can't start another (React mounts twice in development, and the scene is rebuilt on new data).
  const host = useRef<HTMLDivElement>(null);
  const petEl = useRef<HTMLDivElement>(null);
  const tipEl = useRef<HTMLDivElement>(null);
  const scene = useRef<GardenScene | null>(null);
  const [ready, setReady] = useState(false);
  const [sel, setSel] = useState<{ id: string; label: string } | null>(null);
  const [sky, setSky] = useState<Sky>("calm");
  const [phase, setPhase] = useState<Phase>("day");
  const [walking, setWalking] = useState(false);
  const [facing, setFacing] = useState(0);
  const [lookAt, setLookAt] = useState(0);
  const [love, setLove] = useState(false);
  const [inside, setInside] = useState(false);
  const [hint, setHint] = useState(true);
  const insideRef = useRef(false);
  const busy = useRef(0);
  const awake = useRef(0);
  const petScreen = useRef<{ x: number; y: number } | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const later = (fn: () => void, ms: number) => timers.current.push(setTimeout(fn, ms));
  const night = phase === "night";
  const wet = sky === "rain" || sky === "thunder";
  const isNight = () => phaseNow() === "night";

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the clock and the sky, read on mount
    setPhase(phaseNow());
    setSky((window as unknown as { __hmSky?: Sky }).__hmSky ?? "calm");
    const on = (e: Event) => setSky((e as CustomEvent<{ sky: Sky }>).detail?.sky ?? "calm");
    window.addEventListener("hivemind:sky", on);
    const tick = setInterval(() => setPhase(phaseNow()), 5 * 60_000);
    const all = timers.current;
    return () => {
      window.removeEventListener("hivemind:sky", on);
      clearInterval(tick);
      all.forEach(clearTimeout);
    };
  }, []);

  function enter(v: boolean) {
    insideRef.current = v;
    setInside(v);
  }
  function walkTo(to: Pt) {
    const ms = scene.current?.walkPet(to.x, to.y) ?? 0;
    setWalking(true);
    later(() => setWalking(false), ms);
    return ms;
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
    const ms = walkTo(door);
    busy.current = Date.now() + ms + 400 + napMs;
    later(() => enter(true), ms + 50);
  }
  function comeOut(then?: Pt) {
    enter(false);
    busy.current = Date.now() + 4500;
    later(() => walkTo(then ?? strollSpot()), 450);
  }
  function showTip(id: string, label: string) {
    setSel({ id, label });
    scene.current?.setTip(id);
    later(() => {
      setSel((s) => (s?.id === id ? null : s));
      if (tipEl.current?.dataset.id === id) scene.current?.setTip(null);
    }, 5000);
  }

  function pick(id: string) {
    setHint(false);
    const name = g?.pet ?? "Nova";
    if (id === "home") {
      if (insideRef.current) {
        awake.current = Date.now() + 40_000;
        showTip("home", `🏠 ${name}'s cottage · ${name} is coming out!`);
        comeOut();
      } else {
        awake.current = 0;
        showTip("home", `🏠 ${name}'s cottage · time for a nap 💤`);
        goHome(8000);
      }
      return;
    }
    const p = placed.find((x) => x.id === id);
    if (!p) return;
    showTip(p.id, p.label);
    // The pet goes to look at it, and loves it.
    const to = { x: p.x + (p.x > isl.cx ? -26 : 26), y: p.y + 6 };
    const wait = insideRef.current ? 450 : 0;
    if (insideRef.current) {
      awake.current = Date.now() + 40_000;
      enter(false);
    }
    busy.current = Date.now() + 9000;
    later(() => {
      const ms = walkTo(to);
      later(() => {
        setLove(true);
        later(() => setLove(false), 1800);
      }, ms);
    }, wait);
  }
  const pickRef = useRef(pick);
  useEffect(() => {
    pickRef.current = pick;
  });

  // Build the scene once the garden has loaded; its life: strolls, naps, sleeping at night.
  useEffect(() => {
    if (!g || !host.current || !box.current) return;
    let alive = true;
    let ro: ResizeObserver | null = null;
    let canvasEl: HTMLCanvasElement | null = null;
    let t: ReturnType<typeof setTimeout>;
    void (async () => {
      let mod: typeof import("./garden-scene");
      try {
        mod = await import("./garden-scene");
      } catch {
        if (alive) onFail();
        return;
      }
      if (!alive || !host.current || !box.current) return;
      const cv = document.createElement("canvas");
      cv.className = "absolute inset-0 h-full w-full touch-none";
      cv.style.cursor = "grab";
      cv.setAttribute("aria-label", `${g.pet}'s garden, a floating island`);
      host.current.appendChild(cv);
      canvasEl = cv;
      const sleeping = isNight();
      try {
        scene.current = new mod.GardenScene(
          cv,
          placed,
          { n: g.items.length, phase: phaseNow(), wet: false, butterflies: g.butterflies, lit: sleeping },
          {
            onPick: (id) => pickRef.current(id),
            onFrame: ({ pet, tip }) => {
              const el = petEl.current;
              if (el && pet) {
                el.style.transform = `translate3d(${pet.x - pet.size / 2}px, ${pet.y - pet.size * 0.9}px, 0)`;
                el.style.width = el.style.height = `${pet.size}px`;
                el.style.visibility = pet.hidden ? "hidden" : "visible";
                const prev = petScreen.current;
                if (prev && Math.abs(pet.x - prev.x) > 0.4) {
                  const f = Math.sign(pet.x - prev.x);
                  setFacing((o) => (o === f ? o : f));
                }
                petScreen.current = { x: pet.x, y: pet.y };
              }
              const tp = tipEl.current;
              if (tp) {
                if (tip) tp.style.transform = `translate3d(${tip.x}px, ${tip.y}px, 0) translate(-50%, -100%)`;
                tp.style.visibility = tip ? "visible" : "hidden";
              }
            },
          },
        );
      } catch {
        if (alive) onFail();
        return;
      }
      const s = scene.current;
      ro = new ResizeObserver(() => s.resize(cv.clientWidth, cv.clientHeight));
      ro.observe(box.current);
      setReady(true);
      enter(sleeping);
      if (!sleeping) later(() => comeOut(), 3600);
      else busy.current = Date.now() + 3600;
      const tick = () => {
        t = setTimeout(
          () => {
            if (Date.now() > busy.current) {
              const nightNow = isNight() && Date.now() > awake.current;
              if (insideRef.current) {
                if (!nightNow) comeOut();
              } else if (nightNow || Math.random() < 0.16) goHome(nightNow ? 0 : 6000 + Math.random() * 4000);
              else {
                const ms = walkTo(strollSpot());
                busy.current = Date.now() + ms;
              }
            }
            tick();
          },
          4200 + Math.random() * 3500,
        );
      };
      tick();
    })();
    return () => {
      alive = false;
      clearTimeout(t);
      ro?.disconnect();
      scene.current?.dispose();
      scene.current = null;
      canvasEl?.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rebuilt only when the garden itself changes
  }, [g, placed]);

  useEffect(() => {
    scene.current?.setLook(phase, wet);
  }, [phase, wet, ready]);
  useEffect(() => {
    scene.current?.setLit(night || inside);
    scene.current?.setSleeping(inside && night);
  }, [night, inside, ready]);
  useEffect(() => {
    const t = setTimeout(() => setHint(false), 9000);
    return () => clearTimeout(t);
  }, []);

  useVoiceActions({
    garden_describe: {
      description: "Nova's garden page: what has grown on the island (flowers from habits, trees from night check-ins, lamps from lantern walks, gems from game wins, butterflies from songs).",
      run: () => (g ? { ...g.counts, pet: g.pet, note: "Say it warmly in one or two sentences." } : { error: "The garden is still loading." }),
    },
  });

  function onPointer(e: React.PointerEvent<HTMLDivElement>) {
    if (e.pointerType !== "mouse" || walking) return;
    const at = petScreen.current;
    if (!at) return;
    const r = e.currentTarget.getBoundingClientRect();
    const v = Math.round(Math.max(-1, Math.min(1, (e.clientX - r.left - at.x) / 200)) * 3) / 3;
    setLookAt((o) => (o === v ? o : v));
  }

  const c = g?.counts;
  return (
    <div className="w-full">
      <ErrorText error={feed.error} />
      {/* The garden fills the page; its title and what has grown float over it on glass. */}
      <div
        ref={box}
        data-garden
        onPointerMove={onPointer}
        className="relative h-[calc(100dvh-9.5rem)] min-h-[460px] overflow-hidden rounded-3xl bg-[#0b1220] shadow-[0_30px_80px_-30px_rgba(0,0,0,.8)] ring-1 ring-white/10 select-none sm:h-[calc(100dvh-5rem)]"
      >
        <div ref={host} className="absolute inset-0" />

        {/* The pet, standing where it is in the scene. */}
        {g && ready && (
          <div ref={petEl} className="pointer-events-none absolute top-0 left-0" style={{ width: 80, height: 80, visibility: "hidden" }}>
            <div className="h-full w-full" style={{ opacity: inside ? 0 : 1, transform: inside ? "scale(0.5) translateY(-8%)" : "none", transformOrigin: "50% 90%", transition: "opacity .45s ease, transform .45s ease" }}>
              <div className="absolute inset-x-[22%] bottom-[7%] h-[9%] rounded-[50%] bg-black/30 blur-[3px]" />
              <div className={walking ? "garden-walk h-full w-full" : love ? "garden-hop h-full w-full" : "h-full w-full"}>
                <Creature stage={g.stage} mood={night ? "sleepy" : "happy"} look={{ x: (walking ? facing : lookAt) * 2.4, y: 0 }} eating={love} evolving={false} poked={false} sky={sky} />
              </div>
            </div>
          </div>
        )}

        {/* What was tapped, floating over it. */}
        <div ref={tipEl} data-id={sel?.id} className="pointer-events-none absolute top-0 left-0" style={{ visibility: "hidden" }}>
          {sel && (
            <div key={sel.id} className="pet-pop mb-2 rounded-xl border border-white/15 bg-[#0b1016]/80 px-3 py-1.5 text-xs whitespace-nowrap text-white shadow-xl backdrop-blur-md">
              {sel.label}
            </div>
          )}
        </div>

        {!ready && !feed.error && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center text-sm text-white/70">
            <span className="animate-pulse">Growing the island…</span>
          </div>
        )}
        {/* Soft dark fades top and bottom, so the glass text reads over any sky. */}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-black/45 to-transparent" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-44 bg-gradient-to-t from-black/55 to-transparent" />

        {/* Title. */}
        <div className="pointer-events-none absolute top-5 left-5 sm:top-7 sm:left-8">
          <p className="font-mono text-[10px] tracking-[0.35em] text-white/60 uppercase">Pocket pet · {PHASE_NAME[phase]}</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight text-white drop-shadow-[0_2px_12px_rgba(0,0,0,.5)] sm:text-5xl">{g?.pet ?? "Nova"}&apos;s garden</h1>
          <p className="mt-2 max-w-sm text-sm text-white/75 drop-shadow">Everything you keep up with grows here.</p>
        </div>

        {/* What has grown: glass cards along the bottom. */}
        {g && (
          <div className="absolute inset-x-3 bottom-3 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] sm:inset-x-6 sm:bottom-6 sm:gap-3">
            {[
              ["🌸", c?.flowers ?? 0, "Flowers", "a day a habit was done"],
              ["🌳", c?.trees ?? 0, "Trees", "4 night check-ins each"],
              ["🏮", c?.lamps ?? 0, "Lamps", "lantern walks"],
              ["💎", c?.gems ?? 0, "Gems", "games won"],
              ["🦋", c?.butterflies ?? 0, "Butterflies", "songs you played"],
            ].map(([e, num, what, why]) => (
              <div key={String(what)} className="min-w-[104px] shrink-0 rounded-2xl border border-white/15 bg-white/10 px-3.5 py-2.5 text-white shadow-lg backdrop-blur-xl sm:min-w-[132px] sm:px-4 sm:py-3" title={String(why)}>
                <div className="flex items-baseline gap-1.5">
                  <span className="text-base sm:text-lg">{e}</span>
                  <span className="text-xl font-semibold tabular-nums sm:text-2xl">{num}</span>
                </div>
                <p className="text-[11px] font-medium text-white/90">{what}</p>
                <p className="text-[10px] text-white/55">{why}</p>
              </div>
            ))}
          </div>
        )}

        {ready && hint && <div className="pointer-events-none absolute inset-x-0 top-[38%] text-center text-xs text-white/85 drop-shadow transition-opacity sm:top-auto sm:right-8 sm:bottom-8 sm:left-auto sm:text-right">Drag to look around · pinch to zoom · tap anything</div>}
        {g && !g.items.length && <div className="pointer-events-none absolute inset-x-0 top-1/3 text-center text-sm text-white/90 drop-shadow">The island is waiting. Finish a habit today to plant the first flower 🌱</div>}
      </div>
    </div>
  );
}
