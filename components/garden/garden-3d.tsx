"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Creature } from "@/components/pet/creature";
import { ErrorText } from "@/components/ui";
import { useVoiceActions } from "@/components/voice/provider";
import { petHush, petSay } from "@/components/pet/talk";
import * as beat from "@/lib/beat";
import { MUSIC_EVENT, MUSIC_STATE_EVENT, useFetch } from "@/lib/client-api";
import type { GoodNight } from "@/lib/goodnight";
import type { GardenDay } from "@/lib/garden-day";
import { type Garden, homeSpot, islandSize, layout, type Season, SEASONS, seasonOf, type Visitor } from "@/lib/garden-layout";
import { composeSnapshot, shareSnapshot, snapshotName } from "@/lib/garden-snapshot";
import { festivalById, festivalOn } from "@/lib/pet-looks";
import type { Sky } from "@/lib/sky";
import type { GardenScene } from "./garden-scene";
import { type Phase, phaseNow } from "./phase";

/**
 * Nova's garden in 3D. The page owns what the pet does (strolls, naps in its cottage, sleeps at
 * night, goes to look at whatever was tapped); the scene draws the island and reports each frame
 * where the pet and the label are on screen, and the page moves them there without re-rendering.
 */
type Pt = { x: number; y: number };
const PHASE_ICON: Record<Phase, string> = { dawn: "🌅", day: "☀️", golden: "🌇", dusk: "🌆", night: "🌙" };
const PHASE_NAME: Record<Phase, string> = { dawn: "Dawn", day: "Daytime", golden: "Golden hour", dusk: "Dusk", night: "Night" };
/** Festivals the island dresses up for (others only change Nova's outfit). */
const DECOR = ["pongal", "karthigai", "deepavali", "puthandu", "christmas", "india"] as const;
const DECOR_ICON: Record<string, string> = { pongal: "🌾", karthigai: "🪔", deepavali: "🎆", puthandu: "🥭", christmas: "🎄", india: "🇮🇳", monsoon: "🌧️" };
/** How the last night went, for the title line (1 rough to 5 great). */
const MOOD_TEXT = ["😞 a rough night", "😕 a meh night", "😐 an okay night", "🙂 a good night", "😄 a great night"];
const SEASON_ICON: Record<Season, string> = { spring: "🌸", summer: "☀️", autumn: "🍂", winter: "❄️" };
const todayLocal = () => new Date().toLocaleDateString("en-CA");
/** The north-east monsoon over Tamil Nadu: October to December. */
const monsoonMonth = () => [9, 10, 11].includes(new Date().getMonth());

/** What to dress the island for: a festival or "monsoon" from the link (?fest=), "today" or nothing for today's. */
function decorFor(asked: string | null) {
  const today = festivalOn(todayLocal())?.id ?? null;
  const isDecor = (id: string | null) => (DECOR as readonly string[]).includes(id ?? "");
  const own = !asked || asked === "today";
  return { fest: isDecor(asked) ? asked : own && isDecor(today) ? today : null, monsoon: asked === "monsoon" || (own && monsoonMonth()) };
}

