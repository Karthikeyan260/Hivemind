"use client";

import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrambleTextPlugin } from "gsap/ScrambleTextPlugin";
import { useRef } from "react";

gsap.registerPlugin(useGSAP, ScrambleTextPlugin);

/** Text that decodes through random glyphs every time its value changes. */
export function Scramble({ text, className, duration = 0.7 }: { text: string; className?: string; duration?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  useGSAP(
    () => {
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        if (ref.current) ref.current.textContent = text;
        return;
      }
      gsap.to(ref.current, { duration, scrambleText: { text, chars: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789/<>", speed: 0.6 }, ease: "none" });
    },
    { dependencies: [text], scope: ref },
  );
  return (
    <span ref={ref} className={className} aria-label={text}>
      {text}
    </span>
  );
}
