"use client";

import { useEffect, useRef } from "react";
import type { Telemetry } from "@/components/galaxy/scene";

const PX_PER_DEG = 3;
const CARDINAL: Record<number, string> = { 0: "N", 90: "E", 180: "S", 270: "W" };

/** Flight-style heading tape. Reads camera heading every frame and slides without React re-renders. */
export function Compass({ read }: { read: () => Telemetry | null }) {
  const tapeRef = useRef<HTMLDivElement>(null);
  const hdgRef = useRef<HTMLSpanElement>(null);
  const pitchRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const t = read();
      if (t && tapeRef.current) {
        tapeRef.current.style.transform = `translateX(${-(t.heading + 360) * PX_PER_DEG}px)`;
        hdgRef.current!.textContent = String(t.heading).padStart(3, "0");
        pitchRef.current!.textContent = `${t.pitch >= 0 ? "+" : ""}${t.pitch}°`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [read]);

  // Ticks from -360..720 so the tape can wrap in either direction.
  const ticks = [];
  for (let d = -360; d <= 720; d += 5) {
    const norm = ((d % 360) + 360) % 360;
    const major = norm % 30 === 0;
    ticks.push(
      <div key={d} className="absolute top-0 flex flex-col items-center" style={{ left: (d + 360) * PX_PER_DEG, transform: "translateX(-50%)" }}>
        <span className={major ? "h-2.5 w-px bg-data/80" : "h-1.5 w-px bg-data/35"} />
        {major && (
          <span className={`mt-0.5 font-mono text-[9px] tracking-wider ${CARDINAL[norm] ? "text-core" : "text-faint"}`}>
            {CARDINAL[norm] ?? norm}
          </span>
        )}
      </div>,
    );
  }

  return (
    <div className="pointer-events-none flex flex-col items-center" aria-hidden>
      <div className="compass-tape relative h-6 w-[240px] overflow-hidden sm:w-[320px]">
        <div className="absolute left-1/2 top-0 h-full">
          <div ref={tapeRef} className="relative h-full will-change-transform">
            {ticks}
          </div>
        </div>
        <span className="absolute left-1/2 top-0 h-3 w-px -translate-x-1/2 bg-core shadow-[0_0_6px_var(--core)]" />
      </div>
      <div className="mt-0.5 flex gap-3 font-mono text-[9.5px] tracking-widest text-faint">
        <span>
          HDG <span ref={hdgRef} className="text-core">000</span>
        </span>
        <span>
          PITCH <span ref={pitchRef} className="text-data">0°</span>
        </span>
      </div>
    </div>
  );
}
