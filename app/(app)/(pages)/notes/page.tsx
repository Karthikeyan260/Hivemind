"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { FolderOpen, NotebookPen, Plus, Search, X } from "lucide-react";
import { Suspense, useEffect, useMemo, useState } from "react";
import { Badge, Button, CardSkeleton, cx, Empty, ErrorText, Input, PageHeader, ProjectSelect, Textarea } from "@/components/ui";
import { api, fmtDate, type Note, type Project, useFetch } from "@/lib/client-api";

/** A note's preview without Markdown marks (headings, bold, list dashes, link targets). */
const plain = (t: string) =>
  t
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}(#{1,6}|[-*+]|\d+\.)\s+/gm, "")
    .replace(/[*_`~]{1,3}/g, "")
    // Paragraphs read as separate sentences ("Mood: rough · Feeling tired"), not run together.
    .replace(/([^.!?:;,\s])\s*\n\s*\n\s*/g, "$1 · ")
    .replace(/\s+/g, " ")
    .trim();

/** One key per category however the AI spelled it ("personal_log", "Personal Log" → "personal log"). */
const catKey = (c: string) => c.toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
/** Its display name: words capitalised ("personal log" → "Personal Log"). */
const catLabel = (k: string) => k.replace(/\b\w/g, (ch) => ch.toUpperCase());

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
  // a category picked in the side pane narrows the list (cleared with its ×)
  const [cat, setCat] = useState<string | null>(null);
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
      (n) => (!cat || (n.category && catKey(n.category) === cat)) && (!q || n.title.toLowerCase().includes(q) || n.content.toLowerCase().includes(q) || n.tags.some((t) => t.includes(q))),
    );
  }, [notes.data, filter, cat]);
  // how many notes in each category (real counts, biggest first)
  const cats = useMemo(() => {
    const m = new Map<string, number>();
    for (const n of notes.data ?? []) if (n.category) m.set(catKey(n.category), (m.get(catKey(n.category)) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [notes.data]);

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
        eyebrow="Knowledge"
        title="Notes"
        subtitle="AI adds a summary, category, tags and an embedding when you save."
        actions={<Button onClick={() => { setDraft(blank); router.replace("/notes"); }}>New note</Button>}
      />
      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        <div className="space-y-3">
          <div className="flex items-center gap-2 rounded-lg border border-line bg-sunken px-3 transition-colors focus-within:border-data/60">
            <Search size={14} className="shrink-0 text-faint" />
            <input placeholder="Filter notes…" aria-label="Filter notes" value={filter} onChange={(e) => setFilter(e.target.value)} className="h-9 min-w-0 flex-1 bg-transparent text-sm placeholder:text-faint focus:outline-none" />
            {notes.data && (filter || cat) && (
              <span className="shrink-0 font-mono text-[10px] text-faint tabular-nums">
                {visible.length} of {notes.data.length}
              </span>
            )}
          </div>
          {cat && (
            <button type="button" onClick={() => setCat(null)} className="inline-flex items-center gap-1.5 rounded-full border border-core/50 bg-core/10 py-0.5 pr-1.5 pl-2.5 font-mono text-[10.5px] tracking-wider text-core uppercase">
              {catLabel(cat)} <X size={11} />
            </button>
          )}
          <ErrorText error={notes.error} />
          {notes.loading && !notes.data ? (
            <CardSkeleton count={5} />
          ) : visible.length === 0 ? (
            <Empty>{notes.data?.length ? "No notes match that." : "No notes yet."}</Empty>
          ) : (
            <ul className="list-in space-y-2">
              {visible.map((n) => (
                <li key={n.id}>
                  <button
                    onClick={() => router.replace(`/notes?open=${n.id}`)}
                    className={`w-full rounded-md border p-3 text-left ${draft?.id === n.id ? "border-core bg-core/5" : "border-line bg-raised hover:border-line-strong"}`}
                  >
                    <div className="truncate text-sm font-medium">{n.title}</div>
                    <div className="mt-1 line-clamp-2 text-xs text-soft">{plain(n.tags.includes("diary") ? n.content : n.summary || n.content)}</div>
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
          // On a phone the list is the page; the empty side pane only makes sense next to it.
          <div className="hidden rounded-xl border border-dashed border-line bg-panel/40 p-6 md:sticky md:top-6 md:block md:self-start">
            <NotebookPen size={24} className="mb-3 text-faint" />
            <p className="font-medium">Pick a note to read or edit it</p>
            <p className="mt-1 text-sm text-soft">Or start a new one; HIVEMIND adds the summary, category and tags when you save.</p>
            <Button
              className="mt-4"
              onClick={() => {
                setDraft(blank);
                router.replace("/notes");
              }}
            >
              <Plus size={14} /> New note
            </Button>
            {cats.length > 0 && (
              <div className="mt-6 border-t border-line pt-4">
                <p className="mb-2 flex items-center gap-1.5 font-mono text-[10px] tracking-[0.18em] text-faint uppercase">
                  <FolderOpen size={12} /> By category · {notes.data?.length ?? 0} notes
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {cats.map(([c, n]) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setCat(cat === c ? null : c)}
                      aria-pressed={cat === c}
                      className={cx("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors", cat === c ? "border-core/60 bg-core/10 text-core" : "border-line text-soft hover:border-line-strong hover:text-fg")}
                    >
                      {catLabel(c)}
                      <span className="font-mono text-[10px] text-faint tabular-nums">{n}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
