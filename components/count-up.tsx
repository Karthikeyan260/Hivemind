"use client";

import { useEffect, useRef, useState } from "react";

/**
 * A number that counts up to its value the first time it is shown (stats on a page you open now and then).
 * Whole numbers only; a change of value later counts on from where it stands. With reduced motion it just shows the number.
 */
export function CountUp({ value, duration = 700, className }: { value: number; duration?: number; className?: string }) {
  const [shown, setShown] = useState(0);
  const from = useRef(0);
  useEffect(() => {
    if (!Number.isFinite(value)) return;
    const start = from.current;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches || start === value) {
      from.current = value;
       
      setShown(value);
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / duration);
      // ease-out: quick at first, settling onto the number.
      const v = Math.round(start + (value - start) * (1 - Math.pow(1 - p, 3)));
      from.current = v;
      setShown(v);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);
  // The real value is always what a screen reader hears.
  return (
    <span className={className} aria-label={String(value)}>
      <span aria-hidden>{shown}</span>
    </span>
  );
}
