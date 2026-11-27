"use client";

import { Bell, BookOpen, Briefcase, Check, ChevronRight, Compass, ExternalLink, FolderKanban, Globe, HeartPulse, Loader2, Play, ShoppingBag, Sparkles, Users, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge, Button, CardSkeleton, cx, Empty, ErrorText, PageHeader } from "@/components/ui";
import { useVoiceActions } from "@/components/voice/provider";
import { unlocksAction } from "@/lib/agents/intent";
import { api, armAsk, BRAIN_CHANGED, timeAgo, useFetch } from "@/lib/client-api";

type Insight = {
  id: string;
  key: string;
  kind: string;
  priority: 1 | 2 | 3;
  title: string;
  body: string;
  link?: { label: string; url: string };
  ask?: string;
  created_at: string;
  status: "new" | "done" | "dismissed";
  pushed?: boolean;
};
type Settings = { enabled: boolean; every_hours: number; start_hour: number; end_hour: number; push: boolean };
type Feed = { settings: Settings; items: Insight[]; runs: { at: string; ms: number; found: number; manual: boolean; error?: string }[]; lastRun: string | null; running: boolean };

const ICONS: Record<string, typeof Compass> = {
  career: Briefcase,
  learning: BookOpen,
  project: FolderKanban,
  people: Users,
  health: HeartPulse,
  plan: Bell,
  shopping: ShoppingBag,
  world: Globe,
  other: Sparkles,
};
const PRIORITY = { 3: { label: "Today", tone: "core" }, 2: { label: "This week", tone: "data" }, 1: { label: "FYI", tone: "neutral" } } as const;

