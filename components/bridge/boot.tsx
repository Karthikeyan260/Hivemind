"use client";

import { useEffect, useRef, useState } from "react";
import { Core } from "@/components/core";

const KEY = "hivemind-booted";

/** Cinematic boot log shown once per browser session, then fades away. */
export function Boot({ lines, ready, onDone }: { lines: string[]; ready: boolean; onDone?: () => void }) {
  const doneRef = useRef(onDone);
  useEffect(() => {
    doneRef.current = onDone;
  });
  const [show, setShow] = useState(true);
  const [count, setCount] = useState(0);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    try {
      if (sessionStorage.getItem(KEY) || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- skip boot on repeat visits
        setShow(false);
        doneRef.current?.();
      }
    } catch {}
  }, []);

  useEffect(() => {
    if (!show || count >= lines.length) return;
    const id = setTimeout(() => setCount((c) => c + 1), count === 0 ? 250 : 320);
    return () => clearTimeout(id);
  }, [show, count, lines.length]);

  useEffect(() => {
    if (!show || !ready || count < lines.length) return;
    const a = setTimeout(() => setLeaving(true), 450);
    const b = setTimeout(() => {
      setShow(false);
      doneRef.current?.();
      try {
        sessionStorage.setItem(KEY, "1");
      } catch {}
    }, 1250);
    return () => {
      clearTimeout(a);
      clearTimeout(b);
    };
  }, [show, ready, count, lines.length]);

  if (!show) return null;
  return (
    <div
      className="hud-grid fixed inset-0 z-50 flex items-center justify-center bg-bg"
      style={leaving ? { animation: "boot-out 800ms cubic-bezier(0.22,1,0.36,1) forwards" } : undefined}
      onClick={() => setLeaving(true)}
    >
      <div className="flex w-full max-w-lg flex-col items-center px-6">
        <Core state={count < lines.length ? "thinking" : "answering"} size={140} />
        <div className="mt-8 w-full font-mono text-[12px] leading-6">
          {lines.slice(0, count).map((l, i) => (
            <div key={i} className="flex gap-3" style={{ animation: "boot-line 300ms cubic-bezier(0.22,1,0.36,1) both" }}>
              <span className="text-faint">{String(i + 1).padStart(2, "0")}</span>
              <span className={i === lines.length - 1 ? "text-core" : "text-soft"}>{l}</span>
              <span className="ml-auto text-ok">{i === lines.length - 1 ? "" : "OK"}</span>
            </div>
          ))}
          {count < lines.length && <span className="stream-caret" aria-hidden />}
        </div>
      </div>
    </div>
  );
}