export function Garden3D({ onFail, asked = null, bedtimeAsk = false, askedSeason = null, askedMood = null, askedVisitors = null }: { onFail: () => void; asked?: string | null; bedtimeAsk?: boolean; askedSeason?: string | null; askedMood?: string | null; askedVisitors?: string | null }) {
  const feed = useFetch<{ garden: Garden }>("/api/pet/garden");
  const g = feed.data?.garden;
  const placed = useMemo(() => (g ? layout(g.items) : []), [g]);
  // The season: this month's, or one previewed from the link (?season=autumn).
  const season: Season = (SEASONS as string[]).includes(askedSeason ?? "") ? (askedSeason as Season) : seasonOf(new Date().getMonth());
  // How the last night check-in went (or ?mood=1..5 to preview): tints the light and Nova's face.
  // Rare visitors earned by milestones (or ?visitors=owl,deer to preview them).
  const previewVisitors = (askedVisitors ?? "").split(",").filter((k): k is "owl" | "deer" => k === "owl" || k === "deer");
  const visitors: Visitor[] = askedVisitors ? previewVisitors.map((kind) => g?.visitors.find((v) => v.kind === kind) ?? { kind, label: kind === "owl" ? "🦉 A night owl came to roost" : "🦌 A deer wandered in" }) : (g?.visitors ?? []);
  const previewMood = Number(askedMood);
  const mood = Number.isInteger(previewMood) && previewMood >= 1 && previewMood <= 5 ? previewMood : (g?.mood ?? null);
  const gardenKey = g ? `${g.items.map((i) => i.id).join(",")}|${g.butterflies}|${g.stage}|${g.streak}|${season}|${mood ?? ""}|${visitors.map((v) => v.kind).join("+")}` : "";
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
  // AR: the island on a real table, through the camera (only offered where the phone can do it).
  const arUi = useRef<HTMLDivElement>(null);
  const [arOk, setArOk] = useState(false);
  const [ar, setAr] = useState<null | "find" | "placed">(null);
  useEffect(() => {
    let alive = true;
    void import("./garden-scene")
      .then((m) => m.GardenScene.arSupported())
      .then((ok) => alive && setArOk(ok))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  // A tap on the AR buttons must not also count as "place the garden here".
  useEffect(() => {
    const el = arUi.current;
    const stop = (e: Event) => e.preventDefault();
    el?.addEventListener("beforexrselect", stop);
    return () => el?.removeEventListener("beforexrselect", stop);
  }, []);
  async function startAR() {
    const s = scene.current;
    const ui = arUi.current;
    if (!s || !ui) return;
    try {
      await s.enterAR(ui, setAr, () => setAr(null));
    } catch {
      setAr(null);
      setSharing("AR couldn't start on this phone.");
      setTimeout(() => setSharing(""), 3500);
    }
  }
  // Bumped each time a scene is built: the effects below re-apply the sky, decorations and lights to it.
  const [sceneId, setSceneId] = useState(0);
  const ready = sceneId > 0;
  const [sel, setSel] = useState<{ id: string; label: string } | null>(null);
  const [sky, setSky] = useState<Sky>("calm");
  const [wind, setWind] = useState<number | null>(null);
  const [phase, setPhase] = useState<Phase>("day");
  const [walking, setWalking] = useState(false);
  const [facing, setFacing] = useState(0);
  const [lookAt, setLookAt] = useState(0);
  const [love, setLove] = useState(false);
  const [inside, setInside] = useState(false);
  const [hint, setHint] = useState(true);
  // A flower's day (what happened on the date it was planted).
  const [day, setDay] = useState<{ date: string; data?: GardenDay; error?: string } | null>(null);
  // "Nova, good night": night falls, a calm song, the warm glow, Nova tells tomorrow and goes to sleep.
  const [bedtime, setBedtime] = useState<{ plan?: GoodNight; line: number; asleep: boolean } | null>(null);
  const bedtimeRun = useRef(0);
  // Festival / season on the island: today's, or one previewed (?fest=deepavali, or by voice).
  const [fest, setFest] = useState<string | null>(null);
  const [monsoon, setMonsoon] = useState(false);
  const insideRef = useRef(false);
  const busy = useRef(0);
  const awake = useRef(0);
  const petScreen = useRef<{ x: number; y: number } | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const later = (fn: () => void, ms: number) => timers.current.push(setTimeout(fn, ms));
  const inBed = !!bedtime;
  const night = phase === "night" || inBed;
  const wet = sky === "rain" || sky === "thunder";
  const isNight = () => phaseNow() === "night";

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the clock and the sky, read on mount
    setPhase(phaseNow());
    setSky((window as unknown as { __hmSky?: Sky }).__hmSky ?? "calm");
    setWind((window as unknown as { __hmWind?: number | null }).__hmWind ?? null);
    const on = (e: Event) => {
      const d = (e as CustomEvent<{ sky: Sky; wind?: number | null }>).detail;
      setSky(d?.sky ?? "calm");
      setWind(d?.wind ?? null);
    };
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
    // A rare visitor: its label says why it came.
    if (id.startsWith("visitor:")) {
      const v = visitors.find((x) => `visitor:${x.kind}` === id);
      if (v) showTip(id, v.label);
      return;
    }
    const p = placed.find((x) => x.id === id);
    if (!p) return;
    showTip(p.id, p.label);
    if ("date" in p) openDay(p.date);
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
  async function openDay(date: string) {
    setDay({ date });
    try {
      const r = await fetch(`/api/pet/garden/day?date=${date}`);
      const j = (await r.json()) as { day?: GardenDay; error?: string };
      setDay((d) => (d?.date === date ? (j.day ? { date, data: j.day } : { date, error: j.error ?? "Couldn't open that day." }) : d));
    } catch {
      setDay((d) => (d?.date === date ? { date, error: "Couldn't open that day." } : d));
    }
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
          { n: g.items.length, phase: phaseNow(), wet: false, butterflies: g.butterflies, lit: sleeping, streak: g.streak ?? 0, season, mood, visitors: visitors.map((v) => v.kind) },
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
      setSceneId((x) => x + 1);
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
  }, [gardenKey]);

  useEffect(() => {
    scene.current?.setLook(inBed ? "night" : phase, inBed ? false : wet);
  }, [phase, wet, sceneId, inBed]);
  // The real wind outside: the grass, flowers and trees sway as hard as it blows.
  useEffect(() => {
    scene.current?.setWind(wind);
  }, [wind, sceneId]);
  useEffect(() => {
    const d = decorFor(asked);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- follows the link, which can change while the page is open
    setFest(d.fest);
    setMonsoon(d.monsoon);
  }, [asked]);
  useEffect(() => {
    scene.current?.setDecor(fest, monsoon || wet);
  }, [fest, monsoon, wet, sceneId]);
  useEffect(() => {
    scene.current?.setLit(night || inside);
    scene.current?.setSleeping(inside && night);
  }, [night, inside, sceneId]);
  useEffect(() => {
    const t = setTimeout(() => setHint(false), 9000);
    return () => clearTimeout(t);
  }, []);

  // The garden dances to whatever is playing: a bounce on every beat, lamps flash on the drop, and the
  // fireflies take the music lights' colour.
  useEffect(() => {
    if (!sceneId) return;
    const s = () => scene.current;
    const playing = () => document.documentElement.classList.contains("music-live");
    const paint = () => s()?.setMusic(playing() ? beat.currentRgb() : null);
    paint();
    // Development only: tests send beats without playing a real song (which would log a play).
    if (process.env.NODE_ENV === "development") (window as unknown as { __hmGarden?: unknown }).__hmGarden = { focus: (id: string, d?: number, view?: "front" | "side") => s()?.debugFocus(id, d, view), beat: () => s()?.musicBeat(), wind: () => s()?.windNow(), drop: () => s()?.musicDrop(), level: (v: number) => s()?.setMusicLevel(v), music: (rgb: [number, number, number] | null) => s()?.setMusic(rgb) };
    const offBeat = beat.onBeat(() => s()?.musicBeat());
    // The song's loudness, a few times a second, for the gentle sway and the fireflies.
    const lv = setInterval(() => playing() && s()?.setMusicLevel(beat.level()), 120);
    const offDrop = beat.onDrop(() => s()?.musicDrop());
    const state = () => setTimeout(paint, 50);
    window.addEventListener(MUSIC_STATE_EVENT, state);
    window.addEventListener(beat.COLOR_EVENT, paint);
    return () => {
      clearInterval(lv);
      offBeat();
      offDrop();
      window.removeEventListener(MUSIC_STATE_EVENT, state);
      window.removeEventListener(beat.COLOR_EVENT, paint);
    };
  }, [sceneId]);

  // A picture of the garden to send to a friend (the share sheet on a phone, a download on a laptop).
  const [sharing, setSharing] = useState("");
  async function shareGarden() {
    const frame = scene.current?.snapshot();
    if (!frame || !g) return setSharing("Couldn't take the picture.");
    try {
      const cc = g.counts;
      const date = todayLocal();
      const card = {
        title: `${g.pet}'s garden`,
        sub: `${SEASON_ICON[season]} ${season} · ${PHASE_NAME[phase].toLowerCase()}${g.streak > 0 ? ` · 🔥 ${g.streak}-day streak` : ""}`,
        stats: [`🌸 ${cc.flowers}`, `🌳 ${cc.trees}`, `💎 ${cc.gems}`, `🦋 ${cc.butterflies}`],
        date: new Date().toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" }),
      };
      const blob = await composeSnapshot(frame, card);
      const done = await shareSnapshot(blob, snapshotName(g.pet, date), `${g.pet}'s garden 🌱`);
      setSharing(done === "saved" ? "Saved the picture." : "");
    } catch (e) {
      setSharing(e instanceof Error ? e.message : "Couldn't share the picture.");
    }
    setTimeout(() => setSharing(""), 3500);
  }

  async function goodNight() {
    const me = ++bedtimeRun.current;
    setHint(false);
    setBedtime({ line: -1, asleep: false });
    beat.setTempColor("orange");
    busy.current = Date.now() + 12 * 60 * 60_000;
    let plan: GoodNight | undefined;
    try {
      plan = (await (await fetch("/api/pet/goodnight")).json()) as GoodNight;
    } catch {
      plan = { name: "", lines: ["Good night. Sleep well 🌙"], song: "Ilaiyaraaja night melody" };
    }
    if (me !== bedtimeRun.current) return;
    setBedtime({ plan, line: -1, asleep: false });
    window.dispatchEvent(new CustomEvent(MUSIC_EVENT, { detail: { action: "play", query: plan.song } }));
    // Softer, for sleeping.
    later(() => window.dispatchEvent(new CustomEvent(MUSIC_EVENT, { detail: { action: "set_volume", volume: 35 } })), 2500);
    // Nova comes out to say it, then walks home and falls asleep.
    if (insideRef.current) enter(false);
    walkTo({ x: door.x + 30, y: door.y + 30 });
    let at = 2600;
    plan.lines.forEach((l, i) => {
      later(() => {
        if (me !== bedtimeRun.current) return;
        setBedtime((b) => (b ? { ...b, line: i } : b));
        petSay(l);
      }, at);
      at += Math.max(3800, l.split(/\s+/).length * 380 + 1200);
    });
    later(() => {
      if (me !== bedtimeRun.current) return;
      const ms = walkTo(door);
      later(() => {
        if (me !== bedtimeRun.current) return;
        enter(true);
        setBedtime((b) => (b ? { ...b, line: -1, asleep: true } : b));
      }, ms + 100);
    }, at);
    // A sleep timer: the song stops after 20 minutes.
    later(() => {
      if (me === bedtimeRun.current) window.dispatchEvent(new CustomEvent(MUSIC_EVENT, { detail: { action: "pause" } }));
    }, 20 * 60_000);
  }
  function wakeUp() {
    bedtimeRun.current++;
    petHush();
    beat.setTempColor(null);
    setBedtime(null);
    busy.current = 0;
    comeOut();
  }
  // Leaving the page ends bedtime's warm glow (the owner's own colour comes back).
  // ...and so does Nova's voice: a line it is saying must not carry on over the next page.
  useEffect(
    () => () => {
      beat.setTempColor(null);
      petHush();
    },
    [],
  );
  // ?goodnight=1 (from chat or voice): once the island is ready.
  const bedtimeStarted = useRef(false);
  useEffect(() => {
    if (!bedtimeAsk || !sceneId || bedtimeStarted.current) return;
    bedtimeStarted.current = true;
    void goodNight();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, when the island is ready
  }, [bedtimeAsk, sceneId]);

  useVoiceActions({
    garden_goodnight: {
      description: "Nova's garden page: the bedtime routine ('Nova, good night'): night falls, a calm song plays softly, the music lights glow warm, Nova says tomorrow's plan and goes to sleep in its cottage. input: 'start', or 'wake' to end it.",
      run: ({ input }) => {
        if (/wake|morning|end|stop|cancel/i.test(String(input))) {
          wakeUp();
          return { woke: true };
        }
        void goodNight();
        return { started: true, note: "Say good night warmly in a few words, then stay quiet: Nova tells them tomorrow's plan." };
      },
    },
    garden_festival: {
      description: "Nova's garden page: dress the island for a festival or season to preview it. input: 'deepavali' (lamps, rangoli, fireworks), 'karthigai' (oil lamps along the path), 'pongal' (kolam, sugarcane, pongal pot), 'puthandu' (kolam, mango-leaf toran, mangoes), 'christmas' (a lit tree and gifts), 'india' (the tricolour flag), 'monsoon' (puddles, frogs) or 'today' (back to today's).",
      run: ({ input }) => {
        const t = String(input).toLowerCase();
        if (/monsoon|rain|mazhai/.test(t)) {
          setMonsoon(true);
          setFest(null);
          return { shown: "monsoon" };
        }
        const id = /deepa|diwali/.test(t) ? "deepavali" : /karthi|deepam/.test(t) ? "karthigai" : /pongal|sankranti/.test(t) ? "pongal" : null;
        if (!id) {
          const today = festivalOn(todayLocal())?.id ?? null;
          setFest((DECOR as readonly string[]).includes(today ?? "") ? today : null);
          setMonsoon(monsoonMonth());
          return { shown: "today" };
        }
        setFest(id);
        setMonsoon(false);
        return { shown: festivalById(id)?.name };
      },
    },
    garden_day: {
      description: "Nova's garden page: open what happened on a date (the day a flower was planted): mood, check-in, habits, songs, notes. input: a date like 2026-10-14.",
      run: ({ input }) => {
        const d = String(input).trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return { error: "Say a date like 2026-10-14." };
        void openDay(d);
        return { opened: d };
      },
    },
    garden_nova: {
      description: "Nova's garden page: Nova and its cottage. input: 'out' (call Nova out of the cottage), 'nap' (send it in for a nap).",
      run: ({ input }) => {
        const out = !/nap|sleep|home|in\b|inside|thoongu/i.test(String(input));
        if (out === !insideRef.current) return { already: out ? "Nova is already outside" : "Nova is already inside" };
        pick("home");
        return { done: out ? "Nova is coming out" : "Nova went in for a nap" };
      },
    },
    garden_find: {
      description: "Nova's garden page: show one of the things that grew; Nova walks to it and its label shows (a flower opens its day too). input: 'flower', 'tree', 'lamp', 'gem' or 'seed' (a habit's plant).",
      run: ({ input }) => {
        const t = String(input).toLowerCase();
        const kind = /seed|sprout|sapling|plant|habit/.test(t) ? "plant" : /tree|maram/.test(t) ? "tree" : /lamp|lantern|vilakku/.test(t) ? "lamp" : /gem|diamond|win/.test(t) ? "gem" : "flower";
        const list = placed.filter((x) => x.kind === kind);
        if (!list.length) return { none: `No ${kind}s on the island yet.` };
        const it = list[Math.floor(Math.random() * list.length)];
        pick(it.id);
        return { showing: it.label, count: list.length };
      },
    },
    garden_close: {
      description: "Nova's garden page: close the day card (the day a flower was planted).",
      run: () => {
        setDay(null);
        return { closed: true };
      },
    },
    garden_describe: {
      description: "Nova's garden page: what has grown on the island (flowers from habits, a seed for each habit that becomes a tree after 21 days in a row, trees from night check-ins, lamps from lantern walks, gems from game wins, butterflies from songs).",
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
      {/* AR: while the garden sits on a real table, this layer is what stays on screen (see GardenScene.enterAR). */}
      <div ref={arUi} className="pointer-events-none fixed inset-0 z-[90] text-white">
        {ar && (
          <>
            <p className="pointer-events-none absolute inset-x-4 top-6 rounded-2xl bg-black/55 px-4 py-3 text-center text-sm backdrop-blur-md">
              {ar === "find" ? "Point the phone at a table or the floor and move it slowly. Tap when the ring shows." : "Walk around it! Tap Move it to put it somewhere else."}
            </p>
            <div className="pointer-events-auto absolute inset-x-4 bottom-8 flex justify-center gap-3">
              {ar === "placed" && (
                <button type="button" onClick={() => scene.current?.moveAR()} className="rounded-full bg-white/90 px-5 py-3 text-sm font-semibold text-black">
                  Move it
                </button>
              )}
              <button type="button" onClick={() => scene.current?.exitAR()} className="rounded-full bg-black/70 px-5 py-3 text-sm font-semibold ring-1 ring-white/30">
                Exit AR
              </button>
            </div>
          </>
        )}
      </div>
      <ErrorText error={feed.error} />
      {/* The garden fills the page; its title and what has grown float over it on glass. */}
      <div
        ref={box}
        data-garden
        onPointerMove={onPointer}
        onPointerDown={() => setHint(false)}
        className="relative h-[calc(100dvh-9.5rem)] min-h-[460px] overflow-hidden rounded-3xl bg-[#0b1220] shadow-[0_30px_80px_-30px_rgba(0,0,0,.8)] ring-1 ring-white/10 select-none sm:h-[calc(100dvh-5rem)]"
      >
        <div ref={host} className="absolute inset-0" />

        {/* The pet, standing where it is in the scene. */}
        {g && ready && (
          <div ref={petEl} className="pointer-events-none absolute top-0 left-0" style={{ width: 80, height: 80, visibility: "hidden" }}>
            <div className="h-full w-full" style={{ opacity: inside ? 0 : 1, transform: inside ? "scale(0.5) translateY(-8%)" : "none", transformOrigin: "50% 90%", transition: "opacity .45s ease, transform .45s ease" }}>
              <div className="absolute inset-x-[22%] bottom-[7%] h-[9%] rounded-[50%] bg-black/30 blur-[3px]" />
              <div className={walking ? "garden-walk h-full w-full" : love ? "garden-hop h-full w-full" : "h-full w-full"}>
                <Creature stage={g.stage} mood={night || (mood !== null && mood <= 2) ? "sleepy" : "happy"} look={{ x: (walking ? facing : lookAt) * 2.4, y: 0 }} eating={love} evolving={false} poked={false} sky={sky} />
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
        <div className="pointer-events-none absolute top-4 left-4 max-w-[calc(100%-6.5rem)] sm:top-7 sm:left-8 sm:max-w-none">
          <h1 className="text-xl leading-tight font-semibold tracking-tight text-white drop-shadow-[0_2px_14px_rgba(0,0,0,.55)] sm:text-[2.6rem]">{g?.pet ?? "Nova"}&apos;s garden</h1>
          <p className="mt-1 hidden max-w-sm text-[13px] text-white/80 drop-shadow sm:block sm:text-sm">Everything you keep up with grows here.</p>
          {/* What the garden is like right now, as small glass chips (laptop and bigger). */}
          <div className="mt-3 hidden flex-wrap gap-1.5 sm:flex">
            {[
              bedtime ? "🌙 Bedtime" : `${PHASE_ICON[phase]} ${PHASE_NAME[phase]}`,
              fest ? `${DECOR_ICON[fest] ?? ""} ${festivalById(fest)?.name ?? fest}` : monsoon || wet ? `${DECOR_ICON.monsoon} Monsoon` : "",
              `${SEASON_ICON[season]} ${season[0].toUpperCase()}${season.slice(1)}`,
              g && g.streak > 0 ? `🔥 ${g.streak}-day streak` : "",
              mood !== null ? MOOD_TEXT[mood - 1] : "",
            ]
              .filter(Boolean)
              .map((t) => (
                <span key={t} className="rounded-full border border-white/20 bg-black/25 px-2.5 py-1 text-[11px] font-medium text-white/90 shadow-sm backdrop-blur-md">
                  {t}
                </span>
              ))}
          </div>
        </div>

        {/* What has grown: glass cards along the bottom. */}
        {g && !bedtime && (
          <div className="absolute inset-x-3 bottom-3 flex gap-2 overflow-x-auto pr-16 pb-1 [scrollbar-width:none] sm:inset-x-6 sm:bottom-6 sm:gap-3 sm:pr-0">
            {[
              ["🌸", c?.flowers ?? 0, "Flowers", "a day a habit was done"],
              ["🌳", c?.trees ?? 0, "Trees", "4 night check-ins each"],
              ["🌱", `${c?.grown ?? 0}/${(c?.grown ?? 0) + (c?.seeds ?? 0)}`, "Habit trees", "21 days in a row each"],
              ["🏮", c?.lamps ?? 0, "Lamps", "lantern walks"],
              ["💎", c?.gems ?? 0, "Gems", "games won"],
              ["🎵", c?.music ?? 0, "Music flowers", "a song you listened to"],
              ["🦋", c?.butterflies ?? 0, "Butterflies", "songs you played"],
            ].map(([e, num, what, why]) => (
              <div key={String(what)} className="flex shrink-0 items-center gap-2 rounded-full border border-white/20 bg-gradient-to-b from-white/20 to-white/5 px-3 py-1.5 text-white shadow-[0_8px_24px_-8px_rgba(0,0,0,.45)] backdrop-blur-xl transition hover:from-white/30 sm:min-w-[150px] sm:gap-3 sm:rounded-2xl sm:px-3.5 sm:py-2.5" title={String(why)}>
                <span className="grid size-7 shrink-0 place-items-center rounded-full bg-black/25 text-sm ring-1 ring-white/20 sm:size-10 sm:text-xl">{e}</span>
                <div className="flex items-baseline gap-1.5 sm:block">
                  <span className="text-base leading-none font-semibold tabular-nums sm:block sm:text-2xl">{num}</span>
                  <p className="whitespace-nowrap text-[11px] font-medium text-white/90 sm:mt-0.5">{what}</p>
                  <p className="hidden text-[10px] leading-tight text-white/60 sm:block">{why}</p>
                </div>
              </div>
            ))}
          </div>
        )}

        {ready && hint && <div className="pointer-events-none absolute inset-x-0 top-[40%] flex justify-center transition-opacity sm:top-auto sm:right-8 sm:bottom-[8.6rem] sm:left-auto sm:justify-end"><span className="rounded-full border border-white/20 bg-black/30 px-3.5 py-1.5 text-xs font-medium text-white/90 shadow-lg backdrop-blur-md">👆 Drag to look around · pinch to zoom · tap anything</span></div>}
        {day && <DayCard day={day} onClose={() => setDay(null)} />}
        {ready && g && !bedtime && (
          <div className="absolute top-4 right-4 z-10 flex flex-col items-end gap-2 sm:top-7 sm:right-8">
            <div className="flex gap-2">
              {arOk && (
                <button onClick={() => void startAR()} aria-label="Show the garden on my table, through the camera" className="flex items-center gap-1.5 rounded-full border border-emerald-200/40 bg-emerald-950/55 px-3 py-2 text-xs font-medium text-emerald-100 shadow-lg backdrop-blur-md transition hover:bg-emerald-900/65">
                  📱<span className="hidden sm:inline"> On my table</span>
                </button>
              )}
              <button onClick={() => void shareGarden()} aria-label="Share a picture of the garden" className="flex items-center gap-1.5 rounded-full border border-white/25 bg-black/40 px-3 py-2 text-xs font-medium text-white shadow-lg backdrop-blur-md transition hover:bg-black/55">
                📸<span className="hidden sm:inline"> Share</span>
              </button>
              <button onClick={() => void goodNight()} aria-label="Good night" className="flex items-center gap-1.5 rounded-full border border-indigo-200/30 bg-[#0d1024]/70 px-3 py-2 text-xs font-medium text-indigo-100 shadow-lg backdrop-blur-md transition hover:bg-[#161a3a]/80">
                🌙<span className="hidden sm:inline"> Good night</span>
              </button>
            </div>
            {sharing && <p className="rounded-full bg-black/55 px-3 py-1 text-[11px] text-white/90 backdrop-blur-md">{sharing}</p>}
          </div>
        )}
        {bedtime && (
          <div className="absolute inset-x-3 bottom-3 z-10 sm:inset-x-auto sm:bottom-6 sm:left-1/2 sm:w-[520px] sm:-translate-x-1/2">
            {!bedtime.asleep ? (
              <div key={bedtime.line} className="garden-sheet rounded-2xl border border-indigo-200/20 bg-[#0d1024]/80 p-4 text-white shadow-2xl backdrop-blur-xl">
                <p className="text-[11px] text-indigo-200/80">🌙 {g?.pet ?? "Nova"} · bedtime</p>
                <p className="mt-1 text-sm leading-snug">{bedtime.plan && bedtime.line >= 0 ? bedtime.plan.lines[bedtime.line] : `${g?.pet ?? "Nova"} is getting sleepy…`}</p>
              </div>
            ) : (
              <div className="garden-sheet flex items-center justify-between gap-3 rounded-2xl border border-indigo-200/20 bg-[#0d1024]/80 p-4 text-white shadow-2xl backdrop-blur-xl">
                <div>
                  <p className="text-sm font-medium">💤 {g?.pet ?? "Nova"} is asleep</p>
                  <p className="text-xs text-white/60">The song stops by itself in 20 minutes. Good night!</p>
                </div>
                <button onClick={wakeUp} className="shrink-0 rounded-full border border-white/20 px-3 py-1.5 text-xs hover:bg-white/10">
                  ☀️ Wake up
                </button>
              </div>
            )}
          </div>
        )}
        {g && !g.items.length && <div className="pointer-events-none absolute inset-x-0 top-1/3 text-center text-sm text-white/90 drop-shadow">The island is waiting. Finish a habit today to plant the first flower 🌱</div>}
      </div>
    </div>
  );
}

/** What happened on the day a flower was planted: a glass card over the island. */
function DayCard({ day, onClose }: { day: { date: string; data?: GardenDay; error?: string }; onClose: () => void }) {
  const d = day.data;
  const pretty = new Date(`${day.date}T12:00:00`).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const empty = d && !d.mood && !d.habits.length && !d.songs.length && !d.notes.length && !d.memories.length && !d.wins.length && !d.walked;
  return (
    <div className="garden-sheet absolute inset-x-3 bottom-3 z-10 max-h-[64%] overflow-y-auto rounded-3xl border border-white/15 bg-[#0b1220]/75 p-5 text-white shadow-2xl backdrop-blur-2xl sm:inset-x-auto sm:top-6 sm:right-6 sm:bottom-6 sm:max-h-none sm:w-[360px]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] tracking-[0.3em] text-white/50 uppercase">A day in your garden</p>
          <h2 className="mt-1 text-lg leading-snug font-semibold">{pretty}</h2>
          {d?.festival && <p className="mt-1 text-xs text-amber-200">✨ {d.festival}</p>}
        </div>
        <button onClick={onClose} aria-label="Close" className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white/10 text-white/80 hover:bg-white/20">
          ✕
        </button>
      </div>

      {!d && !day.error && <p className="mt-6 animate-pulse text-sm text-white/60">Opening the day…</p>}
      {day.error && <p className="mt-6 text-sm text-rose-300">{day.error}</p>}
      {empty && <p className="mt-6 text-sm text-white/70">A quiet day. Just this little flower to remember it by 🌸</p>}

      {d?.mood && (
        <div className="mt-5 flex gap-3 rounded-2xl bg-white/5 p-3.5">
          <span className="text-4xl leading-none">{d.mood.emoji}</span>
          <div className="min-w-0">
            <p className="text-sm font-medium">You felt {d.mood.word}</p>
            {d.reflection && <p className="mt-1 text-sm leading-relaxed whitespace-pre-line text-white/75">“{d.reflection}”</p>}
          </div>
        </div>
      )}

      {!!d?.habits.length && (
        <Section title="Done that day">
          <div className="flex flex-wrap gap-1.5">
            {d.habits.map((h) => (
              <span key={h.name} className="rounded-full bg-emerald-400/15 px-2.5 py-1 text-xs text-emerald-100">
                {h.emoji} {h.name}
              </span>
            ))}
          </div>
        </Section>
      )}

      {!!d?.songs.length && (
        <Section title="Songs you played">
          <ul className="space-y-2">
            {d.songs.map((s) => (
              <li key={s.title} className="flex items-center gap-2.5">
                {s.image ? (
                  // eslint-disable-next-line @next/next/no-img-element -- remote album art
                  <img src={s.image} alt="" className="h-9 w-9 shrink-0 rounded-lg object-cover" />
                ) : (
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-white/10">🎵</span>
                )}
                <div className="min-w-0">
                  <p className="truncate text-sm">{s.title}</p>
                  <p className="truncate text-xs text-white/55">{s.artists}</p>
                </div>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {!!(d?.notes.length || d?.memories.length) && (
        <Section title="You saved">
          <ul className="space-y-1.5 text-sm">
            {d.notes.map((x) => (
              <li key={x.title} className="rounded-xl bg-white/5 px-3 py-2">
                📝 {x.title}
                {x.summary && <span className="mt-0.5 block text-xs text-white/55">{x.summary}</span>}
              </li>
            ))}
            {d.memories.map((m) => (
              <li key={m} className="rounded-xl bg-white/5 px-3 py-2">
                🧠 {m}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {!!(d?.wins.length || d?.walked) && (
        <Section title="With Nova">
          <div className="flex flex-wrap gap-1.5 text-xs">
            {d.wins.map((w, i) => (
              <span key={i} className="rounded-full bg-sky-400/15 px-2.5 py-1 text-sky-100">
                💎 Won {w}
              </span>
            ))}
            {d.walked && <span className="rounded-full bg-amber-400/15 px-2.5 py-1 text-amber-100">🏮 Lantern walk</span>}
          </div>
        </Section>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-5">
      <p className="mb-2 text-[11px] font-medium tracking-wide text-white/50 uppercase">{title}</p>
      {children}
    </div>
  );
}
