"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useRef, useState } from "react";
import { Badge, Button, Empty, ErrorText, PageHeader, ProjectSelect } from "@/components/ui";
import { api, fmtDate, type Project, useFetch } from "@/lib/client-api";

type Doc = {
  id: string;
  filename: string;
  file_type: string;
  status: "processing" | "ready" | "failed";
  summary: string | null;
  chunk_count: number;
  error: string | null;
  created_at: string;
};
type DocDetail = Doc & { chunks: { chunk_index: number; content: string; metadata: { page?: number } }[] };

export default function DocumentsPage() {
  return (
    <Suspense>
      <Documents />
    </Suspense>
  );
}

function Documents() {
  const router = useRouter();
  const openId = useSearchParams().get("open");
  const docs = useFetch<Doc[]>("/api/documents");
  const projects = useFetch<Project[]>("/api/projects");
  const detail = useFetch<DocDetail>(openId ? `/api/documents/${openId}` : null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function upload(file: File) {
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      if (projectId) form.append("project_id", projectId);
      await api("/api/documents", { method: "POST", body: form });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
      docs.reload();
    }
  }

  async function remove(id: string) {
    if (!confirm("Delete this document and all its chunks?")) return;
    await api(`/api/documents/${id}`, { method: "DELETE" });
    if (openId === id) router.replace("/documents");
    docs.reload();
  }

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title="Documents" subtitle="PDF, TXT, Markdown, DOCX, CSV up to 4MB. Text is chunked and embedded for search." />

      <div className="mb-6 flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-line bg-panel p-4">
        <input
          ref={fileRef}
          type="file"
          accept=".pdf,.txt,.md,.markdown,.docx,.csv"
          disabled={busy}
          onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
          className="text-sm file:mr-3 file:rounded-md file:border-0 file:bg-core file:px-3 file:py-2 file:text-sm file:font-medium file:text-core-ink"
        />
        <ProjectSelect projects={projects.data} value={projectId} onChange={setProjectId} />
        {busy && <span className="text-sm text-soft">Parsing and embedding… this can take up to a minute.</span>}
      </div>
      <ErrorText error={error ?? docs.error} />

      <div className="mt-4 grid gap-6 lg:grid-cols-[1fr_1fr]">
        {!docs.data?.length ? (
          <Empty>{docs.loading ? "Loading…" : "No documents yet."}</Empty>
        ) : (
          <ul className="space-y-2">
            {docs.data.map((d) => (
              <li key={d.id} className={`rounded-lg border bg-panel p-3 ${openId === d.id ? "border-accent" : "border-line"}`}>
                <div className="flex items-start justify-between gap-2">
                  <button onClick={() => router.replace(`/documents?open=${d.id}`)} className="min-w-0 text-left">
                    <div className="truncate text-sm font-medium hover:text-accent">{d.filename}</div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      <Badge>{d.file_type}</Badge>
                      <Badge tone={d.status === "ready" ? "accent" : "neutral"}>{d.status}</Badge>
                      <Badge>{d.chunk_count} chunks</Badge>
                      <Badge>{fmtDate(d.created_at)}</Badge>
                    </div>
                  </button>
                  <Button variant="ghost" onClick={() => remove(d.id)}>Delete</Button>
                </div>
                {d.summary && <p className="mt-2 text-xs text-soft">{d.summary}</p>}
                {d.error && <p className="mt-2 text-xs text-red-500">{d.error}</p>}
              </li>
            ))}
          </ul>
        )}

        {openId && (
          <div className="rounded-xl border border-line bg-panel p-4">
            {!detail.data ? (
              <p className="text-sm text-soft">Loading…</p>
            ) : (
              <>
                <h2 className="font-semibold">{detail.data.filename}</h2>
                <div className="mt-3 max-h-[70vh] space-y-3 overflow-y-auto">
                  {detail.data.chunks.map((c) => (
                    <div key={c.chunk_index} className="rounded-lg bg-muted p-3 text-xs">
                      <div className="mb-1 font-medium text-soft">
                        Chunk {c.chunk_index + 1}
                        {c.metadata.page ? ` · page ${c.metadata.page}` : ""}
                      </div>
                      <div className="whitespace-pre-wrap">{c.content}</div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
