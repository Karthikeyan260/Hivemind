"use client";

import { ArrowLeft, ArrowRight, ArrowUpRight, Code2, Pause, Play, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { Scramble } from "@/components/bridge/scramble";
import { useVoiceActions } from "@/components/voice/provider";
import type { EvoNode, Evolution } from "@/lib/evolution";
import { openExternal } from "@/lib/open-link";
import { sfx } from "@/lib/sfx";
import { Speaker } from "@/lib/voice";
import type { ReelScene } from "./reel-scene";

const FALLBACK = ["#f0b45a", "#7fc6de", "#9be29b", "#c79bff", "#ff8f8f", "#6be3d0"];
const month = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { month: "short", year: "numeric" });
const monthLong = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { month: "long", year: "numeric" });

/** What HIVEMIND says about a project (tour narration and the voice "present" action). */
function pitch(n: EvoNode, chapter?: string) {
  const learned = n.learned.length ? ` Here you learned ${n.learned.slice(0, 3).join(", ")}.` : "";
  const reused = n.reused.length ? ` It builds on ${n.reused.slice(0, 2).map((r) => `${r.tech} from ${r.from}`).join(" and ")}.` : "";
  return `${n.name}, ${monthLong(n.date)}${chapter ? `, from your ${chapter} chapter` : ""}. ${n.description ?? ""}${learned}${reused}`.replace(/\s+/g, " ").trim();
}

/** The most vivid colour in a screenshot (for each project's glow), sampled from a tiny copy. */
async function accentOf(src: string, fallback: string) {
  try {
    const img = new Image();
    img.src = src;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = c.height = 24;
    const g = c.getContext("2d", { willReadFrequently: true })!;
    g.drawImage(img, 0, 0, 24, 24);
    const d = g.getImageData(0, 0, 24, 24).data;
    let best = { s: 0, r: 0, g: 0, b: 0 };
    for (let i = 0; i < d.length; i += 4) {
      const [r, gg, b] = [d[i], d[i + 1], d[i + 2]];
      const max = Math.max(r, gg, b);
      const min = Math.min(r, gg, b);
      const s = max ? (max - min) / max : 0;
      const score = s * (max / 255);
      if (score > best.s) best = { s: score, r, g: gg, b };
    }
    if (best.s < 0.25) return fallback;
    return `#${[best.r, best.g, best.b].map((x) => Math.min(255, Math.round(x * 1.1)).toString(16).padStart(2, "0")).join("")}`;
  } catch {
    return fallback;
  }
}

/**
 * Projects as a 3D reel: real screenshots of each live project on curved glass panels you drag,
 * scroll or swipe through. The project in front gets the big title, its chapter, what it
 * learned and reused, and links to the live demo and the code. Tap it for the full case study.
 */
