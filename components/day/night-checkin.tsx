"use client";

import { Check, Loader2, Moon, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { cx } from "@/components/ui";
import { BRAIN_CHANGED } from "@/lib/client-api";
import { isPublicPage } from "@/lib/public-paths";

type Ctx = {
  date: string;
  done: boolean;
  unfinished: { id: string; title: string; when: string }[];
  habitsOpen: { name: string; emoji: string }[];
  moods: { date: string; mood: number }[];
};
type Result = { habitsDone: string[]; movedTitles: string[] };

export const MOOD_FACES = ["😞", "😕", "😐", "🙂", "😄"];
const SKIP_KEY = "hivemind-checkin-skip";
const OPEN_EVENT = "hivemind-open-checkin";
/** Open the check-in from anywhere (a button, or the 9 pm notification's ?checkin=1). */
export const openCheckin = () => window.dispatchEvent(new Event(OPEN_EVENT));

/**
 * Night check-in: the first time HIVEMIND is opened after 7 pm (or from the 9 pm notification),
 * "How was your day?" — a mood, a few words, and today's unfinished reminders to move to tomorrow.
 */
export function NightCheckin() {
  const path = usePathname();
  const [ctx, setCtx] = useState<Ctx | null>(null);
  const [show, setShow] = useState(false);
  const [mood, setMood] = useState<number | null>(null);
  const [text, setText] = useState("");
  const [move, setMove] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const locked = isPublicPage(path) || path.startsWith("/unlock");

  async function load(force: boolean) {
    const r = await fetch("/api/checkin", { cache: "no-store" }).catch(() => null);
    if (!r?.ok) return;
    const c = (await r.json()) as Ctx;
    if (c.done && !force) return;
    setCtx(c);
    setMove(new Set(c.unfinished.map((u) => u.id)));
    setShow(true);
  }

  useEffect(() => {
    if (locked) return;
    const asked = new URLSearchParams(location.search).get("checkin") === "1";
    // Read once: a reload (or reopening the app on this address) mustn't ask again after it's done.
    if (asked) {
      const u = new URL(location.href);
      u.searchParams.delete("checkin");
      history.replaceState(history.state, "", u.pathname + u.search + u.hash);
    }
    let skipped = false;
    try {
      skipped = localStorage.getItem(SKIP_KEY) === new Date().toDateString();
    } catch {}
    // Evening, not dismissed today, not done yet: ask.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on mount; state is set after the fetch
    if (asked || (new Date().getHours() >= 19 && !skipped)) void load(asked);
    const open = () => void load(true);
    window.addEventListener(OPEN_EVENT, open);
    return () => window.removeEventListener(OPEN_EVENT, open);
    // Once per page load (not on every navigation).
  }, [locked]);

  function later() {
    try {
      localStorage.setItem(SKIP_KEY, new Date().toDateString());
    } catch {}
    setShow(false);
  }

  async function save() {
    if (!mood) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/checkin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mood, text, move: [...move] }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Couldn't save it.");
      setDone(j as Result);
      window.dispatchEvent(new Event(BRAIN_CHANGED));
      setTimeout(() => setShow(false), 4000);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (locked || !show || !ctx) return null;

  return (
    <div className="fixed inset-x-3 bottom-[calc(var(--tabbar-h)+var(--music-h,0px)+0.75rem)] z-[60] mx-auto max-w-md md:bottom-6 md:left-auto md:right-6 md:mx-0 md:w-96" role="dialog" aria-label="Night check-in">
      <div className="rise-in border border-data/40 bg-[#0b1016]/95 p-4 shadow-[0_0_40px_-10px_rgba(90,160,240,0.45)] backdrop-blur-md">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2 font-mono text-[10px] tracking-[0.2em] text-data">
            <Moon size={13} /> NIGHT CHECK-IN
          </div>
          <button type="button" onClick={later} aria-label="Later" className="text-faint hover:text-fg">
            <X size={15} />
          </button>
        </div>

        {done ? (
          <div className="mt-2 space-y-1 text-sm">
            <p className="flex items-center gap-1.5 font-medium text-ok">
              <Check size={15} /> Saved to your diary. Good night 🌙
            </p>
            {!!done.habitsDone.length && <p className="text-soft">Ticked: {done.habitsDone.join(", ")}</p>}
            {!!done.movedTitles.length && <p className="text-soft">Moved to tomorrow: {done.movedTitles.join(", ")}</p>}
          </div>
        ) : (
          <>
            <p className="mt-1.5 text-[15px] font-semibold">How was your day?</p>
            <div className="mt-2 flex justify-between" role="radiogroup" aria-label="Mood">
              {MOOD_FACES.map((f, i) => (
                <button
                  key={f}
                  type="button"
                  role="radio"
                  aria-checked={mood === i + 1}
                  onClick={() => setMood(i + 1)}
                  className={cx("rounded-full p-1.5 text-2xl transition-transform", mood === i + 1 ? "scale-125 bg-core/20" : "opacity-60 hover:opacity-100")}
                >
                  {f}
                </button>
              ))}
            </div>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={3}
              maxLength={5000}
              placeholder={`A few lines… what happened, what you did${ctx.habitsOpen.length ? ` (${ctx.habitsOpen.slice(0, 2).map((h) => h.name.toLowerCase()).join(", ")}?)` : ""}. Tap the keyboard mic to talk.`}
              className="mt-2 w-full resize-none rounded-md border border-line bg-sunken px-3 py-2 text-sm"
            />
            {!!ctx.unfinished.length && (
              <div className="mt-2 text-[13px]">
                <div className="font-mono text-[10px] uppercase tracking-widest text-core">Not done today · move to tomorrow?</div>
                <ul className="mt-1 max-h-28 space-y-0.5 overflow-y-auto">
                  {ctx.unfinished.map((u) => (
                    <li key={u.id}>
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={move.has(u.id)}
                          onChange={(e) =>
                            setMove((s) => {
                              const n = new Set(s);
                              if (e.target.checked) n.add(u.id);
                              else n.delete(u.id);
                              return n;
                            })
                          }
                        />
                        <span className="min-w-0 flex-1 truncate">{u.title}</span>
                        <span className="shrink-0 font-mono text-[10.5px] text-soft">{u.when}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {error && <p className="mt-1 text-xs text-alert">{error}</p>}
            <div className="mt-3 flex items-center gap-2">
              <button type="button" onClick={save} disabled={!mood || busy} className="flex items-center gap-1.5 rounded-md bg-core px-4 py-1.5 text-sm font-semibold text-core-ink disabled:opacity-40">
                {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Save
              </button>
              <button type="button" onClick={later} className="rounded-md border border-line px-3 py-1.5 text-sm text-soft">
                Later
              </button>
              {!!ctx.moods.length && (
                <span className="ml-auto text-sm tracking-tight" title="Your last check-ins">
                  {ctx.moods.slice(-7).map((m) => MOOD_FACES[m.mood - 1]).join("")}
                </span>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
