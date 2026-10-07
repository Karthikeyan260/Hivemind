"use client";

import { ExternalLink, Sparkles, X } from "lucide-react";
import Link from "next/link";
import { cx } from "@/components/ui";
import { api, useFetch } from "@/lib/client-api";

type Insight = { id: string; priority: 1 | 2 | 3; title: string; ask?: string; link?: { label: string; url: string }; status: "new" | "done" | "dismissed" };

/**
 * Autopilot's open suggestions as one-tap buttons right above the chat box (the most urgent three).
 * Tapping one runs its request in the console; × dismisses it. The full list stays on /autopilot.
 */
export function ActionChips({ onAsk, busy }: { onAsk: (text: string) => void; busy: boolean }) {
  const feed = useFetch<{ items: Insight[] }>("/api/autopilot");
  const open = (feed.data?.items ?? [])
    .filter((i) => i.status === "new" && (i.ask || i.link))
    .sort((a, b) => b.priority - a.priority)
    .slice(0, 3);
  if (!open.length) return null;

  async function mark(i: Insight, status: "done" | "dismissed") {
    feed.setData((d) => (d ? { items: d.items.map((x) => (x.id === i.id ? { ...x, status } : x)) } : d));
    await api("/api/autopilot", { method: "PATCH", json: { id: i.id, status } }).catch(() => feed.reload());
  }

  return (
    <div className="no-scrollbar -mx-1 mb-2 flex gap-1.5 overflow-x-auto px-1" aria-label="Suggested by Autopilot">
      {open.map((i) => (
        <div key={i.id} className={cx("flex max-w-[16rem] shrink-0 items-center border text-[11.5px]", i.priority === 3 ? "border-core/60 bg-core/10" : "border-data/30 bg-sunken/60")}>
          {i.ask ? (
            <button
              type="button"
              disabled={busy}
              title={i.ask}
              onClick={() => {
                void mark(i, "done");
                onAsk(i.ask!);
              }}
              className="flex min-w-0 items-center gap-1.5 py-1 pl-2 pr-1 text-left text-fg/90 hover:text-core disabled:opacity-50"
            >
              <Sparkles size={11} className="shrink-0 text-core" />
              <span className="truncate">{i.title}</span>
            </button>
          ) : (
            <Link
              href={i.link!.url}
              target={i.link!.url.startsWith("http") ? "_blank" : undefined}
              rel="noopener noreferrer"
              onClick={() => void mark(i, "done")}
              className="flex min-w-0 items-center gap-1.5 py-1 pl-2 pr-1 text-fg/90 hover:text-data"
            >
              <ExternalLink size={11} className="shrink-0 text-data" />
              <span className="truncate">{i.title}</span>
            </Link>
          )}
          <button type="button" aria-label={`Dismiss: ${i.title}`} title="Not now" onClick={() => mark(i, "dismissed")} className="shrink-0 px-1.5 py-1 text-faint hover:text-alert">
            <X size={11} />
          </button>
        </div>
      ))}
    </div>
  );
}