export function ProjectReel({ data }: { data: Evolution }) {
  // Newest first: the reel opens on your latest work.
  const nodes = useMemo(() => [...data.nodes].reverse(), [data.nodes]);
  const chapterOf = useMemo(() => {
    const m = new Map<string, string>();
    data.nodes.forEach((n, i) => {
      const ch = [...data.chapters].reverse().find((c) => c.start <= i);
      if (ch) m.set(n.id, ch.title);
    });
    return m;
  }, [data]);
  const canvas = useRef<HTMLCanvasElement>(null);
  const scene = useRef<ReelScene | null>(null);
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState<EvoNode | null>(null);
  const [accents, setAccents] = useState<string[]>(() => nodes.map((_, i) => FALLBACK[i % FALLBACK.length]));
  const [ready, setReady] = useState(false);
  const [touring, setTouring] = useState(false);
  const tour = useRef<{ stop: boolean; speaker: Speaker } | null>(null);
  const activeRef = useRef(0);
  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  const stopTour = () => {
    if (tour.current) {
      tour.current.stop = true;
      tour.current.speaker.stop();
      tour.current = null;
    }
    setTouring(false);
  };

  /** Narrated tour: glide to each project and tell its story, oldest to newest from here on. */
  const startTour = async (from = activeRef.current) => {
    stopTour();
    const speaker = new Speaker();
    speaker.unlock();
    const run = { stop: false, speaker };
    tour.current = run;
    setTouring(true);
    for (let i = from; i < nodes.length && !run.stop; i++) {
      scene.current?.goTo(i);
      await new Promise((r) => setTimeout(r, 650));
      if (run.stop) break;
      const text = pitch(nodes[i], chapterOf.get(nodes[i].id));
      // Never wait forever if audio is blocked: move on after roughly the time it takes to say it.
      const words = text.split(" ").length;
      // …and never rush past either: each project stays on screen at least a few seconds.
      await Promise.all([Promise.race([speaker.say(text), new Promise((r) => setTimeout(r, 4000 + words * 420))]), new Promise((r) => setTimeout(r, 3500))]);
      await new Promise((r) => setTimeout(r, 450));
    }
    if (tour.current === run) {
      tour.current = null;
      setTouring(false);
    }
  };
  useEffect(() => () => stopTour(), []);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const acc = await Promise.all(nodes.map((n, i) => (n.image ? accentOf(n.image, FALLBACK[i % FALLBACK.length]) : FALLBACK[i % FALLBACK.length])));
      if (!alive || !canvas.current) return;
      setAccents(acc);
      const { ReelScene } = await import("./reel-scene");
      if (!alive || !canvas.current) return;
      scene.current = new ReelScene(
        canvas.current,
        nodes.map((n, i) => ({ id: n.id, name: n.name, image: n.image, accent: acc[i], subtitle: `${chapterOf.get(n.id) ?? ""} · ${month(n.date)}` })),
        {
          onActive: setActive,
          onOpen: (i) => setOpen(nodes[i]),
          onSnap: () => sfx.lock(),
          // Touching the reel takes back control from a running tour.
          onInput: () => tour.current && stopTour(),
        },
      );
      setReady(true);
    })();
    return () => {
      alive = false;
      scene.current?.dispose();
      scene.current = null;
    };
  }, [nodes, chapterOf]);

  // Arrow keys move through the reel; Enter opens, Escape closes.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest("input, textarea")) return;
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") stopTour();
      if (e.key === "ArrowRight") scene.current?.next(1);
      else if (e.key === "ArrowLeft") scene.current?.next(-1);
      else if (e.key === "Enter" && !open) setOpen(nodes[active]);
      else if (e.key === "Escape") setOpen(null);
    };
    addEventListener("keydown", key);
    return () => removeEventListener("keydown", key);
  }, [active, nodes, open]);

  useVoiceActions({
    show_project: {
      description: "Projects page (reel): bring a project to the front and open its case study. input: project name.",
      run: ({ input }) => {
        const q = String(input ?? "").toLowerCase();
        const i = nodes.findIndex((n) => n.name.toLowerCase().includes(q));
        if (i < 0) return { error: `No project "${input}".`, projects: nodes.map((n) => n.name) };
        scene.current?.goTo(i);
        setTimeout(() => setOpen(nodes[i]), 700);
        return { showing: nodes[i].name };
      },
    },
    present_project: {
      description: "Projects page (reel): everything about the project in front (or a named one), so you can present it out loud. input: optional project name.",
      run: ({ input }) => {
        const q = String(input ?? "").toLowerCase();
        const i = q ? nodes.findIndex((x) => x.name.toLowerCase().includes(q)) : activeRef.current;
        if (i < 0) return { error: `No project "${input}".` };
        scene.current?.goTo(i);
        const x = nodes[i];
        return { project: x.name, built: monthLong(x.date), chapter: chapterOf.get(x.id), about: x.description, learned: x.learned, built_on: x.reused.map((r) => `${r.tech} (from ${r.from})`), live_demo: !!x.live, summary: pitch(x, chapterOf.get(x.id)) };
      },
    },
    start_project_tour: {
      description: "Projects page (reel): play a narrated tour through the projects (HIVEMIND speaks each one). Keep your own reply to one short line while it plays.",
      run: () => {
        void startTour(0);
        return { touring: true, projects: nodes.length };
      },
    },
    stop_project_tour: { description: "Projects page (reel): stop the narrated tour.", run: () => (stopTour(), { stopped: true }) },
    next_project: { description: "Projects page (reel): next (older) project.", run: () => (scene.current?.next(1), { moved: "next" }) },
    previous_project: { description: "Projects page (reel): previous (newer) project.", run: () => (scene.current?.next(-1), { moved: "previous" }) },
    close_project: { description: "Projects page (reel): close the open case study.", run: () => (setOpen(null), { closed: true }) },
    open_project_demo: {
      description: "Projects page (reel): open the live demo of the project in front (or a named one) in a new tab. input: optional project name.",
      run: ({ input }) => {
        const q = String(input ?? "").toLowerCase();
        const x = q ? nodes.find((n) => n.name.toLowerCase().includes(q)) : nodes[activeRef.current];
        if (!x) return { error: `No project "${input}".` };
        if (!x.live) return { error: `${x.name} has no live demo.`, code: !!x.href };
        return openExternal(x.live) ? { opened: `${x.name} live demo` } : { blocked: "The browser blocked the new tab. Ask the owner to tap the Live demo button." };
      },
    },
    open_project_code: {
      description: "Projects page (reel): open the GitHub code of the project in front (or a named one) in a new tab. input: optional project name.",
      run: ({ input }) => {
        const q = String(input ?? "").toLowerCase();
        const x = q ? nodes.find((n) => n.name.toLowerCase().includes(q)) : nodes[activeRef.current];
        if (!x) return { error: `No project "${input}".` };
        if (!x.href) return { error: `${x.name} has no public code link.` };
        return openExternal(x.href) ? { opened: `${x.name} on GitHub` } : { blocked: "The browser blocked the new tab. Ask the owner to tap the Code button." };
      },
    },
  });

  const n = nodes[active];
  const accent = accents[active] ?? "#f0b45a";

  return (
    <div className="relative">
      <div
        className="reel relative h-[74dvh] min-h-[460px] overflow-hidden rounded-3xl border border-white/10"
        style={{ ["--accent" as string]: accent, background: `radial-gradient(ellipse at 50% 38%, ${accent}22 0%, #070a10 55%, #04060a 100%)` }}
      >
        <canvas ref={canvas} className="absolute inset-0 h-full w-full touch-pan-y" aria-label="Project reel: drag or use the arrow keys" />
        {!ready && <div className="absolute inset-0 grid place-items-center font-mono text-[11px] tracking-[0.3em] text-data">LOADING YOUR WORK…</div>}

        {/* Top bar: counter and chapter */}
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-center justify-between p-4 font-mono text-[10.5px] uppercase tracking-[0.25em] text-white/60 sm:p-5">
          <span>
            <span className="text-white">{String(active + 1).padStart(2, "0")}</span> / {String(nodes.length).padStart(2, "0")}
          </span>
          <span className="truncate pl-4" style={{ color: accent }}>
            {n && chapterOf.get(n.id)}
          </span>
        </div>

        {/* The project in front */}
        {n && (
          <div className="reel-info pointer-events-none absolute inset-x-0 bottom-0 p-4 pb-16 sm:p-7 sm:pb-20 lg:inset-y-0 lg:right-auto lg:flex lg:w-[44%] lg:flex-col lg:justify-center lg:pb-20">
            <div aria-hidden className="reel-index pointer-events-none absolute -top-6 left-2 select-none font-black leading-none sm:left-4 lg:top-auto lg:bottom-[52%]">
              {String(active + 1).padStart(2, "0")}
            </div>
            <div key={n.id} className="reel-rise relative">
              <div className="font-mono text-[11px] tracking-[0.25em] text-white/55">{month(n.date).toUpperCase()}</div>
              <h2 className="reel-title mt-1 text-[clamp(1.9rem,6vw,4.2rem)] font-black leading-[0.95] tracking-tight text-white">
                <Scramble text={n.name} />
              </h2>
              {n.description && <p className="mt-2 line-clamp-2 max-w-xl text-[13.5px] leading-relaxed text-white/70">{n.description}</p>}
              <div className="mt-3 flex max-w-2xl flex-wrap gap-1.5">
                {n.learned.slice(0, 5).map((t) => (
                  <span key={t} className="rounded-full px-2.5 py-1 font-mono text-[10.5px] text-black" style={{ background: accent }}>
                    ✦ {t}
                  </span>
                ))}
                {n.reused.slice(0, 4).map((r) => (
                  <span key={r.tech} className="rounded-full border border-white/25 px-2.5 py-1 font-mono text-[10.5px] text-white/75">
                    ↺ {r.tech}
                  </span>
                ))}
              </div>
            </div>
            <div className="pointer-events-auto mt-4 flex flex-wrap gap-2">
              <button type="button" onClick={() => setOpen(n)} className="rounded-full bg-white px-4 py-2 text-[13px] font-semibold text-black transition-transform hover:scale-[1.03]">
                Case study
              </button>
              <button
                type="button"
                onClick={() => (touring ? stopTour() : void startTour())}
                aria-pressed={touring}
                className="flex items-center gap-1.5 rounded-full border px-4 py-2 text-[13px] text-white hover:bg-white/10"
                style={{ borderColor: touring ? accent : "rgba(255,255,255,0.3)", color: touring ? accent : undefined }}
              >
                {touring ? <Pause size={14} /> : <Play size={14} />} {touring ? "Stop tour" : "Narrated tour"}
              </button>
              {n.live && (
                <a href={n.live} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 rounded-full border border-white/30 px-4 py-2 text-[13px] text-white hover:bg-white/10">
                  Live demo <ArrowUpRight size={14} />
                </a>
              )}
              {n.href && (
                <a href={n.href} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 rounded-full border border-white/30 px-4 py-2 text-[13px] text-white hover:bg-white/10">
                  <Code2 size={14} /> Code
                </a>
              )}
            </div>
          </div>
        )}

        {/* Prev / next + progress rail */}
        <div className="absolute inset-x-4 bottom-4 flex items-center gap-3 sm:inset-x-7 sm:bottom-6">
          <button type="button" onClick={() => scene.current?.next(-1)} aria-label="Newer project" className="grid size-8 place-items-center rounded-full border border-white/20 text-white/80 hover:bg-white/10">
            <ArrowLeft size={15} />
          </button>
          <div className="flex h-1 flex-1 gap-1">
            {nodes.map((x, i) => (
              <button
                key={x.id}
                type="button"
                onClick={() => scene.current?.goTo(i)}
                aria-label={x.name}
                className="h-full flex-1 rounded-full transition-all duration-500"
                style={{ background: i === active ? accent : "rgba(255,255,255,0.18)", transform: i === active ? "scaleY(2.2)" : undefined }}
              />
            ))}
          </div>
          <button type="button" onClick={() => scene.current?.next(1)} aria-label="Older project" className="grid size-8 place-items-center rounded-full border border-white/20 text-white/80 hover:bg-white/10">
            <ArrowRight size={15} />
          </button>
        </div>
      </div>
      <p className="mt-2 text-center font-mono text-[10px] text-faint">Drag, scroll or swipe · ← → keys · tap the front project for its case study</p>

      {open && <CaseStudy node={open} chapter={chapterOf.get(open.id)} story={data.chapters.find((c) => c.title === chapterOf.get(open.id))?.story} accent={accents[nodes.indexOf(open)] ?? accent} onClose={() => setOpen(null)} />}
    </div>
  );
}

