"use client";

import { type ReactNode, useEffect, useState } from "react";
import { CountUp } from "@/components/fx";
import { cx } from "@/components/ui";

export function Holo({
  title,
  right,
  tone,
  className,
  bodyClassName,
  children,
}: {
  title?: ReactNode;
  right?: ReactNode;
  tone?: "core";
  className?: string;
  bodyClassName?: string;
  children: ReactNode;
}) {
  return (
    <section className={cx("holo", className)} data-tone={tone}>
      <div className={cx("holo-in flex flex-col", bodyClassName)}>
        {title && (
          <header className="flex items-center justify-between gap-2 border-b border-data/15 px-4 py-2.5">
            <h2 className="holo-title">{title}</h2>
            {right}
          </header>
        )}
        {children}
      </div>
    </section>
  );
}

/** Circular gauge: arc sweeps to value/max on mount. */
export function Gauge({ label, value, max, tone = "data" }: { label: string; value: number; max: number; tone?: "data" | "core" }) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setOn(true));
    return () => cancelAnimationFrame(id);
  }, []);
  const r = 24;
  const c = 2 * Math.PI * r;
  const frac = on && max > 0 ? Math.min(1, value / max) : 0;
  const color = tone === "core" ? "var(--core)" : "var(--data)";
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative">
      <svg width="64" height="64" viewBox="0 0 64 64" aria-hidden>
        <circle cx="32" cy="32" r={r} fill="none" stroke="oklch(0.84 0.085 215 / 0.12)" strokeWidth="3" />
        <circle
          cx="32"
          cy="32"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - frac)}
          transform="rotate(-90 32 32)"
          style={{ transition: "stroke-dashoffset 1400ms cubic-bezier(0.22,1,0.36,1)" }}
        />
        {Array.from({ length: 24 }, (_, i) => {
          const a = (i / 24) * Math.PI * 2;
          return (
            <line
              key={i}
              x1={32 + Math.round(Math.cos(a) * 29 * 100) / 100}
              y1={32 + Math.round(Math.sin(a) * 29 * 100) / 100}
              x2={32 + Math.round(Math.cos(a) * 31 * 100) / 100}
              y2={32 + Math.round(Math.sin(a) * 31 * 100) / 100}
              stroke="oklch(0.84 0.085 215 / 0.3)"
              strokeWidth="0.8"
            />
          );
        })}
      </svg>
      <div className="absolute inset-0 flex items-center justify-center font-mono text-sm tabular-nums" style={{ color }}>
        <CountUp value={value} />
      </div>
      </div>
      <div className="hud-label text-[9.5px]">{label}</div>
    </div>
  );
}

export function Meter({ label, value, max }: { label: string; value: number; max: number }) {
  return (
    <div>
      <div className="mb-1 flex justify-between font-mono text-[10.5px] uppercase tracking-wider">
        <span className="text-soft">{label}</span>
        <span className="text-data tabular-nums">{value}</span>
      </div>
      <div className="h-[3px] bg-data/10">
        <div
          className="h-full bg-data"
          style={{ width: `${max ? (value / max) * 100 : 0}%`, transition: "width 1200ms cubic-bezier(0.22,1,0.36,1)", boxShadow: "0 0 8px var(--data)" }}
        />
      </div>
    </div>
  );
}
