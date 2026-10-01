"use client";

import { Check, Copy, Gift, Loader2, Plus, Send, Trash2, X } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { type BirthdayView, type HabitView, toggleHabit } from "@/components/habits/panel";
import { Button, cx, Empty, ErrorText, Input, PageHeader, Select, Skeleton, Textarea } from "@/components/ui";
import { useVoiceActions } from "@/components/voice/provider";
import { api, useFetch } from "@/lib/client-api";

const DAY_SETS = { daily: [0, 1, 2, 3, 4, 5, 6], weekdays: [1, 2, 3, 4, 5], weekends: [0, 6] } as const;
const DAY_LABEL = ["S", "M", "T", "W", "T", "F", "S"];

export default function HabitsPage() {
  return (
    <Suspense>
      <Habits />
    </Suspense>
  );
}

function Habits() {
  const habits = useFetch<HabitView[]>("/api/habits");
  const bdays = useFetch<BirthdayView[]>("/api/birthdays");
  const params = useSearchParams();
  const router = useRouter();
  const [wishFor, setWishFor] = useState<string | null>(params.get("wish"));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- opened from a birthday notification
    if (params.get("wish")) setWishFor(params.get("wish"));
  }, [params]);

  async function tick(h: HabitView) {
    habits.setData((all) => (all ?? []).map((x) => (x.id === h.id ? { ...x, doneToday: !x.doneToday } : x)));
    await toggleHabit(h).catch((e) => setError(e instanceof Error ? e.message : String(e)));
    habits.reload();
  }

  async function removeHabit(h: HabitView) {
    if (!confirm(`Stop tracking “${h.name}”? Its history is deleted too.`)) return;
    await api(`/api/habits/${h.id}`, { method: "DELETE" }).catch(() => {});
    habits.reload();
  }

  async function removeBirthday(b: BirthdayView) {
    if (!confirm(`Remove ${b.name}'s ${b.kind}?`)) return;
    await api(`/api/birthdays/${b.id}`, { method: "DELETE" }).catch(() => {});
    bdays.reload();
  }

  useVoiceActions({
    tick_habit: {
      description: "Habits page: tick (or untick) a habit for today. input: habit name.",
      run: async ({ input }) => {
        const h = habits.data?.find((x) => x.name.toLowerCase().includes(String(input ?? "").toLowerCase()));
        if (!h) return { error: `No habit "${input}".` };
        await tick(h);
        return { habit: h.name, done: !h.doneToday };
      },
    },
  });

  const today = (habits.data ?? []).filter((h) => h.dueToday);
  const doneCount = today.filter((h) => h.doneToday).length;

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader eyebrow="Daily life" title="Habits & birthdays" subtitle="Tick habits off here, by voice, or straight from the notification. Birthdays remind you a week before, the evening before and on the day, with a wish ready to send." />
      <ErrorText error={error ?? habits.error ?? bdays.error} />

      {/* Today */}
      <section className="mb-8">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="font-mono text-[11px] uppercase tracking-[0.2em] text-core">Today</h2>
          {today.length > 0 && (
            <span className="font-mono text-[11px] text-soft">
              {doneCount}/{today.length} done
            </span>
          )}
        </div>
        {!habits.data ? (
          <Skeleton lines={3} />
        ) : !today.length ? (
          <Empty>{habits.data.length ? "Nothing scheduled today. Rest day! 🌿" : "No habits yet. Add one below, or say “track exercise every day at 7 am”."}</Empty>
        ) : (
          <ul className="space-y-2">
            {today.map((h) => (
              <li key={h.id}>
                <button
                  type="button"
                  onClick={() => tick(h)}
                  className={cx("flex w-full items-center gap-3 rounded-xl border p-3.5 text-left transition-colors", h.doneToday ? "border-ok/40 bg-ok/10" : "border-line hover:border-core/60")}
                >
                  <span className={cx("flex size-7 shrink-0 items-center justify-center rounded-full border-2 transition-colors", h.doneToday ? "border-ok bg-ok text-black" : "border-line-strong")}>
                    {h.doneToday && <Check size={16} strokeWidth={3} />}
                  </span>
                  <span className="text-xl">{h.emoji}</span>
                  <span className="min-w-0 flex-1">
                    <span className={cx("block truncate font-medium", h.doneToday && "text-soft line-through")}>{h.name}</span>
                    <span className="font-mono text-[10.5px] text-faint">{h.times.length > 3 ? `${h.times.length}× from ${h.times[0]}` : h.times.join(" · ")}</span>
                  </span>
                  {h.streak > 0 && <span className="shrink-0 font-mono text-sm text-core">🔥 {h.streak}</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* All habits: streaks and the last 30 days */}
      {habits.data && habits.data.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 font-mono text-[11px] uppercase tracking-[0.2em] text-data">Streaks · last 30 days</h2>
          <ul className="space-y-3">
            {habits.data.map((h) => (
              <li key={h.id} className="rounded-xl border border-line p-3.5">
                <div className="flex items-center gap-2">
                  <span>{h.emoji}</span>
                  <span className="min-w-0 flex-1 truncate font-medium">{h.name}</span>
                  <span className="font-mono text-[10.5px] text-soft">
                    🔥 {h.streak} · best {h.best}
                    {h.rate != null ? ` · ${h.rate}%` : ""}
                  </span>
                  <button type="button" onClick={() => removeHabit(h)} aria-label={`Delete ${h.name}`} className="p-1 text-faint hover:text-alert">
                    <Trash2 size={14} />
                  </button>
                </div>
                <div className="mt-2.5 grid grid-cols-[repeat(30,minmax(0,1fr))] gap-[3px]" aria-label="Last 30 days">
                  {h.last30.map((d) => (
                    <span
                      key={d.date}
                      title={`${d.date}${d.done ? " · done" : d.scheduled ? " · missed" : " · rest day"}`}
                      className={cx("aspect-square rounded-[3px]", d.done ? "bg-ok" : d.scheduled ? "bg-line-strong/70" : "bg-line/30")}
                    />
                  ))}
                </div>
                <div className="mt-1.5 flex gap-1 font-mono text-[9.5px] text-faint">
                  {DAY_LABEL.map((l, i) => (
                    <span key={i} className={h.days.includes(i) ? "text-soft" : "opacity-40"}>
                      {l}
                    </span>
                  ))}
                  <span className="ml-auto">{h.times.length > 3 ? `${h.times.length}× a day` : h.times.join(" · ")}</span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <AddHabit onAdded={habits.reload} />

      {/* Birthdays */}
      <section className="mb-8 mt-10">
        <h2 className="mb-3 font-mono text-[11px] uppercase tracking-[0.2em] text-core">Birthdays & anniversaries</h2>
        {!bdays.data ? (
          <Skeleton lines={2} />
        ) : !bdays.data.length ? (
          <Empty>No birthdays saved. Add one below, or say “Arif&apos;s birthday is 12 March”.</Empty>
        ) : (
          <ul className="divide-y divide-line rounded-xl border border-line">
            {bdays.data.map((b) => (
              <li key={b.id} className="flex items-center gap-3 p-3">
                <span className="text-xl">{b.kind === "anniversary" ? "💍" : "🎂"}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">
                    {b.name}
                    {b.relation && <span className="ml-1.5 text-[12px] font-normal text-faint">{b.relation}</span>}
                  </span>
                  <span className="font-mono text-[10.5px] text-soft">
                    {b.label}
                    {b.turning ? ` · turning ${b.turning}` : ""}
                  </span>
                </span>
                <span className={cx("shrink-0 font-mono text-[11px]", b.days === 0 ? "text-core" : b.days <= 7 ? "text-data" : "text-faint")}>
                  {b.days === 0 ? "TODAY" : b.days === 1 ? "TOMORROW" : `${b.days} days`}
                </span>
                <button type="button" onClick={() => setWishFor(b.id)} aria-label={`Write a wish for ${b.name}`} className="p-1.5 text-data hover:text-core">
                  <Gift size={16} />
                </button>
                <button type="button" onClick={() => removeBirthday(b)} aria-label={`Remove ${b.name}`} className="p-1 text-faint hover:text-alert">
                  <Trash2 size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <AddBirthday onAdded={bdays.reload} />

      {wishFor && (
        <WishSheet
          id={wishFor}
          onClose={() => {
            setWishFor(null);
            if (params.get("wish")) router.replace("/habits");
          }}
        />
      )}
    </div>
  );
}

function AddHabit({ onAdded }: { onAdded: () => void }) {
  const [name, setName] = useState("");
  const [time, setTime] = useState("07:00");
  const [days, setDays] = useState<keyof typeof DAY_SETS>("daily");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api("/api/habits", { method: "POST", json: { name, times: [time], days: DAY_SETS[days] } });
      setName("");
      onAdded();
    } catch (er) {
      setErr(er instanceof Error ? er.message : String(er));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={add} className="rounded-xl border border-dashed border-line p-3.5">
      <div className="mb-2 font-mono text-[10.5px] uppercase tracking-wider text-faint">New habit</div>
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto_auto]">
        <Input placeholder="e.g. Exercise, Read 20 min, Meditate" value={name} onChange={(e) => setName(e.target.value)} required aria-label="Habit name" />
        <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} required aria-label="Reminder time" />
        <Select value={days} onChange={(e) => setDays(e.target.value as keyof typeof DAY_SETS)} aria-label="Days">
          <option value="daily">Every day</option>
          <option value="weekdays">Weekdays</option>
          <option value="weekends">Weekends</option>
        </Select>
        <Button type="submit" disabled={busy || !name.trim()}>
          <Plus size={15} /> Add
        </Button>
      </div>
      {err && <p className="mt-2 text-xs text-alert">{err}</p>}
      <p className="mt-2 text-[11.5px] text-faint">Several times a day? Say “drink water every 2 hours” to HIVEMIND.</p>
    </form>
  );
}

function AddBirthday({ onAdded }: { onAdded: () => void }) {
  const [name, setName] = useState("");
  const [date, setDate] = useState("");
  const [withYear, setWithYear] = useState(false);
  const [kind, setKind] = useState<"birthday" | "anniversary">("birthday");
  const [relation, setRelation] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const [y, m, d] = date.split("-").map(Number);
    setBusy(true);
    setErr(null);
    try {
      await api("/api/birthdays", { method: "POST", json: { name, month: m, day: d, year: withYear ? y : undefined, kind, relation: relation || undefined } });
      setName("");
      setDate("");
      setRelation("");
      onAdded();
    } catch (er) {
      setErr(er instanceof Error ? er.message : String(er));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={add} className="rounded-xl border border-dashed border-line p-3.5">
      <div className="mb-2 font-mono text-[10.5px] uppercase tracking-wider text-faint">Add a birthday or anniversary</div>
      <div className="grid gap-2 sm:grid-cols-2">
        <Input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} required aria-label="Name" />
        <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} required aria-label="Date" />
        <Select value={kind} onChange={(e) => setKind(e.target.value as "birthday" | "anniversary")} aria-label="Kind">
          <option value="birthday">Birthday</option>
          <option value="anniversary">Anniversary</option>
        </Select>
        <Input placeholder="Relation (friend, sister…), optional" value={relation} onChange={(e) => setRelation(e.target.value)} aria-label="Relation" />
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-[12.5px] text-soft">
          <input type="checkbox" checked={withYear} onChange={(e) => setWithYear(e.target.checked)} /> The year is right (show their age)
        </label>
        <Button type="submit" disabled={busy || !name.trim() || !date}>
          <Plus size={15} /> Save
        </Button>
      </div>
      {err && <p className="mt-2 text-xs text-alert">{err}</p>}
    </form>
  );
}

/** AI-written wish you can edit, then send on WhatsApp (when their number is saved) or copy. */
function WishSheet({ id, onClose }: { id: string; onClose: () => void }) {
  const [wish, setWish] = useState<{ name: string; text: string; phone: string | null } | null>(null);
  const [text, setText] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    api<{ name: string; text: string; phone: string | null }>(`/api/birthdays/${id}/wish`, { method: "POST" })
      .then((w) => {
        setWish(w);
        setText(w.text);
      })
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  }, [id]);

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-label="Birthday wish">
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-black/60" />
      <div className="sheet-up relative w-full max-w-md rounded-t-2xl border border-line bg-sunken p-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] sm:rounded-2xl">
        <div className="mb-3 flex items-center justify-between">
          <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-core">🎂 Wish {wish?.name ?? ""}</span>
          <button type="button" onClick={onClose} aria-label="Close" className="p-1 text-faint">
            <X size={16} />
          </button>
        </div>
        {err ? (
          <p className="text-sm text-alert">{err}</p>
        ) : !wish ? (
          <p className="flex items-center gap-2 py-6 text-sm text-soft">
            <Loader2 size={16} className="animate-spin" /> Writing a wish…
          </p>
        ) : (
          <>
            <Textarea rows={5} value={text} onChange={(e) => setText(e.target.value)} aria-label="Wish (editable)" />
            <div className="mt-3 grid gap-2">
              {wish.phone ? (
                <a
                  href={`https://wa.me/${wish.phone.slice(1)}?text=${encodeURIComponent(text)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-2 rounded-full bg-ok/90 py-3 text-sm font-medium text-black"
                >
                  <Send size={16} /> Send on WhatsApp
                </a>
              ) : (
                <p className="text-[12px] text-faint">No number saved for {wish.name}. Copy the wish, or say “{wish.name}&apos;s number is …” to save it.</p>
              )}
              <button
                type="button"
                onClick={() => void navigator.clipboard?.writeText(text).then(() => setCopied(true))}
                className="flex items-center justify-center gap-2 rounded-full border border-line py-2.5 text-sm text-soft"
              >
                <Copy size={15} /> {copied ? "Copied" : "Copy wish"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