function CaseStudy({ node, chapter, story, accent, onClose }: { node: EvoNode; chapter?: string; story?: string; accent: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-label={`${node.name} case study`}>
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-black/75 backdrop-blur-sm" />
      <article className="reel-case relative max-h-[92dvh] w-full max-w-4xl overflow-y-auto rounded-t-3xl border border-white/10 bg-[#080b11] sm:rounded-3xl" style={{ ["--accent" as string]: accent }}>
        <button type="button" onClick={onClose} aria-label="Close" className="absolute right-4 top-4 z-10 grid size-9 place-items-center rounded-full bg-black/60 text-white backdrop-blur hover:bg-black/80">
          <X size={17} />
        </button>
        <div className="relative aspect-[16/9] w-full overflow-hidden bg-[#0b1220]">
          {node.image ? (
            // eslint-disable-next-line @next/next/no-img-element -- local screenshot of the live project
            <img src={node.image} alt={`${node.name} screenshot`} className="reel-case-img h-full w-full object-cover object-top" />
          ) : (
            <div className="grid h-full place-items-center text-4xl font-black text-white/80" style={{ background: `radial-gradient(circle at 70% 30%, ${accent}55, #05080d 70%)` }}>
              {node.name}
            </div>
          )}
          <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-[#080b11] to-transparent" />
        </div>
        <div className="-mt-16 relative p-5 sm:p-8">
          <div className="font-mono text-[11px] tracking-[0.25em]" style={{ color: accent }}>
            {(chapter ?? "").toUpperCase()} · {month(node.date).toUpperCase()}
          </div>
          <h2 className="mt-1 text-3xl font-black tracking-tight text-white sm:text-5xl">{node.name}</h2>
          {node.description && <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-white/75">{node.description}</p>}
          {story && <p className="mt-3 max-w-2xl border-l-2 pl-3 text-[13px] italic text-white/55" style={{ borderColor: accent }}>{story}</p>}
          <div className="mt-6 grid gap-5 sm:grid-cols-2">
            <div>
              <div className="mb-2 font-mono text-[10.5px] tracking-[0.25em] text-white/45">LEARNED HERE</div>
              <div className="flex flex-wrap gap-1.5">
                {node.learned.length ? (
                  node.learned.map((t) => (
                    <span key={t} className="rounded-full px-2.5 py-1 font-mono text-[11px] text-black" style={{ background: accent }}>
                      ✦ {t}
                    </span>
                  ))
                ) : (
                  <span className="text-[13px] text-white/45">Built on what came before.</span>
                )}
              </div>
            </div>
            <div>
              <div className="mb-2 font-mono text-[10.5px] tracking-[0.25em] text-white/45">CARRIED OVER</div>
              <ul className="space-y-1 text-[13px] text-white/75">
                {node.reused.length ? (
                  node.reused.map((r) => (
                    <li key={r.tech}>
                      ↺ <span className="text-white">{r.tech}</span> <span className="text-white/45">from {r.from}</span>
                    </li>
                  ))
                ) : (
                  <li className="text-white/45">A fresh start: everything here was new.</li>
                )}
              </ul>
            </div>
          </div>
          <div className="mt-7 flex flex-wrap gap-2">
            {node.live && (
              <a href={node.live} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 rounded-full px-5 py-2.5 text-[14px] font-semibold text-black" style={{ background: accent }}>
                Open live demo <ArrowUpRight size={15} />
              </a>
            )}
            {node.href && (
              <a href={node.href} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 rounded-full border border-white/25 px-5 py-2.5 text-[14px] text-white hover:bg-white/10">
                <Code2 size={15} /> View code
              </a>
            )}
            {node.kind === "project" && (
              <Link href={`/projects/${node.id}`} className="flex items-center gap-1.5 rounded-full border border-white/25 px-5 py-2.5 text-[14px] text-white hover:bg-white/10">
                Notes & memories →
              </Link>
            )}
          </div>
        </div>
      </article>
    </div>
  );
}
