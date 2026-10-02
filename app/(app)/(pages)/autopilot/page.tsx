"use client";

import { Bell, BookOpen, Briefcase, Check, Compass, ExternalLink, FolderKanban, Globe, HeartPulse, Loader2, Play, ShoppingBag, Sparkles, Users, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge, Button, cx, Empty, ErrorText, PageHeader, Select } from "@/components/ui";
import { useVoiceActions } from "@/components/voice/provider";
import { api, BRAIN_CHANGED, timeAgo, useFetch } from "@/lib/client-api";

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
        if (!i.ask) return { error: `"${i.title}" has no one-tap request.`, link: i.link?.url };
        void mark(i.id, "done");
        router.push(`/?ask=${encodeURIComponent(i.ask)}`);
        return { running: i.ask };
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
        <section className="mb-6 flex flex-wrap items-center gap-x-5 gap-y-3 rounded-xl border border-line bg-panel p-4 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={f.settings.enabled} onChange={(e) => setSettings({ enabled: e.target.checked })} />
            Run on its own
          </label>
          <label className="flex items-center gap-2 text-soft">
            every
            <Select value={f.settings.every_hours} onChange={(e) => setSettings({ every_hours: +e.target.value })} disabled={!f.settings.enabled}>
              {[1, 2, 3, 4, 6, 12, 24].map((h) => (
                <option key={h} value={h}>
                  {h} h
                </option>
              ))}
            </Select>
          </label>
          <label className="flex items-center gap-2 text-soft">
            between
            <Select value={f.settings.start_hour} onChange={(e) => setSettings({ start_hour: +e.target.value })} disabled={!f.settings.enabled}>
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>
                  {String(h).padStart(2, "0")}:00
                </option>
              ))}
            </Select>
            and
            <Select value={f.settings.end_hour} onChange={(e) => setSettings({ end_hour: +e.target.value })} disabled={!f.settings.enabled}>
              {Array.from({ length: 24 }, (_, h) => h + 1).map((h) => (
                <option key={h} value={h}>
                  {String(h % 24).padStart(2, "0")}:00
                </option>
              ))}
            </Select>
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={f.settings.push} onChange={(e) => setSettings({ push: e.target.checked })} />
            Notify me when it&apos;s urgent
          </label>
          <span className="ml-auto font-mono text-[11px] text-faint">{f.lastRun ? `last run ${timeAgo(f.lastRun)}` : "never run yet"}</span>
        </section>
      )}

      <ErrorText error={error ?? feed.error} />

      {!f && feed.loading ? (
        <p className="text-sm text-soft">Loading…</p>
      ) : items.length === 0 ? (
        <Empty>{f?.items.length ? "All caught up. Nothing new needs you." : "Autopilot hasn't found anything yet. Tap Run now to see it work."}</Empty>
      ) : (
        <ul className="space-y-3">
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
                      {i.ask && (
                        <Link href={`/?ask=${encodeURIComponent(i.ask)}`} onClick={() => mark(i.id, "done")} className="inline-flex h-7 items-center gap-1.5 rounded-md bg-core px-2.5 text-xs font-medium text-core-ink hover:bg-core/85" title={i.ask}>
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
        <button type="button" onClick={() => setShowAll(!showAll)} className="mt-4 font-mono text-[11px] uppercase tracking-wider text-data hover:underline">
          {showAll ? "Hide done & dismissed" : `Show ${hidden} done & dismissed`}
        </button>
      )}

      {f?.runs.length ? (
        <details className="mt-8 text-sm">
          <summary className="cursor-pointer font-mono text-[11px] uppercase tracking-wider text-faint">Recent runs</summary>
          <ul className="mt-2 space-y-1 font-mono text-[11.5px] text-soft">
            {f.runs.map((r) => (
              <li key={r.at}>
                {timeAgo(r.at)} · {r.manual ? "manual" : "scheduled"} · {(r.ms / 1000).toFixed(1)}s · {r.error ? <span className="text-alert">{r.error}</span> : `${r.found} new`}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
