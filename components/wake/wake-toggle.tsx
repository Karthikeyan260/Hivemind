"use client";

import { Ear, EarOff } from "lucide-react";
import { useEffect, useState } from "react";
import { cx } from "@/components/ui";
import { loadWake, setWakeOnThisTab, WAKE_CHANGED, WAKE_REJECTED, wakeOnThisTab, type WakeModel } from "@/lib/wake/store";

/**
 * The ear button: hands-free listening for the wake word, on only when the owner turns it on (for
 * this tab). Hidden until a wake word is set up. The mic is otherwise off until the mic is tapped.
 */
export function WakeToggle({ className, compact }: { className?: string; compact?: boolean }) {
  const [model, setModel] = useState<WakeModel | null>(null);
  const [on, setOn] = useState(false);
  // Flashes red when someone else said the word (the voiceprint didn't match).
  const [rejected, setRejected] = useState(false);
  useEffect(() => {
    const load = () => {
      setModel(loadWake());
      setOn(wakeOnThisTab());
    };
    let t: ReturnType<typeof setTimeout> | undefined;
    const flash = () => {
      setRejected(true);
      clearTimeout(t);
      t = setTimeout(() => setRejected(false), 1500);
    };
    load();
    window.addEventListener(WAKE_CHANGED, load);
    window.addEventListener(WAKE_REJECTED, flash);
    return () => {
      clearTimeout(t);
      window.removeEventListener(WAKE_CHANGED, load);
      window.removeEventListener(WAKE_REJECTED, flash);
    };
  }, []);
  if (!model?.enabled) return null;
  const listening = on || !!model.autoStart;
  const label = rejected ? "Heard the word, but not your voice" : listening ? `Listening for “${model.word}” (tap to stop)` : `Hands-free: listen for “${model.word}”`;
  return (
    <button
      type="button"
      onClick={() => setWakeOnThisTab(!listening)}
      aria-pressed={listening}
      aria-label={label}
      title={model.autoStart && listening ? `${label}. Always on: change it in Settings → Wake word.` : label}
      disabled={!!model.autoStart}
      className={cx(
        "pointer-events-auto flex shrink-0 items-center justify-center rounded-full border transition-colors",
        compact ? "size-8" : "size-10 backdrop-blur-md",
        rejected ? "border-alert bg-alert/15 text-alert" : listening ? "border-ok/60 bg-ok/15 text-ok" : "border-line bg-[#0b1016]/80 text-faint hover:text-data",
        className,
      )}
    >
      {listening ? <Ear size={compact ? 14 : 16} className="motion-safe:animate-pulse" /> : <EarOff size={compact ? 14 : 16} />}
    </button>
  );
}
