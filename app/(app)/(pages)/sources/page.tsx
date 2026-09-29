"use client";

import Link from "next/link";
import { useState } from "react";
import { Badge, Button, ErrorText, Input, PageHeader } from "@/components/ui";
import { api, fmtDate, useFetch } from "@/lib/client-api";

type Status = {
  portfolio: { memories: number; syncedAt: string | null; via: string | null; mcpConfigured: boolean };
  pages: { id: string; filename: string; source_url: string; status: string; chunk_count: number; error: string | null; created_at: string }[];
};

const MY_PAGES = [
  { label: "Portfolio site", url: "https://karthikeyan.vercel.app/" },
  { label: "Linktree", url: "https://linktr.ee/karthikeyan26" },
];

export default function SourcesPage() {
  const status = useFetch<Status>("/api/import");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [customUrl, setCustomUrl] = useState("");

  async function run(key: string, body: object, done: (r: Record<string, unknown>) => string) {
    setBusy(key);
    setError(null);
    setMessage(null);
    try {
      setMessage(done(await api<Record<string, unknown>>("/api/import", { method: "POST", json: body })));
      status.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  const syncPortfolio = () =>
    run("portfolio", { source: "portfolio" }, (r) => `Synced ${r.memories} memories + resume (${r.resumeChunks} chunks) via ${r.via === "mcp" ? "your MCP server" : "GitHub data"}.`);
  const importUrl = (url: string) => run(url, { source: "web", url }, (r) => `Imported “${r.filename}” (${r.chunk_count} chunks).`);
  const imported = (url: string) => status.data?.pages.find((p) => p.source_url === url);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader title="Sources" subtitle="Pull your own data into your brain. Re-syncing replaces the previous import — no duplicates." />
      <ErrorText error={error ?? status.error} />
      {message && <p className="rounded-lg bg-accent/10 px-3 py-2 text-sm text-accent">{message}</p>}

      <section className="rounded-xl border border-line bg-panel p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-semibold">Portfolio MCP</h2>
            <p className="mt-1 text-sm text-soft">
              Profile, experience, projects, skills, certifications, education, contact and resume from{" "}
              <code className="text-xs">Karthikeyan260/Portfolio-mcp</code>.
            </p>
            <div className="mt-2 flex flex-wrap gap-1">
              <Badge tone={status.data?.portfolio.mcpConfigured ? "accent" : "neutral"}>
                {status.data?.portfolio.mcpConfigured ? "MCP endpoint set" : "No PORTFOLIO_MCP_URL — reads GitHub data"}
              </Badge>
              {status.data?.portfolio.syncedAt && (
                <Badge>
                  {status.data.portfolio.memories} memories · synced {fmtDate(status.data.portfolio.syncedAt)} via {status.data.portfolio.via}
                </Badge>
              )}
            </div>
          </div>
          <Button onClick={syncPortfolio} disabled={!!busy}>{busy === "portfolio" ? "Syncing…" : "Sync now"}</Button>
        </div>
      </section>

      <section className="rounded-xl border border-line bg-panel p-4">
        <h2 className="font-semibold">Web pages</h2>
        <ul className="mt-3 divide-y divide-line">
          {MY_PAGES.map((p) => {
            const doc = imported(p.url);
            return (
              <li key={p.url} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium">{p.label}</div>
                  <a href={p.url} target="_blank" rel="noreferrer" className="text-xs text-soft hover:text-accent">{p.url}</a>
                  {doc && (
                    <div className="mt-1">
                      <Badge tone={doc.status === "ready" ? "accent" : "neutral"}>
                        {doc.status} · {doc.chunk_count} chunks · {fmtDate(doc.created_at)}
                      </Badge>
                    </div>
                  )}
                </div>
                <Button variant="ghost" onClick={() => importUrl(p.url)} disabled={!!busy}>
                  {busy === p.url ? "Importing…" : doc ? "Re-import" : "Import"}
                </Button>
              </li>
            );
          })}
        </ul>
        <form
          className="mt-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (customUrl) importUrl(customUrl);
          }}
        >
          <Input type="url" placeholder="Any other public page URL…" value={customUrl} onChange={(e) => setCustomUrl(e.target.value)} />
          <Button type="submit" disabled={!!busy || !customUrl}>{busy === customUrl ? "Importing…" : "Import"}</Button>
        </form>
        {status.data?.pages
          .filter((p) => !MY_PAGES.some((m) => m.url === p.source_url) && p.source_url.startsWith("http"))
          .map((p) => (
            <div key={p.id} className="mt-2 flex items-center justify-between gap-2 text-sm">
              <Link href={`/documents?open=${p.id}`} className="truncate hover:text-accent">{p.filename}</Link>
              <Badge>{p.chunk_count} chunks</Badge>
            </div>
          ))}
      </section>

      <section className="rounded-xl border border-line bg-panel p-4">
        <h2 className="font-semibold">LinkedIn</h2>
        <p className="mt-1 text-sm text-soft">
          LinkedIn blocks every automated reader (it returned HTTP 999), so it can&apos;t be synced directly. Two free ways in:
        </p>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm">
          <li>
            Open{" "}
            <a className="text-accent" href="https://www.linkedin.com/in/karthikeyan2604/" target="_blank" rel="noreferrer">
              your profile
            </a>{" "}
            → <b>Resources</b> (or <b>More</b>) → <b>Save to PDF</b>, then upload it in{" "}
            <Link className="text-accent" href="/documents">Documents</Link>.
          </li>
          <li>
            For everything (posts, connections, skills): LinkedIn → Settings → Data privacy → <b>Get a copy of your data</b>. Upload the CSVs
            you care about as text.
          </li>
        </ol>
      </section>
    </div>
  );
}
