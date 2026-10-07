"use client";

import { AlertTriangle, ArrowDown, ArrowUp, CloudSun, ExternalLink, PhoneIncoming, Pin, Plus, Settings2, Play, X, Zap } from "lucide-react";
import Link from "next/link";
import { useCallback, useRef, useState } from "react";
import { AppRunner } from "@/components/apps/runner";
import { Holo } from "@/components/bridge/holo";
import { cx } from "@/components/ui";
import { api, timeAgo, useFetch } from "@/lib/client-api";

type Data = {
  pinned: string[];
  apps: { id: string; name: string; emoji: string }[];
  weather: { place: string; now: { temp_c: number; feels_like_c: number; condition: string; humidity_pct: number }; today: { max_c: number; min_c: number; rain_chance_pct: number } | null } | null;
  calls: { unread: number; latest: { id: string; caller: string; why: string; urgent: boolean; at: string; read: boolean }[] } | null;
  routines: { id: string; name: string; steps: number }[] | null;
};
type AppDoc = { id: string; name: string; emoji: string; html: string; version: number; status: string };

const BUILT_IN: Record<string, { label: string; icon: typeof CloudSun }> = {
  weather: { label: "Weather", icon: CloudSun },
  routines: { label: "Routines", icon: Zap },
  calls: { label: "Answered calls", icon: PhoneIncoming },
};

/**
 * Home panels: small live cards pinned to the home screen — weather, routines (one tap to run),
 * answered calls, and any app HIVEMIND built, running right here. "Edit" pins, unpins and reorders.
 */
export function HomePanels({ onAsk }: { onAsk: (text: string) => void }) {
  const feed = useFetch<Data>("/api/panels");
  const [editing, setEditing] = useState(false);
  const d = feed.data;
  if (!d) return null;

  async function save(pinned: string[]) {
    feed.setData((x) => (x ? { ...x, pinned } : x));
    await api("/api/panels", { method: "PUT", json: { pinned } }).catch(() => {});
    void feed.reload();
  }
  const move = (i: number, by: number) => {
    const next = [...d.pinned];
    const j = i + by;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    void save(next);
  };
  const addable = [...Object.keys(BUILT_IN), ...d.apps.map((a) => `app:${a.id}`)].filter((p) => !d.pinned.includes(p));
  const nameOf = (p: string) => BUILT_IN[p]?.label ?? (d.apps.find((a) => `app:${a.id}` === p) ? `${d.apps.find((a) => `app:${a.id}` === p)!.emoji} ${d.apps.find((a) => `app:${a.id}` === p)!.name}` : "Removed app");

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between px-1 font-mono text-[10px] uppercase tracking-[0.2em] text-faint">
        <span className="flex items-center gap-1.5">
          <Pin size={11} /> Pinned
        </span>
        <button type="button" onClick={() => setEditing(!editing)} className={cx("flex items-center gap-1 hover:text-core", editing && "text-core")}>
          <Settings2 size={11} /> {editing ? "Done" : "Edit"}
        </button>
      </div>

      {editing && (
        <Holo title="Edit panels">
          <div className="space-y-1.5 p-3 text-[12.5px]">
            {d.pinned.map((p, i) => (
              <div key={p} className="flex items-center gap-2 border border-line px-2 py-1.5">
                <span className="min-w-0 flex-1 truncate">{nameOf(p)}</span>
                <button type="button" aria-label="Move up" onClick={() => move(i, -1)} className="text-soft hover:text-fg">
                  <ArrowUp size={13} />
                </button>
                <button type="button" aria-label="Move down" onClick={() => move(i, 1)} className="text-soft hover:text-fg">
                  <ArrowDown size={13} />
                </button>
                <button type="button" aria-label="Unpin" onClick={() => save(d.pinned.filter((x) => x !== p))} className="text-soft hover:text-alert">
                  <X size={13} />
                </button>
              </div>
            ))}
            {addable.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {addable.map((p) => (
                  <button key={p} type="button" onClick={() => save([...d.pinned, p])} className="flex items-center gap-1 border border-data/40 px-2 py-1 text-[11.5px] text-data hover:border-data">
                    <Plus size={11} /> {nameOf(p)}
                  </button>
                ))}
              </div>
            )}
            {!d.apps.length && <p className="pt-1 text-[11.5px] text-faint">Apps you build (Apps page) can be pinned here too.</p>}
          </div>
        </Holo>
      )}

      {d.pinned.map((p) =>
        p === "weather" ? (
          <WeatherCard key={p} w={d.weather} />
        ) : p === "routines" ? (
          <RoutinesCard key={p} routines={d.routines ?? []} onAsk={onAsk} />
        ) : p === "calls" ? (
          <CallsCard key={p} calls={d.calls} />
        ) : p.startsWith("app:") ? (
          <AppCard key={p} id={p.slice(4)} />
        ) : null,
      )}
    </div>
  );
}

