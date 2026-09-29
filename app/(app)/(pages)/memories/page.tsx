"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { Badge, Button, Empty, ErrorText, Input, PageHeader, ProjectSelect, Select, Textarea } from "@/components/ui";
import { api, fmtDate, type Memory, MEMORY_TYPES, type Project, useFetch } from "@/lib/client-api";

export default function MemoriesPage() {
  return (
    <Suspense>
      <Memories />
    </Suspense>
  );
}

type Draft = {
  id: string | null;
  title: string;
  content: string;
  memory_type: string;
  importance: number;
  project_id: string | null;
  change_reason: string;
};
type Version = { id: string; version_number: number; title: string; content: string; change_reason: string | null; created_at: string };

const blank: Draft = { id: null, title: "", content: "", memory_type: "", importance: 5, project_id: null, change_reason: "" };
const label = (t: string) => t.replace("_", " ");

function Memories() {
  const params = useSearchParams();
  const router = useRouter();
  const [type, setType] = useState("");
  const memories = useFetch<Memory[]>(`/api/memories${type ? `?type=${type}` : ""}`);
  const projects = useFetch<Project[]>("/api/projects");
  const [draft, setDraft] = useState<Draft | null>(params.get("new") ? blank : null);
  const versions = useFetch<Version[]>(draft?.id ? `/api/memories/${draft.id}/versions` : null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const openId = params.get("open");
  useEffect(() => {
    const m = openId && memories.data?.find((x) => x.id === openId);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sync editor with ?open=
    if (m) setDraft({ id: m.id, title: m.title, content: m.content, memory_type: m.memory_type, importance: m.importance, project_id: m.project_id, change_reason: "" });
  }, [openId, memories.data]);

  async function save() {
    if (!draft) return;
    setBusy(true);
    setError(null);
    try {
      const body = {
        title: draft.title || undefined,
        content: draft.content,
        memory_type: draft.memory_type || undefined,
        importance: draft.importance,
        project_id: draft.project_id,
        ...(draft.id && draft.change_reason ? { change_reason: draft.change_reason } : {}),
      };
      const saved = draft.id
        ? await api<Memory>(`/api/memories/${draft.id}`, { method: "PUT", json: body })
        : await api<Memory>("/api/memories", { method: "POST", json: body });
      await memories.reload();
      setDraft({ ...blank, id: saved.id, title: saved.title, content: saved.content, memory_type: saved.memory_type, importance: saved.importance, project_id: saved.project_id });
      router.replace(`/memories?open=${saved.id}`);
      versions.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function restore(v: Version) {
    if (!draft?.id || !confirm(`Restore version ${v.version_number}? The current text is kept as a new version.`)) return;
    const m = await api<Memory>(`/api/memories/${draft.id}/versions`, { method: "POST", json: { version_id: v.id } });
    setDraft({ ...blank, id: m.id, title: m.title, content: m.content, memory_type: m.memory_type, importance: m.importance, project_id: m.project_id });
    memories.reload();
    versions.reload();
  }

  async function remove() {
    if (!draft?.id || !confirm("Delete this memory and its history permanently?")) return;
    await api(`/api/memories/${draft.id}`, { method: "DELETE" });
    setDraft(null);
    router.replace("/memories");
    memories.reload();
  }

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Memories"
        subtitle="Durable knowledge. Edits are versioned and re-embedded."
        actions={
          <>
            <Select value={type} onChange={(e) => setType(e.target.value)}>
              <option value="">All types</option>
              {MEMORY_TYPES.map((t) => <option key={t} value={t}>{label(t)}</option>)}
            </Select>
            <Button onClick={() => { setDraft(blank); router.replace("/memories"); }}>New memory</Button>
          </>
        }
      />
      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        <div>
          <ErrorText error={memories.error} />
          {memories.loading && !memories.data ? (
            <p className="text-sm text-soft">Loading…</p>
          ) : !memories.data?.length ? (
            <Empty>No memories yet. Try “remember that …” to HIVEMIND.</Empty>
          ) : (
            <ul className="space-y-2">
              {memories.data.map((m) => (
                <li key={m.id}>
                  <button
                    onClick={() => router.replace(`/memories?open=${m.id}`)}
                    className={`w-full rounded-md border p-3 text-left ${draft?.id === m.id ? "border-core bg-core/5" : "border-line bg-raised hover:border-line-strong"}`}
                  >
                    <div className="truncate text-sm font-medium">{m.title}</div>
                    <div className="mt-1 line-clamp-2 text-xs text-soft">{m.content}</div>
                    <div className="mt-2 flex flex-wrap gap-1">
                      <Badge tone="accent">{label(m.memory_type)}</Badge>
                      <Badge>importance {m.importance}</Badge>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {draft ? (
          <div className="space-y-4">
            <div className="space-y-3 rounded-xl border border-line bg-panel p-4">
              <Input placeholder="Title (optional)" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
              <Textarea rows={8} placeholder="What should your brain remember?" value={draft.content} onChange={(e) => setDraft({ ...draft, content: e.target.value })} />
              <div className="flex flex-wrap items-center gap-2">
                <Select value={draft.memory_type} onChange={(e) => setDraft({ ...draft, memory_type: e.target.value })}>
                  <option value="">{draft.id ? "Type" : "Type: let AI decide"}</option>
                  {MEMORY_TYPES.map((t) => <option key={t} value={t}>{label(t)}</option>)}
                </Select>
                <label className="flex items-center gap-2 text-sm text-soft">
                  Importance
                  <input type="range" min={1} max={10} value={draft.importance} onChange={(e) => setDraft({ ...draft, importance: +e.target.value })} />
                  <span className="w-5 tabular-nums text-fg">{draft.importance}</span>
                </label>
                <ProjectSelect projects={projects.data} value={draft.project_id} onChange={(v) => setDraft({ ...draft, project_id: v })} />
              </div>
              {draft.id && (
                <Input placeholder="Why are you changing it? (saved in history)" value={draft.change_reason} onChange={(e) => setDraft({ ...draft, change_reason: e.target.value })} />
              )}
              <div className="flex gap-2">
                <Button onClick={save} disabled={busy || !draft.content.trim()}>{busy ? "Saving…" : "Save"}</Button>
                {draft.id && <Button variant="danger" onClick={remove}>Delete</Button>}
              </div>
              <ErrorText error={error} />
            </div>

            {draft.id && (
              <div className="rounded-xl border border-line bg-panel p-4">
                <h2 className="mb-2 font-semibold">Version history</h2>
                {!versions.data?.length ? (
                  <p className="text-sm text-soft">No previous versions.</p>
                ) : (
                  <ul className="space-y-2">
                    {versions.data.map((v) => (
                      <li key={v.id} className="rounded-lg border border-line p-3 text-sm">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium">v{v.version_number} · {fmtDate(v.created_at)}</span>
                          <Button variant="ghost" onClick={() => restore(v)}>Restore</Button>
                        </div>
                        {v.change_reason && <div className="mt-1 text-xs text-soft">Reason: {v.change_reason}</div>}
                        <div className="mt-2 line-clamp-3 text-soft">{v.content}</div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        ) : (
          <Empty>Select a memory or create a new one.</Empty>
        )}
      </div>
    </div>
  );
}
