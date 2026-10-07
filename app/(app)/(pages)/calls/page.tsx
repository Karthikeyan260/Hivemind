"use client";

import { AlertTriangle, Check, Copy, PhoneIncoming, RefreshCw, Send, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Badge, Button, cx, Empty, ErrorText, PageHeader, Select } from "@/components/ui";
import { api, timeAgo, useFetch } from "@/lib/client-api";

type Settings = { mode: "missed" | "always" | "off"; wait_s: number; my_voice: boolean };
type Screened = { id: string; at: string; caller: string; reason: string; urgent: boolean; summary: string; lines: { who: "hivemind" | "caller"; text: string }[]; done: boolean; read?: boolean };
type Data = { settings: Settings; items: Screened[]; link: string };

/** Call screening: HIVEMIND answers your HIVEMIND calls when you can't, and tells you who called and why. */
export default function CallsPage() {
  const feed = useFetch<Data>("/api/calls");
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const d = feed.data;
  const unread = d?.items.some((i) => !i.read);

  // Seeing the page counts as reading them.
  useEffect(() => {
    if (unread) void api("/api/calls", { method: "PATCH", json: { read_all: true } }).catch(() => {});
  }, [unread]);

  async function set(patch: Partial<Settings>) {
    feed.setData((x) => (x ? { ...x, settings: { ...x.settings, ...patch } } : x));
    await api("/api/calls", { method: "PATCH", json: { settings: patch } }).catch((e) => {
      setError(e instanceof Error ? e.message : String(e));
      void feed.reload();
    });
  }

  async function resetLink() {
    if (!confirm("Make a new call link? The old one stops working for everyone you shared it with.")) return;
    await api("/api/calls", { method: "PATCH", json: { reset_link: true } });
    await feed.reload();
  }

  async function remove(id?: string) {
    if (!id && !confirm("Clear all answered calls?")) return;
    feed.setData((x) => (x ? { ...x, items: id ? x.items.filter((i) => i.id !== id) : [] } : x));
    await api(`/api/calls${id ? `?id=${id}` : ""}`, { method: "DELETE" }).catch(() => feed.reload());
  }

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        eyebrow="Voice"
        title="Calls"
        subtitle="When someone calls you through HIVEMIND and you can't pick up, HIVEMIND answers, says it's your assistant, asks who it is and why, and sends you a one-line summary."
      />
      <ErrorText error={error ?? feed.error} />

      {d && (
        <>
          <section className="mb-4 space-y-3 rounded-xl border border-line bg-panel p-4 text-sm">
            <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
              <label className="flex items-center gap-2 text-soft">
                Answer for me
                <Select value={d.settings.mode} onChange={(e) => set({ mode: e.target.value as Settings["mode"] })}>
                  <option value="missed">when I don&apos;t pick up</option>
                  <option value="always">every call (I can still pick up)</option>
                  <option value="off">never</option>
                </Select>
              </label>
              <label className="flex items-center gap-2 text-soft">
                after
                <Select value={d.settings.wait_s} onChange={(e) => set({ wait_s: +e.target.value })} disabled={d.settings.mode !== "missed"}>
                  {[10, 15, 20, 25, 30, 45, 60].map((s) => (
                    <option key={s} value={s}>
                      {s} s
                    </option>
                  ))}
                </Select>
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={d.settings.my_voice} onChange={(e) => set({ my_voice: e.target.checked })} />
                Speak in my cloned voice (Google now needs a paid plan for it; otherwise HIVEMIND&apos;s voice)
              </label>
            </div>
          </section>

          <section className="mb-6 rounded-xl border border-line bg-panel p-4 text-sm">
            <h2 className="mb-1 font-medium">Your call link</h2>
            <p className="mb-3 text-soft">Anyone with this link can call you on HIVEMIND from a browser. Put it in your WhatsApp status or email signature.</p>
            <code className="mb-3 block truncate rounded-md bg-raised px-3 py-2 font-mono text-xs text-data">{d.link}</code>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => void navigator.clipboard?.writeText(d.link).then(() => setCopied(true))}>
                {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? "Copied" : "Copy"}
              </Button>
              <a
                href={`https://wa.me/?text=${encodeURIComponent(`Call me on HIVEMIND: ${d.link}`)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-7 items-center gap-1.5 rounded-md border border-line-strong px-2.5 text-xs hover:border-data hover:text-data"
              >
                <Send size={13} /> Share on WhatsApp
              </a>
              <Button size="sm" variant="quiet" onClick={resetLink} title="Stop the old link working">
                <RefreshCw size={13} /> New link
              </Button>
            </div>
          </section>
        </>
      )}

      <div className="mb-2 flex items-center justify-between">
        <h2 className="font-mono text-[11px] uppercase tracking-wider text-faint">Calls HIVEMIND answered</h2>
        {!!d?.items.length && (
          <button type="button" onClick={() => remove()} className="font-mono text-[11px] uppercase tracking-wider text-soft hover:text-alert">
            Clear all
          </button>
        )}
      </div>
      {!d && feed.loading ? (
        <p className="text-sm text-soft">Loading…</p>
      ) : !d?.items.length ? (
        <Empty>No answered calls yet. Share your call link, and HIVEMIND picks up when you can&apos;t.</Empty>
      ) : (
        <ul className="space-y-3">
          {d.items.map((c) => (
            <li key={c.id} className={cx("rounded-xl border bg-panel p-4", c.urgent ? "border-alert/50" : "border-line")}>
              <div className="flex items-start gap-3">
                {c.urgent ? <AlertTriangle size={18} className="mt-0.5 shrink-0 text-alert" /> : <PhoneIncoming size={18} className="mt-0.5 shrink-0 text-data" />}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-medium">{c.caller}</h3>
                    {c.urgent && <Badge tone="core">Urgent</Badge>}
                    {!c.read && <Badge tone="data">New</Badge>}
                    {!c.done && <Badge>in progress</Badge>}
                    <span className="ml-auto font-mono text-[10.5px] text-faint">{timeAgo(c.at)}</span>
                  </div>
                  <p className="mt-1 text-sm text-soft">{c.summary || c.reason || "…"}</p>
                  <details className="mt-2 text-sm">
                    <summary className="cursor-pointer font-mono text-[11px] uppercase tracking-wider text-faint">Conversation</summary>
                    <div className="mt-2 space-y-1.5">
                      {c.lines.map((l, i) => (
                        <p key={i} className={l.who === "caller" ? "text-fg" : "text-soft"}>
                          <span className="font-mono text-[10.5px] uppercase text-faint">{l.who === "caller" ? c.caller : "HIVEMIND"} · </span>
                          {l.text}
                        </p>
                      ))}
                    </div>
                  </details>
                </div>
                <button type="button" onClick={() => remove(c.id)} aria-label="Delete" className="text-faint hover:text-alert">
                  <Trash2 size={15} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
