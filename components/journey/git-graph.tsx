"use client";

import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { RotateCcw } from "lucide-react";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { cx } from "@/components/ui";

export type LaneId = "main" | "experience" | "projects" | "current";
export type Commit = {
  id: string;
  lane: LaneId;
  at: string;
  period: string;
  title: string;
  subtitle?: string;
  description?: string;
  tags: string[];
  current?: boolean;
  mergeFrom?: LaneId[];
  branches?: LaneId[];
  memoryId?: string;
  kind: "education" | "work" | "project" | "milestone" | "now";
};
export type Lane = { id: LaneId; label: string; hint: string };

gsap.registerPlugin(useGSAP);

export const LANE_COLOR: Record<LaneId, string> = { main: "#f0b45a", experience: "#5ec8e8", projects: "#b59cff", current: "#5fe3a1" };
// Roomy layout, and a compact one for phones (narrow lanes, the date on its own line under the title).
const WIDE = { ROW: 66, X0: 26, GAP: 30, R: 7.5 };
const SLIM = { ROW: 74, X0: 12, GAP: 18, R: 6.5 };
const TOP = 30;
const STEP = 0.16; // seconds between rows in the build animation

/** Short fake commit hash so it reads like a real git log. */
const hash = (id: string) => {
  let h = 2166136261;
  for (const c of id) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return (h >>> 0).toString(16).padStart(8, "0").slice(0, 7);
};

/**
 * The owner's career drawn as a git log: lanes branch off main and merge back, commits pop in as the
 * branches draw themselves, and HEAD pulses on the current role.
 */
