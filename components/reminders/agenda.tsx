"use client";

import { Check, X } from "lucide-react";
import Link from "next/link";
import { Holo } from "@/components/bridge/holo";
import { cx } from "@/components/ui";
import { api, BRAIN_CHANGED, useFetch } from "@/lib/client-api";

type Reminder = { id: string; title: string; when: string; all_day: boolean; status: "pending" | "done" };
type Agenda = { overdue: Reminder[]; today: Reminder[]; tomorrow: Reminder[]; later: Reminder[] };

/** Home-page agenda: overdue, today and tomorrow, with a tick to mark things done. */
export function AgendaPanel() {
  const { data, setData } = useFetch<Agenda>("/api/reminders?days=7");

  async function toggle(r: Reminder) {
    const status: Reminder["status"] = r.status === "done" ? "pending" : "done";
    const flip = (l: Reminder[]) => l.map((x) => (x.id === r.id ? { ...x, status } : x));
    if (data) setData({ overdue: flip(data.overdue), today: flip(data.today), tomorrow: flip(data.tomorrow), later: flip(data.later) });
    await api(`/api/reminders/${r.id}`, { method: "PATCH", json: { status } }).catch(() => {});
    window.dispatchEvent(new Event(BRAIN_CHANGED));
  }

  async function cancel(r: Reminder) {
    if (!confirm(`Cancel “${r.title}”? It will be removed from your agenda and notes.`)) return;
    const drop = (l: Reminder[]) => l.filter((x) => x.id !== r.id);
    if (data) setData({ overdue: drop(data.overdue), today: drop(data.today), tomorrow: drop(data.tomorrow), later: drop(data.later) });
    await api(`/api/reminders/${r.id}`, { method: "DELETE" }).catch(() => {});
    window.dispatchEvent(new Event(BRAIN_CHANGED));
  }

  const groups = data
    ? ([
        ["Overdue", data.overdue.filter((r) => r.status === "pending"), "text-alert"],
        ["Today", data.today, "text-core"],
        ["Tomorrow", data.tomorrow, "text-data"],
        ["This week", data.later.slice(0, 3), "text-soft"],
      ] as const)
    : [];
  const empty = groups.every(([, l]) => !l.length);

  return (
    <Holo title="Agenda" right={<span className="font-mono text-[10px] text-faint">{data ? `${data.today.filter((r) => r.status === "pending").length} TODAY` : ""}</span>}>
      <div className="space-y-3 p-4">
        {!data ? (
          <p className="font-mono text-[11px] text-faint">SYNCING…</p>
        ) : empty ? (
          <p className="text-[12.5px] text-soft">
            Nothing scheduled. Try “I have a meeting tomorrow at 3 pm” or “remind me to submit the report on Friday”.
          </p>
        ) : (
          groups.map(([label, list, tone]) =>
            list.length ? (
              <div key={label}>
                <div className={cx("mb-1 font-mono text-[10px] uppercase tracking-widest", tone)}>{label}</div>
                <ul className="space-y-1">
                  {list.map((r) => (
                    <li key={r.id} className="group flex items-center gap-2 text-[12.5px]">
                      <button
                        type="button"
                        onClick={() => toggle(r)}
                        aria-label={r.status === "done" ? `Mark ${r.title} not done` : `Mark ${r.title} done`}
                        className={cx(
                          "flex h-3.5 w-3.5 shrink-0 items-center justify-center border transition-colors",
                          r.status === "done" ? "border-ok bg-ok/20 text-ok" : "border-line-strong hover:border-core",
                        )}
                      >
                        {r.status === "done" && <Check size={10} />}
                      </button>
                      <Link href={`/notes?open=${r.id}`} className={cx("min-w-0 flex-1 truncate hover:text-core", r.status === "done" && "text-faint line-through")}>
                        {r.title}
                      </Link>
                      <span className="shrink-0 font-mono text-[10px] text-soft">
                        {r.all_day ? "all day" : label === "This week" ? r.when.split(",")[0] : r.when.split(", ").pop()}
                      </span>
                      <button type="button" onClick={() => cancel(r)} aria-label={`Cancel ${r.title}`} className="shrink-0 text-faint opacity-0 hover:text-alert focus:opacity-100 group-hover:opacity-100">
                        <X size={12} />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null,
          )
        )}
      </div>
    </Holo>
  );
}
