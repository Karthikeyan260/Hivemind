"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useRef, useState } from "react";
import { BookOpen, FileSpreadsheet, FileText, FileType2, Loader2, Trash2, UploadCloud, X } from "lucide-react";
import { CardSkeleton, cx, Empty, ErrorText, PageHeader, Skeleton } from "@/components/ui";
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

/** A file type's icon and colour. */
function kindOf(t: string) {
  const x = t.toLowerCase();
  if (x.includes("pdf")) return { icon: FileType2, tone: "text-rose-300 border-rose-400/40 bg-rose-400/10", label: "PDF" };
  if (x.includes("doc")) return { icon: FileText, tone: "text-sky-300 border-sky-400/40 bg-sky-400/10", label: "Word" };
  if (x.includes("csv")) return { icon: FileSpreadsheet, tone: "text-emerald-300 border-emerald-400/40 bg-emerald-400/10", label: "CSV" };
  return { icon: FileText, tone: "text-soft border-line bg-raised/50", label: x.includes("md") || x.includes("markdown") ? "Markdown" : "Text" };
}

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
  const [over, setOver] = useState(false);

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
      <PageHeader eyebrow="Knowledge" title="Documents" subtitle="PDF, TXT, Markdown, DOCX, CSV up to 4MB. Text is chunked and embedded for search." />

      {/* the drop zone: drop a file on it, or click to choose one */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          if (!busy) setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          const f = e.dataTransfer.files?.[0];
          if (f && !busy) void upload(f);
        }}
        className={cx("mb-6 flex flex-wrap items-center gap-4 rounded-2xl border-2 border-dashed p-5 transition-colors", over ? "border-core bg-core/5" : "border-line bg-panel")}
      >
        <label className={cx("flex min-w-0 grow basis-64 cursor-pointer items-center gap-4", busy && "pointer-events-none")}>
          <span className={cx("grid size-12 shrink-0 place-items-center rounded-xl border", over || busy ? "border-core/50 bg-core/10 text-core" : "border-line bg-raised/50 text-soft")}>
            {busy ? <Loader2 size={22} className="animate-spin" /> : <UploadCloud size={22} />}
          </span>
          <span className="min-w-0">
            <span className="block font-medium">{busy ? "Reading and indexing…" : over ? "Drop to upload" : "Drop a document here, or click to choose"}</span>
            <span className="block text-xs text-soft">{busy ? "This can take up to a minute." : "PDF, Word, TXT, Markdown or CSV · up to 4 MB"}</span>
          </span>
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,.txt,.md,.markdown,.docx,.csv"
            disabled={busy}
            onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
            className="sr-only"
          />
        </label>
        <label className="flex shrink-0 items-center gap-2 rounded-full border border-line bg-raised/60 pr-1 pl-3 text-xs text-soft">
          <span className="font-mono text-[10px] tracking-[0.14em] text-faint uppercase">Project</span>
          <select value={projectId ?? ""} onChange={(e) => setProjectId(e.target.value || null)} aria-label="Project" className="h-8 max-w-[12rem] cursor-pointer truncate bg-transparent pr-1 text-fg focus:outline-none">
            <option value="" className="bg-panel">
              Let HIVEMIND decide
            </option>
            {projects.data?.map((p) => (
              <option key={p.id} value={p.id} className="bg-panel">
                {p.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <ErrorText error={error ?? docs.error} />

      <div className="mt-4 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {!docs.data?.length ? (
          docs.loading ? <CardSkeleton count={4} /> : <Empty>No documents yet.</Empty>
        ) : (
          <ul className="list-in min-w-0 space-y-2">
            {docs.data.map((d) => {
              const k = kindOf(d.file_type);
              return (
                <li key={d.id} className={cx("group relative rounded-xl border bg-panel transition-colors", openId === d.id ? "border-core/60 bg-raised/40" : "border-line hover:border-line-strong")}>
                  <button onClick={() => router.replace(`/documents?open=${d.id}`)} className="flex w-full gap-3 p-3.5 pr-12 text-left">
                    <span className={cx("grid size-10 shrink-0 place-items-center rounded-lg border", k.tone)}>
                      <k.icon size={18} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium">{d.filename}</span>
                        {d.status !== "ready" && (
                          <span className={cx("inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-px font-mono text-[9.5px] tracking-wider uppercase", d.status === "failed" ? "border-alert/50 text-alert" : "border-core/40 text-core")}>
                            {d.status === "processing" && <Loader2 size={9} className="animate-spin" />}
                            {d.status}
                          </span>
                        )}
                      </span>
                      <span className="mt-0.5 block font-mono text-[10.5px] text-faint">
                        {k.label} · {d.chunk_count} {d.chunk_count === 1 ? "chunk" : "chunks"} · {fmtDate(d.created_at)}
                      </span>
                      {d.summary && <span className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-soft">{d.summary}</span>}
                      {d.error && <span className="mt-1.5 block text-xs text-alert">{d.error}</span>}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(d.id)}
                    aria-label={`Delete ${d.filename}`}
                    title="Delete"
                    className="absolute top-3 right-3 grid size-8 place-items-center rounded-md text-faint opacity-60 transition hover:bg-alert/10 hover:text-alert group-hover:opacity-100 focus-visible:opacity-100"
                  >
                    <Trash2 size={15} />
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {!openId && (docs.data?.length ?? 0) > 0 && (
          // nothing open: the reading pane says what it is for
          <div className="hidden place-items-center rounded-xl border border-dashed border-line bg-panel/40 p-8 text-center lg:grid">
            <span>
              <BookOpen size={26} className="mx-auto mb-3 text-faint" />
              <span className="block text-sm text-soft">Pick a document to read its text here,</span>
              <span className="block text-sm text-soft">page by page, as HIVEMIND indexed it.</span>
            </span>
          </div>
        )}
        {openId && (
          <div className="min-w-0 rounded-xl border border-line bg-panel p-4 lg:sticky lg:top-4 lg:self-start">
            {!detail.data ? (
              <Skeleton lines={8} />
            ) : (
              <>
                <div className="flex items-start gap-3">
                  {(() => {
                    const k = kindOf(detail.data.file_type);
                    return (
                      <span className={cx("grid size-9 shrink-0 place-items-center rounded-lg border", k.tone)}>
                        <k.icon size={16} />
                      </span>
                    );
                  })()}
                  <span className="min-w-0 flex-1">
                    <h2 className="truncate font-semibold">{detail.data.filename}</h2>
                    <span className="block font-mono text-[10.5px] text-faint">
                      {detail.data.chunks.length} chunks · {fmtDate(detail.data.created_at)}
                    </span>
                  </span>
                  <button type="button" onClick={() => router.replace("/documents")} aria-label="Close" className="grid size-8 shrink-0 place-items-center rounded-md text-faint hover:bg-raised hover:text-fg">
                    <X size={15} />
                  </button>
                </div>
                <div className="mt-3 max-h-[70vh] space-y-3 overflow-y-auto">
                  {detail.data.chunks.map((c) => (
                    <div key={c.chunk_index} className="rounded-lg bg-muted p-3 text-xs">
                      <div className="mb-1 font-medium text-soft">
                        Chunk {c.chunk_index + 1}
                        {c.metadata.page ? ` · page ${c.metadata.page}` : ""}
                      </div>
                      <div className="whitespace-pre-wrap break-words">{c.content}</div>
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
