"use client";

import { GitMerge, Lightbulb, Loader2, Moon, PencilLine, Undo2 } from "lucide-react";
import { useState } from "react";
import { MascotFrame } from "@/components/mascot";
import { Button, cx, ErrorText, PageHeader, Select } from "@/components/ui";
import { useVoiceActions } from "@/components/voice/provider";
import { api, BRAIN_CHANGED, useFetch } from "@/lib/client-api";

type Change = { kind: "merged" | "updated" | "learned"; text: string; activities: string[]; undone?: boolean };
type Dream = { date: string; at: string; changes: Change[]; looked_at: { memories: number; messages: number }; note?: string };
type Feed = { settings: { enabled: boolean; hour: number }; dates: string[]; date: string; dream: Dream | null };

const ICON = { merged: GitMerge, updated: PencilLine, learned: Lightbulb };
const pretty = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });

/** What HIVEMIND did with your memories while you slept, with Undo on every change. */
export default function DreamPage() {
  const [date, setDate] = useState<string | null>(null);
  const feed = useFetch<Feed>(`/api/dream${date ? `?date=${date}` : ""}`);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const d = feed.data;

  async function dreamNow() {
    setBusy("now");
    setError(null);
    try {
      const r = await api<{ dream: Dream }>("/api/dream", { method: "POST", json: { now: true } });
      setDate(r.dream.date);
      await feed.reload();
      window.dispatchEvent(new Event(BRAIN_CHANGED));
      return r.dream;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function undo(i: number) {
    if (!d?.dream) return;
    setBusy(`u${i}`);
    try {
      const r = await api<{ dream: Dream }>("/api/dream", { method: "POST", json: { undo: i, date: d.dream.date } });
      feed.setData((x) => (x ? { ...x, dream: r.dream } : x));
      window.dispatchEvent(new Event(BRAIN_CHANGED));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function settings(patch: Partial<Feed["settings"]>) {
    feed.setData((x) => (x ? { ...x, settings: { ...x.settings, ...patch } } : x));
    await api("/api/dream", { method: "PATCH", json: patch }).catch(() => feed.reload());
  }

  useVoiceActions({
    dream_now: {
      description: "Dream page: tidy the memories now (merge duplicates, update stale facts, learn repeated preferences). Takes about 20 seconds.",
      run: async () => {
        const r = await dreamNow();
        return r ? { changes: r.changes.map((c) => c.text), note: r.note } : { error: "Couldn't dream right now." };
      },
    },
  });

  const counts = (k: Change["kind"]) => d?.dream?.changes.filter((c) => c.kind === k && !c.undone).length ?? 0;

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        eyebrow="Overnight"
        title="Dream mode"
        subtitle="While you sleep, HIVEMIND goes over the day like a brain does: it merges duplicate memories, updates facts your own words made out of date, and saves preferences you kept repeating. Every change can be undone."
        actions={
          <Button onClick={dreamNow} disabled={!!busy}>
            {busy === "now" ? <Loader2 size={15} className="animate-spin" /> : <Moon size={15} />} {busy === "now" ? "Dreaming…" : "Dream now"}
          </Button>
        }
      />
      <ErrorText error={error ?? feed.error} />

      {d && (
        <section className="mb-5 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border border-line bg-panel p-4 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={d.settings.enabled} onChange={(e) => settings({ enabled: e.target.checked })} />
            Dream every night
          </label>
          <label className="flex items-center gap-2 text-soft">
            at
            <Select value={d.settings.hour} onChange={(e) => settings({ hour: +e.target.value })} disabled={!d.settings.enabled}>
              {[0, 1, 2, 3, 4, 5, 6].map((h) => (
                <option key={h} value={h}>
                  {String(h).padStart(2, "0")}:00
                </option>
              ))}
            </Select>
          </label>
        </section>
      )}

      {busy === "now" && (
        <p className="mb-4 flex items-center gap-2 text-sm text-soft">
          <Loader2 size={14} className="animate-spin text-core" /> Going over your memories and today&apos;s conversations… about 20 seconds.
        </p>
      )}

      {d?.dream ? (
        <div className="rounded-xl border border-line bg-panel p-4">
          <div className="mb-3 flex items-center gap-3">
            <MascotFrame frame={d.dream.changes.length ? "sparkle" : "sleepy"} size={64} />
            <div>
              <h2 className="font-medium">{pretty(d.dream.date)}</h2>
              <p className="text-xs text-soft">
                Looked at {d.dream.looked_at.memories} memories and {d.dream.looked_at.messages} things you said · merged {counts("merged")}, updated {counts("updated")}, learned {counts("learned")}
              </p>
            </div>
          </div>
          {d.dream.note && <p className="mb-2 text-sm text-soft">{d.dream.note}</p>}
          <ul className="space-y-2">
            {d.dream.changes.map((c, i) => {
              const Icon = ICON[c.kind];
              return (
                <li key={i} className={cx("flex items-start gap-2 rounded-lg border border-line p-3 text-sm", c.undone && "opacity-50")}>
                  <Icon size={15} className={cx("mt-0.5 shrink-0", c.kind === "learned" ? "text-core" : "text-data")} />
                  <span className={cx("min-w-0 flex-1", c.undone && "line-through")}>{c.text}</span>
                  {c.undone ? (
                    <span className="font-mono text-[10.5px] text-faint">undone</span>
                  ) : (
                    <Button size="sm" variant="quiet" onClick={() => undo(i)} disabled={!!busy} title="Put it back the way it was">
                      {busy === `u${i}` ? <Loader2 size={12} className="animate-spin" /> : <Undo2 size={12} />} Undo
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ) : (
        d &&
        !busy && (
          <div className="rounded-xl border border-dashed border-line p-8 text-center text-sm text-soft">
            <MascotFrame frame="sleepy" size={96} className="mx-auto mb-2" />
            No dream yet. It runs by itself tonight, or tap <b>Dream now</b>.
          </div>
        )
      )}

      {!!d?.dates.length && (
        <div className="mt-6 flex flex-wrap gap-1.5">
          {d.dates.slice(0, 20).map((x) => (
            <button key={x} type="button" onClick={() => setDate(x)} className={cx("border px-2 py-1 font-mono text-[11px]", x === d.date ? "border-core text-core" : "border-line text-soft hover:border-data hover:text-data")}>
              {pretty(x)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
