"use client";

import { ArrowLeft, Check, History, Loader2, Mic, Pin, Trash2, Wand2 } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type AppAction, AppRunner } from "@/components/apps/runner";
import { Button, ErrorText, Input, Select } from "@/components/ui";
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
    return <p className="p-6 text-sm text-soft">{app.error ?? "Loading…"}</p>;
  }

  return (
    <div className="mx-auto flex h-[calc(100dvh-var(--tabbar-h)-var(--music-h,0px)-2rem)] max-w-6xl flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Link href="/apps" className="text-soft hover:text-fg" aria-label="All apps">
          <ArrowLeft size={18} />
        </Link>
        <span className="text-2xl leading-none">{d.emoji}</span>
        <h1 className="text-lg font-semibold">{d.name}</h1>
        <span className="font-mono text-[11px] text-faint">v{d.version} · {timeAgo(d.updated_at)}</span>
        {actions.length > 0 && (
          <span className="flex items-center gap-1 text-xs text-soft" title={actions.map((a) => `${a.name}: ${a.description}`).join("\n")}>
            <Mic size={12} className="text-data" /> {actions.length} voice commands
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          {d.history.length > 0 && (
            <Select aria-label="Undo to an earlier version" value="" onChange={(e) => e.target.value && undo(Number(e.target.value))}>
              <option value="">Undo…</option>
              {d.history.map((h) => (
                <option key={h.version} value={h.version}>
                  v{h.version} · {timeAgo(h.at)}
                </option>
              ))}
            </Select>
          )}
          {d.status === "ready" && (
            <Button size="sm" variant="quiet" onClick={togglePin} title={pinned ? "Remove from the home screen" : "Show this app on the home screen"}>
              {pinned ? <Check size={13} /> : <Pin size={13} />} {pinned ? "On home" : "Pin to home"}
            </Button>
          )}
          <Button size="sm" variant="danger" onClick={remove}>
            <Trash2 size={13} /> Delete
          </Button>
        </div>
      </div>

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void applyChange();
        }}
      >
        <Input placeholder={`Change it… e.g. "add a field for km driven"`} value={change} onChange={(e) => setChange(e.target.value)} disabled={building} />
        <Button type="submit" disabled={busy || building || change.trim().length < 3}>
          {busy || building ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />} {building ? "Updating…" : "Change"}
        </Button>
      </form>
      <ErrorText error={error ?? d.error ?? null} />

      <div className="min-h-[360px] flex-1">
        {d.html ? (
          <AppRunner id={d.id} html={d.html} version={d.version} onActions={onActions} callRef={call} />
        ) : d.status === "failed" ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 rounded-xl border border-alert/40 text-sm text-soft">
            <p>{d.error}</p>
            <Button onClick={() => applyChange(d.description)}>
              <History size={14} /> Try again
            </Button>
          </div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 rounded-xl border border-line text-sm text-soft">
            <Loader2 size={22} className="animate-spin text-core" />
            <p>Writing your app… usually about 30 seconds.</p>
            <p className="max-w-md text-center text-xs text-faint">{d.description}</p>
          </div>
        )}
      </div>
    </div>
  );
}
