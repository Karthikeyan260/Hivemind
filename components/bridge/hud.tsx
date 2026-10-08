"use client";

import { useEffect, useState } from "react";
import { cx } from "@/components/ui";
import type { Telemetry } from "@/components/galaxy/scene";

/**
 * The header clock and the galaxy readout, each updating only itself (they used to re-render the
 * whole home page 3 times a second). Both pause while the app is in the background.
 */
function useTicker(ms: number, enabled = true) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let id: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (id || document.hidden) return;
      setN((x) => x + 1);
      id = setInterval(() => setN((x) => x + 1), ms);
    };
    const stop = () => {
      if (id) clearInterval(id);
      id = null;
    };
    const vis = () => (document.hidden ? stop() : start());
    start();
    document.addEventListener("visibilitychange", vis);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", vis);
    };
  }, [ms, enabled]);
  return n;
}

export function HudClock({ className }: { className?: string }) {
  useTicker(1000);
  // Rendered only in the browser (this is a client component mounted after hydration-safe first paint).
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the time is only known in the browser
    setMounted(true);
  }, []);
  return <span className={className}>{mounted ? new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }) : ""}</span>;
}

/** FPS / LOCK readout, shown on very wide screens only (and only polled there). */
export function HudTelemetry({ read, busy }: { read: () => Telemetry | null; busy: boolean }) {
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1536px)");
    const on = () => setWide(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  useTicker(500, wide);
  const tele = wide ? read() : null;
  if (!tele) return null;
  return (
    <span className="hidden items-center gap-3 2xl:flex">
      <span className="eq flex items-end" aria-hidden>
        {[0, 1, 2, 3, 4].map((i) => (
          <span key={i} style={{ animationDelay: `${i * 0.13}s`, animationDuration: busy ? "0.6s" : "2.4s" }} />
        ))}
      </span>
      <span>
        FPS <b className="font-normal text-data">{tele.fps}</b>
      </span>
      <span>
        LOCK <b className={cx("font-normal", tele.locked ? "text-core" : "text-data")}>{String(tele.locked).padStart(2, "0")}</b>
      </span>
    </span>
  );
}
