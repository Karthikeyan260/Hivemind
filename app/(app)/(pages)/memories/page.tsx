"use client";

import { ChevronDown, GitCommitVertical, Pencil, Plus, Search, Sparkles, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { Holo } from "@/components/bridge/holo";
import { Badge, Button, cx, Empty, ErrorText, Input, PageHeader, ProjectSelect, Select, Textarea } from "@/components/ui";
import { api, fmtDate, type Memory, MEMORY_TYPES, type Project, useFetch } from "@/lib/client-api";

export default function MemoriesPage() {
  return (
    <Suspense>
      <Explorer />
    </Suspense>
  );
}

type Item = {
  id: string;
  title: string;
  snippet: string;
  memory_type: string;
  category: string | null;
  importance: number;
  confidence: number;
  project_id: string | null;
  source: string;
  updated_at: string;
  match?: number;
};
type ListRes = { facets: { total: number; types: Record<string, number>; categories: Record<string, number>; sources: Record<string, number>; projects: Record<string, number> }; items: Item[] };
type Version = { id: string; version_number: number; title: string; content: string; change_reason: string | null; created_at: string };
type TimelineEvent = { at: string; kind: "created" | "edited" | "restored" | "filed" | "updated"; label: string; detail?: string; version?: number };
type Detail = {
  memory: Memory & { metadata: Record<string, unknown>; source: { key: string; label: string; detail?: string }; has_embedding: boolean };
  project: { id: string; name: string; description: string | null } | null;
  versions: Version[];
  current_version: number;
  timeline: TimelineEvent[];
  related: {
    items: { type: string; title: string; snippet: string; href: string; similarity: number }[];
    projects: { id: string; name: string; own: boolean }[];
    skills: { name: string; direct: boolean }[];
  };
};
type Draft = { id: string | null; title: string; content: string; memory_type: string; importance: number; project_id: string | null; change_reason: string };

const blank: Draft = { id: null, title: "", content: "", memory_type: "", importance: 5, project_id: null, change_reason: "" };
const label = (t: string) => t.replace(/_/g, " ");
const SOURCE_NAMES: Record<string, string> = { hivemind: "Saved in HIVEMIND", "portfolio-mcp": "Portfolio MCP import" };

/** Word-level diff (LCS) for the history view; long texts fall back to before/after. */
function diffWords(a: string, b: string) {
  const x = a.split(/(\s+)/);
  const y = b.split(/(\s+)/);
  if (x.length * y.length > 400_000) return null;
  const dp = Array.from({ length: x.length + 1 }, () => new Uint16Array(y.length + 1));
  for (let i = x.length - 1; i >= 0; i--) for (let j = y.length - 1; j >= 0; j--) dp[i][j] = x[i] === y[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: { t: string; k: "same" | "add" | "del" }[] = [];
  let i = 0;
  let j = 0;
  while (i < x.length && j < y.length) {
    if (x[i] === y[j]) {
      out.push({ t: x[i++], k: "same" });
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) out.push({ t: x[i++], k: "del" });
    else out.push({ t: y[j++], k: "add" });
  }
  while (i < x.length) out.push({ t: x[i++], k: "del" });
  while (j < y.length) out.push({ t: y[j++], k: "add" });
  return out;
}

function Diff({ before, after }: { before: string; after: string }) {
  const parts = useMemo(() => diffWords(before, after), [before, after]);
  if (!parts)
    return (
      <div className="grid gap-2 text-[12.5px] sm:grid-cols-2">
        <p className="whitespace-pre-wrap text-alert/80 line-through decoration-alert/40">{before}</p>
        <p className="whitespace-pre-wrap text-ok">{after}</p>
      </div>
    );
  return (
    <p className="whitespace-pre-wrap text-[12.5px] leading-relaxed text-soft">
      {parts.map((p, i) =>
        p.k === "same" ? (
          <span key={i}>{p.t}</span>
        ) : p.k === "add" ? (
          <span key={i} className="bg-ok/15 text-ok">
            {p.t}
          </span>
        ) : (
          <span key={i} className="bg-alert/10 text-alert/80 line-through decoration-alert/50">
            {p.t}
          </span>
        ),
      )}
    </p>
  );
}

function Meter10({ value, tone = "core" }: { value: number; tone?: "core" | "data" }) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex gap-0.5">
        {Array.from({ length: 10 }, (_, i) => (
          <span key={i} className={cx("h-2.5 w-1.5", i < value ? (tone === "core" ? "bg-core" : "bg-data") : "bg-line")} />
        ))}
      </div>
      <span className="font-mono text-[11px] tabular-nums">{value}/10</span>
    </div>
  );
}

