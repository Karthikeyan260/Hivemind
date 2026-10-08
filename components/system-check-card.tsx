"use client";

import { CircleAlert, CircleCheck, CircleX, RefreshCw } from "lucide-react";
import { useState } from "react";
import { Button, cx, ErrorText, Input } from "@/components/ui";
import { useFetch } from "@/lib/client-api";

type Check = { name: string; status: "ok" | "warn" | "fail"; detail: string };
type Status = {
  model: string;
  configured: string;
  dim: number;
  running: boolean;
  job: { target: string; done: number; total: number; error?: string; note?: string; finished?: string } | null;
  tables: Record<string, { rows: number; missing: number }>;
};

const ICON = { ok: CircleCheck, warn: CircleAlert, fail: CircleX };
const TONE = { ok: "text-ok", warn: "text-core", fail: "text-alert" };

/** Settings: database privacy, embeddings, and moving to another embedding model. */
export function SystemCheckCard() {
  const health = useFetch<{ checks: Check[] }>("/api/health");
  const emb = useFetch<Status>("/api/embeddings");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [target, setTarget] = useState("");
  const [live, setLive] = useState<Status | null>(null);
  const s = live ?? emb.data;

  async function post(body: object) {
    const r = await fetch("/api/embeddings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error ?? `Error ${r.status}`);
    setLive(j as Status);
    return j as Status;
  }

  async function reembed() {
    const model = target.trim() || s?.configured;
    const resume = !!s?.running;
    if (!resume && !confirm(`Re-embed every note, memory and document with ${model}? Search may be less accurate until it finishes.`)) return;
    setBusy(true);
    setError(null);
    try {
      let st = await post(resume ? { action: "step" } : { action: "start", model });
      // Each request does up to ~45 s of work; keep going while this page is open (the scheduler
      // also carries on with it if the page is closed).
      for (let stuck = 0; st.running && stuck < 5; ) {
        const before = st.job?.done ?? 0;
        st = await post({ action: "step" });
        stuck = (st.job?.done ?? 0) > before ? 0 : stuck + 1;
        if (st.job?.error) break;
      }
      health.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    setBusy(true);
    try {
      await post({ action: "cancel" });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const pct = s?.job && s.job.total ? Math.min(100, Math.round((s.job.done / s.job.total) * 100)) : 0;

  return (
    <section className="rounded-xl border border-line bg-panel p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="font-semibold">System check</h2>
        <Button size="sm" variant="quiet" onClick={() => (health.reload(), emb.reload())} aria-label="Check again">
          <RefreshCw size={13} />
        </Button>
      </div>
      <ul className="mb-4 space-y-1.5 text-sm">
        {(health.data?.checks ?? []).map((c) => {
          const I = ICON[c.status];
          return (
            <li key={c.name} className="flex items-start gap-2">
              <I size={15} className={cx("mt-0.5 shrink-0", TONE[c.status])} />
              <span>
                <b className="font-medium">{c.name}</b> <span className="text-soft">· {c.detail}</span>
              </span>
            </li>
          );
        })}
        {!health.data && <li className="text-soft">{health.error ?? "Checking…"}</li>}
      </ul>

      <h3 className="mb-1 text-sm font-semibold">Embeddings</h3>
      {s && (
        <div className="space-y-2 text-sm">
          <p className="text-soft">
            Search vectors: <span className="font-mono text-fg">{s.model}</span> · {s.dim}-d ·{" "}
            {Object.entries(s.tables)
              .map(([t, c]) => `${c.rows} ${t.replace("document_chunks", "document chunks")}`)
              .join(", ")}
          </p>
          {s.running && s.job && (
            <div>
              <div className="mb-1 h-1.5 w-full max-w-sm overflow-hidden rounded bg-sunken">
                <div className="h-full bg-core" style={{ width: `${pct}%` }} />
              </div>
              <p className="text-xs text-soft">
                Moving to {s.job.target}: {s.job.done} of {s.job.total}
                {s.job.note ? ` · paused: ${s.job.note}` : ""}
              </p>
            </div>
          )}
          {s.job?.error && <p className="text-xs text-alert">{s.job.error}</p>}
          {s.job?.finished && !s.running && <p className="text-xs text-soft">Last re-embed finished {new Date(s.job.finished).toLocaleString()}.</p>}
          <div className="flex flex-wrap items-center gap-2">
            <Input value={target} onChange={(e) => setTarget(e.target.value)} placeholder={s.configured} disabled={busy || s.running} className="max-w-56 font-mono" aria-label="Embedding model" />
            <Button size="sm" variant="ghost" onClick={reembed} disabled={busy}>
              {s.running ? "Continue re-embed" : "Re-embed everything"}
            </Button>
            {s.running && (
              <Button size="sm" variant="danger" onClick={cancel} disabled={busy}>
                Cancel
              </Button>
            )}
          </div>
          <p className="text-xs text-soft">
            Vectors from different models can&apos;t be compared, so HIVEMIND keeps using {s.model} until every row is redone. The model must give {s.dim}-number
            vectors (Gemini embedding models do).
          </p>
        </div>
      )}
      <ErrorText error={error ?? emb.error} />
    </section>
  );
}
