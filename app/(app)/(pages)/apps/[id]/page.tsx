"use client";

import { ArrowLeft, Check, History, Loader2, Mic, MoreHorizontal, Pin, RotateCcw, Trash2, Wand2 } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type AppAction, AppRunner } from "@/components/apps/runner";
import { Pop } from "@/components/apps/pop";
import { Button, cx, ErrorText } from "@/components/ui";
import { useVoiceActions } from "@/components/voice/provider";
import { api, BRAIN_CHANGED, timeAgo, useFetch } from "@/lib/client-api";

type Doc = {
  id: string;
  name: string;
  emoji: string;
  description: string;
  status: "building" | "ready" | "failed";
  error?: string;
  updated_at: string;
  version: number;
  html: string;
  history: { version: number; at: string; request: string }[];
};

// "add_emi" → "add emi": how the owner would say it.
const spoken = (name: string) => name.replace(/[_-]+/g, " ").trim();

export default function AppPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const app = useFetch<Doc>(`/api/apps/${id}`);
  const [change, setChange] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actions, setActions] = useState<AppAction[]>([]);
  const call = useRef<((name: string, input: string) => Promise<unknown>) | null>(null);
  const d = app.data;
  const building = d?.status === "building";

  // While it's being written or changed, check every few seconds.
  const reload = app.reload;
  useEffect(() => {
    if (!building) return;
    const t = setInterval(() => void reload(), 3000);
    return () => clearInterval(t);
  }, [building, reload]);

  async function applyChange(text = change) {
    if (text.trim().length < 3) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/api/apps/${id}`, { method: "PATCH", json: { change: text.trim() } });
      setChange("");
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function undo(version: number) {
    setError(null);
    try {
      await api(`/api/apps/${id}`, { method: "PATCH", json: { restore: version } });
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function remove() {
    if (!d || !confirm(`Delete "${d.name}" and everything it saved? This can't be undone.`)) return;
    await api(`/api/apps/${id}`, { method: "DELETE" });
    window.dispatchEvent(new Event(BRAIN_CHANGED));
    router.replace("/apps");
  }

  // Pin this app to the home screen (Panels), or unpin it.
  const panels = useFetch<{ pinned: string[] }>("/api/panels");
  const pinned = !!panels.data?.pinned.includes(`app:${id}`);
  async function togglePin() {
    const now = panels.data?.pinned ?? [];
    const next = pinned ? now.filter((p) => p !== `app:${id}`) : [...now, `app:${id}`];
    panels.setData((x) => (x ? { ...x, pinned: next } : x));
    await api("/api/panels", { method: "PUT", json: { pinned: next } }).catch(() => panels.reload());
  }

  const onActions = useCallback((a: AppAction[]) => setActions(a), []);

  // The app's own voice commands ("add 500 rupees petrol"), plus changing / deleting it by voice.
  const voice = useMemo(() => {
    const out: Record<string, { description: string; run: (args: Record<string, unknown>) => Promise<Record<string, unknown>> | Record<string, unknown> }> = {
      app_change: {
        description: `This app (${d?.name ?? "app"}): change or add a feature. input: what to change, in plain words.`,
        run: async ({ input }) => {
          await applyChange(String(input ?? ""));
          return { changing: true, note: "It takes about 30 seconds; the app reloads by itself." };
        },
      },
    };
    out.app_undo = {
      description: `This app (${d?.name ?? "app"}): undo the last change (go back to the previous version).`,
      run: async () => {
        const prev = d?.history[0];
        if (!prev) return { error: "There's no earlier version." };
        await undo(prev.version);
        return { restored: `v${prev.version}` };
      },
    };
    for (const a of actions) {
      out[`app_${a.name}`] = {
        description: `${d?.name ?? "This app"}: ${a.description}`,
        run: async ({ input }) => ((await call.current?.(a.name, String(input ?? ""))) as Record<string, unknown>) ?? { error: "The app isn't running." },
      };
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rebuilt when the app or its actions change
  }, [actions, d?.name, d?.history]);
  useVoiceActions(voice);

  if (!d) {
    return app.error ? (
      <div className="mx-auto max-w-6xl p-6">
        <ErrorText error={app.error} />
        <Link href="/apps" className="mt-3 inline-flex items-center gap-1.5 text-sm text-soft hover:text-fg">
          <ArrowLeft size={14} /> All apps
        </Link>
      </div>
    ) : (
      // loading: the same shape as the page, so nothing jumps when it arrives
      <div className="mx-auto flex max-w-6xl flex-col gap-3" role="status" aria-label="Loading">
        <div className="flex items-center gap-3">
          <div className="shimmer size-10 rounded-xl" />
          <div className="space-y-2">
            <div className="shimmer h-4 w-40 rounded-sm" />
            <div className="shimmer h-3 w-24 rounded-sm" />
          </div>
        </div>
        <div className="shimmer h-11 rounded-xl" />
        <div className="shimmer h-[60dvh] rounded-xl" />
      </div>
    );
  }

  const firstBuild = building && !d.html;

  return (
    <div className="mx-auto flex h-[calc(100dvh-var(--tabbar-h)-var(--music-h,0px)-2rem)] max-w-6xl flex-col gap-3">
      {/* who it is, and the few things you do to it */}
      <header className="flex items-center gap-3">
        <Link href="/apps" className="hit -ml-1 rounded-md p-1.5 text-soft transition-colors hover:bg-raised hover:text-fg" aria-label="All apps">
          <ArrowLeft size={18} />
        </Link>
        <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-line bg-raised text-xl leading-none" aria-hidden>
          {d.emoji}
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg leading-tight font-semibold">{d.name}</h1>
          <p className="mt-0.5 flex items-center gap-1.5 font-mono text-[11px] text-faint">
            <span>v{d.version}</span>
            <span aria-hidden>·</span>
            <span>{timeAgo(d.updated_at)}</span>
            {building && d.html && (
              <>
                <span aria-hidden>·</span>
                <span className="flex items-center gap-1 text-core">
                  <Loader2 size={11} className="animate-spin" /> updating
                </span>
              </>
            )}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-0.5">
          {actions.length > 0 && (
            <Pop
              label="Voice commands"
              trigger={
                <>
                  <Mic size={15} className="text-data" />
                  <span className="hidden sm:inline">{actions.length} voice</span>
                </>
              }
            >
              {() => (
                <div className="p-1.5">
                  <p className="px-1.5 pb-2 text-xs text-soft">Say these to HIVEMIND while this app is open.</p>
                  <ul className="space-y-1">
                    {actions.map((a) => (
                      <li key={a.name} className="rounded-lg bg-sunken/70 px-2.5 py-2">
                        <p className="text-sm font-medium">&ldquo;{spoken(a.name)}&hellip;&rdquo;</p>
                        <p className="mt-0.5 text-xs leading-relaxed text-soft">{a.description}</p>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </Pop>
          )}

          {d.history.length > 0 && (
            <Pop
              label="Earlier versions"
              trigger={
                <>
                  <History size={15} />
                  <span className="hidden sm:inline">Versions</span>
                </>
              }
            >
              {(close) => (
                <div>
                  <p className="px-2.5 pt-1.5 pb-2 text-xs text-soft">Go back to an earlier version. The current one stays in this list.</p>
                  <ul className="max-h-[50dvh] overflow-y-auto">
                    <li className="flex items-start gap-2.5 rounded-lg px-2.5 py-2">
                      <span className="mt-0.5 w-8 shrink-0 font-mono text-xs text-core">v{d.version}</span>
                      <span className="min-w-0 flex-1 text-sm">
                        Current
                        <span className="block font-mono text-[10.5px] text-faint">{timeAgo(d.updated_at)}</span>
                      </span>
                      <Check size={14} className="mt-0.5 text-core" aria-label="Current version" />
                    </li>
                    {d.history.map((h) => (
                      <li key={h.version}>
                        <button
                          type="button"
                          disabled={building}
                          onClick={() => {
                            close();
                            void undo(h.version);
                          }}
                          className="group flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-sunken disabled:opacity-40"
                        >
                          <span className="mt-0.5 w-8 shrink-0 font-mono text-xs text-faint">v{h.version}</span>
                          <span className="min-w-0 flex-1">
                            <span className="line-clamp-2 text-sm text-fg">{h.request}</span>
                            <span className="block font-mono text-[10.5px] text-faint">{timeAgo(h.at)}</span>
                          </span>
                          <span className="mt-0.5 flex items-center gap-1 text-xs text-soft opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 pointer-coarse:opacity-100">
                            <RotateCcw size={12} /> Restore
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </Pop>
          )}

          <Pop label="App options" trigger={<MoreHorizontal size={16} />} className="w-56">
            {(close) => (
              <div className="flex flex-col">
                {d.status === "ready" && (
                  <button
                    type="button"
                    onClick={() => {
                      close();
                      void togglePin();
                    }}
                    className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors hover:bg-sunken"
                  >
                    {pinned ? <Check size={14} className="text-core" /> : <Pin size={14} className="text-soft" />}
                    {pinned ? "On home screen (unpin)" : "Pin to home screen"}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    close();
                    void remove();
                  }}
                  className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm text-alert transition-colors hover:bg-alert/10"
                >
                  <Trash2 size={14} /> Delete app
                </button>
              </div>
            )}
          </Pop>
        </div>
      </header>

      {/* change it in words */}
      <form
        className={cx(
          "relative flex items-center gap-2 overflow-hidden rounded-xl border bg-sunken p-1 pl-3 transition-colors focus-within:border-data",
          building ? "border-core/40" : "border-line",
        )}
        onSubmit={(e) => {
          e.preventDefault();
          void applyChange();
        }}
      >
        <Wand2 size={15} className={cx("shrink-0", building ? "text-core" : "text-faint")} aria-hidden />
        <input
          aria-label="Describe a change to this app"
          placeholder={building ? (d.html ? "Updating… usually about 30 seconds" : "Writing your app…") : `Change it: "add a field for km driven"`}
          value={change}
          onChange={(e) => setChange(e.target.value)}
          disabled={building}
          className="h-9 min-w-0 flex-1 bg-transparent text-sm placeholder:text-faint focus:outline-none disabled:cursor-not-allowed pointer-coarse:h-11"
        />
        <Button type="submit" size="sm" disabled={busy || building || change.trim().length < 3} className="shrink-0">
          {busy ? <Loader2 size={13} className="animate-spin" /> : null} Change
        </Button>
        {building && (
          <span className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 overflow-hidden" aria-hidden>
            <span className="build-line block h-full w-2/5 bg-core" />
          </span>
        )}
      </form>
      <ErrorText error={error ?? d.error ?? null} />

      <div className="min-h-[360px] flex-1">
        {d.html ? (
          <div className={cx("h-full transition-opacity duration-200", building && "opacity-60")}>
            <AppRunner id={d.id} html={d.html} version={d.version} onActions={onActions} callRef={call} />
          </div>
        ) : d.status === "failed" ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 rounded-xl border border-alert/40 bg-alert/5 p-6 text-center">
            <p className="text-sm font-medium">This app didn&apos;t get built</p>
            <p className="max-w-md text-sm text-soft">{d.error}</p>
            <Button onClick={() => applyChange(d.description)} disabled={busy}>
              <RotateCcw size={14} /> Try again
            </Button>
          </div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-4 rounded-xl border border-line bg-panel/40 p-6 text-center">
            <span className="grid size-14 place-items-center rounded-2xl border border-core/30 bg-core/10 text-3xl">{d.emoji}</span>
            <div>
              <p className="text-sm font-medium">{firstBuild ? "Writing your app" : "Getting ready"}</p>
              <p className="mt-1 text-xs text-soft">Usually about 30 seconds. You can leave this page; it keeps going.</p>
            </div>
            <p className="max-w-md text-xs leading-relaxed text-faint">&ldquo;{d.description}&rdquo;</p>
          </div>
        )}
      </div>
    </div>
  );
}
