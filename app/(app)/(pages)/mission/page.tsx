"use client";

import { ArrowUpRight, Camera, ChevronUp, Clock3, Loader2, Moon, Play, Send, Square, Sun, X } from "lucide-react";
import Link from "next/link";
import { type CSSProperties, useCallback, useEffect, useRef, useState } from "react";
import { FLOOR_OF, FLOORS, MissionScene, type MissionView, type SkyMode } from "@/components/mission/mission-scene";
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
type Step = { key: string; text: string; status: "run" | "ok" | "error" | "info" };

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
  const [ready, setReady] = useState(false);
  // the loading curtain never traps the page: it lifts when the crew arrives, on an error, or after 8 s regardless
  const [late, setLate] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setLate(true), 8000);
    return () => clearTimeout(t);
  }, []);
  const lifted = ready || late || error;
  const [listOpen, setListOpen] = useState(false);
  const [view, setView] = useState<MissionView>("outside");
  // a lower-third caption names where the camera just went (not on the first view: the opening shot owns that)
  const [caption, setCaption] = useState<{ key: number; title: string; sub: string } | null>(null);
  const shownView = useRef<MissionView>("outside");
  const [hover, setHover] = useState<{ id: CrewId; x: number; y: number } | null>(null);
  const [sky, setSky] = useState<SkyMode>("live");
  // photo mode: the HUD steps aside for a clean view of the building
  const [bare, setBare] = useState(false);

  const pick = useCallback((id: CrewId | null) => {
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

  useEffect(() => {
    scene.current?.setSky(sky);
  }, [sky]);

  // Keyboard: E outside, 2 / 1 / G the floors, L the lobby, T the tour, H photo mode, Esc to close (instant, no animation)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (e.metaKey || e.ctrlKey || e.altKey || (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)))) return;
      const k = e.key.toLowerCase();
      const to = FLOOR_BUTTONS.find((f) => f.key.toLowerCase() === k);
      if (to) go(to.v);
      else if (k === "t") {
        if (touring) {
          setTouring(false);
          pick(null);
        } else setTouring(true);
      } else if (k === "h") setBare((b) => !b);
      else if (k === "escape") {
        if (open) userPick(null);
        else setBare(false);
      } else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, pick, userPick, touring, open]);

  // The tour: visit each robot in turn, anyone who needs you first.
  useEffect(() => {
    if (!touring) return;
    const order = [...latest.current].sort((a, b) => Number(b.state === "alert") - Number(a.state === "alert"));
    if (!order.length) return;
    let i = -1;
    const step = () => {
      i = (i + 1) % order.length;
      pick(order[i].id);
    };
    step();
    const t = setInterval(step, 4800);
    return () => clearInterval(t);
  }, [touring, pick]);

  // A fresh canvas per effect: a canvas whose WebGL context was released can't get a new one (dev strict mode).
  useEffect(() => {
    if (!host.current) return;
    const el = document.createElement("canvas");
    el.className = "absolute inset-0 block h-full w-full touch-none cursor-grab";
    el.setAttribute("aria-label", "Your background agents as robots in their headquarters. Drag to look around, scroll or pinch to zoom, tap a robot for details.");
    host.current.appendChild(el);
    let s: MissionScene;
    try {
      s = new MissionScene(el, { onSelect: userPick, onHover: (id, x, y) => setHover(id ? { id, x, y } : null), onReady: () => setReady(true) });
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
  }, []);

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
      <nav aria-label="Floors" style={D(900)} className="mc-hud mc-in-left absolute top-1/2 left-3 z-10 w-14 -translate-y-1/2 border border-white/10 bg-[#0a0d14]/85 backdrop-blur-md sm:left-5">
        <p className="border-b border-white/10 py-1 text-center font-mono text-[8.5px] tracking-[0.2em] text-white/40">LIFT</p>
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
              className="group flex w-full flex-col items-center gap-1 py-2 font-mono text-white/70 transition hover:text-[#38d6f5] focus-visible:outline-2 focus-visible:outline-[#38d6f5] aria-pressed:bg-[#38d6f5]/10 aria-pressed:text-[#38d6f5] [&+&]:border-t [&+&]:border-white/10"
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
          <p style={D(300)} className="mc-in hud-label text-[#38d6f5]">HIVEMIND · MISSION CONTROL</p>
          <h1 style={D(380)} className="mc-in mt-1 text-lg font-semibold tracking-tight drop-shadow-[0_2px_14px_rgba(0,0,0,0.7)] sm:text-2xl">Your agents at work</h1>
          <p style={D(460)} className="mc-in mt-1 max-w-md text-xs leading-snug text-white/65 sm:text-[13px]">{mission ? mission.summary : error ? "Can't reach the crew" : "Waking the crew…"}</p>
          {stats && (
            <div style={D(560)} className="mc-in">
              <SystemBar stats={stats} active={active} />
            </div>
          )}
        </div>
        <div style={D(640)} className="mc-in pointer-events-auto flex shrink-0 items-center gap-2">
          <span className="hidden h-9 items-center gap-2 border border-white/10 bg-[#0a0d14]/80 px-3 font-mono sm:flex text-[10.5px] tracking-wider uppercase backdrop-blur-md">
            <span className={`size-1.5 rounded-full ${error ? "bg-rose-400" : "animate-pulse bg-emerald-400"}`} />
            {error ? "Offline" : `Live · ${crew.length}`}
          </span>
          {chosen && (
            <button type="button" onClick={() => userPick(null)} className={BTN}>
              Overview
            </button>
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
          <button type="button" onClick={() => setBare(true)} aria-label="Photo mode: hide the panels (H)" title="Photo mode (H)" className={BTN}>
            <Camera size={13} />
          </button>
          {crew.length > 0 && (
            <button
              onClick={() => {
                if (touring) {
                  setTouring(false);
                  pick(null);
                } else setTouring(true);
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
            <div className="pointer-events-none absolute z-20 w-60 border border-white/10 bg-[#0a0d14]/90 p-3 text-xs shadow-xl backdrop-blur-md" style={{ left: Math.max(8, Math.min(hover.x + 16, w - 250)), top: hover.y + 16 }}>
              <p className="flex items-center gap-2 font-medium">
                <span className={`size-2 rounded-full ${DOT[a.state]}`} />
                {a.name}
                <span className="font-mono text-[10px] tracking-wider text-white/55 uppercase">{WORD[a.state]}</span>
              </p>
              <p className="mt-1.5 leading-snug text-white/80">{a.line}</p>
              <p className="mt-1.5 text-[10px] text-white/45">Click for details</p>
            </div>
          );
        })()}

      {bare && (
        <button type="button" onClick={() => setBare(false)} className="absolute bottom-4 left-1/2 z-20 -translate-x-1/2 border border-white/15 bg-[#0a0d14]/70 px-3 py-1.5 font-mono text-[10px] tracking-[0.2em] text-white/70 uppercase backdrop-blur-md transition hover:text-white active:scale-[0.97]">
          Show panels · H
        </button>
      )}

      {/* The loading curtain: lifts (a quick fade) the moment the scene is drawn, so the crane shot is the reveal. */}
      {!failed && (
        <div aria-hidden={lifted} className={`pointer-events-none absolute inset-0 z-[5] grid place-items-center bg-[#04060d] transition-opacity duration-700 ease-out ${lifted ? "opacity-0" : "opacity-100"}`}>
          <div className="flex w-56 flex-col items-center gap-3">
            <span className="font-mono text-[11px] tracking-[0.5em] text-white/85">HIVEMIND</span>
            <span className="relative h-px w-full overflow-hidden bg-white/10">
              <span className="mc-scan absolute inset-y-0 left-0 w-2/5 bg-gradient-to-r from-transparent via-[#38d6f5] to-transparent" />
            </span>
            <span role="status" className="font-mono text-[9.5px] tracking-[0.3em] text-white/45">{lifted ? "" : "RAISING THE TOWER"}</span>
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
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
              <span className="hud-label">
                AGENTS · {active} OF {crew.length} ACTIVE
              </span>
              <button type="button" onClick={() => setListOpen(false)} aria-label="Close" className="-mr-2 grid size-9 place-items-center text-white/70">
                <X size={16} />
              </button>
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
          </div>
        </div>
      )}

      {urgent && !chosen && (
        <button
          onClick={() => userPick(urgent.id)}
          className="absolute bottom-[5.5rem] left-1/2 z-10 flex max-w-[92%] -translate-x-1/2 items-center gap-2.5 border border-amber-400/50 bg-amber-950/70 py-2 pr-4 pl-3 text-left text-sm backdrop-blur-md transition hover:bg-amber-900/70 focus-visible:outline-2 focus-visible:outline-amber-300"
        >
          <span className="size-2.5 shrink-0 animate-pulse rounded-full bg-amber-400" />
          <span className="min-w-0 truncate">
            <b className="font-medium">{urgent.name}</b> <span className="text-white/75">{urgent.line}</span>
          </span>
          <ArrowUpRight size={15} className="shrink-0 text-amber-200" />
        </button>
      )}

      {caption && (
        <div key={caption.key} aria-live="polite" className="mc-hud mc-caption pointer-events-none absolute bottom-[5.75rem] left-20 z-[6] sm:left-24">
          <p className="font-mono text-[9.5px] tracking-[0.3em] text-[#38d6f5] uppercase">Now viewing</p>
          <p className="mt-0.5 text-2xl font-semibold tracking-tight sm:text-3xl">{caption.title}</p>
          <p className="mt-0.5 text-xs text-white/65">{caption.sub}</p>
        </div>
      )}

      {/* The agent inspector: right column on laptops, a card above the console on phones. */}
      {chosen && (
        <div
          key={chosen.id}
          className="mc-hud mc-panel absolute inset-x-3 bottom-[5.25rem] z-10 mx-auto max-h-[55%] max-w-sm overflow-y-auto border border-white/10 bg-[#0a0d14]/92 p-4 shadow-2xl backdrop-blur-xl lg:inset-x-auto lg:top-20 lg:right-4 lg:bottom-auto lg:mx-0 lg:max-h-[calc(100%-12rem)] lg:w-80"
          role="dialog"
          aria-label={`${chosen.name} inspector`}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="hud-label">{FLOORS[FLOOR_OF[chosen.id]]} · Office</p>
              <p className="mt-1 text-xl font-semibold leading-tight">{chosen.name}</p>
              <p className="text-xs text-white/60">{chosen.role}</p>
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
              <p className="hud-label mt-4">RECENT</p>
              <ol className="mt-2 ml-1 space-y-2.5 border-l border-white/12 text-xs text-white/70">
                {chosen.detail.map((d, i) => (
                  <li key={i} className="relative pl-3.5">
                    <span aria-hidden className={`absolute top-1.5 -left-[3.5px] size-1.5 rounded-full ${i === 0 ? "bg-[#38d6f5] shadow-[0_0_6px_#38d6f5]" : "bg-white/30"}`} />
                    {d}
                  </li>
                ))}
              </ol>
            </>
          )}
          <Link href={chosen.href} className="mt-4 flex h-10 items-center justify-center gap-1.5 bg-core text-sm font-medium text-black transition hover:brightness-110 active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-core">
            Open {chosen.name} <ArrowUpRight size={15} />
          </Link>
          <p className="mt-2 text-[10.5px] leading-snug text-white/40">Start, pause or change this agent from its own page. Model and token use aren&apos;t recorded for background jobs.</p>
        </div>
      )}

      {/* The command console: talk to HIVEMIND; the agents it uses light up in the hall. */}
      {!failed && <CommandConsole crew={crew} scene={scene} onDone={() => reload.current()} onAgents={() => setListOpen(true)} active={active} />}
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
          <span className="text-[13px] tabular-nums">{v}</span>
          <span className="text-[9px] tracking-[0.16em] uppercase opacity-75">{k}</span>
        </span>
      ))}
    </div>
  );
}

