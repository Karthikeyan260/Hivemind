"use client";

import { Palette } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import * as beat from "@/lib/beat";
import { PALETTE, rgbOf, SWATCHES } from "@/lib/beat-color";

/** The music bar's 🎨 button: the colour of the music lights (any colour, rainbow, or the song's cover). */
export function BeatColorPicker() {
  const [open, setOpen] = useState(false);
  const [color, setColor] = useState("gold");
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the saved colour, read once
    setColor(beat.getColor());
    const sync = () => setColor(beat.getColor());
    window.addEventListener(beat.COLOR_EVENT, sync);
    return () => window.removeEventListener(beat.COLOR_EVENT, sync);
  }, []);
  // Close when tapping elsewhere.
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener("pointerdown", away);
    return () => window.removeEventListener("pointerdown", away);
  }, [open]);

  const pick = (c: string) => {
    beat.setColor(c);
    if (!beat.lightsOn()) beat.setLights(true);
  };
  const swatch = (c: string) =>
    c === "rainbow"
      ? "conic-gradient(red, orange, yellow, lime, cyan, blue, magenta, red)"
      : c === "auto"
        ? "linear-gradient(135deg, #ffb446 0 50%, #5096ff 50%)"
        : `rgb(${rgbOf(c).join(" ")})`;
  const hex = /^#/.test(color) ? color : `#${(PALETTE[color] ?? PALETTE.gold).map((v) => v.toString(16).padStart(2, "0")).join("")}`;

  return (
    <div ref={box} className="relative">
      <button type="button" onClick={() => setOpen(!open)} aria-label="Music lights colour" title="Music lights colour" className="p-1.5 text-soft hover:text-fg">
        <Palette size={17} style={{ color: color === "rainbow" || color === "auto" ? undefined : `rgb(${rgbOf(color).join(" ")})` }} />
      </button>
      {open && (
        <div className="absolute bottom-full right-0 z-50 mb-3 w-60 rounded-xl border border-line bg-[#0b1016]/95 p-3 text-xs text-fg shadow-2xl backdrop-blur-md">
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-faint">Music lights colour</p>
          <div className="mt-2 grid grid-cols-6 gap-2">
            {SWATCHES.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => pick(c)}
                aria-label={c}
                title={c === "auto" ? "From the song's cover" : c}
                className={`h-7 w-7 rounded-full border-2 ${color === c ? "border-white" : "border-transparent"}`}
                style={{ background: swatch(c) }}
              />
            ))}
            <label title="Any colour" className={`relative h-7 w-7 cursor-pointer overflow-hidden rounded-full border-2 ${/^#/.test(color) ? "border-white" : "border-line"}`} style={{ background: /^#/.test(color) ? color : "transparent" }}>
              <span className="absolute inset-0 grid place-items-center text-[13px]">+</span>
              <input type="color" value={hex} onChange={(e) => pick(e.target.value)} className="absolute inset-0 cursor-pointer opacity-0" aria-label="Any colour" />
            </label>
          </div>
          <p className="mt-2 text-faint">{color === "auto" ? "From each song's cover" : color === "rainbow" ? "Every colour, cycling" : `Now: ${color}`}</p>
        </div>
      )}
    </div>
  );
}