export default function AutopilotPage() {
  const router = useRouter();
  const feed = useFetch<Feed>("/api/autopilot");
  // A one-tap request that could change or delete something isn't offered (Autopilot reads web pages).
  const safeAsk = (i: Insight) => (i.ask && !unlocksAction(i.ask) ? i.ask : undefined);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const f = feed.data;

  async function runNow() {
    setRunning(true);
    setError(null);
    try {
      const r = await api<{ feed: Feed; insights: Insight[]; error?: string }>("/api/autopilot", { method: "POST" });
      feed.setData(r.feed);
      if (r.error) setError(r.error);
      else if (!r.insights.length) setError("Nothing new worth your attention right now.");
      window.dispatchEvent(new Event(BRAIN_CHANGED));
      return r;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }

  async function mark(id: string, status: Insight["status"]) {
    feed.setData((d) => (d ? { ...d, items: d.items.map((i) => (i.id === id ? { ...i, status } : i)) } : d));
    await api(`/api/autopilot`, { method: "PATCH", json: { id, status } }).catch(() => feed.reload());
  }

  async function setSettings(patch: Partial<Settings>) {
    feed.setData((d) => (d ? { ...d, settings: { ...d.settings, ...patch } } : d));
    await api(`/api/autopilot`, { method: "PATCH", json: { settings: patch } }).catch(() => feed.reload());
  }

  useVoiceActions({
    autopilot_run: {
      description: "Autopilot page: run Autopilot now (it looks across the whole brain and finds what needs attention).",
      run: async () => {
        const r = await runNow();
        return { found: r?.insights.map((i) => i.title) ?? [] };
      },
    },
    insight_do: {
      description: "Autopilot page: run an insight's one-tap request (its 'Do it' button) in HIVEMIND. input: the insight's number in the list (1 = top) or words from its title.",
      run: ({ input }) => {
        const i = pick(String(input ?? ""));
        if (!i) return { error: "No open insight like that.", open: open.map((x) => x.title) };
        const ask = safeAsk(i);
        if (!ask) return { error: `"${i.title}" has no one-tap request.`, link: i.link?.url };
        void mark(i.id, "done");
        armAsk(ask);
        router.push(`/?ask=${encodeURIComponent(ask)}`);
        return { running: ask };
      },
    },
    insight_open_link: {
      description: "Autopilot page: open an insight's link. input: its number (1 = top) or words from its title.",
      run: ({ input }) => {
        const i = pick(String(input ?? ""));
        if (!i?.link) return { error: "No open insight with a link like that." };
        if (i.link.url.startsWith("http")) window.open(i.link.url, "_blank", "noopener");
        else router.push(i.link.url);
        return { opened: i.link.label };
      },
    },
  });
  const open = (f?.items ?? []).filter((i) => i.status === "new");
  function pick(q: string) {
    const n = Number(q.match(/\d+/)?.[0]);
    if (n) return open[n - 1];
    const words = q.toLowerCase().trim();
    return words ? open.find((i) => `${i.title} ${i.body}`.toLowerCase().includes(words)) : open[0];
  }

  const items = (f?.items ?? []).filter((i) => (showAll ? true : i.status === "new"));
  const hidden = (f?.items.length ?? 0) - (f?.items.filter((i) => i.status === "new").length ?? 0);

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        eyebrow="Agentic"
        title="Autopilot"
        subtitle="HIVEMIND works on its own a few times a day: it reads your whole brain, connects the dots, and tells you what needs you. It never changes or deletes anything by itself."
        actions={
          <Button onClick={runNow} disabled={running || f?.running}>
            {running || f?.running ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />}
            {running || f?.running ? "Thinking…" : "Run now"}
          </Button>
        }
      />

      {f && (
        <section className="mb-6 overflow-hidden rounded-xl border border-line bg-panel">
          {/* status: is it on, when it last ran, what is waiting */}
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3 border-b border-line px-4 py-3.5">
            <Toggle on={f.settings.enabled} onChange={(v) => setSettings({ enabled: v })} label="Run on its own" />
            <span className="flex items-center gap-2 font-mono text-[11px] text-faint">
              <span className={cx("size-1.5 rounded-full", f.running || running ? "animate-pulse bg-core" : f.settings.enabled ? "bg-ok" : "bg-line-strong")} />
              {f.running || running ? "thinking now" : f.lastRun ? `last run ${timeAgo(f.lastRun)}` : "never run yet"}
            </span>
            <span className="ml-auto font-mono text-[11px] text-soft">
              <span className="text-fg">{open.length}</span> waiting for you
            </span>
          </div>
          {/* the schedule */}
          <div className={cx("flex flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3.5 text-sm transition-opacity", !f.settings.enabled && "pointer-events-none opacity-45")} aria-disabled={!f.settings.enabled}>
            <div className="flex w-full flex-col gap-1.5 sm:w-auto">
              <span className="text-xs text-faint">How often</span>
              <div className="flex rounded-lg bg-sunken p-1" role="radiogroup" aria-label="How often">
                {[1, 2, 3, 4, 6, 12, 24].map((h) => (
                  <button
                    key={h}
                    type="button"
                    role="radio"
                    aria-checked={f.settings.every_hours === h}
                    aria-label={`Every ${h} hour${h > 1 ? "s" : ""}`}
                    onClick={() => setSettings({ every_hours: h })}
                    className={cx(
                      "h-8 min-w-10 flex-1 rounded-md px-2 text-[13px] tabular-nums transition-colors duration-150 pointer-coarse:h-10",
                      f.settings.every_hours === h ? "bg-core font-semibold text-core-ink" : "text-soft hover:bg-raised hover:text-fg",
                    )}
                  >
                    {h}h
                  </button>
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-1.5 text-soft">
              <span className="text-xs text-faint">Between</span>
              <span className="flex items-center gap-2">
                <HourPill label="Start hour" value={f.settings.start_hour} hours={Array.from({ length: 24 }, (_, h) => h)} onChange={(h) => setSettings({ start_hour: h })} />
                <span className="text-faint">to</span>
                <HourPill label="End hour" value={f.settings.end_hour} hours={Array.from({ length: 24 }, (_, h) => h + 1)} onChange={(h) => setSettings({ end_hour: h })} />
              </span>
            </div>
            <span className="sm:ml-auto">
              <Toggle on={f.settings.push} onChange={(v) => setSettings({ push: v })} label="Notify me when urgent" small />
            </span>
          </div>
          {f.runs.length > 0 && <RunStrip runs={f.runs} />}
        </section>
      )}

      <ErrorText error={error ?? feed.error} />

      {!f && feed.loading ? (
        <CardSkeleton count={3} />
      ) : items.length === 0 ? (
        <Empty>{f?.items.length ? "All caught up. Nothing new needs you." : "Autopilot hasn't found anything yet. Tap Run now to see it work."}</Empty>
      ) : (
        <ul className="list-in space-y-3">
          {items.map((i) => {
            const Icon = ICONS[i.kind] ?? Sparkles;
            const p = PRIORITY[i.priority];
            const external = i.link?.url.startsWith("http");
            return (
              <li key={i.id} className={cx("rounded-xl border bg-panel p-4", i.status === "new" ? "border-line" : "border-line opacity-60", i.priority === 3 && i.status === "new" && "border-core/50")}>
                <div className="flex items-start gap-3">
                  <Icon size={18} className={cx("mt-0.5 shrink-0", i.priority === 3 ? "text-core" : "text-data")} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="font-medium">{i.title}</h2>
                      <Badge tone={p.tone}>{p.label}</Badge>
                      {i.status !== "new" && <Badge>{i.status}</Badge>}
                    </div>
                    {i.body && <p className="mt-1 text-sm leading-relaxed text-soft">{i.body}</p>}
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      {safeAsk(i) && (
                        <Link href={`/?ask=${encodeURIComponent(safeAsk(i)!)}`} onClick={() => { armAsk(safeAsk(i)!); void mark(i.id, "done"); }} className="inline-flex h-7 items-center gap-1.5 rounded-md bg-core px-2.5 text-xs font-medium text-core-ink hover:bg-core/85" title={i.ask}>
                          <Sparkles size={13} /> Do it
                        </Link>
                      )}
                      {i.link &&
                        (external ? (
                          <a href={i.link.url} target="_blank" rel="noopener noreferrer" className="inline-flex h-7 items-center gap-1.5 rounded-md border border-line-strong px-2.5 text-xs hover:border-data hover:text-data">
                            <ExternalLink size={13} /> {i.link.label}
                          </a>
                        ) : (
                          <Link href={i.link.url} className="inline-flex h-7 items-center gap-1.5 rounded-md border border-line-strong px-2.5 text-xs hover:border-data hover:text-data">
                            {i.link.label}
                          </Link>
                        ))}
                      {i.status === "new" && (
                        <>
                          <Button size="sm" variant="quiet" onClick={() => mark(i.id, "done")}>
                            <Check size={13} /> Done
                          </Button>
                          <Button size="sm" variant="quiet" onClick={() => mark(i.id, "dismissed")} title="Not useful: Autopilot won't suggest things like this again">
                            <X size={13} /> Not useful
                          </Button>
                        </>
                      )}
                      <span className="ml-auto font-mono text-[10.5px] text-faint">
                        {timeAgo(i.created_at)}
                        {i.pushed ? " · notified" : ""}
                      </span>
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {hidden > 0 && (
        <button
          type="button"
          onClick={() => setShowAll(!showAll)}
          aria-expanded={showAll}
          className="mt-4 inline-flex h-9 items-center gap-2 rounded-full border border-line bg-panel px-3.5 text-[13px] text-soft transition hover:border-data/60 hover:text-data pointer-coarse:h-11"
        >
          <Check size={12} /> {showAll ? "Hide done & dismissed" : `Show ${hidden} done & dismissed`}
        </button>
      )}

      {f?.runs.length ? (
        <details className="group mt-8 text-sm">
          <summary className="flex min-h-10 cursor-pointer list-none items-center gap-2 text-soft hover:text-fg">
            <ChevronRight size={15} className="transition-transform duration-150 group-open:rotate-90" />
            Run history <span className="text-faint tabular-nums">({f.runs.length})</span>
          </summary>
          {/* a timeline: newest first, a dot for how it went */}
          <ol className="mt-2 ml-[7px] border-l border-line">
            {f.runs.map((r) => (
              <li key={r.at} className="relative py-2 pl-5">
                <span
                  className={cx("absolute top-3.5 -left-[5px] size-[9px] rounded-full ring-4 ring-bg", r.error ? "bg-alert" : r.found ? "bg-core" : "bg-line-strong")}
                  aria-hidden
                />
                <p className="flex flex-wrap items-baseline gap-x-2">
                  <span className={cx("font-medium", r.error ? "text-alert" : r.found ? "text-fg" : "text-soft")}>
                    {r.error ? "Failed" : r.found ? `Found ${r.found} new` : "Nothing new"}
                  </span>
                  <span className="text-xs text-faint">
                    {timeAgo(r.at)} · {r.manual ? "you ran it" : "on schedule"} · {(r.ms / 1000).toFixed(1)}s
                  </span>
                </p>
                {r.error && <p className="mt-0.5 line-clamp-2 text-xs text-alert/80">{r.error}</p>}
              </li>
            ))}
          </ol>
        </details>
      ) : null}
    </div>
  );
}

/** A switch (role="switch") with its label. */
function Toggle({ on, onChange, label, small }: { on: boolean; onChange: (v: boolean) => void; label: string; small?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={on} onClick={() => onChange(!on)} className={cx("group flex min-h-9 items-center gap-2.5 text-left text-sm pointer-coarse:min-h-11", small ? "text-soft" : "font-medium")}>
      <span className={cx("relative h-5 w-9 shrink-0 rounded-full border transition-colors", on ? "border-core bg-core/80" : "border-line-strong bg-raised")}>
        <span className={cx("absolute top-1/2 size-3.5 -translate-y-1/2 rounded-full bg-white shadow transition-[left] duration-200", on ? "left-[18px]" : "left-[2px]")} />
      </span>
      {label}
    </button>
  );
}

/** An hour picker styled as a pill (still a real select underneath, for keyboards and phones). */
function HourPill({ label, value, hours, onChange }: { label: string; value: number; hours: number[]; onChange: (h: number) => void }) {
  return (
    <span className="relative inline-flex h-9 items-center rounded-lg border border-line bg-sunken px-3 text-sm text-fg tabular-nums transition-colors focus-within:border-data/60 hover:border-line-strong pointer-coarse:h-10">
      {String(value % 24).padStart(2, "0")}:00
      <select aria-label={label} value={value} onChange={(e) => onChange(+e.target.value)} className="absolute inset-0 cursor-pointer opacity-0">
        {hours.map((h) => (
          <option key={h} value={h}>
            {String(h % 24).padStart(2, "0")}:00
          </option>
        ))}
      </select>
    </span>
  );
}

/** The latest runs as small bars: height is how much it found, red when the run failed. Oldest on the left. */
function RunStrip({ runs }: { runs: Feed["runs"] }) {
  const list = [...runs].slice(0, 16).reverse();
  const max = Math.max(1, ...list.map((r) => r.found));
  const useful = list.filter((r) => !r.error && r.found > 0).length;
  const failed = list.filter((r) => r.error).length;
  const found = list.reduce((s, r) => s + (r.error ? 0 : r.found), 0);
  return (
    <div className="border-t border-line px-4 pt-3 pb-3.5">
      {/* in words first: the bars alone said nothing on a phone */}
      <p className="text-sm">
        <span className="font-medium">
          Last {list.length} run{list.length > 1 ? "s" : ""}:
        </span>{" "}
        <span className="text-soft">
          {found ? `${found} thing${found > 1 ? "s" : ""} found in ${useful}` : "nothing new found"}
          {failed ? <span className="text-alert"> · {failed} failed</span> : null}
        </span>
      </p>
      <div className="mt-2.5 flex h-10 items-end justify-between gap-1" role="img" aria-label={`Last ${list.length} runs, oldest first`}>
        {list.map((r) => (
          <span
            key={r.at}
            title={`${timeAgo(r.at)} · ${r.manual ? "manual" : "scheduled"} · ${(r.ms / 1000).toFixed(1)}s · ${r.error ? `failed: ${r.error}` : `${r.found} new`}`}
            className={cx("max-w-5 min-w-1.5 flex-1 rounded-sm transition-opacity hover:opacity-80", r.error ? "bg-alert/80" : r.found ? "bg-core/80" : "bg-line-strong/60")}
            style={{ height: r.error ? "100%" : r.found ? `${Math.max(30, (r.found / max) * 100)}%` : "14%" }}
          />
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-faint">
        <span>{timeAgo(list[0].at)}</span>
        <span className="flex items-center gap-3">
          <span className="flex items-center gap-1">
            <span className="size-2 rounded-sm bg-core/80" /> found
          </span>
          <span className="flex items-center gap-1">
            <span className="size-2 rounded-sm bg-line-strong/60" /> nothing
          </span>
          {failed > 0 && (
            <span className="flex items-center gap-1">
              <span className="size-2 rounded-sm bg-alert/80" /> failed
            </span>
          )}
        </span>
        <span>{timeAgo(list[list.length - 1].at)}</span>
      </div>
    </div>
  );
}