function Explorer() {
  const params = useSearchParams();
  const router = useRouter();
  const openId = params.get("open");

  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [filters, setFilters] = useState({ type: "", category: "", project: "", source: "", sort: "" });
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 350);
    return () => clearTimeout(t);
  }, [q]);

  const qs = new URLSearchParams(Object.entries({ q: debounced, ...filters }).filter(([, v]) => v)).toString();
  const list = useFetch<ListRes>(`/api/memories/explore${qs ? `?${qs}` : ""}`);
  const projects = useFetch<Project[]>("/api/projects");
  const detail = useFetch<Detail>(openId ? `/api/memories/${openId}/detail` : null);
  const projectName = (id: string | null) => projects.data?.find((p) => p.id === id)?.name;

  const [draft, setDraft] = useState<Draft | null>(params.get("new") ? blank : null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openVersion, setOpenVersion] = useState<number | null>(null);

  const open = (id: string) => {
    setDraft(null);
    setOpenVersion(null);
    router.replace(`/memories?open=${id}`);
  };

  function edit() {
    const m = detail.data?.memory;
    if (m) setDraft({ id: m.id, title: m.title, content: m.content, memory_type: m.memory_type, importance: m.importance, project_id: m.project_id, change_reason: "" });
  }

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
      setDraft(null);
      router.replace(`/memories?open=${saved.id}`);
      list.reload();
      detail.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function restore(v: Version) {
    if (!openId || !confirm(`Restore version ${v.version_number}? The current text is kept in history.`)) return;
    await api(`/api/memories/${openId}/versions`, { method: "POST", json: { version_id: v.id } });
    list.reload();
    detail.reload();
  }

  async function remove() {
    if (!openId || !confirm("Delete this memory and its history permanently?")) return;
    await api(`/api/memories/${openId}`, { method: "DELETE" });
    router.replace("/memories");
    list.reload();
  }

  const f = list.data?.facets;
  const setF = (k: keyof typeof filters) => (e: React.ChangeEvent<HTMLSelectElement>) => setFilters({ ...filters, [k]: e.target.value });
  const active = Object.values(filters).some(Boolean) || !!debounced;
  const d = detail.data;

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        eyebrow="Memory"
        title="Memory Explorer"
        subtitle="Everything HIVEMIND has stored about you. Search by meaning or words, then open a memory to see where it came from, how it changed, and what it connects to."
        actions={
          <Button onClick={() => { setDraft(blank); router.replace("/memories"); }}>
            <Plus size={15} /> New memory
          </Button>
        }
      />

      {/* Search + filters */}
      <div className="mb-5 space-y-2">
        <div className="relative">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search your memories… e.g. “Python”, “what did I learn about RAG”" className="pl-9" />
          {q && (
            <button type="button" onClick={() => setQ("")} aria-label="Clear search" className="absolute right-3 top-1/2 -translate-y-1/2 text-faint hover:text-fg">
              <X size={14} />
            </button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={filters.type} onChange={setF("type")}>
            <option value="">All types</option>
            {MEMORY_TYPES.map((t) => (
              <option key={t} value={t}>
                {label(t)} {f?.types[t] ? `(${f.types[t]})` : ""}
              </option>
            ))}
          </Select>
          <Select value={filters.category} onChange={setF("category")}>
            <option value="">All categories</option>
            {Object.entries(f?.categories ?? {})
              .sort((a, b) => b[1] - a[1])
              .map(([c, n]) => (
                <option key={c} value={c}>
                  {c} ({n})
                </option>
              ))}
          </Select>
          <Select value={filters.project} onChange={setF("project")}>
            <option value="">All projects</option>
            <option value="none">No project</option>
            {(projects.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} {f?.projects[p.id] ? `(${f.projects[p.id]})` : ""}
              </option>
            ))}
          </Select>
          <Select value={filters.source} onChange={setF("source")}>
            <option value="">All sources</option>
            {Object.entries(f?.sources ?? {}).map(([s, n]) => (
              <option key={s} value={s}>
                {SOURCE_NAMES[s] ?? s} ({n})
              </option>
            ))}
          </Select>
          <Select value={filters.sort} onChange={setF("sort")}>
            <option value="">{debounced ? "Sort: best match" : "Sort: recently updated"}</option>
            <option value="updated">Recently updated</option>
            <option value="created">Newest first</option>
            <option value="importance">Most important</option>
            <option value="confidence">Most confident</option>
          </Select>
          {active && (
            <button type="button" onClick={() => { setQ(""); setFilters({ type: "", category: "", project: "", source: "", sort: "" }); }} className="font-mono text-[10px] tracking-widest text-soft hover:text-core">
              RESET
            </button>
          )}
          <span className="ml-auto font-mono text-[11px] text-faint">
            {list.data ? `${list.data.items.length} of ${f?.total ?? 0} memories` : "…"}
          </span>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[380px_minmax(0,1fr)]">
        {/* List */}
        <div className="lg:max-h-[calc(100vh-15rem)] lg:overflow-y-auto lg:pr-1">
          <ErrorText error={list.error} />
          {list.loading && !list.data ? (
            <p className="font-mono text-[11px] text-faint">SCANNING…</p>
          ) : !list.data?.items.length ? (
            <Empty>{active ? "No memories match. Try other words or clear the filters." : "No memories yet. Say “remember that …” to HIVEMIND."}</Empty>
          ) : (
            <ul className="space-y-1.5">
              {list.data.items.map((m) => (
                <li key={m.id}>
                  <button
                    type="button"
                    onClick={() => open(m.id)}
                    className={cx(
                      "w-full border p-3 text-left transition-colors",
                      openId === m.id ? "border-core/60 bg-core/10" : "border-line hover:border-line-strong",
                    )}
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-[13.5px] font-medium">{m.title}</span>
                      {m.match !== undefined && <span className="shrink-0 font-mono text-[10px] text-data">{m.match}%</span>}
                    </div>
                    <p className="mt-0.5 line-clamp-2 text-[12px] text-soft">{m.snippet}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-1">
                      <Badge tone="accent">{label(m.memory_type)}</Badge>
                      {m.category && <Badge>{m.category}</Badge>}
                      {projectName(m.project_id) && <Badge tone="data">{projectName(m.project_id)}</Badge>}
                      <span className="ml-auto flex items-center gap-0.5" title={`Importance ${m.importance}/10`}>
                        {Array.from({ length: 5 }, (_, i) => (
                          <span key={i} className={cx("h-1.5 w-1.5", i < Math.round(m.importance / 2) ? "bg-core" : "bg-line")} />
                        ))}
                      </span>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Detail / editor */}
        {draft ? (
          <Holo title={draft.id ? "Edit memory" : "New memory"} tone="core">
            <div className="space-y-3 p-5">
              <Input placeholder="Title (optional)" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
              <Textarea rows={9} placeholder="What should your brain remember?" value={draft.content} onChange={(e) => setDraft({ ...draft, content: e.target.value })} />
              <div className="flex flex-wrap items-center gap-3">
                <Select value={draft.memory_type} onChange={(e) => setDraft({ ...draft, memory_type: e.target.value })}>
                  <option value="">{draft.id ? "Type" : "Type: let AI decide"}</option>
                  {MEMORY_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {label(t)}
                    </option>
                  ))}
                </Select>
                <label className="flex items-center gap-2 text-sm text-soft">
                  Importance
                  <input type="range" min={1} max={10} value={draft.importance} onChange={(e) => setDraft({ ...draft, importance: +e.target.value })} />
                  <span className="w-5 tabular-nums text-fg">{draft.importance}</span>
                </label>
                <ProjectSelect projects={projects.data} value={draft.project_id} onChange={(v) => setDraft({ ...draft, project_id: v })} />
              </div>
              {draft.id && <Input placeholder="Why are you changing it? (saved in history)" value={draft.change_reason} onChange={(e) => setDraft({ ...draft, change_reason: e.target.value })} />}
              <div className="flex gap-2">
                <Button onClick={save} disabled={busy || !draft.content.trim()}>
                  {busy ? "Saving…" : "Save"}
                </Button>
                <Button variant="quiet" onClick={() => setDraft(null)}>
                  Cancel
                </Button>
              </div>
              <ErrorText error={error} />
            </div>
          </Holo>
        ) : !openId ? (
          <Empty>Select a memory to see its source, history and connections, or create a new one.</Empty>
        ) : !d ? (
          <p className="font-mono text-[11px] text-faint">{detail.error ?? "LOADING MEMORY…"}</p>
        ) : (
          <div className="space-y-4">
            <Holo
              title={d.memory.title}
              tone="core"
              right={
                <div className="flex items-center gap-3">
                  <button type="button" onClick={edit} className="flex items-center gap-1 font-mono text-[10px] tracking-widest text-soft hover:text-core">
                    <Pencil size={12} /> EDIT
                  </button>
                  <button type="button" onClick={remove} className="flex items-center gap-1 font-mono text-[10px] tracking-widest text-soft hover:text-alert">
                    <Trash2 size={12} /> DELETE
                  </button>
                </div>
              }
            >
              <p className="whitespace-pre-wrap p-5 text-[14.5px] leading-relaxed">{d.memory.content}</p>
              <dl className="grid gap-x-6 gap-y-3 border-t border-data/15 p-5 text-[13px] sm:grid-cols-2 xl:grid-cols-3">
                <div>
                  <dt className="hud-label mb-1">Type</dt>
                  <dd>
                    <Badge tone="accent">{label(d.memory.memory_type)}</Badge>
                  </dd>
                </div>
                <div>
                  <dt className="hud-label mb-1">Category</dt>
                  <dd>{d.memory.category ?? <span className="text-faint">none</span>}</dd>
                </div>
                <div>
                  <dt className="hud-label mb-1">Project</dt>
                  <dd>
                    {d.project ? (
                      <Link href={`/projects/${d.project.id}`} className="text-data hover:underline">
                        {d.project.name}
                      </Link>
                    ) : (
                      <span className="text-faint">not filed</span>
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="hud-label mb-1">Importance</dt>
                  <dd>
                    <Meter10 value={d.memory.importance} />
                  </dd>
                </div>
                <div>
                  <dt className="hud-label mb-1">Confidence</dt>
                  <dd className="flex items-center gap-2">
                    <div className="h-1.5 w-24 bg-line">
                      <div className="h-full bg-data" style={{ width: `${Math.round(d.memory.confidence * 100)}%` }} />
                    </div>
                    <span className="font-mono text-[11px]">{Math.round(d.memory.confidence * 100)}%</span>
                  </dd>
                </div>
                <div>
                  <dt className="hud-label mb-1">Source</dt>
                  <dd>
                    {d.memory.source.label}
                    {d.memory.source.detail && <span className="text-soft"> · {d.memory.source.detail}</span>}
                  </dd>
                </div>
                <div>
                  <dt className="hud-label mb-1">Created</dt>
                  <dd className="font-mono text-[12px]">{fmtDate(d.memory.created_at)}</dd>
                </div>
                <div>
                  <dt className="hud-label mb-1">Last changed</dt>
                  <dd className="font-mono text-[12px]">{fmtDate(d.memory.updated_at)}</dd>
                </div>
                <div>
                  <dt className="hud-label mb-1">Version</dt>
                  <dd className="font-mono text-[12px]">
                    v{d.current_version}
                    {!d.memory.has_embedding && <span className="ml-2 text-alert">not searchable yet</span>}
                  </dd>
                </div>
                {d.memory.tags?.length ? (
                  <div className="sm:col-span-2 xl:col-span-3">
                    <dt className="hud-label mb-1">Tags</dt>
                    <dd className="flex flex-wrap gap-1">
                      {d.memory.tags.map((t) => (
                        <Badge key={t}>{t}</Badge>
                      ))}
                    </dd>
                  </div>
                ) : null}
              </dl>
            </Holo>

            <div className="grid gap-4 xl:grid-cols-2">
              {/* History */}
              <Holo title={`History · ${d.timeline.length} events`}>
                <ol className="relative space-y-4 p-5 pl-9">
                  <span className="absolute bottom-6 left-[1.35rem] top-6 w-px bg-data/25" aria-hidden />
                  {d.timeline.map((e, i) => {
                    const v = e.version ? d.versions.find((x) => x.version_number === e.version) : undefined;
                    const next = v ? (d.versions.find((x) => x.version_number === v.version_number + 1)?.content ?? d.memory.content) : "";
                    const expanded = openVersion === e.version && !!v;
                    return (
                      <li key={i} className="relative">
                        <GitCommitVertical
                          size={16}
                          className={cx("absolute -left-[1.45rem] top-0.5", e.kind === "created" ? "text-core" : e.kind === "filed" ? "text-data" : "text-violet-300")}
                        />
                        <div className="flex items-baseline justify-between gap-3">
                          <span className="text-[13px] font-medium">{e.label}</span>
                          <span className="shrink-0 font-mono text-[10.5px] text-faint">{fmtDate(e.at)}</span>
                        </div>
                        {e.detail && <p className="text-[12px] text-soft">{e.detail}</p>}
                        {v && (
                          <div className="mt-1.5">
                            <div className="flex items-center gap-3">
                              <button type="button" onClick={() => setOpenVersion(expanded ? null : v.version_number)} className="flex items-center gap-1 font-mono text-[10px] tracking-widest text-soft hover:text-data">
                                <ChevronDown size={12} className={cx("transition-transform", expanded && "rotate-180")} /> {expanded ? "HIDE CHANGES" : "SHOW CHANGES"}
                              </button>
                              <button type="button" onClick={() => restore(v)} className="font-mono text-[10px] tracking-widest text-soft hover:text-core">
                                RESTORE PREVIOUS
                              </button>
                            </div>
                            {expanded && (
                              <div className="mt-2 border border-line bg-sunken/50 p-3">
                                {v.title !== (d.versions.find((x) => x.version_number === v.version_number + 1)?.title ?? d.memory.title) && (
                                  <p className="mb-1.5 font-mono text-[11px] text-soft">
                                    Title: <span className="text-alert/80 line-through">{v.title}</span>
                                  </p>
                                )}
                                <Diff before={v.content} after={next} />
                              </div>
                            )}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ol>
              </Holo>

              {/* Connections */}
              <Holo title="Connections">
                <div className="space-y-4 p-5">
                  <div>
                    <div className="hud-label mb-1.5">Projects</div>
                    {d.related.projects.length ? (
                      <div className="flex flex-wrap gap-1.5">
                        {d.related.projects.map((p) => (
                          <Link
                            key={p.id}
                            href={`/projects/${p.id}`}
                            className={cx("border px-2 py-0.5 font-mono text-[11px]", p.own ? "border-core/60 text-core" : "border-data/30 text-soft hover:border-data hover:text-data")}
                          >
                            {p.name}
                            {p.own && " · filed here"}
                          </Link>
                        ))}
                      </div>
                    ) : (
                      <p className="text-[12.5px] text-faint">No linked projects.</p>
                    )}
                  </div>
                  <div>
                    <div className="hud-label mb-1.5">Skills</div>
                    {d.related.skills.length ? (
                      <div className="flex flex-wrap gap-1.5">
                        {d.related.skills.map((s) => (
                          <span
                            key={s.name}
                            title={s.direct ? "Mentioned in this memory" : "Mentioned in related memories"}
                            className={cx("px-1.5 py-0.5 font-mono text-[10.5px] uppercase tracking-wider", s.direct ? "bg-ok/10 text-ok" : "bg-data/10 text-data/80")}
                          >
                            {s.name}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <p className="text-[12.5px] text-faint">No skills from your skills list are mentioned.</p>
                    )}
                  </div>
                  <div>
                    <div className="hud-label mb-1.5 flex items-center gap-1.5">
                      <Sparkles size={11} /> Related by meaning
                    </div>
                    {d.related.items.length ? (
                      <ul className="space-y-1.5">
                        {d.related.items.map((r) => {
                          const memId = r.type === "memory" ? r.href.split("open=")[1] : null;
                          const inner = (
                            <>
                              <div className="flex items-baseline justify-between gap-2">
                                <span className="truncate text-[12.5px] font-medium">{r.title}</span>
                                <span className="shrink-0 font-mono text-[10px] text-data">{r.similarity}%</span>
                              </div>
                              <div className="mt-1 h-0.5 bg-line">
                                <div className="h-full bg-data/70" style={{ width: `${r.similarity}%` }} />
                              </div>
                              <div className="mt-1 font-mono text-[10px] uppercase tracking-wider text-faint">{r.type}</div>
                            </>
                          );
                          return (
                            <li key={r.href}>
                              {memId ? (
                                <button type="button" onClick={() => open(memId)} className="block w-full border border-line p-2 text-left hover:border-data/50">
                                  {inner}
                                </button>
                              ) : (
                                <Link href={r.href} className="block border border-line p-2 hover:border-data/50">
                                  {inner}
                                </Link>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    ) : (
                      <p className="text-[12.5px] text-faint">Nothing closely related yet.</p>
                    )}
                  </div>
                </div>
              </Holo>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
