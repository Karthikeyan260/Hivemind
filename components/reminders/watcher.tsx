"use client";

import { AlarmClock, BellRing, Check, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { cx } from "@/components/ui";
import { BRAIN_CHANGED } from "@/lib/client-api";
import { sfx } from "@/lib/sfx";

type Reminder = { id: string; title: string; details: string; when: string; all_day: boolean; status: "pending" | "done" };
type Agenda = { overdue: Reminder[]; today: Reminder[]; tomorrow: Reminder[] };
type Toast = { key: string; kind: "alert"; reminder: Reminder } | { key: string; kind: "brief"; agenda: Agenda };

const POLL_MS = 60_000;
const BRIEF_KEY = "hivemind-brief-date";

function chime() {
  sfx.done();
  setTimeout(() => sfx.done(), 450);
}

/**
 * In-app reminders for every page: polls for due alerts once a minute (and when the tab regains
 * focus), shows them as toasts with a chime, and once per day shows a brief of today and tomorrow.
 * When the tab is in the background and the owner allowed it, a system notification is shown too.
 */
export function ReminderWatcher() {
  const path = usePathname();
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [canNotify, setCanNotify] = useState<NotificationPermission | "unsupported">("unsupported");
  const busy = useRef(false);
  const briefed = useRef<string | null>(null);
  const locked = path.startsWith("/unlock");

  const dismiss = (key: string) => setToasts((t) => t.filter((x) => x.key !== key));

  const poll = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      const r = await fetch("/api/reminders/due", { cache: "no-store" });
      if (!r.ok) return;
      const due = (await r.json()) as Reminder[];
      if (!due.length) return;
      chime();
      setToasts((t) => [...t.filter((x) => !due.some((d) => x.key === `a-${d.id}`)), ...due.map((reminder) => ({ key: `a-${reminder.id}`, kind: "alert" as const, reminder }))]);
      if (document.hidden && "Notification" in window && Notification.permission === "granted") {
        for (const d of due) new Notification(`⏰ ${d.title}`, { body: d.when + (d.details ? `\n${d.details}` : ""), tag: d.id });
      }
    } catch {
      // offline or locked: try again next tick
    } finally {
      busy.current = false;
    }
  }, []);

  // Morning brief: the first time HIVEMIND is opened each day.
  const brief = useCallback(async () => {
    const today = new Date().toDateString();
    // Claim today's brief before fetching so a second call (StrictMode, fast remount) can't show it twice.
    if (briefed.current === today) return;
    briefed.current = today;
    try {
      if (localStorage.getItem(BRIEF_KEY) === today) return;
    } catch {}
    const r = await fetch("/api/reminders?days=2", { cache: "no-store" }).catch(() => null);
    if (!r?.ok) {
      briefed.current = null;
      return;
    }
    const agenda = (await r.json()) as Agenda;
    try {
      localStorage.setItem(BRIEF_KEY, today);
    } catch {}
    const pending = (l: Reminder[]) => l.filter((x) => x.status === "pending");
    if (!pending(agenda.overdue).length && !pending(agenda.today).length && !pending(agenda.tomorrow).length) return;
    setToasts((t) => [...t.filter((x) => x.key !== "brief"), { key: "brief", kind: "brief", agenda: { overdue: pending(agenda.overdue), today: pending(agenda.today), tomorrow: pending(agenda.tomorrow) } }]);
  }, []);

  useEffect(() => {
    if (locked) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- read the browser's permission once
    setCanNotify("Notification" in window ? Notification.permission : "unsupported");
    void brief();
    void poll();
    const id = setInterval(poll, POLL_MS);
    const onFocus = () => void poll();
    window.addEventListener("focus", onFocus);
    window.addEventListener(BRAIN_CHANGED, onFocus);
    return () => {
      clearInterval(id);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener(BRAIN_CHANGED, onFocus);
    };
  }, [locked, poll, brief]);

  async function done(t: Toast & { kind: "alert" }) {
    dismiss(t.key);
    await fetch(`/api/reminders/${t.reminder.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "done" }) });
    window.dispatchEvent(new Event(BRAIN_CHANGED));
  }

  async function enableDesktop() {
    const p = await Notification.requestPermission();
    setCanNotify(p);
  }

  if (locked || !toasts.length) return null;

  return (
    <div className="pointer-events-none fixed right-4 top-[max(1rem,env(safe-area-inset-top))] z-[60] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.key}
          role="alert"
          className={cx(
            "rise-in pointer-events-auto border bg-[#0b1016]/95 p-3.5 shadow-[0_0_40px_-10px_rgba(240,180,90,0.5)] backdrop-blur-md",
            t.kind === "alert" ? "border-core/60" : "border-data/40",
          )}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2 font-mono text-[10px] tracking-[0.2em] text-core">
              {t.kind === "alert" ? <BellRing size={13} className="animate-pulse" /> : <AlarmClock size={13} />}
              {t.kind === "alert" ? "REMINDER" : "YOUR DAY"}
            </div>
            <button type="button" onClick={() => dismiss(t.key)} aria-label="Dismiss" className="text-faint hover:text-fg">
              <X size={14} />
            </button>
          </div>

          {t.kind === "alert" ? (
            <>
              <div className="mt-1.5 text-[15px] font-medium leading-snug">{t.reminder.title}</div>
              <div className="font-mono text-[11px] text-data">{t.reminder.when}</div>
              {t.reminder.details && <p className="mt-1 line-clamp-3 text-[12.5px] text-soft">{t.reminder.details}</p>}
              <div className="mt-2.5 flex items-center gap-2">
                <button type="button" onClick={() => done(t)} className="flex items-center gap-1 border border-ok/50 px-2 py-1 font-mono text-[10px] tracking-widest text-ok hover:bg-ok/10">
                  <Check size={12} /> DONE
                </button>
                <button type="button" onClick={() => dismiss(t.key)} className="border border-line px-2 py-1 font-mono text-[10px] tracking-widest text-soft hover:text-fg">
                  LATER
                </button>
                {canNotify === "default" && (
                  <button type="button" onClick={enableDesktop} className="ml-auto font-mono text-[10px] tracking-widest text-faint hover:text-data">
                    ENABLE DESKTOP ALERTS
                  </button>
                )}
              </div>
            </>
          ) : (
            <div className="mt-2 space-y-2 text-[13px]">
              {(
                [
                  ["Overdue", t.agenda.overdue, "text-alert"],
                  ["Today", t.agenda.today, "text-core"],
                  ["Tomorrow", t.agenda.tomorrow, "text-data"],
                ] as const
              ).map(([label, list, tone]) =>
                list.length ? (
                  <div key={label}>
                    <div className={cx("font-mono text-[10px] uppercase tracking-widest", tone)}>{label}</div>
                    <ul className="mt-0.5 space-y-0.5">
                      {list.map((r) => (
                        <li key={r.id} className="flex justify-between gap-3">
                          <span className="truncate">{r.title}</span>
                          <span className="shrink-0 font-mono text-[10.5px] text-soft">{r.all_day ? "all day" : r.when.split(", ").pop()}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null,
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