function WeatherCard({ w }: { w: Data["weather"] }) {
  return (
    <Holo title="Weather" right={<span className="font-mono text-[10px] text-faint">{w?.place ?? ""}</span>}>
      {w ? (
        <div className="flex items-center gap-4 p-4">
          <div className="text-3xl font-semibold tabular-nums">{Math.round(w.now.temp_c)}°</div>
          <div className="min-w-0 text-[12.5px] leading-snug text-soft">
            <div className="capitalize text-fg">{w.now.condition}</div>
            <div>
              feels {Math.round(w.now.feels_like_c)}° · humidity {w.now.humidity_pct}%
            </div>
            {w.today && (
              <div className="font-mono text-[10.5px] text-faint">
                {Math.round(w.today.min_c)}–{Math.round(w.today.max_c)}° · rain {w.today.rain_chance_pct}%
              </div>
            )}
          </div>
        </div>
      ) : (
        <p className="p-4 text-[12.5px] text-faint">Weather is unavailable right now.</p>
      )}
    </Holo>
  );
}

function RoutinesCard({ routines, onAsk }: { routines: NonNullable<Data["routines"]>; onAsk: (text: string) => void }) {
  const run = (name: string) => onAsk(`Run my "${name}" routine`);
  return (
    <Holo
      title="Routines"
      right={
        <Link href="/routines" className="font-mono text-[10px] text-faint hover:text-data">
          ALL →
        </Link>
      }
    >
      <div className="space-y-1 p-3">
        {routines.length ? (
          routines.slice(0, 4).map((r) => (
            <button key={r.id} type="button" onClick={() => run(r.name)} className="group flex w-full items-center gap-2 border border-line px-2.5 py-1.5 text-left text-[12.5px] text-soft hover:border-core/60 hover:text-fg">
              <Play size={11} className="text-core" />
              <span className="min-w-0 flex-1 truncate">{r.name}</span>
              <span className="font-mono text-[10px] text-faint">{r.steps} steps</span>
            </button>
          ))
        ) : (
          <p className="p-1 text-[12.5px] text-faint">No routines yet.</p>
        )}
      </div>
    </Holo>
  );
}

function CallsCard({ calls }: { calls: Data["calls"] }) {
  return (
    <Holo
      title={`Answered calls${calls?.unread ? ` · ${calls.unread} new` : ""}`}
      right={
        <Link href="/calls" className="font-mono text-[10px] text-faint hover:text-data">
          ALL →
        </Link>
      }
    >
      <div className="space-y-2 p-3">
        {calls?.latest.length ? (
          calls.latest.map((c) => (
            <Link key={c.id} href="/calls" className="flex items-start gap-2 text-[12.5px] hover:text-fg">
              {c.urgent ? <AlertTriangle size={13} className="mt-0.5 shrink-0 text-alert" /> : <PhoneIncoming size={13} className={cx("mt-0.5 shrink-0", c.read ? "text-faint" : "text-data")} />}
              <span className="min-w-0 flex-1">
                <span className={cx(c.read ? "text-soft" : "font-medium text-fg")}>{c.caller}</span>
                <span className="text-soft"> · {c.why || "no message"}</span>
              </span>
              <span className="shrink-0 font-mono text-[10px] text-faint">{timeAgo(c.at)}</span>
            </Link>
          ))
        ) : (
          <p className="p-1 text-[12.5px] text-faint">No answered calls. Share your call link from the Calls page.</p>
        )}
      </div>
    </Holo>
  );
}

/** One of the owner's built apps, running live in a small window on the home screen. */
function AppCard({ id }: { id: string }) {
  const app = useFetch<AppDoc>(`/api/apps/${id}`);
  const call = useRef<((name: string, input: string) => Promise<unknown>) | null>(null);
  const onActions = useCallback(() => {}, []);
  const a = app.data;
  return (
    <Holo
      title={a ? `${a.emoji} ${a.name}` : "App"}
      right={
        <Link href={`/apps/${id}`} aria-label="Open the app" className="text-faint hover:text-data">
          <ExternalLink size={12} />
        </Link>
      }
    >
      <div className="h-72 p-2">
        {a?.html ? (
          <AppRunner id={a.id} html={a.html} version={a.version} onActions={onActions} callRef={call} />
        ) : (
          <p className="p-2 text-[12.5px] text-faint">{app.error ? "This app was removed." : "Loading…"}</p>
        )}
      </div>
    </Holo>
  );
}
