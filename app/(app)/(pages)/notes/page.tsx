"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { Badge, Button, Empty, ErrorText, Input, PageHeader, ProjectSelect, Textarea } from "@/components/ui";
import { api, fmtDate, type Note, type Project, useFetch } from "@/lib/client-api";

export default function NotesPage() {
  return (
    <Suspense>
      <Notes />
    </Suspense>
  );
}

type Draft = { id: string | null; title: string; content: string; project_id: string | null };
const blank: Draft = { id: null, title: "", content: "", project_id: null };

function Notes() {
  const params = useSearchParams();
  const router = useRouter();
  const notes = useFetch<Note[]>("/api/notes");
  const projects = useFetch<Project[]>("/api/projects");
  const [filter, setFilter] = useState("");
  const [draft, setDraft] = useState<Draft | null>(params.get("new") ? blank : null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const openId = params.get("open");
  useEffect(() => {
    const n = openId && notes.data?.find((x) => x.id === openId);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sync editor with ?open=
    if (n) setDraft({ id: n.id, title: n.title, content: n.content, project_id: n.project_id });
  }, [openId, notes.data]);

  const visible = useMemo(() => {
    const q = filter.toLowerCase();
    return (notes.data ?? []).filter(
      (n) => !q || n.title.toLowerCase().includes(q) || n.content.toLowerCase().includes(q) || n.tags.some((t) => t.includes(q)),
    );
  }, [notes.data, filter]);

  const current = draft?.id ? notes.data?.find((n) => n.id === draft.id) : null;

  async function save() {
    if (!draft) return;
    setBusy(true);
    setError(null);
    try {
      const body = { title: draft.title || undefined, content: draft.content, project_id: draft.project_id };
      const saved = draft.id
        ? await api<Note>(`/api/notes/${draft.id}`, { method: "PUT", json: body })
        : await api<Note>("/api/notes", { method: "POST", json: body });
      await notes.reload();
      setDraft({ id: saved.id, title: saved.title, content: saved.content, project_id: saved.project_id });
      router.replace(`/notes?open=${saved.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!draft?.id || !confirm("Delete this note permanently?")) return;
    await api(`/api/notes/${draft.id}`, { method: "DELETE" });
    setDraft(null);
    router.replace("/notes");
    notes.reload();
  }

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Notes"
        subtitle="AI adds a summary, category, tags and an embedding when you save."
        actions={<Button onClick={() => { setDraft(blank); router.replace("/notes"); }}>New note</Button>}
      />
      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        <div className="space-y-3">
          <Input placeholder="Filter notes…" value={filter} onChange={(e) => setFilter(e.target.value)} />
          <ErrorText error={notes.error} />
          {notes.loading && !notes.data ? (
            <p className="text-sm text-soft">Loading…</p>
          ) : visible.length === 0 ? (
            <Empty>No notes yet.</Empty>
          ) : (
            <ul className="space-y-2">
              {visible.map((n) => (
                <li key={n.id}>
                  <button
                    onClick={() => router.replace(`/notes?open=${n.id}`)}
                    className={`w-full rounded-md border p-3 text-left ${draft?.id === n.id ? "border-core bg-core/5" : "border-line bg-raised hover:border-line-strong"}`}
                  >
                    <div className="truncate text-sm font-medium">{n.title}</div>
                    <div className="mt-1 line-clamp-2 text-xs text-soft">{n.summary || n.content}</div>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {n.category && <Badge tone="accent">{n.category}</Badge>}
                      {n.tags.slice(0, 3).map((t) => <Badge key={t}>{t}</Badge>)}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {draft ? (
          <div className="space-y-3 rounded-xl border border-line bg-panel p-4">
            <Input placeholder="Title (optional — AI can suggest one)" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
            <Textarea
              rows={16}
              placeholder="Write in plain text or Markdown…"
              value={draft.content}
              onChange={(e) => setDraft({ ...draft, content: e.target.value })}
            />
            <div className="flex flex-wrap items-center gap-2">
              <ProjectSelect projects={projects.data} value={draft.project_id} onChange={(v) => setDraft({ ...draft, project_id: v })} />
              <Button onClick={save} disabled={busy || !draft.content.trim()}>{busy ? "Saving…" : "Save"}</Button>
              {draft.id && <Button variant="danger" onClick={remove}>Delete</Button>}
              {current && <span className="ml-auto text-xs text-soft">Updated {fmtDate(current.updated_at)}</span>}
            </div>
            <ErrorText error={error} />
            {current?.summary && (
              <div className="rounded-lg bg-muted p-3 text-sm">
                <div className="mb-1 text-xs font-medium text-soft">AI summary</div>
                {current.summary}
              </div>
            )}
          </div>
        ) : (
          <Empty>Select a note or create a new one.</Empty>
        )}
      </div>
    </div>
  );
}
