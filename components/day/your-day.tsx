"use client";

import { Cake, Square, Volume2 } from "lucide-react";
import { useEffect, useState } from "react";
import { cx } from "@/components/ui";
import type { DayBrief } from "@/lib/day-brief";
import { isReading, onReading, readAloud, stopReading } from "@/lib/read-aloud";

/** Is there anything worth showing? */
export const hasAnything = (d: DayBrief) => !!(d.overdue.length || d.today.length || d.tomorrow.length || d.habits.length || d.birthdays.length || d.news);

/** "Hear your day" / "Stop". */
export function ListenButton({ day, className }: { day: DayBrief; className?: string }) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- pick up a reading started elsewhere
    setOn(isReading(day.speech));
    return onReading((t) => setOn(t === day.speech));
  }, [day.speech]);
  return (
    <button
      type="button"
      onClick={() => (on ? stopReading() : void readAloud(day.speech))}
      className={cx("flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-semibold", on ? "bg-alert/15 text-alert" : "bg-core text-black hover:bg-core/90", className)}
    >
      {on ? <Square size={12} /> : <Volume2 size={13} />} {on ? "Stop" : "Hear your day"}
    </button>
  );
}

/** Today at a glance: overdue, today, habits, birthdays, tomorrow, the news headline. */
export function YourDay({ day, compact }: { day: DayBrief; compact?: boolean }) {
  const todo = day.habits.filter((h) => !h.done).length;
  const section = (label: string, list: DayBrief["today"], tone: string) =>
    list.length ? (
      <div>
        <div className={cx("font-mono text-[10px] uppercase tracking-widest", tone)}>{label}</div>
        <ul className="mt-0.5 space-y-0.5">
          {list.slice(0, compact ? 4 : 10).map((r) => (
            <li key={r.id} className="flex justify-between gap-3">
              <span className="truncate">{r.title}</span>
              <span className="shrink-0 font-mono text-[10.5px] text-soft">{r.when}</span>
            </li>
          ))}
          {compact && list.length > 4 && <li className="text-xs text-faint">+{list.length - 4} more</li>}
        </ul>
      </div>
    ) : null;
  return (
    <div className={cx("space-y-2.5", compact ? "text-[13px]" : "text-sm")}>
      {section("Overdue", day.overdue, "text-alert")}
      {section("Today", day.today, "text-core")}
      {!day.today.length && !day.overdue.length && <p className="text-soft">Nothing on the calendar today.</p>}
      {section("Tomorrow", day.tomorrow, "text-data")}
      {!!day.habits.length && (
        <div>
          <div className="font-mono text-[10px] uppercase tracking-widest text-ok">Habits {todo ? `· ${todo} to do` : "· all done"}</div>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {day.habits.map((h) => (
              <span key={h.name} className={cx("rounded-full border px-2 py-0.5 text-xs", h.done ? "border-ok/40 text-ok line-through decoration-ok/60" : "border-line")}>
                {h.emoji} {h.name}
                {h.streak >= 2 && <span className="ml-1 text-core">🔥{h.streak}</span>}
              </span>
            ))}
          </div>
        </div>
      )}
      {day.birthdays.map((b) => (
        <p key={b.name} className="flex items-center gap-1.5 text-[13px]">
          <Cake size={13} className="shrink-0 text-core" />
          <span>
            <b>{b.name}</b>&apos;s {b.kind} {b.days === 0 ? "is today" : b.days === 1 ? "is tomorrow" : `in ${b.days} days`}
            {b.turning ? ` (turning ${b.turning})` : ""}
          </span>
        </p>
      ))}
      {day.week && (
        <div>
          <div className="font-mono text-[10px] uppercase tracking-widest text-data">Your week · {day.week.headline}</div>
          <div className="mt-1 flex flex-wrap gap-1.5 text-xs">
            {day.week.due > 0 && <span className="rounded-full border border-line px-2 py-0.5">✅ {day.week.done}/{day.week.due} habit days</span>}
            {day.week.checkins > 0 && <span className="rounded-full border border-line px-2 py-0.5">🌙 {day.week.checkins} check-in{day.week.checkins === 1 ? "" : "s"}</span>}
            {day.week.wins > 0 && <span className="rounded-full border border-line px-2 py-0.5">🏆 {day.week.wins} won</span>}
            {day.week.played > 0 && <span className="rounded-full border border-line px-2 py-0.5">🎵 {day.week.played} songs</span>}
            {day.week.best && day.week.best.done > 0 && <span className="rounded-full border border-ok/40 px-2 py-0.5 text-ok">{day.week.best.emoji} {day.week.best.name} {day.week.best.done}/{day.week.best.due}</span>}
          </div>
        </div>
      )}
      {day.news && <p className="line-clamp-2 text-[12.5px] text-soft">📰 {day.news}</p>}
    </div>
  );
}
