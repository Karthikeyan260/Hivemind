"use client";

import { Wand2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Badge, Button, cx, Empty, ErrorText, Input, PageHeader, Skeleton } from "@/components/ui";
import { api, type Brain, useFetch } from "@/lib/client-api";

const STATUS_DOT: Record<string, string> = { active: "bg-ok", paused: "bg-core", done: "bg-faint" };
const FILTERS = ["all", "active", "paused", "done"] as const;

export default function ProjectsPage() {
  const brain = useFetch<Brain>("/api/brain");
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("all");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy("create");
    setError(null);
    try {
      await api("/api/projects", { method: "POST", json: { name } });
      setName("");
      brain.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function organize() {
    setBusy("organize");
    setMsg(null);
    try {
      const r = await api<{ scanned: number; filed: number; created: number }>("/api/brain", { method: "POST", json: { action: "organize" } });
      setMsg(`Scanned ${r.scanned} unfiled items, filed ${r.filed}, created ${r.created} new projects.`);
      brain.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  const projects = (brain.data?.projects ?? []).filter((p) => filter === "all" || p.status === filter);

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        eyebrow="Workspaces"
        title="Projects"
        subtitle="HIVEMIND creates these from your portfolio and from what you save, then files related memories, notes and documents into them."
        actions={
          <Button variant="ghost" onClick={organize} disabled={!!busy}>
            <Wand2 size={15} /> {busy === "organize" ? "Organizing…" : "Organize unfiled items"}
          </Button>
        }
      />
      {msg && <p className="mb-4 text-sm text-data">{msg}</p>}
      <ErrorText error={error ?? brain.error} />

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1" role="tablist" aria-label="Filter by status">
          {FILTERS.map((f) => (
            <button
              key={f}
              role="tab"
              aria-selected={filter === f}
              onClick={() => setFilter(f)}
              className={cx("rounded-md px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider", filter === f ? "bg-raised text-fg" : "text-faint hover:text-soft")}
            >
              {f}
            </button>
          ))}
        </div>
        <form onSubmit={create} className="flex gap-2">
          <Input placeholder="New project name" required value={name} onChange={(e) => setName(e.target.value)} className="w-56" />
          <Button type="submit" disabled={!!busy || !name.trim()}>Create</Button>
        </form>
      </div>

      {!brain.data ? (
        <Skeleton lines={6} />
      ) : projects.length === 0 ? (
        <Empty>
          {brain.data.projects.length === 0 ? (
            <>
              No projects yet. <Link href="/sources" className="text-data hover:underline">Sync your portfolio</Link> or tell HIVEMIND “start a project called …”.
            </>
          ) : (
            "No projects with this status."
          )}
        </Empty>
      ) : (
        <ul className="divide-y divide-line border-y border-line">
          {projects.map((p) => (
            <li key={p.id}>
              <Link href={`/projects/${p.id}`} className="group grid grid-cols-[auto_1fr_auto] items-center gap-x-4 gap-y-1 px-2 py-4 hover:bg-raised/50 sm:grid-cols-[auto_1fr_auto_auto]">
                <span className={cx("h-2 w-2 rounded-full", STATUS_DOT[p.status] ?? "bg-faint")} aria-label={p.status} />
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium group-hover:text-core">{p.name}</span>
                    {p.metadata?.auto && <Badge tone="core">auto</Badge>}
                    {p.metadata?.cluster && <span className="hidden font-mono text-[10.5px] text-faint sm:inline">{p.metadata.cluster}</span>}
                  </div>
                  {p.description && <p className="mt-0.5 line-clamp-1 text-sm text-soft">{p.description}</p>}
                </div>
                <span className="hidden font-mono text-[11px] text-faint sm:block">{p.metadata?.year ?? ""}</span>
                <span className="font-mono text-xs tabular-nums text-data">{p.items} items</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
