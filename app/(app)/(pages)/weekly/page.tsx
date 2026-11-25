"use client";

import { CountUp } from "@/components/count-up";
import { Meter } from "@/components/bridge/holo";
import { cx, ErrorText, PageHeader, Skeleton } from "@/components/ui";
import { useVoiceActions } from "@/components/voice/provider";
import { useFetch } from "@/lib/client-api";
import type { Weekly } from "@/lib/weekly";

const FACES = ["😞", "😕", "😐", "🙂", "😄"];

/** The last 7 days: how many habits you finished each day, your mood, and what you made. */
export default function WeeklyPage() {
  const feed = useFetch<Weekly>("/api/weekly");
  const w = feed.data;
  useVoiceActions({
    weekly_review: {
      description: "Weekly review page: read out how the last 7 days went.",
      run: () => (w ? { summary: w.line, habitRate: w.rate, moodAverage: w.moodAverage } : { error: "Still loading." }),
    },
  });

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader eyebrow="Review" title="This week" subtitle="The last 7 days from your own data: habits, moods, notes and games." />
      <ErrorText error={feed.error} />
      {!w ? (
        feed.loading ? <Skeleton lines={3} /> : null
      ) : (
        <div className="list-in space-y-4">
          <section className="border border-line bg-sunken/40 p-5">
            <div className="flex items-baseline gap-3">
              <span className="font-mono text-4xl tabular-nums text-core">{w.rate === null ? "–" : <><CountUp value={w.rate} />%</>}</span>
              <span className="hud-label">habits done</span>
              {w.rate !== null && w.lastRate !== null && w.rate !== w.lastRate && (
                <span className={cx("font-mono text-xs", w.rate > w.lastRate ? "text-ok" : "text-alert")}>
                  {w.rate > w.lastRate ? "▲" : "▼"} {Math.abs(w.rate - w.lastRate)} vs last week
                </span>
              )}
            </div>
            <p className="mt-3 text-[13.5px] leading-relaxed text-soft">{w.line}</p>
          </section>

          <section className="border border-line bg-sunken/40 p-5">
            <h2 className="hud-label mb-4">Day by day</h2>
            <div className="grid grid-cols-7 gap-2">
              {w.days.map((d, i) => {
                const pct = d.scheduled ? (d.done / d.scheduled) * 100 : 0;
                const today = i === w.days.length - 1;
                // full days glow green, partial ones the data blue, misses stay empty
                const color = pct >= 100 ? "var(--ok)" : "var(--data)";
                return (
                  <div key={d.date} className="flex flex-col items-center gap-1.5" title={`${d.date}: ${d.done} of ${d.scheduled} habits`}>
                    <span className="h-5 text-base leading-5">{d.mood ? FACES[d.mood - 1] : ""}</span>
                    <div className={cx("relative flex h-24 w-full items-end overflow-hidden rounded-md bg-data/[0.07]", today && "outline outline-1 outline-offset-2 outline-data/50")}>
                      <span aria-hidden className="absolute inset-x-0 top-1/2 border-t border-dashed border-white/10" />
                      <div
                        className="bar-rise w-full rounded-t-[3px]"
                        style={{ height: `${pct}%`, background: `linear-gradient(to top, color-mix(in oklch, ${color} 55%, transparent), ${color})`, boxShadow: pct ? `0 0 10px color-mix(in oklch, ${color} 60%, transparent)` : undefined }}
                      />
                    </div>
                    <span className="font-mono text-[10px] tabular-nums text-soft">{d.scheduled ? `${d.done}/${d.scheduled}` : "–"}</span>
                    <span className={cx("hud-label text-[9.5px]", today && "text-data")}>{today ? "Today" : d.weekday}</span>
                  </div>
                );
              })}
            </div>
          </section>

          {w.habits.length > 0 && (
            <section className="border border-line bg-sunken/40 p-5">
              <h2 className="hud-label mb-4">By habit</h2>
              <div className="space-y-3">
                {w.habits.map((h) => (
                  <Meter key={h.name} label={`${h.emoji} ${h.name}`} value={h.done} max={h.scheduled} />
                ))}
              </div>
            </section>
          )}

          <section className="grid grid-cols-3 gap-2">
            {[
              ["Mood", w.moodAverage === null ? "–" : `${FACES[Math.round(w.moodAverage) - 1]} ${w.moodAverage}`],
              ["Notes", String(w.notes)],
              ["Games won", `${w.games.won}/${w.games.played}`],
            ].map(([k, v]) => (
              <div key={k} className="border border-line bg-sunken/40 px-4 py-3">
                <div className="font-mono text-xl tabular-nums">{v}</div>
                <div className="hud-label">{k}</div>
              </div>
            ))}
          </section>
        </div>
      )}
    </div>
  );
}
