"use client";

import { ArrowUpRight, Bell, Camera, Check, ChevronLeft, ChevronRight, ChevronUp, Clock3, Cloud, CloudDrizzle, CloudFog, CloudLightning, CloudRain, CloudSnow, CloudSun, Download, Globe, Hammer, Info, Keyboard, Loader2, Moon, Newspaper, Pause, Play, Radar, Send, Sparkles, Square, Sun, Volume2, VolumeX, X } from "lucide-react";
import { Ambience } from "@/components/mission/ambience";
import { festivalOn } from "@/lib/pet-looks";
import Link from "next/link";
import { type CSSProperties, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { FLOOR_OF, FLOORS, MissionScene, type MissionView, type SiteWeather, type SkyMode } from "@/components/mission/mission-scene";
import { api, type HiveEvent, streamHivemind } from "@/lib/client-api";
import { ago, type AgentState, type CrewAgent, type CrewId, type SystemStats } from "@/lib/mission";

type Mission = { crew: CrewAgent[]; summary: string; at: string; stats?: SystemStats; activity?: Array<{ message: string; at: string }> };
const POLL_MS = 6000;
const DOT: Record<AgentState, string> = { working: "bg-emerald-300", idle: "bg-sky-300", sleeping: "bg-slate-400", alert: "bg-rose-400" };
const WORD: Record<AgentState, string> = { working: "Working", idle: "Ready", sleeping: "Asleep", alert: "Needs you" };
/** Which of HIVEMIND's tools belong to which background agent: when your command uses one, that agent's station lights up. */
const TOOL_AGENT: Array<[RegExp, CrewId]> = [
  [/^web_task/, "web"],
  [/^(create|list|open|change|delete)_apps?$/, "apps"],
  [/autopilot/, "autopilot"],
  [/reminder|birthday|habit/, "reminders"],
  [/^(morning_brief|brief_topics)$/, "brief"],
  [/^dream_report$/, "dream"],
  [/routine/, "scheduler"],
];
/** The status pill in the inspector, one look per state. */
const PILL: Record<AgentState, string> = {
  working: "border-emerald-300/40 bg-emerald-300/10 text-emerald-200",
  idle: "border-sky-300/40 bg-sky-300/10 text-sky-200",
  sleeping: "border-slate-400/40 bg-slate-400/10 text-slate-300",
  alert: "border-rose-400/50 bg-rose-400/15 text-rose-200",
};
/** Examples the console's placeholder cycles through: things HIVEMIND's agents really do. */
const EXAMPLES = ["Remind me to stretch at 4 pm", "What's on my plate today?", "Find remote React jobs posted this week", "Build me a simple habit tracker app", "Brief me on today's AI news"];
/** Stagger delay for one piece of the HUD as it settles in after the opening shot. */
const D = (ms: number) => ({ "--d": `${ms}ms` }) as CSSProperties;
/** One line of the mission log; `at` is ms since the command was sent, `who` the agent whose tool it is. */
/** A live notice: an agent's state change (with its agent, so a click opens it) or a new activity line. */
type Toast = { id: number; text: string; sub?: string; state?: AgentState; agent?: CrewId };
const TOAST_MS = 5200;
const CHANGED: Record<AgentState, string> = { working: "started working", idle: "is ready", sleeping: "went to sleep", alert: "needs you" };
type Step = { key: string; text: string; status: "run" | "ok" | "error" | "info"; at: number; who?: string };
/** Seconds as the log's clock shows them: 4.2s, then 1:05 past a minute. */
const clock = (ms: number) => (ms < 60000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")}`);

export default function MissionPage() {
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<MissionScene | null>(null);
  const latest = useRef<CrewAgent[]>([]);
  const feedRef = useRef<Array<{ message: string; at: string }>>([]);
  const reload = useRef<() => void>(() => {});
  const [mission, setMission] = useState<Mission | null>(null);
  const [error, setError] = useState(false);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState<CrewId | null>(null);
  const [now, setNow] = useState(0);
  const [touring, setTouring] = useState(false);
  // the tour's running order (fixed when it starts), where it is, and whether it is held on one agent
  const [tourOrder, setTourOrder] = useState<CrewId[]>([]);
  const [tourIdx, setTourIdx] = useState(0);
  const [tourPaused, setTourPaused] = useState(false);
  const [ready, setReady] = useState(false);
  // the loading curtain never traps the page: it lifts when the crew arrives, on an error, or after 8 s regardless
  const [late, setLate] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setLate(true), 8000);
    return () => clearTimeout(t);
  }, []);
  const lifted = ready || late || error;
  const [listOpen, setListOpen] = useState(false);
  // the sheet has two tabs: the crew, and the logbook of the latest activity
  const [sheetTab, setSheetTab] = useState<"crew" | "log">("crew");
  const [view, setView] = useState<MissionView>("outside");
  // a lower-third caption names where the camera just went (not on the first view: the opening shot owns that)
  const [caption, setCaption] = useState<{ key: number; title: string; sub: string } | null>(null);
  const shownView = useRef<MissionView>("outside");
  const [hover, setHover] = useState<{ id: CrewId; x: number; y: number } | null>(null);
  const [sky, setSky] = useState<SkyMode>("live");
  // the real weather at home (HIVEMIND's own weather source): clouds, rain and fog in the scene, and a small chip
  const [wx, setWx] = useState<(SiteWeather & { temp_c: number; condition: string; place: string }) | null>(null);
  // photo mode: the HUD steps aside for a clean view of the building
  const [bare, setBare] = useState(false);
  // photo mode can save the view as a picture (P); a counter keys the shutter flash
  const [shot, setShot] = useState(0);
  const savePicture = useCallback(() => {
    const url = scene.current?.snapshot();
    if (!url) return;
    const a = document.createElement("a");
    a.href = url;
    const d = new Date();
    a.download = `hivemind-tower-${localDate(d.getTime())}-${String(d.getHours()).padStart(2, "0")}${String(d.getMinutes()).padStart(2, "0")}.png`;
    a.click();
    setShot((n) => n + 1);
  }, []);
  // the keyboard sheet (?), and the lift panel's lit car
  const [help, setHelp] = useState(false);
  // the "needs you" banner put off: hidden until that agent says something new
  const [later, setLater] = useState<string | null>(null);
  // the floor map: the scene moves its dots each frame
  const mapRef = useRef<HTMLDivElement>(null);
  // lets the agent panel hand a job to the console ("Give a job": that agent picked, cursor in the box)
  const consoleApi = useRef<ConsoleApi | null>(null);
  // ambient sound: off until you turn it on (hum always; rain and wind from the real weather)
  const [sound, setSound] = useState(false);
  const amb = useRef<Ambience | null>(null);
  const liftRef = useRef<HTMLElement>(null);
  const [car, setCar] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  // live notices: an agent changing state, or a new line in the activity feed, slides in at the top right
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastId = useRef(0);
  const prevStates = useRef<Map<CrewId, AgentState> | null>(null);
  const seenFeed = useRef<Set<string> | null>(null);
  const notify = useCallback((t: Omit<Toast, "id">) => {
    const id = ++toastId.current;
    setToasts((s) => [...s.slice(-2), { ...t, id }]);
    setTimeout(() => setToasts((s) => s.filter((x) => x.id !== id)), TOAST_MS);
  }, []);

  const pick =useCallback((id: CrewId | null) => {
    setOpen(id);
    if (id) setView(`f${FLOOR_OF[id]}` as MissionView); // picking an agent takes you to its floor
    scene.current?.select(id);
  }, []);

  // Anything the user does themselves ends the tour.
  const userPick = useCallback(
    (id: CrewId | null) => {
      setTouring(false);
      pick(id);
    },
    [pick],
  );

  const go = useCallback((v: MissionView) => {
    setTouring(false);
    setOpen(null);
    setView(v);
    scene.current?.setView(v);
  }, []);

  // The tour: visit each robot in turn, anyone who needs you first. It can be held and stepped (buttons or arrow keys).
  const showTour = useCallback(
    (order: CrewId[], i: number) => {
      setTourIdx(i);
      if (order.length) pick(order[i]);
    },
    [pick],
  );
  const startTour = useCallback(() => {
    const order = [...latest.current].sort((a, b) => Number(b.state === "alert") - Number(a.state === "alert")).map((c) => c.id);
    setTourOrder(order);
    setTourPaused(false);
    setTouring(true);
    showTour(order, 0);
  }, [showTour]);
  const stepTour = useCallback(
    (d: number) => {
      const n = Math.max(1, tourOrder.length);
      showTour(tourOrder, (tourIdx + d + n) % n);
    },
    [tourOrder, tourIdx, showTour],
  );
  useEffect(() => {
    if (!touring || tourPaused) return;
    const t = setTimeout(() => stepTour(1), TOUR_MS);
    return () => clearTimeout(t);
  }, [touring, tourPaused, stepTour]);

  useEffect(() => {
    scene.current?.setSky(sky);
  }, [sky]);

  useEffect(() => {
    let live = true;
    const load = () =>
      api<{ place: string; current: { temp_c: number; condition: string; code: number; rain_mm: number; wind_kmh: number } }>("/api/tools/weather")
        .then((w) => {
          if (!live) return;
          const c = w.current;
          setWx({ code: c.code, rain_mm: c.rain_mm, wind_kmh: c.wind_kmh, temp_c: c.temp_c, condition: c.condition, place: w.place });
        })
        .catch(() => {}); // no weather: the scene keeps a fair sky and no chip shows
    load();
    const t = setInterval(load, 15 * 60_000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, []);

  useEffect(() => {
    if (wx) scene.current?.setWeather(wx);
  }, [wx, ready]);

  // a festival today (HIVEMIND's own calendar): the lamp festivals light clay lamps on the tower
  const fest = now > 0 ? festivalOn(localDate(now)) : null;
  useEffect(() => {
    scene.current?.setFestival(fest?.id ?? null);
  }, [fest?.id, ready]);

  useEffect(() => {
    const s = scene.current;
    s?.attachMap(mapRef.current);
    return () => s?.attachMap(null);
  }, [ready, mission?.crew.length, open]);

  useEffect(() => {
    if (!sound) return;
    const a = new Ambience();
    amb.current = a;
    a.start(null);
    const onVis = () => a.pause(document.hidden);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      a.stop();
      amb.current = null;
    };
  }, [sound]);

  useEffect(() => {
    amb.current?.setWeather(wx);
  }, [wx, sound]);

  // Keyboard: E outside, 2 / 1 / G the floors, L the lobby, T the tour, H photo mode, Esc to close (instant, no animation)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (e.metaKey || e.ctrlKey || e.altKey || (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)))) return;
      const k = e.key.toLowerCase();
      const to = FLOOR_BUTTONS.find((f) => f.key.toLowerCase() === k);
      if (k === "?") setHelp((h) => !h);
      else if (k === "escape" && help) setHelp(false);
      else if (to) go(to.v);
      else if (k === "t") {
        if (touring) {
          setTouring(false);
          pick(null);
        } else startTour();
      } else if (touring && (k === "arrowleft" || k === "arrowright")) stepTour(k === "arrowright" ? 1 : -1);
      else if (k === "h") setBare((b) => !b);
      else if (k === "m") setSound((s) => !s);
      else if (k === "p" && bare) savePicture();
      else if (k === "escape") {
        if (open) userPick(null);
        else setBare(false);
      } else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, pick, userPick, touring, open, help, startTour, stepTour, bare, savePicture]);

  // The lift car: a lit block that slides to the pressed floor button (measured, so it fits both the column and the phone bar).
  useLayoutEffect(() => {
    const nav = liftRef.current;
    if (!nav) return;
    const place = () => {
      const b = nav.querySelector<HTMLElement>(`[data-v="${view}"]`);
      setCar(b ? { x: b.offsetLeft, y: b.offsetTop, w: b.offsetWidth, h: b.offsetHeight } : null);
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(nav);
    return () => ro.disconnect();
  }, [view]);

  // A fresh canvas per effect: a canvas whose WebGL context was released can't get a new one (dev strict mode).
  useEffect(() => {
    if (!host.current) return;
    const el = document.createElement("canvas");
    el.className = "absolute inset-0 block h-full w-full touch-none cursor-grab";
    el.setAttribute("aria-label", "Your background agents as robots in their headquarters. Drag to look around, scroll or pinch to zoom, tap a robot for details.");
    host.current.appendChild(el);
    let s: MissionScene;
    try {
      s = new MissionScene(el, { onSelect: userPick, onHover: (id, x, y) => setHover(id ? { id, x, y } : null), onReady: () => setReady(true), onBolt: () => amb.current?.thunder() });
    } catch {
      el.remove();
      setTimeout(() => setFailed(true));
      return;
    }
    scene.current = s;
    if (latest.current.length) s.setCrew(latest.current);
    if (feedRef.current.length) s.setFeed(feedRef.current);
    return () => {
      s.dispose();
      el.remove();
      scene.current = null;
    };
  }, [userPick]);

  useEffect(() => {
    let live = true;
    const load = () =>
      api<Mission>("/api/mission")
        .then((m) => {
          if (!live) return;
          // what changed since the last look (nothing on the first load: that is just how things are)
          const was = prevStates.current;
          if (was)
            for (const c of m.crew) {
              const before = was.get(c.id);
              if (before && before !== c.state) notify({ text: `${c.name} ${CHANGED[c.state]}`, sub: c.line, state: c.state, agent: c.id });
            }
          prevStates.current = new Map(m.crew.map((c) => [c.id, c.state]));
          const feed = m.activity ?? [];
          const seen = seenFeed.current;
          if (seen) for (const a of feed.filter((x) => !seen.has(x.at + x.message)).slice(0, 2)) notify({ text: a.message });
          seenFeed.current = new Set(feed.map((x) => x.at + x.message));
          latest.current = m.crew;
          feedRef.current = m.activity ?? [];
          setMission(m);
          setNow(Date.now());
          setError(false);
          scene.current?.setCrew(m.crew);
          scene.current?.setFeed(m.activity ?? []);
        })
        .catch(() => live && setError(true));
    reload.current = load;
    load();
    const t = setInterval(() => !document.hidden && load(), POLL_MS);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [notify]);

  useEffect(() => {
    if (view === shownView.current) return; // only on a real change (also safe when effects run twice)
    shownView.current = view;
    const all = latest.current;
    const n = view[0] === "f" ? Number(view[1]) : -1;
    const names = all.filter((c) => FLOOR_OF[c.id] === n).map((c) => c.name);
    const title = view === "outside" ? "The tower" : view === "lobby" ? "The lobby hall" : FLOORS[n];
    const sub = view === "outside" ? `${all.length} agents on 3 floors` : view === "lobby" ? "The coordination desk" : names.length ? names.join(" · ") : "Open office";
    setCaption((c) => ({ key: (c?.key ?? 0) + 1, title, sub }));
    const t = setTimeout(() => setCaption(null), 2900);
    return () => clearTimeout(t);
  }, [view]);

  const crew = mission?.crew ?? [];
  const stats = mission?.stats;
  const chosen = crew.find((c) => c.id === open) ?? null;
  const count = (s: AgentState) => crew.filter((c) => c.state === s).length;
  const urgent = crew.find((c) => c.state === "alert") ?? null;
  const active = count("working") + count("idle");

  return (
    // Sits inside the app frame: the sidebar (laptop) or title bar and tab bar (phone) stay visible.
    <div data-hud={lifted || failed ? "in" : "wait"} data-bare={bare ? "1" : "0"} className="fixed inset-x-0 top-[calc(env(safe-area-inset-top)+3.25rem)] bottom-[var(--tabbar-h)] z-10 select-none overflow-hidden bg-[#04060d] text-white md:top-0 md:bottom-0 md:left-52">
      <div ref={host} className="absolute inset-0" />

      {/* The lift panel: look at the tower from outside, into one of its floors, or down in the lobby hall. */}
      <nav ref={liftRef} aria-label="Floors" style={D(900)} className="mc-hud mc-in-left absolute inset-x-3 bottom-[4.5rem] z-10 flex border border-white/10 bg-[#0a0d14]/85 backdrop-blur-md sm:inset-x-auto sm:top-1/2 sm:bottom-auto sm:left-5 sm:block sm:w-14 sm:-translate-y-1/2">
        {/* the lift car: glides to the floor you pick, with a lit edge on the shaft side */}
        <span
          aria-hidden
          className="mc-car pointer-events-none absolute top-0 left-0 bg-[#38d6f5]/10 shadow-[inset_0_0_0_1px_rgba(56,214,245,0.3),0_0_18px_rgba(56,214,245,0.15)]"
          style={car ? { transform: `translate(${car.x}px, ${car.y}px)`, width: car.w, height: car.h } : { opacity: 0 }}
        >
          <span className="absolute inset-x-1.5 bottom-0 h-0.5 bg-[#38d6f5] shadow-[0_0_8px_#38d6f5] sm:inset-x-auto sm:inset-y-1.5 sm:left-0 sm:h-auto sm:w-0.5" />
        </span>
        <p className="hidden border-b border-white/10 py-1 text-center font-mono text-[8.5px] tracking-[0.2em] text-white/40 sm:block">LIFT</p>
        {FLOOR_BUTTONS.map((f) => {
          // who is on this floor right now: one status light per agent, like the lamps on a real lift panel
          const here = f.floor === undefined ? [] : crew.filter((c) => FLOOR_OF[c.id] === f.floor);
          const names = here.map((c) => `${c.name} ${WORD[c.state].toLowerCase()}`).join(", ");
          return (
            <button
              key={f.v}
              type="button"
              onClick={() => go(f.v)}
              aria-pressed={view === f.v}
              aria-label={names ? `${f.label}: ${names}` : f.label}
              aria-keyshortcuts={f.key}
              title={`${names ? `${f.label}: ${names}` : f.label} (${f.key})`}
              data-v={f.v}
              className="group relative flex min-w-0 flex-1 flex-col items-center justify-center gap-1 py-1.5 font-mono text-white/70 transition hover:text-[#38d6f5] focus-visible:outline-2 focus-visible:outline-[#38d6f5] aria-pressed:text-[#38d6f5] sm:w-full sm:py-2 [&+&]:border-l [&+&]:border-white/10 sm:[&+&]:border-t sm:[&+&]:border-l-0"
            >
              <span className={`grid h-7 min-w-7 place-items-center rounded-full border text-[10.5px] tracking-wider transition group-aria-pressed:border-[#38d6f5] group-aria-pressed:shadow-[0_0_10px_rgba(56,214,245,0.45)] ${f.floor === undefined ? "border-transparent px-1.5 text-[9px]" : "w-7 border-white/25"}`}>
                {f.short}
              </span>
              {here.length > 0 && (
                <span className="flex gap-1" aria-hidden>
                  {here.map((c) => (
                    <span key={c.id} className={`size-1.5 rounded-full ${DOT[c.state]} ${c.state === "alert" ? "animate-pulse" : ""}`} />
                  ))}
                </span>
              )}
            </button>
          );
        })}
      </nav>
      <div className="pointer-events-none absolute inset-0 [background:radial-gradient(ellipse_at_center,transparent_55%,rgba(4,6,13,0.55)_100%)]" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-[#04060d]/85 to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-36 bg-gradient-to-t from-[#04060d]/80 to-transparent" />

      {/* Header: identity, what's going on, and the system bar (real counts only). */}
      <div className="mc-hud pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-3 p-4 sm:p-5">
        <div className="min-w-0">
          <p style={D(300)} className="mc-in hud-label hidden text-[#38d6f5] sm:block">HIVEMIND · MISSION CONTROL</p>
          <h1 style={D(380)} className="mc-in text-base font-semibold sm:mt-1 sm:text-lg tracking-tight drop-shadow-[0_2px_14px_rgba(0,0,0,0.7)] sm:text-2xl">Your agents at work</h1>
          <p style={D(460)} className="mc-in mt-0.5 max-w-md truncate text-xs leading-snug text-white/65 sm:mt-1 sm:overflow-visible sm:whitespace-normal sm:text-[13px]">{mission ? mission.summary : error ? "Can't reach the crew" : "Waking the crew…"}</p>
          {stats && (
            <div style={D(560)} className="mc-in">
              <SystemBar stats={stats} active={active} />
            </div>
          )}
          {mission && now > 0 && (
            <div style={D(620)} className="mc-in hidden md:block">
              <DayTrack
                activity={mission.activity ?? []}
                now={now}
                onOpen={() => {
                  setSheetTab("log");
                  setListOpen(true);
                }}
              />
            </div>
          )}
        </div>
        <div style={D(640)} className="mc-in pointer-events-auto flex shrink-0 items-center gap-2">
          <LiveChip at={now} count={crew.length} error={error} />
          {chosen && (
            // phones close the panel with its own ×; the header has no room to spare there
            <span className="hidden sm:contents">
              <button type="button" onClick={() => userPick(null)} className={BTN}>
                Overview
              </button>
            </span>
          )}
          {fest && (
            <span title={`Today: ${fest.name}`} className="hidden h-9 items-center gap-1.5 border px-3 font-mono text-[10.5px] tracking-wider uppercase backdrop-blur-md md:flex" style={{ borderColor: `${fest.glow}66`, color: fest.glow, background: "rgba(10,13,20,0.8)" }}>
              {fest.id === "karthigai" || fest.id === "deepavali" ? "🪔" : "✦"} {fest.name}
            </span>
          )}
          {wx && (
            <span title={`Weather now in ${wx.place}: ${wx.condition}`} className="hidden h-9 items-center gap-1.5 border border-white/10 bg-[#0a0d14]/80 px-3 font-mono text-[10.5px] tracking-wider uppercase backdrop-blur-md md:flex">
              {(() => {
                const W = weatherIcon(wx.code);
                return <W size={13} className="text-[#7fe6fa]" aria-hidden />;
              })()}
              {Math.round(wx.temp_c)}°<span className="max-w-[9rem] truncate text-white/55 normal-case">{wx.condition}</span>
            </span>
          )}
          <button
            type="button"
            onClick={() => setSky((m) => SKY_NEXT[m])}
            aria-label={`Sky: ${SKY_LABEL[sky]}. Switch to ${SKY_LABEL[SKY_NEXT[sky]]}`}
            title={sky === "live" ? "Sky follows your clock. Click to see it by day" : `Showing the ${sky}. Click for ${SKY_LABEL[SKY_NEXT[sky]].toLowerCase()}`}
            className={`${BTN} ${sky !== "live" ? "border-[#38d6f5]/60 text-[#38d6f5]" : ""}`}
          >
            {sky === "day" ? <Sun size={13} /> : sky === "night" ? <Moon size={13} /> : <Clock3 size={13} />}
            <span className="hidden sm:inline">{SKY_LABEL[sky]}</span>
          </button>
          <button
            type="button"
            onClick={() => setSound((s) => !s)}
            aria-pressed={sound}
            aria-label={sound ? "Ambient sound on. Turn it off (M)" : "Ambient sound: the tower's hum, and rain when it is raining at home (M)"}
            title={sound ? "Sound on (M)" : "Ambient sound (M)"}
            className={`${BTN} aria-pressed:border-[#38d6f5]/60 aria-pressed:text-[#38d6f5]`}
          >
            {sound ? <Volume2 size={13} /> : <VolumeX size={13} />}
          </button>
          <span className="hidden sm:contents">
            <button type="button" onClick={() => setBare(true)} aria-label="Photo mode: hide the panels (H)" title="Photo mode (H)" className={BTN}>
              <Camera size={13} />
            </button>
          </span>
          <span className="hidden lg:contents">
            <button type="button" onClick={() => setHelp(true)} aria-label="Keyboard shortcuts (?)" title="Keyboard shortcuts (?)" className={BTN}>
              <Keyboard size={13} />
            </button>
          </span>
          {crew.length > 0 && (
            <button
              onClick={() => {
                if (touring) {
                  setTouring(false);
                  pick(null);
                } else startTour();
              }}
              aria-pressed={touring}
              className={`${BTN} aria-pressed:border-[#38d6f5]/60 aria-pressed:text-[#38d6f5]`}
            >
              {touring ? <Square size={12} /> : <Play size={12} />}
              {touring ? "Stop tour" : "Tour"}
            </button>
          )}
        </div>
      </div>

      {hover &&
        !chosen &&
        (() => {
          const a = crew.find((c) => c.id === hover.id);
          if (!a) return null;
          const w = typeof window === "undefined" ? 1200 : window.innerWidth;
          return (
            <div key={a.id} className="mc-hover pointer-events-none absolute z-20 w-64 border border-white/10 bg-[#0a0d14]/92 text-xs shadow-xl backdrop-blur-md" style={{ left: Math.max(8, Math.min(hover.x + 16, w - 264)), top: hover.y + 16 }}>
              <div className="flex items-center justify-between gap-2 border-b border-white/8 px-3 py-2">
                <span className="flex min-w-0 items-center gap-2">
                  <StatusLight state={a.state} />
                  <span className="truncate text-[13px] font-medium">{a.name}</span>
                </span>
                <span className={`shrink-0 rounded-full border px-1.5 py-px font-mono text-[8.5px] tracking-wider uppercase ${PILL[a.state]}`}>{WORD[a.state]}</span>
              </div>
              <div className="px-3 py-2">
                <p className="font-mono text-[9px] tracking-[0.18em] text-white/40 uppercase">
                  {FLOORS[FLOOR_OF[a.id]]} · {a.role}
                </p>
                <p className="mt-1 leading-snug text-white/85">{a.line}</p>
                <p className="mt-2 flex items-center gap-1 text-[10px] text-[#7fe6fa]/70">
                  Click to open <ArrowUpRight size={11} />
                </p>
              </div>
            </div>
          );
        })()}

      {bare && (
        <div className="absolute bottom-4 left-1/2 z-20 flex -translate-x-1/2 gap-2">
          <button type="button" onClick={savePicture} className="flex items-center gap-1.5 border border-[#38d6f5]/45 bg-[#0a0d14]/70 px-3 py-1.5 font-mono text-[10px] tracking-[0.2em] text-[#7fe6fa] uppercase backdrop-blur-md transition hover:border-[#38d6f5]/80 active:scale-[0.97]">
            <Download size={12} /> Save picture · P
          </button>
          <button type="button" onClick={() => setBare(false)} className="border border-white/15 bg-[#0a0d14]/70 px-3 py-1.5 font-mono text-[10px] tracking-[0.2em] text-white/70 uppercase backdrop-blur-md transition hover:text-white active:scale-[0.97]">
            Show panels · H
          </button>
        </div>
      )}
      {/* the shutter: a quick white flash when a picture is taken */}
      {shot > 0 && <div key={shot} aria-hidden className="mc-shutter pointer-events-none absolute inset-0 z-30 bg-white" />}

      {/* The loading curtain: lifts (a quick fade) the moment the scene is drawn, so the crane shot is the reveal. */}
      {!failed && (
        <div aria-hidden={lifted} className={`pointer-events-none absolute inset-0 z-[5] grid place-items-center bg-[#04060d] transition-opacity duration-700 ease-out ${lifted ? "opacity-0" : "opacity-100"}`}>
          <div className="flex w-60 flex-col items-center gap-4">
            {/* the tower drawing itself, floor by floor */}
            <svg width="120" height="96" viewBox="0 0 120 96" aria-hidden className="mc-build">
              <path d="M8 92 H112" className="stroke-white/25" />
              {[0, 1, 2].map((f) => (
                <rect key={f} x="22" y={66 - f * 22} width="76" height="22" style={{ animationDelay: `${f * 380}ms` }} className="stroke-[#38d6f5]" />
              ))}
              <path d="M30 4 H90 V0" className="stroke-[#38d6f5]/60" style={{ animationDelay: "1140ms" }} />
              <path d="M60 22 V88" className="stroke-white/20" style={{ animationDelay: "1300ms" }} />
            </svg>
            <span className="font-mono text-[11px] tracking-[0.5em] text-white/85">HIVEMIND</span>
            <ul role="status" className="w-full space-y-1.5 font-mono text-[10px] tracking-[0.2em] uppercase">
              {[
                ["The crew", !!mission || error],
                ["The weather", !!wx],
                ["The tower", ready],
              ].map(([label, done]) => (
                <li key={String(label)} className={`flex items-center justify-between transition-colors ${done ? "text-white/70" : "text-white/35"}`}>
                  {label}
                  {done ? <Check size={11} className="text-emerald-300" /> : <Loader2 size={11} className="animate-spin text-[#38d6f5]/70" />}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* No WebGL: the same crew as a plain list, so nothing is lost. */}
      {failed && (
        <div className="absolute inset-x-4 top-44 bottom-24 overflow-auto border border-white/10 bg-[#0a0d14]/90 sm:inset-x-auto sm:left-1/2 sm:w-[28rem] sm:-translate-x-1/2">
          <p className="border-b border-white/10 px-4 py-3 text-xs text-white/60">This device can&apos;t draw the 3D headquarters (it needs WebGL). Here is the crew as a list.</p>
          <AgentList crew={crew} open={open} now={now} onPick={(id) => userPick(open === id ? null : id)} />
        </div>
      )}

      {/* The agent list in a sheet, opened from the console. */}
      {listOpen && (
        <div className="absolute inset-0 z-30" role="dialog" aria-modal="true" aria-label="Agents">
          <button type="button" aria-label="Close" onClick={() => setListOpen(false)} className="absolute inset-0 bg-black/55" />
          <div className="sheet-up absolute inset-x-0 bottom-0 flex max-h-[75%] flex-col border-t border-white/10 bg-[#0a0d14] sm:inset-x-auto sm:bottom-4 sm:left-4 sm:w-80 sm:border">
            <div className="flex items-center justify-between border-b border-white/10 pr-2 pl-2">
              <div role="tablist" aria-label="Show" className="relative flex">
                {(["crew", "log"] as const).map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    role="tab"
                    aria-selected={sheetTab === tab}
                    onClick={() => setSheetTab(tab)}
                    className={`relative px-3 py-3 font-mono text-[10px] tracking-[0.2em] uppercase transition-colors ${sheetTab === tab ? "text-[#7fe6fa]" : "text-white/45 hover:text-white/75"}`}
                  >
                    {tab === "crew" ? `Crew · ${active}/${crew.length}` : `Activity · ${(mission?.activity ?? []).length}`}
                    <span aria-hidden className={`absolute inset-x-3 -bottom-px h-0.5 bg-[#38d6f5] shadow-[0_0_8px_#38d6f5] transition-opacity ${sheetTab === tab ? "opacity-100" : "opacity-0"}`} />
                  </button>
                ))}
              </div>
              <button type="button" onClick={() => setListOpen(false)} aria-label="Close" className="grid size-9 place-items-center text-white/70">
                <X size={16} />
              </button>
            </div>
            {sheetTab === "crew" ? (
              <>
                <div className="border-b border-white/8 px-4 pt-1 pb-2.5">
                  <StateCounts crew={crew} />
                </div>
                <AgentList
                  crew={crew}
                  open={open}
                  now={now}
                  onPick={(id) => {
                    setListOpen(false);
                    userPick(id);
                  }}
                />
              </>
            ) : (
              <Logbook activity={mission?.activity ?? []} now={now} />
            )}
          </div>
        </div>
      )}

      {urgent && !chosen && later !== urgent.id + urgent.line && (
        // something needs you: the agent, what it says, open it or put it off (until it says something new)
        <div
          role="status"
          className="mc-toast absolute bottom-[8.75rem] left-1/2 z-10 flex w-[min(30rem,92%)] -translate-x-1/2 items-center gap-3 overflow-hidden border border-rose-400/40 bg-[#1a0d12]/90 py-2 pr-2 pl-2.5 text-sm shadow-2xl backdrop-blur-md sm:bottom-[5.5rem]"
          style={{ boxShadow: "inset 3px 0 0 #fb7185, 0 25px 50px -12px rgba(0,0,0,0.6)" }}
        >
          <span className="scale-[0.8]">
            <Avatar id={urgent.id} state={urgent.state} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-mono text-[9px] tracking-[0.2em] text-rose-300 uppercase">Needs you</span>
            <span className="block truncate">
              <b className="font-medium">{urgent.name}</b> <span className="text-white/75">{urgent.line}</span>
            </span>
          </span>
          <button type="button" onClick={() => userPick(urgent.id)} className="flex h-8 shrink-0 items-center gap-1 bg-rose-400 px-3 text-xs font-medium text-[#1a0d12] transition hover:brightness-110 active:scale-[0.97]">
            Open <ArrowUpRight size={13} />
          </button>
          <button type="button" onClick={() => setLater(urgent.id + urgent.line)} className="h-8 shrink-0 px-2 text-xs text-white/55 transition hover:text-white" title="Hide this until it says something new">
            Later
          </button>
        </div>
      )}

      {/* The keyboard sheet: every shortcut on one card (? to open, Esc or a click outside to close). */}
      {help && (
        <div className="absolute inset-0 z-40 grid place-items-center p-4" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts">
          <button type="button" aria-label="Close" onClick={() => setHelp(false)} className="absolute inset-0 bg-black/55 backdrop-blur-[2px]" />
          <div className="mc-panel relative w-full max-w-md border border-white/10 bg-[#0a0d14]/95 shadow-2xl backdrop-blur-xl">
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
              <span className="hud-label">KEYBOARD</span>
              <button type="button" onClick={() => setHelp(false)} aria-label="Close" className="-mr-2 grid size-8 place-items-center text-white/70 hover:text-white">
                <X size={15} />
              </button>
            </div>
            <div className="grid gap-x-6 gap-y-1 p-4 sm:grid-cols-2">
              {KEYS.map(([group, rows]) => (
                <div key={group} className="mb-2">
                  <p className="mb-1.5 font-mono text-[9px] tracking-[0.2em] text-[#7fe6fa]/70 uppercase">{group}</p>
                  {rows.map(([keys, what]) => (
                    <p key={what} className="flex items-center justify-between gap-3 py-1 text-[12.5px] text-white/80">
                      {what}
                      <span className="flex shrink-0 gap-1">
                        {keys.map((k) => (
                          <kbd key={k} className="grid h-6 min-w-6 place-items-center rounded-[3px] border border-white/20 border-b-white/35 bg-white/[0.06] px-1.5 font-mono text-[10.5px] text-white/90 shadow-[0_1px_0_rgba(255,255,255,0.08)]">
                            {k}
                          </kbd>
                        ))}
                      </span>
                    </p>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* The floor map (wide screens): the tower in section, a dot per robot that moves as it walks or rides the lift. */}
      {!chosen && !failed && crew.length > 0 && (
        <div style={D(1000)} className="mc-hud mc-in absolute bottom-6 left-5 z-10 hidden w-56 border border-white/10 bg-[#0a0d14]/85 p-2.5 backdrop-blur-md lg:[@media(min-height:760px)]:block">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="font-mono text-[9px] tracking-[0.22em] text-white/45 uppercase">Floor map</span>
            <span className="flex items-center gap-1 font-mono text-[8.5px] tracking-[0.16em] text-emerald-300/80 uppercase">
              <span className="size-1 animate-pulse rounded-full bg-emerald-300" /> Live
            </span>
          </div>
          <div ref={mapRef} className="relative h-32">
            {MAP_ROWS.map((row, i) => (
              <button
                key={row.v}
                type="button"
                onClick={() => go(row.v)}
                aria-label={`Go to ${row.label}`}
                style={{ top: `${i * 25}%` }}
                className={`absolute inset-x-0 h-1/4 border-b text-left transition-colors ${i === 3 ? "border-transparent" : "border-white/10"} ${view === row.v ? "bg-[#38d6f5]/10" : "hover:bg-white/[0.04]"}`}
              >
                <span className={`absolute top-1/2 left-1 -translate-y-1/2 font-mono text-[8.5px] tracking-wider ${view === row.v ? "text-[#7fe6fa]" : "text-white/35"}`}>{row.short}</span>
              </button>
            ))}
            {/* the lift shaft, through the three floors */}
            <span aria-hidden className="pointer-events-none absolute top-0 left-1/2 h-3/4 w-[7%] -translate-x-1/2 border-x border-dashed border-white/15" />
            {crew.map((c) => (
              <button
                key={c.id}
                type="button"
                data-dot={c.id}
                onClick={() => userPick(c.id)}
                aria-label={`${c.name}, ${WORD[c.state].toLowerCase()}`}
                title={`${c.name} · ${WORD[c.state]}`}
                className={`mc-dot absolute top-1/2 left-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-[#0a0d14] transition-transform hover:scale-150 ${DOT[c.state]}`}
              />
            ))}
          </div>
        </div>
      )}

      {/* Live notices: newest at the bottom; each drains a thin bar as it times out. */}
      <ol aria-live="polite" className={`mc-hud pointer-events-none absolute inset-x-3 top-[9.5rem] z-20 flex flex-col items-end gap-2 sm:inset-x-auto sm:top-20 sm:right-4 sm:w-72 ${chosen ? "lg:right-[21.5rem]" : ""}`}>
        {toasts.map((t) => {
          const body = (
            <>
              <span className="flex items-start gap-2.5 px-3 py-2.5">
                <span className="mt-[5px]">{t.state ? <StatusLight state={t.state} /> : <span className="block size-2 rounded-full bg-[#38d6f5] shadow-[0_0_6px_#38d6f5]" />}</span>
                <span className="min-w-0 flex-1">
                  <span className="block font-mono text-[8.5px] tracking-[0.2em] text-white/40 uppercase">{t.agent ? "Status" : "Activity"}</span>
                  <span className="mt-0.5 line-clamp-2 block text-[12.5px] leading-snug text-white/90">{t.text}</span>
                  {t.sub && <span className="mt-0.5 block truncate text-[11px] text-white/50">{t.sub}</span>}
                </span>
                {t.agent && <ArrowUpRight size={13} className="mt-0.5 shrink-0 text-white/40 transition group-hover:text-[#38d6f5]" />}
              </span>
              <span aria-hidden className="mc-drain absolute inset-x-0 bottom-0 h-px origin-left bg-[#38d6f5]/60" style={{ animationDuration: `${TOAST_MS}ms` }} />
            </>
          );
          const cls = "mc-toast group relative block w-full overflow-hidden border border-white/10 bg-[#0a0d14]/92 text-left shadow-2xl backdrop-blur-xl";
          return (
            <li key={t.id} className="pointer-events-auto w-full max-w-xs">
              {t.agent ? (
                <button type="button" onClick={() => userPick(t.agent!)} className={`${cls} transition-colors hover:border-[#38d6f5]/45 focus-visible:outline-2 focus-visible:outline-[#38d6f5]`}>
                  {body}
                </button>
              ) : (
                <div className={cls}>{body}</div>
              )}
            </li>
          );
        })}
      </ol>

      {caption && (
        <div key={caption.key} aria-live="polite" className="mc-hud mc-caption pointer-events-none absolute bottom-[9rem] left-4 z-[6] sm:bottom-[5.75rem] sm:left-24 lg:[@media(min-height:760px)]:left-[17rem]">
          <p className="font-mono text-[9.5px] tracking-[0.3em] text-[#38d6f5] uppercase">Now viewing</p>
          <p className="mt-0.5 text-2xl font-semibold tracking-tight sm:text-3xl">{caption.title}</p>
          <p className="mt-0.5 text-xs text-white/65">{caption.sub}</p>
        </div>
      )}

      {/* The agent inspector: right column on laptops, a card above the console on phones. */}
      {chosen && (
        <div
          key={chosen.id}
          className="mc-hud mc-panel absolute inset-x-3 bottom-[8.5rem] z-20 sm:bottom-[5.25rem] mx-auto max-h-[55%] max-w-sm overflow-y-auto border border-white/10 bg-[#0a0d14]/92 p-4 shadow-2xl backdrop-blur-xl lg:inset-x-auto lg:top-20 lg:right-4 lg:bottom-auto lg:mx-0 lg:max-h-[calc(100%-12rem)] lg:w-80"
          role="dialog"
          aria-label={`${chosen.name} inspector`}
          style={{ boxShadow: `inset 0 2px 0 ${RING[chosen.state]}, 0 25px 50px -12px rgba(0,0,0,0.6)` }}
        >
          {touring && (
            // the tour strip: where we are, step back / hold / step on / stop, and a bar for this stop's time
            <div className="-mx-4 -mt-4 mb-3 border-b border-white/10 bg-[#38d6f5]/[0.06]">
              <div className="flex items-center justify-between gap-2 py-1 pr-2 pl-4">
                <span className="font-mono text-[9.5px] tracking-[0.2em] text-[#7fe6fa] uppercase">
                  Tour · <span className="tabular-nums">{(tourIdx % Math.max(1, tourOrder.length)) + 1}/{tourOrder.length}</span>
                  {tourPaused && <span className="text-white/45"> · held</span>}
                </span>
                <span className="flex items-center">
                  <button type="button" onClick={() => stepTour(-1)} aria-label="Previous agent (←)" title="Previous (←)" className={TOUR_BTN}>
                    <ChevronLeft size={14} />
                  </button>
                  <button type="button" onClick={() => setTourPaused((p) => !p)} aria-label={tourPaused ? "Carry on the tour" : "Hold the tour here"} title={tourPaused ? "Carry on" : "Hold here"} className={TOUR_BTN}>
                    {tourPaused ? <Play size={12} /> : <Pause size={12} />}
                  </button>
                  <button type="button" onClick={() => stepTour(1)} aria-label="Next agent (→)" title="Next (→)" className={TOUR_BTN}>
                    <ChevronRight size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setTouring(false);
                      pick(null);
                    }}
                    aria-label="Stop the tour"
                    title="Stop the tour (T)"
                    className={TOUR_BTN}
                  >
                    <Square size={11} />
                  </button>
                </span>
              </div>
              <span aria-hidden className="block h-0.5 bg-white/8">
                <span key={`${tourIdx}-${tourPaused}`} className={`block h-full origin-left bg-[#38d6f5] ${tourPaused ? "opacity-30" : "mc-tour shadow-[0_0_6px_#38d6f5]"}`} style={{ animationDuration: `${TOUR_MS}ms` }} />
              </span>
            </div>
          )}
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <Avatar id={chosen.id} state={chosen.state} />
              <div className="min-w-0">
                <p className="hud-label">{FLOORS[FLOOR_OF[chosen.id]]} · Office</p>
                <p className="mt-0.5 text-xl font-semibold leading-tight">{chosen.name}</p>
                <p className="text-xs text-white/60">{chosen.role}</p>
              </div>
            </div>
            <button onClick={() => userPick(null)} aria-label="Close" className="-m-1.5 grid size-9 shrink-0 place-items-center text-white/75 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-[#38d6f5]">
              <X size={16} />
            </button>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-[10px] tracking-wider uppercase ${PILL[chosen.state]}`}>
              <span className={`size-1.5 rounded-full ${DOT[chosen.state]} ${chosen.state === "alert" ? "animate-pulse" : ""}`} />
              {WORD[chosen.state]}
            </span>
            <span className="font-mono text-[10px] text-white/45">
              {chosen.at && now > 0 ? `Last activity ${ago(chosen.at.length === 10 ? `${chosen.at}T12:00:00Z` : chosen.at, now)}` : "No activity recorded"}
            </span>
          </div>
          <p className="mt-3 border-t border-white/10 pt-3 text-[15px] leading-snug text-white/95">{chosen.line}</p>
          {chosen.detail.length > 0 && (
            <>
              <p className="hud-label mt-4 flex items-center justify-between">
                RECENT <span className="font-mono text-[9.5px] tracking-wider text-white/35 tabular-nums">{chosen.detail.length}</span>
              </p>
              <ol className="mt-2.5 ml-1 space-y-3 border-l border-white/12 text-xs leading-snug text-white/75">
                {chosen.detail.map((d, i) => (
                  <li key={i} className="relative pl-3.5">
                    <span aria-hidden className={`absolute top-1.5 -left-[3.5px] size-1.5 rounded-full ${i === 0 ? "bg-[#38d6f5] shadow-[0_0_6px_#38d6f5]" : "bg-white/30"}`} />
                    {d}
                  </li>
                ))}
              </ol>
            </>
          )}
          <div className="mt-4 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => consoleApi.current?.assign(chosen.id)}
              className="flex h-10 items-center justify-center gap-1.5 border border-[#38d6f5]/40 bg-[#38d6f5]/10 text-sm font-medium text-[#7fe6fa] transition hover:border-[#38d6f5]/70 hover:bg-[#38d6f5]/15 active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-[#38d6f5]"
            >
              <Send size={13} /> Give a job
            </button>
            <Link href={chosen.href} className="flex h-10 items-center justify-center gap-1.5 bg-core text-sm font-medium text-black transition hover:brightness-110 active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-core">
              Open {chosen.name} <ArrowUpRight size={15} />
            </Link>
          </div>
          <details className="group mt-2.5 text-[10.5px] text-white/40">
            <summary className="flex cursor-pointer list-none items-center gap-1.5 hover:text-white/65 [&::-webkit-details-marker]:hidden">
              <Info size={11} /> About controls
            </summary>
            <p className="mt-1.5 leading-snug">Start, pause or change this agent from its own page. Model and token use aren&apos;t recorded for background jobs.</p>
          </details>
        </div>
      )}

      {/* The command console: talk to HIVEMIND; the agents it uses light up in the hall. */}
      {!failed && (
        <CommandConsole
          crew={crew}
          scene={scene}
          api={consoleApi}
          onDone={() => reload.current()}
          onAgents={() => {
            setSheetTab("crew");
            setListOpen(true);
          }}
          active={active}
        />
      )}
    </div>
  );
}

const FLOOR_BUTTONS: Array<{ v: MissionView; short: string; label: string; key: string; floor?: number }> = [
  { v: "outside", short: "EXT", label: "The building from outside", key: "E" },
  { v: "f2", short: "2", label: "Floor 2", key: "2", floor: 2 },
  { v: "f1", short: "1", label: "Floor 1", key: "1", floor: 1 },
  { v: "f0", short: "G", label: "Ground floor", key: "G", floor: 0 },
  { v: "lobby", short: "LOBBY", label: "The lobby hall: the K and the coordination desk", key: "L" },
];
/** A timestamp as a local calendar date ("2026-11-24"), the form the festival calendar uses. */
const localDate = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
/** The floor map's rows, top to bottom, and where each takes the camera. */
const MAP_ROWS: Array<{ v: MissionView; short: string; label: string }> = [
  { v: "f2", short: "2", label: "Floor 2" },
  { v: "f1", short: "1", label: "Floor 1" },
  { v: "f0", short: "G", label: "the ground floor" },
  { v: "lobby", short: "L", label: "the lobby hall" },
];
/** How long the tour stays on each agent. */
const TOUR_MS = 4800;
const TOUR_BTN = "grid size-7 place-items-center text-white/65 transition hover:text-[#38d6f5] active:scale-[0.94] focus-visible:outline-2 focus-visible:outline-[#38d6f5]";
/** The keyboard sheet, grouped: what each key does on this page. */
const KEYS: Array<[string, Array<[string[], string]>]> = [
  ["Move", [[["E"], "Outside the tower"], [["2"], "Floor 2"], [["1"], "Floor 1"], [["G"], "Ground floor"], [["L"], "The lobby hall"]]],
  ["View", [[["T"], "Start or stop the tour"], [["←", "→"], "Tour: back / on"],[["H"], "Photo mode"], [["P"], "Save a picture (photo mode)"], [["M"], "Ambient sound"],[["Esc"], "Close / leave photo mode"], [["?"], "This sheet"]]],
];
const SKY_NEXT: Record<SkyMode, SkyMode> = { live: "day", day: "night", night: "live" };
const SKY_LABEL: Record<SkyMode, string> = { live: "Live sky", day: "Day", night: "Night" };

const BTN =
  "flex h-9 items-center gap-1.5 border border-white/10 bg-[#0a0d14]/80 px-3 font-mono text-[10.5px] tracking-wider uppercase backdrop-blur-md transition hover:border-[#38d6f5]/60 hover:text-[#38d6f5] active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-[#38d6f5]";

/**
 * The system bar: health, then the real counts from the background jobs as one readout line. Zeros sit back,
 * anything non-zero is lit, and anything that needs you is amber.
 */
function SystemBar({ stats, active }: { stats: SystemStats; active: number }) {
  const ok = stats.health === "ok";
  const items: Array<[string, string, number, boolean]> = [
    ["agents", `${active}/${stats.agents}`, active, false],
    ["web tasks", String(stats.webRunning), stats.webRunning, false],
    ["approvals", String(stats.approvals), stats.approvals, stats.approvals > 0],
    ["reminders", stats.overdue ? `${stats.remindersDue}+${stats.overdue} late` : String(stats.remindersDue), stats.remindersDue + stats.overdue, stats.overdue > 0],
    ["building", String(stats.appsBuilding), stats.appsBuilding, false],
  ];
  return (
    <div className="pointer-events-auto mt-3 flex max-w-[calc(100vw-2rem)] items-center gap-x-4 overflow-x-auto border-t border-white/10 pt-2.5 font-mono [scrollbar-width:none] md:max-w-none [&::-webkit-scrollbar]:hidden" aria-label="System status">
      <span className={`flex shrink-0 items-center gap-1.5 text-[10px] tracking-[0.16em] uppercase ${ok ? "text-emerald-300" : "text-amber-300"}`}>
        <span className={`size-1.5 rounded-full ${ok ? "bg-emerald-300 shadow-[0_0_8px_currentColor]" : "animate-pulse bg-amber-300"}`} />
        {ok ? "All systems ok" : "Check health"}
      </span>
      {items.map(([k, v, n, warn]) => (
        <span key={k} className={`flex shrink-0 items-baseline gap-1.5 transition-colors ${warn ? "text-amber-300" : n > 0 ? "text-white/90" : "text-white/35"}`}>
          <span key={v} className="mc-flash text-[13px] tabular-nums">{v}</span>
          <span className="text-[9px] tracking-[0.16em] uppercase opacity-75">{k}</span>
        </span>
      ))}
    </div>
  );
}

/** The logbook: the latest activity, newest first, split into today and earlier, each with its time and how long ago. */
function Logbook({ activity, now }: { activity: Array<{ message: string; at: string }>; now: number }) {
  if (!activity.length) return <p className="px-4 py-6 text-center text-xs text-white/50">Nothing recorded yet.</p>;
  const d = new Date(now);
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const groups = [
    { label: "Today", rows: activity.filter((a) => Date.parse(a.at) >= start) },
    { label: "Earlier", rows: activity.filter((a) => Date.parse(a.at) < start) },
  ].filter((g) => g.rows.length);
  return (
    <ol className="list-in min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-3">
      {groups.flatMap((g) => [
        <li key={g.label} className="sticky top-0 z-[1] bg-[#0a0d14]/95 pt-3 pb-1.5 font-mono text-[9px] tracking-[0.22em] text-white/40 uppercase backdrop-blur">
          {g.label}
        </li>,
        ...g.rows.map((a, i) => {
          const t = new Date(a.at);
          return (
            <li key={a.at + i} className="relative border-l border-white/12 py-2 pl-4">
              <span aria-hidden className={`absolute top-3.5 -left-[3.5px] size-1.5 rounded-full ${g.label === "Today" && i === 0 ? "bg-[#38d6f5] shadow-[0_0_6px_#38d6f5]" : "bg-white/30"}`} />
              <p className="text-[12.5px] leading-snug text-white/85">{a.message}</p>
              <p className="mt-0.5 font-mono text-[9.5px] text-white/40">
                {g.label === "Today" ? t.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : t.toLocaleDateString([], { day: "numeric", month: "short" })} · {now > 0 ? ago(a.at, now) : ""}
              </p>
            </li>
          );
        }),
      ])}
    </ol>
  );
}

/**
 * Today on one line: a 24-hour track with a tick for each of the latest activity events that happened today (Mission
 * Control is sent the latest few, not the whole day), and a lit marker at the current time. Hover a tick for what it was.
 */
function DayTrack({ activity, now, onOpen }: { activity: Array<{ message: string; at: string }>; now: number; onOpen: () => void }) {
  const d = new Date(now);
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const pct = (ms: number) => ((ms - start) / 864e5) * 100;
  const today = activity.map((a) => ({ ...a, ms: new Date(a.at).getTime() })).filter((a) => a.ms >= start && a.ms <= now);
  const hm = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return (
    <div className="pointer-events-auto mt-2.5 w-[26rem] max-w-full" aria-label={`Today: ${today.length} of the latest events happened today`}>
      <div className="mb-1 flex items-center justify-between font-mono text-[8.5px] tracking-[0.2em] text-white/40 uppercase">
        <button type="button" onClick={onOpen} className="tracking-[0.2em] uppercase transition-colors hover:text-[#7fe6fa]" title="Open the activity logbook">
          Today · latest events ›
        </button>
        <span className="tabular-nums text-[#7fe6fa]/80">{hm(now)}</span>
      </div>
      <div className="relative h-5">
        <span aria-hidden className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-white/12" />
        {/* the part of the day already gone */}
        <span aria-hidden className="absolute top-1/2 left-0 h-px -translate-y-1/2 bg-gradient-to-r from-[#38d6f5]/10 to-[#38d6f5]/50" style={{ width: `${pct(now)}%` }} />
        {[6, 12, 18].map((h) => (
          <span key={h} aria-hidden className="absolute top-1/2 h-1.5 w-px -translate-y-1/2 bg-white/20" style={{ left: `${(h / 24) * 100}%` }} />
        ))}
        {today.map((a, i) => (
          <span key={a.at + i} className="group absolute top-1/2 -translate-x-1/2 -translate-y-1/2" style={{ left: `${pct(a.ms)}%` }}>
            <span tabIndex={0} aria-label={`${hm(a.ms)}: ${a.message}`} className="block h-3 w-[3px] rounded-full bg-amber-200/80 transition group-hover:scale-y-150 group-hover:bg-amber-100 focus-visible:outline-1 focus-visible:outline-[#38d6f5]" />
            <span className="pointer-events-none absolute top-full left-1/2 z-10 mt-1.5 hidden w-56 -translate-x-1/2 border border-white/10 bg-[#0a0d14]/95 px-2 py-1.5 text-[11px] leading-snug text-white/85 shadow-xl group-focus-within:block group-hover:block">
              <span className="font-mono text-[9.5px] text-[#7fe6fa]">{hm(a.ms)}</span> {a.message}
            </span>
          </span>
        ))}
        <span aria-hidden className="absolute top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#38d6f5] shadow-[0_0_10px_#38d6f5]" style={{ left: `${pct(now)}%` }}>
          <span className="absolute inset-0 animate-ping rounded-full bg-[#38d6f5]/60 motion-reduce:hidden" />
        </span>
      </div>
      <div aria-hidden className="relative mt-0.5 h-3 font-mono text-[8px] text-white/30">
        {[0, 6, 12, 18, 24].map((h) => (
          <span key={h} className="absolute -translate-x-1/2" style={{ left: `${(h / 24) * 100}%` }}>
            {String(h).padStart(2, "0")}
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * Sends your words to HIVEMIND's assistant (the same one as the home console) and shows what it does, live: which of
 * its agents took the job, each tool it ran, and the answer. Tools that belong to a background agent light that
 * agent's station and a path to it from the hub.
 */
type ConsoleApi = { assign: (id: CrewId) => void };

function CommandConsole({ crew, scene, api, onDone, onAgents, active }: { crew: CrewAgent[]; scene: React.RefObject<MissionScene | null>; api: React.RefObject<ConsoleApi | null>; onDone: () => void; onAgents: () => void; active: number }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [steps, setSteps] = useState<Step[]>([]);
  const [reply, setReply] = useState("");
  const [links, setLinks] = useState<Array<{ label: string; href: string }>>([]);
  const [prefer, setPrefer] = useState<CrewId | "">("");
  const input = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    api.current = {
      assign: (id) => {
        setPrefer(id);
        input.current?.focus();
      },
    };
    return () => {
      api.current = null;
    };
  }, [api]);
  const hinted = crew.find((c) => c.id === prefer);
  const [shown, setShown] = useState(false);
  const convo = useRef<string | null>(null);
  // the log's clock: when the command went out, and a ticking "now" while it runs
  const t0 = useRef(0);
  const [elapsed, setElapsed] = useState(0);
  const [failedRun, setFailedRun] = useState(false);
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => setElapsed(performance.now() - t0.current), 100);
    return () => clearInterval(t);
  }, [busy]);
  const since = () => Math.round(performance.now() - t0.current);
  // the placeholder cycles through examples while the box is empty (a hint of what the agents can do)
  const [ex, setEx] = useState(-1);
  useEffect(() => {
    if (text) return;
    const t = setInterval(() => setEx((i) => (i + 1) % EXAMPLES.length), 3800);
    return () => clearInterval(t);
  }, [text]);

  async function send() {
    const msg = text.trim();
    if (!msg || busy) return;
    const hint = crew.find((c) => c.id === prefer);
    t0.current = performance.now();
    setElapsed(0);
    setFailedRun(false);
    setBusy(true);
    setShown(true);
    setSteps([{ key: "you", text: msg, status: "info", at: 0 }]);
    setReply("");
    setLinks([]);
    setText("");
    scene.current?.setBusy(true);
    try {
      await streamHivemind({ message: hint ? `${msg}\n\n(Preferably with ${hint.name}: ${hint.role.toLowerCase()}.)` : msg, conversation_id: convo.current }, (e: HiveEvent) => {
        if (e.type === "meta") convo.current = e.conversation_id;
        else if (e.type === "delta") setReply((r) => r + e.text);
        else if (e.type === "agent") setSteps((s) => [...s, { key: `a${s.length}`, text: `Handed to the ${e.name} agent`, status: "info", at: since() }]);
        else if (e.type === "tool") {
          const who = TOOL_AGENT.find(([re]) => re.test(e.tool))?.[1];
          if (e.status === "run" && who) scene.current?.signal(who);
          const name = who ? crew.find((c) => c.id === who)?.name : undefined;
          const label = e.tool.replace(/_/g, " ");
          setSteps((s) => {
            const i = s.findIndex((x) => x.key === `t-${e.tool}` && x.status === "run");
            if (i >= 0) return s.map((x, k) => (k === i ? { ...x, status: e.status } : x));
            return [...s, { key: `t-${e.tool}`, text: label, status: e.status, at: since(), who: name }];
          });
        } else if (e.type === "action" && e.href) setLinks((l) => [...l, { label: e.label, href: e.href! }]);
        else if (e.type === "error") {
          setFailedRun(true);
          setSteps((s) => [...s, { key: `e${s.length}`, text: e.message, status: "error", at: since() }]);
        }
      });
    } catch (err) {
      setFailedRun(true);
      setSteps((s) => [...s, { key: "err", text: err instanceof Error ? err.message : "Something went wrong.", status: "error", at: since() }]);
    } finally {
      setElapsed(performance.now() - t0.current);
      setBusy(false);
      scene.current?.setBusy(false);
      onDone();
    }
  }

  return (
    <div style={D(760)} className="mc-hud mc-in absolute right-[4.75rem] bottom-3 left-3 z-20 sm:right-auto sm:bottom-4 sm:left-1/2 sm:w-[min(42rem,calc(100%-11rem))] sm:-translate-x-1/2">
      {shown && (steps.length > 0 || reply) && (
        <div className="relative mb-2 max-h-[38vh] overflow-y-auto border border-white/10 bg-[#0a0d14]/92 text-xs shadow-2xl backdrop-blur-xl">
          {/* while it runs, a scan line sweeps along the top edge */}
          <span aria-hidden className="pointer-events-none sticky top-0 z-10 block h-px w-full overflow-hidden bg-white/5">
            {busy && <span className="mc-scan absolute inset-y-0 left-0 w-2/5 bg-gradient-to-r from-transparent via-[#38d6f5] to-transparent" />}
          </span>
          <div className="flex items-center justify-between gap-2 border-b border-white/8 px-3 py-2">
            <span className="flex items-center gap-2">
              <span className="hud-label">MISSION LOG</span>
              <span
                className={`inline-flex items-center gap-1.5 rounded-full border px-1.5 py-px font-mono text-[9px] tracking-[0.16em] uppercase ${busy ? "border-[#38d6f5]/40 bg-[#38d6f5]/10 text-[#7fe6fa]" : failedRun ? "border-rose-400/40 bg-rose-400/10 text-rose-200" : "border-emerald-300/40 bg-emerald-300/10 text-emerald-200"}`}
              >
                <span className={`size-1 rounded-full ${busy ? "animate-pulse bg-[#38d6f5]" : failedRun ? "bg-rose-400" : "bg-emerald-300"}`} />
                {busy ? "Running" : failedRun ? "Stopped" : "Done"}
              </span>
            </span>
            <span className="flex items-center gap-2">
              <span className="font-mono text-[10.5px] text-white/55 tabular-nums" aria-label={`Elapsed ${clock(elapsed)}`}>
                {clock(elapsed)}
              </span>
              <button type="button" onClick={() => setShown(false)} aria-label="Hide the mission log" className="-m-1 grid size-7 place-items-center text-white/60 hover:text-white">
                <X size={14} />
              </button>
            </span>
          </div>
          <ol className="relative px-3 pt-2.5 pb-1" aria-live="polite">
            {/* the rail the steps hang on */}
            <span aria-hidden className="absolute top-4 bottom-3 left-[17px] w-px bg-gradient-to-b from-[#38d6f5]/50 via-white/12 to-white/5" />
            {steps.map((s) => (
              <li key={s.key} className="mc-step relative flex items-start gap-2.5 pb-2">
                <span
                  aria-hidden
                  className={`relative z-[1] mt-[3px] grid size-[11px] shrink-0 place-items-center rounded-full border bg-[#0a0d14] ${
                    s.status === "run"
                      ? "mc-node-run border-[#38d6f5]"
                      : s.status === "ok"
                        ? "border-emerald-300/80"
                        : s.status === "error"
                          ? "border-rose-400"
                          : s.key === "you"
                            ? "border-white/70"
                            : "border-white/25"
                  }`}
                >
                  <span className={`size-[5px] rounded-full ${s.status === "run" ? "bg-[#38d6f5]" : s.status === "ok" ? "bg-emerald-300" : s.status === "error" ? "bg-rose-400" : s.key === "you" ? "bg-white" : "bg-white/30"}`} />
                </span>
                <span className="min-w-0 flex-1 leading-snug">
                  <span className={s.key === "you" ? "text-[13px] text-white" : s.status === "error" ? "text-rose-200" : s.status === "run" ? "text-white/90" : "text-white/65"}>{s.text}</span>
                  {s.who && <span className="ml-1.5 inline-flex items-center rounded-sm border border-[#38d6f5]/35 bg-[#38d6f5]/8 px-1 font-mono text-[9px] tracking-wider text-[#7fe6fa] uppercase">{s.who}</span>}
                  {s.status === "run" && <span className="ml-1.5 text-[10px] text-[#7fe6fa]/70">working…</span>}
                </span>
                <span className="shrink-0 font-mono text-[9.5px] text-white/30 tabular-nums">{s.at > 0 ? `+${clock(s.at)}` : "sent"}</span>
              </li>
            ))}
          </ol>
          {(reply || (busy && steps.length > 0)) && (
            <p className={`mx-3 mb-3 border-t border-white/10 pt-2.5 text-[13px] leading-relaxed whitespace-pre-wrap text-white/90 ${busy ? "mc-caret" : ""}`}>{reply}</p>
          )}
          {links.length > 0 && (
            <div className="mx-3 -mt-1 mb-3 flex flex-wrap gap-1.5">
              {links.map((l) => (
                <Link key={l.href + l.label} href={l.href} className="inline-flex items-center gap-1.5 border border-[#38d6f5]/35 bg-[#38d6f5]/10 px-2.5 py-1.5 text-xs text-[#7fe6fa] transition hover:border-[#38d6f5]/70 hover:bg-[#38d6f5]/15 active:scale-[0.97]">
                  {l.label} <ArrowUpRight size={12} />
                </Link>
              ))}
            </div>
          )}
        </div>
      )}
      {/* ideas to start from: shown while the empty box has focus (a tap fills it in) */}
      {focused && !text && !busy && (
        <div className="mb-2 flex gap-1.5 overflow-x-auto [scrollbar-width:none] sm:flex-wrap [&::-webkit-scrollbar]:hidden" aria-label="Suggestions">
          {EXAMPLES.map((x, i) => (
            <button
              key={x}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setText(x);
                input.current?.focus();
              }}
              style={{ animationDelay: `${i * 40}ms` }}
              className="mc-chip shrink-0 border border-white/12 bg-[#0a0d14]/88 px-2.5 py-1.5 text-[11.5px] whitespace-nowrap text-white/75 backdrop-blur-md transition hover:border-[#38d6f5]/50 hover:text-white active:scale-[0.97]"
            >
              {x}
            </button>
          ))}
        </div>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
        className={`flex items-center gap-1.5 border bg-[#0a0d14]/92 p-1.5 shadow-2xl backdrop-blur-xl transition-[border-color,box-shadow] duration-500 focus-within:border-[#38d6f5]/50 ${busy ? "border-[#38d6f5]/45 shadow-[0_0_28px_rgba(56,214,245,0.16)]" : "border-white/12"}`}
      >
        <button type="button" onClick={onAgents} className="flex h-9 shrink-0 items-center gap-1 px-2 font-mono text-[10px] tracking-wider text-white/70 uppercase hover:text-[#38d6f5]" aria-label="Show all agents">
          <ChevronUp size={14} /> {active}/{crew.length}
        </button>
        {hinted && (
          // which agent this goes to (on phones, where the picker is hidden)
          <span className="flex h-7 shrink-0 items-center gap-1 rounded-full border border-[#38d6f5]/40 bg-[#38d6f5]/10 pr-1 pl-2 font-mono text-[10px] tracking-wider text-[#7fe6fa] uppercase sm:hidden">
            {hinted.name}
            <button type="button" onClick={() => setPrefer("")} aria-label={`Don't prefer ${hinted.name}`} className="grid size-5 place-items-center text-[#7fe6fa]/70">
              <X size={11} />
            </button>
          </span>
        )}
        <input
          ref={input}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder={hinted ? `What should ${hinted.name} do?` : ex < 0 ? "Command your agents… What should we accomplish?" : `Try: ${EXAMPLES[ex]}`}
          aria-label="Command for your agents"
          className="h-9 min-w-0 flex-1 bg-transparent px-2 text-sm text-white placeholder:text-white/40 focus:outline-none"
        />
        <AgentPicker crew={crew} value={prefer} onChange={setPrefer} />
        <button type="submit" disabled={busy || !text.trim()} aria-label="Send mission" className="grid size-9 shrink-0 place-items-center bg-[#38d6f5] text-[#04060d] transition hover:brightness-110 active:scale-[0.96] disabled:opacity-40">
          {busy ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
        </button>
      </form>
    </div>
  );
}

/**
 * The live chip: how fresh the crew data is (seconds since the last good refresh), amber and "stalled" when refreshing
 * has stopped for a while, red when it can't be reached.
 */
function LiveChip({ at, count, error }: { at: number; count: number; error: boolean }) {
  const [t, setT] = useState(0);
  useEffect(() => {
    const i = setInterval(() => setT(Date.now()), 1000);
    return () => clearInterval(i);
  }, []);
  const age = at > 0 && t > 0 ? Math.max(0, Math.round((t - at) / 1000)) : 0;
  const stalled = !error && at > 0 && age > 20;
  return (
    <span
      title={at > 0 ? `Crew data refreshed ${age}s ago` : "Waiting for the crew"}
      className={`hidden h-9 items-center gap-2 border bg-[#0a0d14]/80 px-3 font-mono text-[10.5px] tracking-wider uppercase backdrop-blur-md sm:flex ${error ? "border-rose-400/40 text-rose-200" : stalled ? "border-amber-400/40 text-amber-200" : "border-white/10"}`}
    >
      <span className={`size-1.5 rounded-full ${error ? "bg-rose-400" : stalled ? "bg-amber-400" : "animate-pulse bg-emerald-400"}`} />
      {error ? "Offline" : stalled ? `Stalled · ${age}s` : `Live · ${count}`}
      {!error && !stalled && at > 0 && <span className="w-6 text-right text-white/40 tabular-nums normal-case">{age}s</span>}
    </span>
  );
}

/** Which icon shows the weather (WMO code): sun, a little cloud, cloud, fog, drizzle, rain, snow, storm. */
function weatherIcon(code: number) {
  if (code >= 95) return CloudLightning;
  if (code >= 71 && code <= 77) return CloudSnow;
  if (code >= 61 || (code >= 80 && code <= 82)) return CloudRain;
  if (code >= 51) return CloudDrizzle;
  if (code === 45 || code === 48) return CloudFog;
  if (code === 3) return Cloud;
  if (code >= 1) return CloudSun;
  return Sun;
}

/**
 * Who a command should go to: "Auto-assign" or one agent, as a small popover above the command box (each agent with
 * its tool icon and state light). Escape or a click elsewhere closes it.
 */
function AgentPicker({ crew, value, onChange }: { crew: CrewAgent[]; value: CrewId | ""; onChange: (v: CrewId | "") => void }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("pointerdown", away);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("pointerdown", away);
      window.removeEventListener("keydown", esc);
    };
  }, [open]);
  const cur = crew.find((c) => c.id === value);
  const pick = (v: CrewId | "") => {
    onChange(v);
    setOpen(false);
  };
  return (
    <div ref={box} className="relative hidden border-l border-white/10 sm:block">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-haspopup="listbox" aria-expanded={open} aria-label={`Send to: ${cur ? cur.name : "auto-assign"}`} className="flex h-9 items-center gap-1.5 px-2.5 text-xs text-white/75 transition hover:text-white">
        {cur ? (
          (() => {
            const I = TOOL_ICON[cur.id];
            return <I size={13} className="text-[#7fe6fa]" />;
          })()
        ) : (
          <Sparkles size={13} className="text-white/45" />
        )}
        <span className="max-w-[7rem] truncate">{cur ? cur.name : "Auto-assign"}</span>
        <ChevronUp size={12} className={`text-white/40 transition-transform ${open ? "" : "rotate-180"}`} />
      </button>
      {open && (
        <ul role="listbox" aria-label="Send to" className="mc-hover absolute right-0 bottom-full mb-2 w-60 overflow-hidden border border-white/10 bg-[#0a0d14]/96 py-1 shadow-2xl backdrop-blur-xl">
          <li>
            <button type="button" role="option" aria-selected={!value} onClick={() => pick("")} className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-xs transition ${!value ? "bg-[#38d6f5]/10 text-[#7fe6fa]" : "text-white/80 hover:bg-white/5"}`}>
              <Sparkles size={14} className="shrink-0 text-white/50" />
              <span className="flex-1">
                Auto-assign
                <span className="block text-[10.5px] text-white/40">HIVEMIND picks the right agent</span>
              </span>
              {!value && <Check size={13} />}
            </button>
          </li>
          <li aria-hidden className="mx-3 my-1 h-px bg-white/8" />
          {crew.map((c) => {
            const I = TOOL_ICON[c.id];
            const on = value === c.id;
            return (
              <li key={c.id}>
                <button type="button" role="option" aria-selected={on} onClick={() => pick(c.id)} className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-xs transition ${on ? "bg-[#38d6f5]/10 text-[#7fe6fa]" : "text-white/80 hover:bg-white/5"}`}>
                  <I size={14} className="shrink-0 text-white/55" />
                  <span className="min-w-0 flex-1 truncate">{c.name}</span>
                  <StatusLight state={c.state} />
                  {on && <Check size={13} />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** The tool each robot keeps floating in its office (the same ones as in the 3D scene). */
const TOOL_ICON: Record<CrewId, typeof Clock3> = { scheduler: Clock3, autopilot: Radar, web: Globe, dream: Moon, brief: Newspaper, reminders: Bell, apps: Hammer };
const RING: Record<AgentState, string> = { working: "#6ee7b7", idle: "#7dd3fc", sleeping: "#94a3b8", alert: "#fb7185" };

/** An agent's badge: its tool in a ring of its state colour (the ring turns while it works, blinks when it needs you). */
function Avatar({ id, state }: { id: CrewId; state: AgentState }) {
  const Icon = TOOL_ICON[id];
  const c = RING[state];
  return (
    <span className="relative grid size-12 shrink-0 place-items-center" aria-hidden>
      <span
        className={`absolute inset-0 rounded-full ${state === "working" ? "animate-spin motion-reduce:animate-none [animation-duration:3.5s]" : state === "alert" ? "animate-pulse" : ""}`}
        style={{ background: `conic-gradient(from 0deg, ${c}, ${c}22 55%, ${c})`, opacity: state === "sleeping" ? 0.45 : 1 }}
      />
      <span className="absolute inset-[2px] rounded-full bg-[#0a0d14]" />
      <span className="absolute inset-[2px] rounded-full" style={{ background: `radial-gradient(circle at 50% 35%, ${c}33, transparent 70%)` }} />
      <Icon size={20} className="relative" style={{ color: c, opacity: state === "sleeping" ? 0.6 : 1 }} />
    </span>
  );
}

/** A status light: working agents get a soft ping ring, anyone who needs you blinks. */
function StatusLight({ state }: { state: AgentState }) {
  return (
    <span className="relative grid size-2 shrink-0 place-items-center">
      {state === "working" && <span className="absolute inset-0 animate-ping rounded-full bg-emerald-300/50 motion-reduce:hidden" />}
      <span className={`size-2 rounded-full ${DOT[state]} ${state === "alert" ? "animate-pulse" : ""}`} />
    </span>
  );
}

/** How many agents are in each state, as small pills (only the states someone is in). */
function StateCounts({ crew }: { crew: CrewAgent[] }) {
  const order: AgentState[] = ["alert", "working", "idle", "sleeping"];
  return (
    <span className="mt-1.5 flex flex-wrap gap-1">
      {order.map((s) => {
        const n = crew.filter((c) => c.state === s).length;
        return n ? (
          <span key={s} className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-px font-mono text-[9px] tracking-wider uppercase ${PILL[s]}`}>
            <span className="tabular-nums">{n}</span> {WORD[s]}
          </span>
        ) : null;
      })}
    </span>
  );
}

/** The crew roster: floor by floor, top floor first (as the tower stands), each agent with its light, state and latest line. */
function AgentList({ crew, open, now, onPick }: { crew: CrewAgent[]; open: CrewId | null; now: number; onPick: (id: CrewId) => void }) {
  const floors = [2, 1, 0].map((f) => ({ f, here: crew.filter((c) => FLOOR_OF[c.id] === f) })).filter((x) => x.here.length);
  return (
    <ul className="list-in min-h-0 flex-1 overflow-y-auto overscroll-contain pb-2">
      {floors.flatMap(({ f, here }) => [
        <li key={`floor-${f}`} className="sticky top-0 z-[1] flex items-center gap-2 bg-[#0a0d14]/95 px-4 pt-3 pb-1.5 font-mono text-[9px] tracking-[0.22em] text-white/45 uppercase backdrop-blur">
          <span className="grid h-4 min-w-4 place-items-center rounded-full border border-white/20 px-1 text-[8.5px] text-white/65">{f === 0 ? "G" : f}</span>
          {FLOORS[f]}
          <span className="h-px flex-1 bg-gradient-to-r from-white/12 to-transparent" />
          <span className="tracking-[0.12em] text-white/35 tabular-nums">
            {here.filter((c) => c.state !== "sleeping").length}/{here.length} awake
          </span>
        </li>,
        ...here.map((c) => (
          <li key={c.id} className="px-2">
            <button
              type="button"
              onClick={() => onPick(c.id)}
              aria-pressed={open === c.id}
              className={`group relative flex w-full items-start gap-3 rounded-sm px-2.5 py-2.5 text-left transition-colors focus-visible:outline-2 focus-visible:outline-[#38d6f5] ${open === c.id ? "bg-[#38d6f5]/10" : "hover:bg-white/[0.04] active:bg-white/[0.08]"}`}
            >
              {/* the selected agent gets a lit edge */}
              <span aria-hidden className={`absolute inset-y-2 left-0 w-0.5 rounded-full bg-[#38d6f5] shadow-[0_0_8px_#38d6f5] transition-opacity ${open === c.id ? "opacity-100" : "opacity-0"}`} />
              <span className="mt-1.5">
                <StatusLight state={c.state} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium transition-colors group-hover:text-white">{c.name}</span>
                  <span className={`shrink-0 rounded-full border px-1.5 py-px font-mono text-[8.5px] tracking-wider uppercase ${PILL[c.state]}`}>{WORD[c.state]}</span>
                </span>
                <span className="mt-0.5 block truncate text-xs text-white/65">{c.line}</span>
                <span className="mt-0.5 flex items-center gap-1.5 text-[10.5px] text-white/38">
                  <span className="truncate">{c.role}</span>
                  {c.at && now > 0 && (
                    <>
                      <span aria-hidden>·</span>
                      <span className="shrink-0">{ago(c.at.length === 10 ? `${c.at}T12:00:00Z` : c.at, now)}</span>
                    </>
                  )}
                </span>
              </span>
            </button>
          </li>
        )),
      ])}
    </ul>
  );
}