export function GitGraph({ lanes, commits, selected, onSelect }: { lanes: Lane[]; commits: Commit[]; selected: string | null; onSelect: (c: Commit) => void }) {
  const root = useRef<HTMLDivElement>(null);
  const [run, setRun] = useState(0);
  // narrow box (phones): the slim layout, so titles and dates fit instead of being cut off
  const [slim, setSlim] = useState(false);
  // measured before the first paint, so phones never draw (and animate) the wide layout first
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    setSlim(el.clientWidth < 480);
    const ro = new ResizeObserver(([e]) => setSlim(e.contentRect.width < 480));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const { ROW, X0, GAP, R } = slim ? SLIM : WIDE;
  const laneX = (id: LaneId) => X0 + lanes.findIndex((l) => l.id === id) * GAP;
  const y = (row: number) => TOP + row * ROW;
  const width = X0 + (lanes.length - 1) * GAP + (slim ? 14 : 22);
  const height = TOP * 2 + (commits.length - 1) * ROW;

  // Each branch lane lives from the commit that branches it to the commit that merges it (or to HEAD).
  const paths = useMemo(() => {
    const last = commits.length - 1;
    return lanes.map((lane) => {
      if (lane.id === "main") {
        const end = commits.findLastIndex((c) => c.lane === "main");
        return { lane, start: 0, end, d: `M ${laneX("main")} ${y(0)} L ${laneX("main")} ${y(end)}` };
      }
      const start = commits.findIndex((c) => c.branches?.includes(lane.id));
      const mergeAt = commits.findIndex((c) => c.mergeFrom?.includes(lane.id));
      const end = mergeAt >= 0 ? mergeAt : commits.findLastIndex((c) => c.lane === lane.id);
      if (start < 0 || end < 0) return null;
      const from = commits[start].lane;
      const x = laneX(lane.id);
      const fx = laneX(from);
      const bend = ROW * 0.55;
      let d = `M ${fx} ${y(start)} C ${fx} ${y(start) + bend}, ${x} ${y(start) + bend * 0.45}, ${x} ${y(start) + bend}`;
      if (mergeAt >= 0) {
        const mx = laneX(commits[mergeAt].lane);
        d += ` L ${x} ${y(end) - bend} C ${x} ${y(end) - bend * 0.45}, ${mx} ${y(end) - bend}, ${mx} ${y(end)}`;
      } else d += ` L ${x} ${y(Math.max(end, start + 1))}`;
      return { lane, start, end: mergeAt >= 0 ? mergeAt : Math.min(end, last), d };
    }).filter((p): p is NonNullable<typeof p> => !!p);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lanes, commits, slim]);

  useGSAP(
    () => {
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const el = root.current;
      if (reduce || !el) return;
      const tl = gsap.timeline();
      // Branches draw row by row; each commit pops in as its branch reaches it.
      el.querySelectorAll<SVGPathElement>("[data-lane-path]").forEach((p) => {
        const len = p.getTotalLength();
        const start = Number(p.dataset.start);
        const end = Number(p.dataset.end);
        gsap.set(p, { strokeDasharray: len, strokeDashoffset: len });
        tl.to(p, { strokeDashoffset: 0, duration: Math.max(0.35, (end - start) * STEP), ease: "none" }, start * STEP);
      });
      el.querySelectorAll<SVGGElement>("[data-commit]").forEach((g) => {
        tl.fromTo(g, { scale: 0, transformOrigin: "center", opacity: 0 }, { scale: 1, opacity: 1, duration: 0.45, ease: "back.out(3)" }, Number(g.dataset.row) * STEP + 0.05);
      });
      el.querySelectorAll<HTMLLIElement>("li[data-row]").forEach((li) => {
        tl.fromTo(li, { opacity: 0, x: -14 }, { opacity: 1, x: 0, duration: 0.4, ease: "power2.out" }, Number(li.dataset.row) * STEP + 0.08);
      });
    },
    { scope: root, dependencies: [run, commits.length, slim] },
  );

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        onClick={() => setRun((r) => r + 1)}
        className="absolute -top-11 right-0 flex h-9 items-center gap-1.5 rounded-md px-2 text-xs text-soft transition-colors hover:bg-white/[0.04] hover:text-core"
      >
        <RotateCcw size={13} /> Replay
      </button>

      <div className="relative" style={{ height }}>
        <svg key={`svg-${run}-${slim}`} width={width} height={height} className="absolute left-0 top-0 overflow-visible" aria-hidden>
          <defs>
            <filter id="gg-glow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="3.2" result="b" />
              <feMerge>
                <feMergeNode in="b" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          {paths.map((p) => (
            <g key={p.lane.id}>
              <path d={p.d} fill="none" stroke={LANE_COLOR[p.lane.id]} strokeOpacity={0.18} strokeWidth={7} strokeLinecap="round" data-lane-path data-start={p.start} data-end={p.end} />
              <path d={p.d} fill="none" stroke={LANE_COLOR[p.lane.id]} strokeWidth={2.2} strokeLinecap="round" filter="url(#gg-glow)" data-lane-path data-start={p.start} data-end={p.end} />
            </g>
          ))}
          {commits.map((c, i) => {
            const cx0 = laneX(c.lane);
            const color = LANE_COLOR[c.lane];
            const isSel = selected === c.id;
            return (
              <g key={c.id} data-commit data-row={i} className="cursor-pointer" onClick={() => onSelect(c)}>
                {(c.current || c.kind === "now") && (
                  <circle cx={cx0} cy={y(i)} r={13} fill="none" stroke={color} strokeWidth={1.5} className="gg-pulse" style={{ transformOrigin: `${cx0}px ${y(i)}px` }} />
                )}
                <circle cx={cx0} cy={y(i)} r={isSel ? R + 1.5 : R} fill="#0b1016" stroke={color} strokeWidth={isSel ? 3 : 2.4} filter="url(#gg-glow)" />
                <circle cx={cx0} cy={y(i)} r={c.kind === "milestone" ? 2 : 3.2} fill={color} />
                {c.mergeFrom && <circle cx={cx0} cy={y(i)} r={11.5} fill="none" stroke={color} strokeOpacity={0.45} strokeDasharray="3 3" />}
              </g>
            );
          })}
        </svg>

        <ol key={`ol-${run}-${slim}`} className="absolute top-0" style={{ left: width + (slim ? 4 : 8), right: 0 }}>
          {commits.map((c, i) => (
            <li key={c.id} data-row={i} className="absolute left-0 right-0" style={{ top: y(i) - ROW / 2 + 5, height: ROW - 10 }}>
              <button
                type="button"
                onClick={() => onSelect(c)}
                aria-current={selected === c.id || undefined}
                className={cx(
                  "group flex h-full w-full items-center gap-3 border text-left transition-colors",
                  slim ? "px-2" : "px-3",
                  selected === c.id ? "border-core/50 bg-core/[0.07]" : "border-transparent hover:border-line hover:bg-white/[0.02]",
                )}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    {!slim && <span className="font-mono text-[10px] text-faint">{hash(c.id)}</span>}
                    {c.kind === "now" ? (
                      <span className="flex items-center gap-1.5">
                        <span className="rounded-sm px-1.5 py-px font-mono text-[10px] font-semibold tracking-wider text-[#0b1016]" style={{ background: LANE_COLOR.current }}>
                          HEAD → current_work
                        </span>
                      </span>
                    ) : (
                      <span className="truncate text-[13.5px] font-medium">{c.title}</span>
                    )}
                    {c.current && <span className="shrink-0 rounded-sm bg-ok/15 px-1.5 text-[11px] font-medium text-ok">Present</span>}
                  </div>
                  {c.subtitle && <div className="truncate text-[12px] text-soft">{c.subtitle}</div>}
                  {/* slim: the date gets its own line (the right-hand column doesn't fit) */}
                  {slim && (
                    <div className="mt-0.5 truncate text-[11px] tabular-nums" style={{ color: LANE_COLOR[c.lane] }}>
                      {c.period}
                    </div>
                  )}
                </div>
                <div className={cx("shrink-0 text-right", slim ? "hidden" : "block")}>
                  <div className="font-mono text-[11px]" style={{ color: LANE_COLOR[c.lane] }}>
                    {c.period}
                  </div>
                  <div className="font-mono text-[9.5px] uppercase tracking-widest text-faint">{lanes.find((l) => l.id === c.lane)?.label}</div>
                </div>
              </button>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
