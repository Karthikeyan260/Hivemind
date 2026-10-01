"use client";

import { Check } from "lucide-react";
import Link from "next/link";
import { Holo } from "@/components/bridge/holo";
import { cx } from "@/components/ui";
import { api, useFetch } from "@/lib/client-api";

export type HabitView = {
  id: string;
  name: string;
  emoji: string;
  times: string[];
  days: number[];
  streak: number;
  best: number;
  doneToday: boolean;
  dueToday: boolean;
  rate: number | null;
  last30: { date: string; scheduled: boolean; done: boolean }[];
};
export type BirthdayView = { id: string; name: string; kind: "birthday" | "anniversary"; relation?: string; label: string; days: number; turning: number | null; year?: number };

export async function toggleHabit(h: HabitView) {
  return api<{ streak: number }>(`/api/habits/${h.id}/check`, { method: "POST", json: { done: !h.doneToday } });
}

/** Home card: today's habits (tap to tick) and the next birthday. */
export function HabitsPanel() {
  const habits = useFetch<HabitView[]>("/api/habits");
  const bdays = useFetch<BirthdayView[]>("/api/birthdays");

  const today = (habits.data ?? []).filter((h) => h.dueToday);
  const next = (bdays.data ?? []).find((b) => b.days <= 30);
  if (!habits.data?.length && !next) return null;

  async function tick(h: HabitView) {
    habits.setData((all) => (all ?? []).map((x) => (x.id === h.id ? { ...x, doneToday: !x.doneToday, streak: x.doneToday ? Math.max(0, x.streak - 1) : x.streak + 1 } : x)));
    await toggleHabit(h).catch(() => {});
    habits.reload();
  }

  return (
    <Holo
      title={
        <Link href="/habits" className="hover:text-core">
          Habits
        </Link>
      }
      right={<span className="font-mono text-[10px] text-faint">{today.length ? `${today.filter((h) => h.doneToday).length}/${today.length} TODAY` : ""}</span>}
    >
      <div className="space-y-2 p-4">
        {today.map((h) => (
          <button key={h.id} type="button" onClick={() => tick(h)} className="flex w-full items-center gap-2 text-left text-[12.5px]">
            <span className={cx("flex h-3.5 w-3.5 shrink-0 items-center justify-center border transition-colors", h.doneToday ? "border-ok bg-ok/20 text-ok" : "border-line-strong")}>
              {h.doneToday && <Check size={10} />}
            </span>
            <span className="shrink-0">{h.emoji}</span>
            <span className={cx("min-w-0 flex-1 truncate", h.doneToday && "text-faint line-through")}>{h.name}</span>
            {h.streak > 0 && <span className="shrink-0 font-mono text-[10px] text-core">🔥{h.streak}</span>}
          </button>
        ))}
        {next && (
          <Link href={next.days === 0 ? `/habits?wish=${next.id}` : "/habits"} className="flex items-center gap-2 border-t border-line pt-2 text-[12.5px] hover:text-core">
            <span>{next.kind === "anniversary" ? "💍" : "🎂"}</span>
            <span className="min-w-0 flex-1 truncate">{next.name}</span>
            <span className={cx("shrink-0 font-mono text-[10px]", next.days === 0 ? "text-core" : "text-soft")}>{next.days === 0 ? "TODAY · WISH" : next.days === 1 ? "TOMORROW" : `IN ${next.days} DAYS`}</span>
          </Link>
        )}
      </div>
    </Holo>
  );
}