/**
 * Sends your words to HIVEMIND's assistant (the same one as the home console) and shows what it does, live: which of
 * its agents took the job, each tool it ran, and the answer. Tools that belong to a background agent light that
 * agent's station and a path to it from the hub.
 */
function CommandConsole({ crew, scene, onDone, onAgents, active }: { crew: CrewAgent[]; scene: React.RefObject<MissionScene | null>; onDone: () => void; onAgents: () => void; active: number }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [steps, setSteps] = useState<Step[]>([]);
  const [reply, setReply] = useState("");
  const [links, setLinks] = useState<Array<{ label: string; href: string }>>([]);
  const [prefer, setPrefer] = useState<CrewId | "">("");
  const [shown, setShown] = useState(false);
  const convo = useRef<string | null>(null);
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
    setBusy(true);
    setShown(true);
    setSteps([{ key: "you", text: msg, status: "info" }]);
    setReply("");
    setLinks([]);
    setText("");
    scene.current?.setBusy(true);
    try {
      await streamHivemind({ message: hint ? `${msg}\n\n(Preferably with ${hint.name}: ${hint.role.toLowerCase()}.)` : msg, conversation_id: convo.current }, (e: HiveEvent) => {
        if (e.type === "meta") convo.current = e.conversation_id;
        else if (e.type === "delta") setReply((r) => r + e.text);
        else if (e.type === "agent") setSteps((s) => [...s, { key: `a${s.length}`, text: `Handed to the ${e.name} agent`, status: "info" }]);
        else if (e.type === "tool") {
          const who = TOOL_AGENT.find(([re]) => re.test(e.tool))?.[1];
          if (e.status === "run" && who) scene.current?.signal(who);
          const name = who ? crew.find((c) => c.id === who)?.name : null;
          const label = `${e.tool.replace(/_/g, " ")}${name ? ` · ${name}` : ""}`;
          setSteps((s) => {
            const i = s.findIndex((x) => x.key === `t-${e.tool}` && x.status === "run");
            if (i >= 0) return s.map((x, k) => (k === i ? { ...x, status: e.status } : x));
            return [...s, { key: `t-${e.tool}`, text: label, status: e.status }];
          });
        } else if (e.type === "action" && e.href) setLinks((l) => [...l, { label: e.label, href: e.href! }]);
        else if (e.type === "error") setSteps((s) => [...s, { key: `e${s.length}`, text: e.message, status: "error" }]);
      });
    } catch (err) {
      setSteps((s) => [...s, { key: "err", text: err instanceof Error ? err.message : "Something went wrong.", status: "error" }]);
    } finally {
      setBusy(false);
      scene.current?.setBusy(false);
      onDone();
    }
  }

  return (
    <div style={D(760)} className="mc-hud mc-in absolute right-[4.75rem] bottom-3 left-3 z-20 sm:right-auto sm:bottom-4 sm:left-1/2 sm:w-[min(42rem,calc(100%-11rem))] sm:-translate-x-1/2">
      {shown && (steps.length > 0 || reply) && (
        <div className="mb-2 max-h-[38vh] overflow-y-auto border border-white/10 bg-[#0a0d14]/92 p-3 text-xs backdrop-blur-xl">
          <div className="mb-2 flex items-center justify-between">
            <span className="hud-label">MISSION LOG {busy ? "· RUNNING" : "· DONE"}</span>
            <button type="button" onClick={() => setShown(false)} aria-label="Hide the mission log" className="-m-1 grid size-7 place-items-center text-white/60 hover:text-white">
              <X size={14} />
            </button>
          </div>
          <ol className="space-y-1">
            {steps.map((s) => (
              <li key={s.key} className="flex items-start gap-2">
                <span className="mt-0.5 w-3 shrink-0 text-center">
                  {s.status === "run" ? <Loader2 size={11} className="animate-spin text-[#38d6f5]" /> : s.status === "ok" ? <span className="text-emerald-300">✓</span> : s.status === "error" ? <span className="text-rose-300">!</span> : <span className="text-white/40">›</span>}
                </span>
                <span className={s.key === "you" ? "text-white" : s.status === "error" ? "text-rose-200" : "text-white/70"}>{s.text}</span>
              </li>
            ))}
          </ol>
          {reply && <p className="mt-2 border-t border-white/10 pt-2 text-[13px] leading-relaxed whitespace-pre-wrap text-white/90">{reply}</p>}
          {links.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {links.map((l) => (
                <Link key={l.href + l.label} href={l.href} className="border border-white/15 px-2 py-1 text-[11px] text-[#38d6f5] hover:border-[#38d6f5]/60">
                  {l.label}
                </Link>
              ))}
            </div>
          )}
        </div>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
        className="flex items-center gap-1.5 border border-white/12 bg-[#0a0d14]/92 p-1.5 shadow-2xl backdrop-blur-xl focus-within:border-[#38d6f5]/50"
      >
        <button type="button" onClick={onAgents} className="flex h-9 shrink-0 items-center gap-1 px-2 font-mono text-[10px] tracking-wider text-white/70 uppercase hover:text-[#38d6f5]" aria-label="Show all agents">
          <ChevronUp size={14} /> {active}/{crew.length}
        </button>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={ex < 0 ? "Command your agents… What should we accomplish?" : `Try: ${EXAMPLES[ex]}`}
          aria-label="Command for your agents"
          className="h-9 min-w-0 flex-1 bg-transparent px-2 text-sm text-white placeholder:text-white/40 focus:outline-none"
        />
        <select
          value={prefer}
          onChange={(e) => setPrefer(e.target.value as CrewId | "")}
          aria-label="Suggest an agent"
          className="hidden h-9 border-l border-white/10 bg-transparent px-2 text-xs text-white/70 focus:outline-none sm:block"
        >
          <option value="" className="bg-[#0a0d14]">
            Auto-assign
          </option>
          {crew.map((c) => (
            <option key={c.id} value={c.id} className="bg-[#0a0d14]">
              {c.name}
            </option>
          ))}
        </select>
        <button type="submit" disabled={busy || !text.trim()} aria-label="Send mission" className="grid size-9 shrink-0 place-items-center bg-[#38d6f5] text-[#04060d] transition hover:brightness-110 active:scale-[0.96] disabled:opacity-40">
          {busy ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
        </button>
      </form>
    </div>
  );
}

/** Every agent as a row: status dot, name, what it is doing, when it last did something. */
function AgentList({ crew, open, now, onPick }: { crew: CrewAgent[]; open: CrewId | null; now: number; onPick: (id: CrewId) => void }) {
  return (
    <ul className="list-in min-h-0 flex-1 divide-y divide-white/8 overflow-y-auto overscroll-contain">
      {crew.map((c) => (
        <li key={c.id}>
          <button
            type="button"
            onClick={() => onPick(c.id)}
            aria-pressed={open === c.id}
            className={`flex w-full items-start gap-3 px-4 py-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-[#38d6f5] ${open === c.id ? "bg-[#38d6f5]/10" : "hover:bg-white/5 active:bg-white/10"}`}
          >
            <span className={`mt-1.5 size-2 shrink-0 rounded-full ${DOT[c.state]} ${c.state === "alert" ? "animate-pulse" : ""}`} />
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline justify-between gap-2">
                <span className="truncate text-sm font-medium">{c.name}</span>
                <span className="shrink-0 font-mono text-[9.5px] tracking-wider text-white/50 uppercase">{WORD[c.state]}</span>
              </span>
              <span className="block truncate text-xs text-white/65">{c.line}</span>
              {c.at && now > 0 && <span className="block text-[10.5px] text-white/40">{ago(c.at.length === 10 ? `${c.at}T12:00:00Z` : c.at, now)}</span>}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
