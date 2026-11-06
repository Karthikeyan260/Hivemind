"use client";

import { ArrowLeft, ArrowUpRight, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { MissionScene } from "@/components/mission/mission-scene";
import { api } from "@/lib/client-api";
import { ago, type AgentState, type CrewAgent, type CrewId } from "@/lib/mission";

type Mission = { crew: CrewAgent[]; summary: string; at: string };
const POLL_MS = 6000;
const DOT: Record<AgentState, string> = { working: "bg-emerald-300", idle: "bg-sky-300", sleeping: "bg-slate-400", alert: "bg-rose-400" };
const WORD: Record<AgentState, string> = { working: "Working", idle: "Ready", sleeping: "Asleep", alert: "Needs you" };

export default function MissionPage() {
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<MissionScene | null>(null);
  const latest = useRef<CrewAgent[]>([]);
  const [mission, setMission] = useState<Mission | null>(null);
  const [error, setError] = useState(false);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState<CrewId | null>(null);
  const [now, setNow] = useState(0);

  const pick = useCallback((id: CrewId | null) => {
    setOpen(id);
    scene.current?.select(id);
  }, []);

  // A fresh canvas per effect: a canvas whose WebGL context was released can't get a new one (dev strict mode).
  useEffect(() => {
    if (!host.current) return;
    const el = document.createElement("canvas");
    el.className = "absolute inset-0 block h-full w-full touch-none cursor-grab";
    el.setAttribute("aria-label", "Your background agents as robots on a command deck. Drag to look around, scroll or pinch to zoom, tap a robot for details.");
    host.current.appendChild(el);
    let s: MissionScene;
    try {
      s = new MissionScene(el, { onSelect: pick, onHover: () => {} });
    } catch {
      el.remove();
      setTimeout(() => setFailed(true));
      return;
    }
    scene.current = s;
    if (latest.current.length) s.setCrew(latest.current);
    return () => {
      s.dispose();
      el.remove();
      scene.current = null;
    };
  }, [pick]);

  useEffect(() => {
    let live = true;
    const load = () =>
      api<Mission>("/api/mission")
        .then((m) => {
          if (!live) return;
          latest.current = m.crew;
          setMission(m);
          setNow(Date.now());
          setError(false);
          scene.current?.setCrew(m.crew);
        })
        .catch(() => live && setError(true));
    load();
    const t = setInterval(() => !document.hidden && load(), POLL_MS);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, []);

  const crew = mission?.crew ?? [];
  const chosen = crew.find((c) => c.id === open) ?? null;
  const count = (s: AgentState) => crew.filter((c) => c.state === s).length;
  const urgent = crew.find((c) => c.state === "alert") ?? null;

  return (
    <div className="fixed inset-0 z-[350] select-none overflow-hidden bg-[#04060d] text-white">
      <div ref={host} className="absolute inset-0" />
      <div className="pointer-events-none absolute inset-0 [background:radial-gradient(ellipse_at_center,transparent_55%,rgba(2,4,10,0.6)_100%)]" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-[#04060d]/85 to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-[#04060d]/80 to-transparent" />

      <div className="absolute inset-x-0 top-0 flex items-start gap-3 p-4 pt-[max(1rem,env(safe-area-inset-top))] sm:p-6">
        <Link href="/" aria-label="Back" className="grid size-10 shrink-0 place-items-center rounded-full border border-white/15 bg-white/8 backdrop-blur-md hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-indigo-300">
          <ArrowLeft size={17} />
        </Link>
        <div className="min-w-0">
          <p className="flex items-center gap-2 font-mono text-[10px] tracking-[0.3em] text-white/60 uppercase">
            <span className={`size-1.5 rounded-full ${error ? "bg-rose-400" : "animate-pulse bg-emerald-400"}`} />
            Mission control · {error ? "offline" : "live"}
          </p>
          <p className="mt-0.5 font-serif text-2xl leading-tight drop-shadow-[0_2px_10px_rgba(0,0,0,0.8)] sm:text-3xl">{mission ? mission.summary : error ? "Can't reach the crew" : "Waking the crew…"}</p>
          {mission && (
            <p className="mt-1 flex flex-wrap gap-x-3 text-xs text-white/60">
              <span>{count("working")} working</span>
              <span>{count("idle")} ready</span>
              <span>{count("sleeping")} asleep</span>
              <span className={count("alert") ? "text-rose-300" : ""}>{count("alert")} need you</span>
            </p>
          )}
        </div>
      </div>

      {failed && <p className="absolute inset-0 grid place-items-center px-6 text-center text-sm text-white/70">This device can&apos;t draw the command deck (it needs WebGL).</p>}

      {crew.length > 0 && (
        <div className="absolute inset-x-0 bottom-0 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:p-6">
          <ul className="mx-auto flex max-w-3xl flex-wrap justify-center gap-2" aria-label="Agents">
            {crew.map((c) => (
              <li key={c.id}>
                <button
                  onClick={() => pick(open === c.id ? null : c.id)}
                  aria-pressed={open === c.id}
                  className={`flex h-9 items-center gap-2 rounded-full border px-3 text-xs backdrop-blur-md transition focus-visible:outline-2 focus-visible:outline-indigo-300 ${open === c.id ? "border-white/70 bg-white/90 font-medium text-[#0b1020]" : "border-white/15 bg-white/8 text-white/85 hover:bg-white/15"}`}
                >
                  <span className={`size-2 rounded-full ${DOT[c.state]} ${c.state === "alert" ? "animate-pulse" : ""}`} />
                  {c.name}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {urgent && !chosen && (
        <button
          onClick={() => pick(urgent.id)}
          className="absolute bottom-28 left-1/2 z-10 flex max-w-[92vw] -translate-x-1/2 items-center gap-2.5 rounded-full border border-rose-400/50 bg-rose-950/70 py-2 pr-4 pl-3 text-left text-sm shadow-[0_0_30px_rgba(244,63,94,0.35)] backdrop-blur-md transition hover:bg-rose-900/70 focus-visible:outline-2 focus-visible:outline-rose-300 sm:bottom-20"
        >
          <span className="size-2.5 shrink-0 animate-pulse rounded-full bg-rose-400" />
          <span className="min-w-0 truncate">
            <b className="font-medium">{urgent.name}</b> <span className="text-white/75">{urgent.line}</span>
          </span>
          <ArrowUpRight size={15} className="shrink-0 text-rose-200" />
        </button>
      )}

      {chosen && (
        <div className="absolute inset-x-3 bottom-20 z-10 mx-auto max-w-sm rounded-2xl border border-white/15 bg-[#080d1c]/85 p-4 shadow-2xl backdrop-blur-xl sm:inset-x-auto sm:top-24 sm:right-6 sm:bottom-auto sm:mx-0 sm:w-80" role="dialog" aria-label={chosen.name}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="flex items-center gap-2 font-mono text-[10px] tracking-[0.22em] text-white/70 uppercase">
                <span className={`size-2 rounded-full ${DOT[chosen.state]}`} />
                {WORD[chosen.state]}
              </p>
              <p className="mt-1 font-serif text-2xl leading-tight">{chosen.name}</p>
              <p className="text-xs text-white/60">{chosen.role}</p>
            </div>
            <button onClick={() => pick(null)} aria-label="Close" className="-m-1.5 grid size-9 shrink-0 place-items-center rounded-full text-white/75 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-indigo-300">
              <X size={16} />
            </button>
          </div>
          <p className="mt-3 text-sm leading-snug text-white/90">{chosen.line}</p>
          {chosen.detail.length > 0 && (
            <ul className="mt-3 space-y-1.5 border-t border-white/10 pt-3 text-xs text-white/65">
              {chosen.detail.map((d, i) => (
                <li key={i} className="flex gap-2">
                  <span aria-hidden className="mt-1.5 size-1 shrink-0 rounded-full bg-white/40" />
                  <span>{d}</span>
                </li>
              ))}
            </ul>
          )}
          {chosen.at && now > 0 && <p className="mt-3 text-[11px] text-white/45">Last activity {ago(chosen.at.length === 10 ? `${chosen.at}T12:00:00Z` : chosen.at, now)}</p>}
          <Link href={chosen.href} className="mt-3 flex h-10 items-center justify-center gap-1.5 rounded-full bg-white/90 text-sm font-medium text-[#0b1020] hover:bg-white focus-visible:outline-2 focus-visible:outline-indigo-300">
            Open {chosen.name} <ArrowUpRight size={15} />
          </Link>
        </div>
      )}
    </div>
  );
}
