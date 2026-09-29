"use client";

import Link from "next/link";
import { useState } from "react";
import { Badge, Button, Empty, ErrorText, Input, PageHeader, ProjectSelect } from "@/components/ui";
import { api, fmtDate, type Project, useFetch } from "@/lib/client-api";

type Result = {
  source_type: "note" | "memory" | "document";
  source_id: string;
  parent_id: string;
  title: string;
  content: string;
  similarity: number;
  created_at: string;
};

const hrefFor = (r: Result) =>
  `/${r.source_type === "note" ? "notes" : r.source_type === "memory" ? "memories" : "documents"}?open=${r.parent_id}`;

export default function SearchPage() {
  const projects = useFetch<Project[]>("/api/projects");
  const [query, setQuery] = useState("");
  const [projectId, setProjectId] = useState<string | null>(null);
  const [results, setResults] = useState<Result[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setResults(await api<Result[]>("/api/search", { method: "POST", json: { query, project_id: projectId } }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="Semantic search" subtitle="Search by meaning across notes, memories and documents." />
      <form onSubmit={run} className="mb-6 flex flex-wrap gap-2">
        <Input className="min-w-60 flex-1" placeholder="e.g. how does vector search work in postgres" value={query} onChange={(e) => setQuery(e.target.value)} />
        <ProjectSelect projects={projects.data} value={projectId} onChange={setProjectId} allLabel="All projects" />
        <Button type="submit" disabled={busy || !query.trim()}>{busy ? "Searching…" : "Search"}</Button>
      </form>
      <ErrorText error={error} />
      {results && results.length === 0 && <Empty>No close matches. Try different words.</Empty>}
      <ul className="space-y-2">
        {results?.map((r) => (
          <li key={r.source_type + r.source_id}>
            <Link href={hrefFor(r)} className="block rounded-lg border border-line bg-panel p-4 hover:border-accent">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate font-medium">{r.title}</span>
                <span className="shrink-0 text-xs tabular-nums text-soft">{Math.round(r.similarity * 100)}% match</span>
              </div>
              <p className="mt-1 line-clamp-3 text-sm text-soft">{r.content}</p>
              <div className="mt-2 flex gap-1">
                <Badge tone="accent">{r.source_type}</Badge>
                <Badge>{fmtDate(r.created_at)}</Badge>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
