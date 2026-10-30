"use client";

import { useEffect, useState } from "react";
import type { DayBrief } from "@/lib/day-brief";

/**
 * What opens when the clock tower is tapped: a glanceable card with big light numerals on dark glass (the time,
 * the date, the part of the day) and, under it, what is next today. Kept sparse on purpose; the contrast is high
 * (white on near-black) so it reads over any sky.
 */
const parseTime = (s: string) => {
  const m = s.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i);
  if (!m) return null;
  let h = Number(m[1]) % 12;
  if (m[3].toLowerCase() === "pm") h += 12;
  return h * 60 + Number(m[2] ?? 0);
};

export function TowerCard({ pet, phase, onRing, onClose }: { pet: string; phase: { icon: string; name: string }; onRing: () => void; onClose: () => void }) {
  const [now, setNow] = useState(() => new Date());
  const [day, setDay] = useState<DayBrief | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    fetch("/api/brief/day")
      .then((r) => r.json() as Promise<DayBrief>)
      .then(setDay)
      .catch(() => setFailed(true));
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose]);

  const clock = now.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true });
  const [hm, ap] = [clock.replace(/\s?[ap]m$/i, ""), clock.match(/[ap]m$/i)?.[0].toUpperCase() ?? ""];
  const date = now.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" });
  const minutes = now.getHours() * 60 + now.getMinutes();

  // What's still ahead today: all-day things, and anything at or after this minute.
  const ahead = (day?.today ?? []).filter((r) => {
    const t = parseTime(r.when);
    return t == null || t >= minutes;
  });
  const habitsLeft = (day?.habits ?? []).filter((h) => !h.done);

  return (
    <div className="garden-sheet absolute inset-x-3 bottom-3 z-20 rounded-3xl border border-white/15 bg-[#0a0f1a]/85 p-5 text-white shadow-2xl backdrop-blur-xl sm:inset-x-auto sm:top-6 sm:right-6 sm:bottom-auto sm:w-[340px]" role="dialog" aria-label={`${pet}'s clock tower`}>
      <div className="flex items-start justify-between gap-3">
        <p className="font-mono text-[10px] tracking-[0.3em] text-white/60 uppercase">🕰️ {pet}&apos;s clock tower</p>
        <button onClick={onClose} aria-label="Close" className="-m-2 grid h-11 w-11 shrink-0 place-items-center rounded-full text-white/80 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-amber-200">
          ✕
        </button>
      </div>

      <div className="mt-1 flex items-end gap-2" aria-live="off">
        <span className="text-6xl leading-none font-semibold tracking-tight tabular-nums">{hm}</span>
        <span className="pb-1.5 text-lg font-medium text-white/80">{ap}</span>
        <span className="pb-1.5 font-mono text-sm text-white/50 tabular-nums">:{String(now.getSeconds()).padStart(2, "0")}</span>
      </div>
      <p className="mt-2 text-sm text-white/85">{date}</p>
      <p className="mt-0.5 text-xs text-amber-200">
        {phase.icon} {phase.name}
      </p>

      <div className="mt-4 border-t border-white/12 pt-3">
        <p className="text-[10px] tracking-[0.2em] text-white/55 uppercase">Next up</p>
        {!day && !failed && <p className="mt-2 animate-pulse text-sm text-white/60">Checking your day…</p>}
        {failed && <p className="mt-2 text-sm text-white/60">Couldn&apos;t read your day just now.</p>}
        {day && (
          <ul className="mt-2 space-y-1.5 text-sm">
            {day.overdue.length > 0 && <li className="text-rose-200">⚠️ {day.overdue.length} overdue</li>}
            {ahead.slice(0, 2).map((r) => (
              <li key={r.id} className="flex items-baseline justify-between gap-3">
                <span className="truncate">⏰ {r.title}</span>
                <span className="shrink-0 text-xs text-white/65 tabular-nums">{r.when}</span>
              </li>
            ))}
            {ahead.length > 2 && <li className="text-xs text-white/60">+{ahead.length - 2} more today</li>}
            {habitsLeft.length > 0 && (
              <li className="truncate">
                🌱 {habitsLeft.length} habit{habitsLeft.length === 1 ? "" : "s"} to go
                <span className="text-white/60"> · {habitsLeft.slice(0, 2).map((h) => h.name).join(", ")}</span>
              </li>
            )}
            {!ahead.length && !habitsLeft.length && !day.overdue.length && <li className="text-white/75">Nothing else today. Enjoy it 🎉</li>}
          </ul>
        )}
      </div>

      <button onClick={onRing} className="mt-4 flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl bg-white/12 text-sm font-medium transition hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-200 active:scale-[0.98]">
        🔔 Ring the bell
      </button>
    </div>
  );
}
