"use client";

import { type ReactNode, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { cx } from "@/components/ui";

/**
 * A small anchored panel (versions list, voice commands, the ⋯ menu). Opens on click, closes on
 * Escape, an outside click, or when `close()` is called from inside.
 */
export function Pop({
  label,
  trigger,
  children,
  align = "end",
  className,
  triggerClass,
}: {
  label: string;
  trigger: ReactNode;
  children: (close: () => void) => ReactNode;
  align?: "start" | "end";
  className?: string;
  triggerClass?: string;
}) {
  const [open, setOpen] = useState(false);
  // Where the panel goes: under its button, but always inside the screen (phones are narrow).
  const [at, setAt] = useState<{ top: number; left?: number; right?: number } | null>(null);
  const box = useRef<HTMLDivElement | null>(null);
  const panel = useRef<HTMLDivElement | null>(null);
  const btn = useRef<HTMLButtonElement | null>(null);
  const id = useId();

  function toggle() {
    if (open) return setOpen(false);
    const r = btn.current?.getBoundingClientRect();
    if (r) {
      const edge = 16;
      setAt(align === "end" ? { top: r.bottom + 6, right: Math.max(edge, window.innerWidth - r.right) } : { top: r.bottom + 6, left: Math.max(edge, r.left) });
    }
    setOpen(true);
  }

  // Wider than the room beside its button: slide it back inside the screen before it is painted.
  useLayoutEffect(() => {
    const el = panel.current;
    if (!open || !el) return;
    const r = el.getBoundingClientRect();
    if (r.left < 16) {
      el.style.right = "auto";
      el.style.left = "16px";
    } else if (r.right > window.innerWidth - 16) {
      el.style.left = "auto";
      el.style.right = "16px";
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const shut = () => setOpen(false);
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    window.addEventListener("resize", shut);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", esc);
      window.removeEventListener("resize", shut);
    };
  }, [open]);

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        aria-label={label}
        title={label}
        aria-expanded={open}
        aria-controls={id}
        ref={btn}
        onClick={toggle}
        className={cx(
          "inline-flex h-9 items-center gap-1.5 rounded-md px-2.5 text-sm text-soft transition-colors duration-150 hover:bg-raised hover:text-fg pointer-coarse:h-11",
          open && "bg-raised text-fg",
          triggerClass,
        )}
      >
        {trigger}
      </button>
      {open && (
        <div
          id={id}
          ref={panel}
          role="dialog"
          aria-label={label}
          style={at ?? undefined}
          className={cx(
            "pop-in fixed z-50 max-h-[70dvh] w-[min(22rem,calc(100vw-2rem))] overflow-y-auto rounded-xl border border-line-strong bg-raised p-1.5 shadow-[0_12px_40px_-8px_oklch(0.05_0.01_250/0.7)]",
            className,
          )}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}
