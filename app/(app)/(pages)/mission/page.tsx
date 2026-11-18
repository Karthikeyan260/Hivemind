"use client";

import { ArrowUpRight, ChevronUp, Loader2, Play, Send, Square, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { MissionScene } from "@/components/mission/mission-scene";
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
  const [listOpen, setListOpen] = useState(false);
  const [view, setView] = useState<"inside" | "outside">("inside");
  const [hover, setHover] = useState<{ id: CrewId; x: number; y: number } | null>(null);

  const pick = useCallback((id: CrewId | null) => {
    setOpen(id);
    if (id) setView("inside"); // picking an agent takes you inside
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

  const crew = mission?.crew ?? [];
  const stats = mission?.stats;
  const chosen = crew.find((c) => c.id === open) ?? null;
  const count = (s: AgentState) => crew.filter((c) => c.state === s).length;
  const urgent = crew.find((c) => c.state === "alert") ?? null;
  const active = count("working") + count("idle");

  return (
    // Sits inside the app frame: the sidebar (laptop) or title bar and tab bar (phone) stay visible.
    <div className="fixed inset-x-0 top-[calc(env(safe-area-inset-top)+3.25rem)] bottom-[var(--tabbar-h)] z-10 select-none overflow-hidden bg-[#04060d] text-white md:top-0 md:bottom-0 md:left-52">
      <div ref={host} className="absolute inset-0" />
      <div className="pointer-events-none absolute inset-0 [background:radial-gradient(ellipse_at_center,transparent_55%,rgba(4,6,13,0.55)_100%)]" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-[#04060d]/85 to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-36 bg-gradient-to-t from-[#04060d]/80 to-transparent" />

      {/* Header: identity, what's going on, and the system bar (real counts only). */}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-3 p-4 sm:p-5">
        <div className="min-w-0">
          <p className="hud-label text-[#38d6f5]">HIVEMIND · MISSION CONTROL</p>
          <h1 className="mt-1 text-lg font-semibold tracking-tight drop-shadow-[0_2px_14px_rgba(0,0,0,0.7)] sm:text-2xl">Your agents at work</h1>
          <p className="mt-1 max-w-md text-xs leading-snug text-white/65 sm:text-[13px]">{mission ? mission.summary : error ? "Can't reach the crew" : "Waking the crew…"}</p>
          {stats && <SystemBar stats={stats} active={active} />}
        </div>
        <div className="pointer-events-auto flex shrink-0 items-center gap-2">
          <span className="hidden h-9 items-center gap-2 border border-white/10 bg-[#0a0d14]/80 px-3 font-mono sm:flex text-[10.5px] tracking-wider uppercase backdrop-blur-md">
            <span className={`size-1.5 rounded-full ${error ? "bg-rose-400" : "animate-pulse bg-emerald-400"}`} />
            {error ? "Offline" : `Live · ${crew.length}`}
          </span>
          <button
            type="button"
            onClick={() => {
              const v = view === "inside" ? "outside" : "inside";
              setTouring(false);
              setOpen(null);
              setView(v);
              scene.current?.setView(v);
            }}
            className={BTN}
            aria-label={view === "inside" ? "Show the building from outside" : "Go back inside"}
          >
            {view === "inside" ? "Exterior" : "Inside"}
          </button>
          {chosen && (
            <button type="button" onClick={() => userPick(null)} className={BTN}>
              Overview
            </button>
          )}
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

      {!ready && !failed && (
        <div className="pointer-events-none absolute inset-0 z-[5] grid place-items-center">
          <div className="flex flex-col items-center gap-4">
            <span className="size-10 animate-spin rounded-full border-2 border-white/10 border-t-[#38d6f5]" />
            <span className="font-mono text-[10.5px] tracking-[0.25em] text-white/70">BUILDING THE DECK…</span>
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

      {/* The agent inspector: right column on laptops, a card above the console on phones. */}
      {chosen && (
        <div
          className="absolute inset-x-3 bottom-[5.25rem] z-10 mx-auto max-h-[55%] max-w-sm overflow-y-auto border border-white/10 bg-[#0a0d14]/92 p-4 shadow-2xl backdrop-blur-xl lg:inset-x-auto lg:top-20 lg:right-4 lg:bottom-auto lg:mx-0 lg:max-h-[calc(100%-12rem)] lg:w-80"
          role="dialog"
          aria-label={`${chosen.name} inspector`}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="hud-label">AGENT INSPECTOR</p>
              <p className="mt-1 text-xl font-semibold leading-tight">{chosen.name}</p>
              <p className="text-xs text-white/60">{chosen.role}</p>
            </div>
            <button onClick={() => userPick(null)} aria-label="Close" className="-m-1.5 grid size-9 shrink-0 place-items-center text-white/75 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-[#38d6f5]">
              <X size={16} />
            </button>
          </div>
          <dl className="mt-3 grid grid-cols-[6.5rem_1fr] gap-x-2 gap-y-1.5 border-t border-white/10 pt-3 text-xs">
            <dt className="text-white/45">Status</dt>
            <dd className="flex items-center gap-1.5">
              <span className={`size-2 rounded-full ${DOT[chosen.state]}`} /> {WORD[chosen.state]}
            </dd>
            <dt className="text-white/45">Now</dt>
            <dd className="text-white/90">{chosen.line}</dd>
            <dt className="text-white/45">Last activity</dt>
            <dd className="text-white/80">{chosen.at && now > 0 ? ago(chosen.at.length === 10 ? `${chosen.at}T12:00:00Z` : chosen.at, now) : "None recorded"}</dd>
          </dl>
          {chosen.detail.length > 0 && (
            <>
              <p className="hud-label mt-4">RECENT</p>
              <ul className="mt-1.5 space-y-1.5 text-xs text-white/70">
                {chosen.detail.map((d, i) => (
                  <li key={i} className="flex gap-2">
                    <span aria-hidden className="mt-1.5 size-1 shrink-0 rounded-full bg-[#38d6f5]/70" />
                    <span>{d}</span>
                  </li>
                ))}
              </ul>
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

const BTN =
  "flex h-9 items-center gap-1.5 border border-white/10 bg-[#0a0d14]/80 px-3 font-mono text-[10.5px] tracking-wider uppercase backdrop-blur-md transition hover:border-[#38d6f5]/60 hover:text-[#38d6f5] active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-[#38d6f5]";

/** The system bar: health and real counts from the background jobs. */
function SystemBar({ stats, active }: { stats: SystemStats; active: number }) {
  const items: Array<[string, string, boolean]> = [
    ["HEALTH", stats.health === "ok" ? "OK" : "CHECK", stats.health !== "ok"],
    ["AGENTS", `${active}/${stats.agents}`, false],
    ["WEB TASKS", String(stats.webRunning), false],
    ["APPROVALS", String(stats.approvals), stats.approvals > 0],
    ["REMINDERS", stats.overdue ? `${stats.remindersDue}+${stats.overdue} late` : String(stats.remindersDue), stats.overdue > 0],
    ["BUILDING", String(stats.appsBuilding), false],
  ];
  return (
    <div className="pointer-events-auto mt-3 flex max-w-[calc(100vw-2rem)] gap-px overflow-x-auto border border-white/10 bg-white/10 [scrollbar-width:none] md:max-w-none [&::-webkit-scrollbar]:hidden" aria-label="System status">
      {items.map(([k, v, warn]) => (
        <div key={k} className="shrink-0 bg-[#0a0d14]/85 px-3 py-1.5 backdrop-blur-md">
          <div className="font-mono text-[9px] tracking-[0.18em] text-white/45">{k}</div>
          <div className={`font-mono text-sm tabular-nums ${warn ? "text-amber-300" : "text-white/90"}`}>{v}</div>
        </div>
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
    <div className="absolute right-[4.75rem] bottom-3 left-3 z-20 sm:right-auto sm:bottom-4 sm:left-1/2 sm:w-[min(42rem,calc(100%-11rem))] sm:-translate-x-1/2">
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
          placeholder="Command your agents… What should we accomplish?"
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
