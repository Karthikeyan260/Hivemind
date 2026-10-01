"use client";

import { ArrowUpRight, Pause, Play, RotateCcw, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { cx } from "@/components/ui";
import { useVoiceActions } from "@/components/voice/provider";
import type { LivingData, LivingMemory } from "@/lib/living-memory";
import type { LivingScene, Picked } from "./living-scene";

const TYPE_LABEL: Record<string, [string, string]> = {
  project_context: ["Project", "#7fc6de"],
  experience: ["Experience", "#f0b45a"],
  fact: ["Fact", "#9be29b"],
  knowledge: ["Knowledge", "#c79bff"],
  learning: ["Learning", "#ff9f7a"],
};
const SEEN_KEY = "living-memory-seen";
const yearOf = (t: number) => Math.floor(t);

/** Projects page: your memories as a living 3D environment that grows with you. */
export function LivingMemoryView({ data }: { data: LivingData }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const overlay = useRef<HTMLDivElement>(null);
  const scene = useRef<LivingScene | null>(null);
  const [hover, setHover] = useState<{ p: Picked; x: number; y: number } | null>(null);
  const [selected, setSelected] = useState<Picked>(null);
  const [time, setTime] = useState(data.range.max);
  const [playing, setPlaying] = useState(false);
  const [newCount, setNewCount] = useState(0);

  const byId = useMemo(() => new Map(data.memories.map((m) => [m.id, m])), [data.memories]);
  const projectName = useMemo(() => new Map(data.projects.map((p) => [p.id, p.name])), [data.projects]);

  useEffect(() => {
    let lastSeen = 0;
    try {
      lastSeen = Number(localStorage.getItem(SEEN_KEY) || 0);
      localStorage.setItem(SEEN_KEY, String(Date.now()));
    } catch {}
    // eslint-disable-next-line react-hooks/set-state-in-effect -- count what's new since the last visit, once
    setNewCount(lastSeen ? data.memories.filter((m) => +new Date(m.created_at) > lastSeen).length : 0);
    let alive = true;
    void import("./living-scene").then(({ LivingScene }) => {
      if (!alive || !canvas.current || !overlay.current) return;
      const s = new LivingScene(canvas.current, overlay.current, {
        onHover: (p, x, y) => setHover(p ? { p, x, y } : null),
        onSelect: setSelected,
        onTime: (t) => setTime(t),
      });
      s.setData(data, lastSeen);
      scene.current = s;
    });
    return () => {
      alive = false;
      scene.current?.dispose();
      scene.current = null;
    };
  }, [data]);

  useEffect(() => {
    if (!playing) return;
    const t = setTimeout(() => setPlaying(false), 8200);
    return () => clearTimeout(t);
  }, [playing]);

  const pick = (p: Picked) => {
    setSelected(p);
    scene.current?.select(p);
  };

  useVoiceActions({
    focus_memory_topic: {
      description: "Projects page (Living Memory): highlight a skill/topic (e.g. 'RAG', 'Python') or a project by name and fly to it.",
      run: ({ input }) => {
        const q = String(input ?? "").toLowerCase();
        const s = data.skills.find((x) => x.name.toLowerCase() === q) ?? data.skills.find((x) => x.name.toLowerCase().includes(q));
        if (s) {
          pick({ kind: "skill", name: s.name });
          return { focused_skill: s.name, memories: s.count };
        }
        const p = data.projects.find((x) => x.name.toLowerCase().includes(q));
        if (p) {
          pick({ kind: "project", id: p.id });
          return { focused_project: p.name };
        }
        return { error: `Nothing called "${input}".`, skills: data.skills.map((x) => x.name), projects: data.projects.map((x) => x.name) };
      },
    },
    replay_memory_growth: {
      description: "Projects page (Living Memory): replay how the brain grew over time.",
      run: () => {
        setPlaying(true);
        scene.current?.play(8);
        return { playing: true };
      },
    },
  });

  const hovered = hover?.p;
  const tip =
    hovered?.kind === "memory" ? byId.get(hovered.id)?.title : hovered?.kind === "skill" ? `${hovered.name}` : hovered?.kind === "project" ? projectName.get(hovered.id) : null;

  return (
    <div className="relative">
      <div className="relative h-[68dvh] min-h-[420px] overflow-hidden rounded-2xl border border-data/20 bg-[radial-gradient(ellipse_at_50%_35%,#0d1a24_0%,#05080d_70%)]">
        <canvas ref={canvas} className="absolute inset-0 h-full w-full touch-none" />
        <div ref={overlay} className="pointer-events-none absolute inset-0 overflow-hidden" />

        {tip && hover && (
          <div className="pointer-events-none absolute z-10 max-w-60 rounded-md border border-data/40 bg-[#0a0f15]/90 px-2.5 py-1.5 text-[12px] text-fg" style={{ left: hover.x + 14, top: hover.y + 14 }}>
            {tip}
          </div>
        )}

        {/* Top-left readout */}
        <div className="pointer-events-none absolute left-3 top-3 font-mono text-[10px] uppercase tracking-[0.2em] text-data">
          ◇ Living memory · {data.memories.length} memories · {data.projects.length} clusters · {data.skills.length} skills
          {newCount > 0 && <span className="ml-2 text-core">· {newCount} new since last visit</span>}
        </div>

        {/* Legend */}
        <div className="pointer-events-none absolute right-3 top-3 hidden flex-col items-end gap-1 font-mono text-[10px] text-soft sm:flex">
          {Object.values(TYPE_LABEL).map(([l, c]) => (
            <span key={l} className="flex items-center gap-1.5">
              {l} <span className="size-2 rounded-full" style={{ background: c, boxShadow: `0 0 6px ${c}` }} />
            </span>
          ))}
          <span className="flex items-center gap-1.5 text-core">
            Skill <span className="size-2 rotate-45 bg-core" />
          </span>
        </div>

        {/* Time scrubber */}
        <div className="absolute inset-x-3 bottom-3 flex items-center gap-3 rounded-full border border-data/25 bg-[#0a0f15]/80 px-3 py-2 backdrop-blur">
          <button
            type="button"
            onClick={() => {
              if (playing) {
                setPlaying(false);
                scene.current?.setTime(data.range.max);
                setTime(data.range.max);
              } else {
                setPlaying(true);
                scene.current?.play(8);
              }
            }}
            aria-label={playing ? "Stop replay" : "Replay how your brain grew"}
            className="flex size-7 shrink-0 items-center justify-center rounded-full bg-core text-black"
          >
            {playing ? <Pause size={13} /> : <Play size={13} />}
          </button>
          <input
            type="range"
            min={data.range.min}
            max={data.range.max}
            step={0.05}
            value={Math.min(time, data.range.max)}
            onChange={(e) => {
              const t = Number(e.target.value);
              setPlaying(false);
              setTime(t);
              scene.current?.setTime(t >= data.range.max - 0.01 ? Infinity : t);
            }}
            aria-label="Time"
            className="min-w-0 flex-1 accent-[#f0b45a]"
          />
          <span className="w-10 shrink-0 text-right font-mono text-[12px] text-core">{time >= data.range.max - 0.01 ? "NOW" : yearOf(time)}</span>
          <button
            type="button"
            onClick={() => {
              pick(null);
              scene.current?.resetView();
            }}
            aria-label="Reset view"
            className="shrink-0 text-faint hover:text-fg"
          >
            <RotateCcw size={14} />
          </button>
        </div>
      </div>
      <p className="mt-2 text-center font-mono text-[10px] text-faint">Drag to orbit · scroll / pinch to zoom · tap a memory, skill or cluster · ▶ replays your brain growing</p>

      {selected && <Detail p={selected} data={data} byId={byId} projectName={projectName} onClose={() => pick(null)} onPick={pick} />}
    </div>
  );
}

function Detail({
  p,
  data,
  byId,
  projectName,
  onClose,
  onPick,
}: {
  p: NonNullable<Picked>;
  data: LivingData;
  byId: Map<string, LivingMemory>;
  projectName: Map<string, string>;
  onClose: () => void;
  onPick: (p: Picked) => void;
}) {
  const list = (ms: LivingMemory[]) => (
    <ul className="mt-2 space-y-1">
      {ms
        .sort((a, b) => b.importance - a.importance)
        .slice(0, 12)
        .map((m) => (
          <li key={m.id}>
            <button type="button" onClick={() => onPick({ kind: "memory", id: m.id })} className="flex w-full items-center gap-2 text-left text-[12.5px] hover:text-core">
              <span className="size-1.5 shrink-0 rounded-full" style={{ background: TYPE_LABEL[m.type]?.[1] ?? "#dde6f0" }} />
              <span className="min-w-0 flex-1 truncate">{m.title}</span>
              <span className="font-mono text-[10px] text-faint">{yearOf(m.t)}</span>
            </button>
          </li>
        ))}
    </ul>
  );

  let body: React.ReactNode = null;
  if (p.kind === "memory") {
    const m = byId.get(p.id);
    if (!m) return null;
    body = (
      <>
        <div className="font-mono text-[10px] tracking-[0.25em]" style={{ color: TYPE_LABEL[m.type]?.[1] }}>
          {(TYPE_LABEL[m.type]?.[0] ?? m.type).toUpperCase()} · {yearOf(m.t)} · IMPORTANCE {m.importance}/10
        </div>
        <h3 className="mt-1 text-[15px] font-semibold">{m.title}</h3>
        {m.project_id && (
          <button type="button" onClick={() => onPick({ kind: "project", id: m.project_id! })} className="mt-0.5 font-mono text-[11px] text-data hover:text-core">
            ◦ {projectName.get(m.project_id)}
          </button>
        )}
        <p className="mt-2 text-[12.5px] leading-relaxed text-soft">{m.snippet}…</p>
        {m.skills.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1">
            {m.skills.map((s) => (
              <button key={s} type="button" onClick={() => onPick({ kind: "skill", name: s })} className="border border-core/40 px-1.5 py-0.5 font-mono text-[10px] text-core hover:bg-core/10">
                {s}
              </button>
            ))}
          </div>
        )}
        {m.related.length > 0 && (
          <>
            <div className="mt-4 font-mono text-[9.5px] tracking-[0.25em] text-faint">RELATED BY MEANING</div>
            {list(m.related.map((r) => byId.get(r.id)).filter((x): x is LivingMemory => !!x))}
          </>
        )}
        <Link href={`/memories?open=${m.id}`} className="mt-4 flex items-center justify-center gap-1.5 border border-core/50 py-2 font-mono text-[11px] uppercase tracking-wider text-core hover:bg-core/10">
          Open memory <ArrowUpRight size={13} />
        </Link>
      </>
    );
  } else if (p.kind === "skill") {
    const ms = data.memories.filter((m) => m.skills.includes(p.name));
    body = (
      <>
        <div className="font-mono text-[10px] tracking-[0.25em] text-core">SKILL · CONNECTION POINT</div>
        <h3 className="mt-1 text-[15px] font-semibold">{p.name}</h3>
        <p className="text-[12px] text-soft">
          In {ms.length} memories across {new Set(ms.map((m) => m.project_id).filter(Boolean)).size} projects, {yearOf(Math.min(...ms.map((m) => m.t)))}–{yearOf(Math.max(...ms.map((m) => m.t)))}.
        </p>
        {list(ms)}
      </>
    );
  } else {
    const ms = data.memories.filter((m) => m.project_id === p.id);
    const proj = data.projects.find((x) => x.id === p.id);
    const skills = [...new Set(ms.flatMap((m) => m.skills))];
    body = (
      <>
        <div className="font-mono text-[10px] tracking-[0.25em] text-data">PROJECT CLUSTER · {(proj?.status ?? "").toUpperCase()}</div>
        <h3 className="mt-1 text-[15px] font-semibold">{proj?.name}</h3>
        <p className="text-[12px] text-soft">
          {ms.length} memories{proj?.year ? ` · ${proj.year}` : ""}
          {proj?.cluster ? ` · ${proj.cluster}` : ""}
        </p>
        {skills.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {skills.map((s) => (
              <button key={s} type="button" onClick={() => onPick({ kind: "skill", name: s })} className="border border-core/40 px-1.5 py-0.5 font-mono text-[10px] text-core hover:bg-core/10">
                {s}
              </button>
            ))}
          </div>
        )}
        {list(ms)}
        <Link href={`/projects/${p.id}`} className="mt-4 flex items-center justify-center gap-1.5 border border-data/50 py-2 font-mono text-[11px] uppercase tracking-wider text-data hover:bg-data/10">
          Open project <ArrowUpRight size={13} />
        </Link>
      </>
    );
  }

  return (
    <aside className={cx("living-detail fixed inset-x-0 bottom-[var(--tabbar-h)] z-50 max-h-[60dvh] overflow-y-auto border-t border-core/40 bg-[#0a0f15]/95 p-4 backdrop-blur-md", "lg:absolute lg:inset-x-auto lg:bottom-auto lg:right-3 lg:top-12 lg:max-h-[calc(68dvh-7rem)] lg:w-80 lg:rounded-xl lg:border")}>
      <button type="button" onClick={onClose} aria-label="Close" className="absolute right-3 top-3 p-1 text-faint hover:text-fg">
        <X size={15} />
      </button>
      {body}
    </aside>
  );
}
