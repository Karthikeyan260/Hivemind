"use client";

import { Brain, Clock3, FileText, Loader2, Search, StickyNote, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { cx, ErrorText, PageHeader } from "@/components/ui";
import { api, fmtDate, type Memory, type Note, type Project, useFetch } from "@/lib/client-api";

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

/** Each kind of result: its icon and colour. */
const KIND = {
  note: { icon: StickyNote, label: "Note", tone: "text-data border-data/40 bg-data/10" },
  memory: { icon: Brain, label: "Memory", tone: "text-core border-core/40 bg-core/10" },
  document: { icon: FileText, label: "Document", tone: "text-ok border-ok/40 bg-ok/10" },
} as const;

const IDEAS = ["what did I learn about RAG", "my AI agent projects", "Python tips", "notes from last week"];
const RECENT_KEY = "hm.search.recent";

/** This device's last few searches (a per-viewer convenience: it can be missing, and that's fine). */
function loadRecent(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string").slice(0, 6) : [];
  } catch {
    return [];
  }
}
function saveRecent(list: string[]) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 6)));
  } catch {}
}

export default function SearchPage() {
  const projects = useFetch<Project[]>("/api/projects");
  const notes = useFetch<Note[]>("/api/notes");
  const memories = useFetch<Memory[]>("/api/memories");
  const [query, setQuery] = useState("");
  const [projectId, setProjectId] = useState<string | null>(null);
  const [results, setResults] = useState<Result[] | null>(null);
  const [asked, setAsked] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recent, setRecent] = useState<string[]>([]);
  const box = useRef<HTMLInputElement>(null);
  useEffect(() => {
    // read after mount (browser storage isn't there on the server)
    const t = setTimeout(() => setRecent(loadRecent()));
    return () => clearTimeout(t);
  }, []);

  async function search(q: string) {
    const text = q.trim();
    if (!text || busy) return;
    setQuery(text);
    setBusy(true);
    setError(null);
    try {
      setResults(await api<Result[]>("/api/search", { method: "POST", json: { query: text, project_id: projectId } }));
      setAsked(text);
      const next = [text, ...recent.filter((x) => x.toLowerCase() !== text.toLowerCase())].slice(0, 6);
      setRecent(next);
      saveRecent(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const clear = () => {
    setQuery("");
    setResults(null);
    setAsked("");
    box.current?.focus();
  };

  // before any search: the latest notes and memories, so there is somewhere to start
  const latest = [
    ...(notes.data ?? []).slice(0, 4).map((n) => ({ kind: "note" as const, id: n.id, title: n.title, text: n.summary || n.content, at: n.created_at })),
    ...(memories.data ?? []).slice(0, 4).map((m) => ({ kind: "memory" as const, id: m.id, title: m.title, text: m.content, at: m.created_at })),
  ]
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .slice(0, 6);

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader eyebrow="Knowledge" title="Semantic search" subtitle="Search by meaning across notes, memories and documents." />

      {/* the search bar: one field, the project filter as a pill inside it */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void search(query);
        }}
        className="group mb-4 flex items-center gap-2 rounded-xl border border-line bg-panel p-1.5 pl-4 shadow-[0_8px_30px_-12px_rgba(0,0,0,0.5)] transition-colors focus-within:border-data/60"
      >
        {busy ? <Loader2 size={18} className="shrink-0 animate-spin text-data" /> : <Search size={18} className="shrink-0 text-faint group-focus-within:text-data" />}
        <input
          ref={box}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Ask in your own words, e.g. how does vector search work in postgres"
          aria-label="Search"
          className="h-10 min-w-0 flex-1 bg-transparent text-[15px] placeholder:text-faint focus:outline-none"
        />
        {query && (
          <button type="button" onClick={clear} aria-label="Clear" className="grid size-8 shrink-0 place-items-center rounded-full text-faint hover:bg-raised hover:text-fg">
            <X size={15} />
          </button>
        )}
        <label className="hidden shrink-0 items-center rounded-full border border-line bg-raised/60 pr-1 pl-3 text-xs text-soft sm:flex">
          <span className="sr-only">Project</span>
          <select value={projectId ?? ""} onChange={(e) => setProjectId(e.target.value || null)} className="h-8 max-w-[11rem] cursor-pointer truncate bg-transparent pr-1 focus:outline-none" aria-label="Project">
            <option value="" className="bg-panel">
              All projects
            </option>
            {projects.data?.map((p) => (
              <option key={p.id} value={p.id} className="bg-panel">
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          disabled={busy || !query.trim()}
          className="h-10 shrink-0 rounded-lg bg-data px-4 text-sm font-medium text-black transition hover:brightness-110 active:scale-[0.97] disabled:bg-raised disabled:text-faint"
        >
          Search
        </button>
      </form>
      <ErrorText error={error} />

      {/* ideas and this device's recent searches */}
      {!results && (
        <div className="mb-8 space-y-2.5">
          {recent.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="mr-1 flex items-center gap-1 font-mono text-[10px] tracking-[0.16em] text-faint uppercase">
                <Clock3 size={11} /> Recent
              </span>
              {recent.map((x) => (
                <button key={x} type="button" onClick={() => void search(x)} className="rounded-full border border-line bg-panel px-2.5 py-1 text-xs text-soft transition hover:border-data/60 hover:text-fg">
                  {x}
                </button>
              ))}
              <button
                type="button"
                onClick={() => {
                  setRecent([]);
                  saveRecent([]);
                }}
                className="ml-1 text-[11px] text-faint underline-offset-2 hover:text-soft hover:underline"
              >
                clear
              </button>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 font-mono text-[10px] tracking-[0.16em] text-faint uppercase">Try</span>
            {IDEAS.map((x) => (
              <button key={x} type="button" onClick={() => void search(x)} className="rounded-full border border-dashed border-line px-2.5 py-1 text-xs text-soft transition hover:border-data/60 hover:text-data">
                {x}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* results */}
      {results && (
        <div className="mb-3 flex items-baseline justify-between gap-2">
          <p className="text-sm text-soft">
            {results.length ? (
              <>
                <span className="text-fg">{results.length}</span> {results.length === 1 ? "match" : "matches"} for <span className="text-fg">“{asked}”</span>
              </>
            ) : (
              <>
                No close matches for <span className="text-fg">“{asked}”</span>. Try different words.
              </>
            )}
          </p>
          <button type="button" onClick={clear} className="shrink-0 text-xs text-faint hover:text-soft">
            New search
          </button>
        </div>
      )}
      <ul className="list-in space-y-2">
        {results?.map((r) => {
          const k = KIND[r.source_type];
          const pct = Math.round(r.similarity * 100);
          return (
            <li key={r.source_type + r.source_id}>
              <Link href={hrefFor(r)} className="group flex gap-3.5 rounded-xl border border-line bg-panel p-4 transition hover:border-data/50 hover:bg-raised/40">
                <span className={cx("grid size-9 shrink-0 place-items-center rounded-lg border", k.tone)}>
                  <k.icon size={16} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-3">
                    <span className="truncate font-medium group-hover:text-fg">{r.title}</span>
                    <span className="flex shrink-0 items-center gap-2" title={`${pct}% match`}>
                      <span className="h-1 w-14 overflow-hidden rounded-full bg-line">
                        <span className="block h-full rounded-full bg-data" style={{ width: `${Math.max(6, pct)}%` }} />
                      </span>
                      <span className="w-9 text-right font-mono text-[11px] text-soft tabular-nums">{pct}%</span>
                    </span>
                  </span>
                  <span className="mt-1 line-clamp-2 text-sm text-soft">{r.content}</span>
                  <span className="mt-2 flex items-center gap-2 font-mono text-[10px] tracking-wider text-faint uppercase">
                    {k.label} · {fmtDate(r.created_at)}
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>

      {/* nothing asked yet: the latest things saved, a place to start */}
      {!results && latest.length > 0 && (
        <section>
          <h2 className="mb-3 font-mono text-[11px] tracking-[0.2em] text-data uppercase">Recently added</h2>
          <div className="list-in grid gap-2 sm:grid-cols-2">
            {latest.map((x) => {
              const k = KIND[x.kind];
              return (
                <Link key={x.kind + x.id} href={`/${x.kind === "note" ? "notes" : "memories"}?open=${x.id}`} className="group flex gap-3 rounded-xl border border-line bg-panel/70 p-3.5 transition hover:border-data/50">
                  <span className={cx("grid size-8 shrink-0 place-items-center rounded-lg border", k.tone)}>
                    <k.icon size={15} />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{x.title}</span>
                    <span className="mt-0.5 line-clamp-2 text-xs text-soft">{x.text}</span>
                    <span className="mt-1.5 block font-mono text-[10px] tracking-wider text-faint uppercase">
                      {k.label} · {fmtDate(x.at)}
                    </span>
                  </span>
                </Link>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
