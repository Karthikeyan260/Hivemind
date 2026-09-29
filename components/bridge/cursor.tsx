"use client";

import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { useEffect, useRef } from "react";

gsap.registerPlugin(useGSAP);

/**
 * Magnetic targeting cursor (mouse/trackpad only): a dot that tracks exactly, a ring that
 * trails with inertia, and a comet tail. The ring expands and locks when over a star or control.
 */
export function Cursor({ locked, label }: { locked: boolean; label?: string }) {
  const root = useRef<HTMLDivElement>(null);
  const dot = useRef<HTMLDivElement>(null);
  const ring = useRef<HTMLDivElement>(null);
  const tail = useRef<HTMLDivElement[]>([]);
  const labelRef = useRef<HTMLSpanElement>(null);
  const hoverUi = useRef(false);

  useGSAP(
    () => {
      if (!window.matchMedia("(pointer: fine)").matches || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        gsap.set(root.current, { display: "none" });
        return;
      }
      document.documentElement.classList.add("hud-cursor");
      const qx = [dot, ring].map((r, i) => gsap.quickTo(r.current, "x", { duration: i ? 0.45 : 0.08, ease: "power3.out" }));
      const qy = [dot, ring].map((r, i) => gsap.quickTo(r.current, "y", { duration: i ? 0.45 : 0.08, ease: "power3.out" }));
      const tx = tail.current.map((el, i) => gsap.quickTo(el, "x", { duration: 0.12 + i * 0.05, ease: "power2.out" }));
      const ty = tail.current.map((el, i) => gsap.quickTo(el, "y", { duration: 0.12 + i * 0.05, ease: "power2.out" }));

      const move = (e: PointerEvent) => {
        qx.forEach((f) => f(e.clientX));
        qy.forEach((f) => f(e.clientY));
        tx.forEach((f) => f(e.clientX));
        ty.forEach((f) => f(e.clientY));
        const t = e.target as HTMLElement;
        const ui = !!t.closest("button, a, input, textarea, select, [role=button]");
        if (ui !== hoverUi.current) {
          hoverUi.current = ui;
          gsap.to(ring.current, { scale: ui ? 0.55 : 1, borderColor: ui ? "var(--core)" : "oklch(0.84 0.085 215 / 0.6)", duration: 0.25 });
        }
      };
      const down = () => gsap.to(ring.current, { scale: 0.7, duration: 0.12 });
      const up = () => gsap.to(ring.current, { scale: hoverUi.current ? 0.55 : 1, duration: 0.3, ease: "back.out(3)" });
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerdown", down);
      window.addEventListener("pointerup", up);
      return () => {
        document.documentElement.classList.remove("hud-cursor");
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerdown", down);
        window.removeEventListener("pointerup", up);
      };
    },
    { scope: root },
  );

  useEffect(() => {
    if (!ring.current) return;
    gsap.to(ring.current, {
      width: locked ? 54 : 30,
      height: locked ? 54 : 30,
      rotate: locked ? 45 : 0,
      borderRadius: locked ? "4px" : "50%",
      borderColor: locked ? "var(--core)" : "oklch(0.84 0.085 215 / 0.6)",
      duration: 0.35,
      ease: "expo.out",
    });
    if (labelRef.current) {
      gsap.to(labelRef.current, { autoAlpha: locked ? 1 : 0, x: locked ? 0 : -6, duration: 0.25 });
    }
  }, [locked]);

  return (
    <div ref={root} aria-hidden className="pointer-events-none fixed inset-0 z-[60]">
      {Array.from({ length: 5 }, (_, i) => (
        <div
          key={i}
          ref={(el) => {
            if (el) tail.current[i] = el;
          }}
          className="absolute left-0 top-0 -ml-[2px] -mt-[2px] h-1 w-1 rounded-full bg-core"
          style={{ opacity: 0.5 - i * 0.09, transform: "translate(-100px,-100px)" }}
        />
      ))}
      <div
        ref={ring}
        className="absolute left-0 top-0 -translate-x-1/2 -translate-y-1/2 border"
        style={{ width: 30, height: 30, borderRadius: "50%", borderColor: "oklch(0.84 0.085 215 / 0.6)", transform: "translate(-100px,-100px)" }}
      >
        <span
          ref={labelRef}
          className="absolute left-full top-1/2 ml-3 -translate-y-1/2 -rotate-45 whitespace-nowrap font-mono text-[9.5px] tracking-widest text-core opacity-0"
        >
          {label}
        </span>
      </div>
      <div ref={dot} className="absolute left-0 top-0 -ml-[3px] -mt-[3px] h-1.5 w-1.5 rounded-full bg-fg shadow-[0_0_8px_var(--data)]" style={{ transform: "translate(-100px,-100px)" }} />
    </div>
  );
}
