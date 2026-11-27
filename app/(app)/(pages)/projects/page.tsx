"use client";

import dynamic from "next/dynamic";
import { ChevronRight, Film, List, Plus, Wand2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useVoiceActions } from "@/components/voice/provider";
import type { Evolution } from "@/lib/evolution";
import { Badge, Button, cx, Empty, ErrorText, Input, PageHeader, Skeleton } from "@/components/ui";
import { api, type Brain, useFetch } from "@/lib/client-api";

// The 3D showcase (three.js) loads only on this page.
const ProjectReel = dynamic(() => import("@/components/projects/reel").then((m) => m.ProjectReel), {
  ssr: false,
  // While the 3D code downloads, the reel's own frame (not a blank page).
  loading: () => <div className="grid h-[74dvh] min-h-[460px] place-items-center rounded-3xl border border-white/10 font-mono text-[11px] tracking-[0.3em] text-data">LOADING YOUR WORK…</div>,
});

const STATUS_DOT: Record<string, string> = { active: "bg-ok", paused: "bg-core", done: "bg-faint" };
const FILTERS = ["all", "active", "paused", "done"] as const;
const itemsLabel = (n: number) => (n === 1 ? "1 item" : `${n} items`);

export default function ProjectsPage() {
  const router = useRouter();
  const brain = useFetch<Brain>("/api/brain");
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("all");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"reel" | "list">("reel");
  const evolution = useFetch<Evolution>(view === "reel" ? "/api/projects/evolution" : null);

  // Remember the last view on this device.
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- restore the saved view once
      if (localStorage.getItem("projects-view") === "list") setView("list");
    } catch {}
  }, []);
  const switchView = (v: "reel" | "list") => {
    setView(v);
    try {
      localStorage.setItem("projects-view", v);
    } catch {}
  };

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy("create");
    setError(null);
    try {
      await api("/api/projects", { method: "POST", json: { name } });
      setName("");
      setAdding(false);
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
  const [adding, setAdding] = useState(false);
  const counts = Object.fromEntries(FILTERS.map((f) => [f, (brain.data?.projects ?? []).filter((p) => f === "all" || p.status === f).length])) as Record<(typeof FILTERS)[number], number>;
  // by portfolio cluster, biggest group first; projects without one go last under "Other"
  const groups = Object.entries(
    projects.reduce<Record<string, typeof projects>>((m, p) => {
      const k = p.metadata?.cluster || "Other";
      (m[k] ??= []).push(p);
      return m;
    }, {}),
  ).sort((a, b) => (a[0] === "Other" ? 1 : b[0] === "Other" ? -1 : b[1].length - a[1].length));

  // Voice: everything on this page (the 3D reel registers its own show/tour/demo actions).
  useVoiceActions({
    projects_view: {
      description: "Projects page: switch between the 3D Showcase reel and the List. input: 'showcase' or 'list'. Switch to showcase before using show_project / tour actions.",
      run: ({ input }) => {
        const v = /list/i.test(String(input ?? "")) ? "list" : "reel";
        switchView(v);
        return { view: v === "reel" ? "showcase" : "list" };
      },
    },
    projects_filter: {
      description: `Projects page: show only some projects in the List. input: one of ${FILTERS.join(", ")}.`,
      run: ({ input }) => {
        const f = FILTERS.find((x) => String(input ?? "").toLowerCase().includes(x)) ?? "all";
        switchView("list");
        setFilter(f);
        const n = (brain.data?.projects ?? []).filter((p) => f === "all" || p.status === f);
        return { filter: f, projects: n.map((p) => p.name) };
      },
    },
    organize_projects: {
      description: "Projects page: file unfiled memories, notes and documents into projects (creates projects where needed). Takes a few seconds.",
      run: async () => {
        await organize();
        return { done: true };
      },
    },
    open_project_page: {
      description: "Projects page: open a project's own page (its memories, notes, documents, edit and delete). input: project name.",
      run: ({ input }) => {
        const q = String(input ?? "").toLowerCase();
        const p = (brain.data?.projects ?? []).find((x) => x.name.toLowerCase().includes(q));
        if (!p) return { error: `No project "${input}".`, projects: (brain.data?.projects ?? []).map((x) => x.name) };
        router.push(`/projects/${p.id}`);
        return { opened: p.name };
      },
    },
  });

  return (
    <div className="mx-auto max-w-6xl">
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

      <div className="mb-5 flex gap-1" role="tablist" aria-label="View">
        {(
          [
            ["reel", "Showcase", Film],
            ["list", "List", List],
          ] as const
        ).map(([v, label, Icon]) => (
          <button
            key={v}
            role="tab"
            aria-selected={view === v}
            onClick={() => switchView(v)}
            className={cx("flex h-10 items-center gap-1.5 border px-4 font-mono text-[11.5px] uppercase tracking-wider transition-colors", view === v ? "border-core bg-core/15 text-core" : "border-line text-soft hover:text-fg")}
          >
            <Icon size={13} /> {label}
          </button>
        ))}
      </div>

      {view === "reel" ? (
        evolution.error ? (
          <ErrorText error={evolution.error} />
        ) : !evolution.data ? (
          <Skeleton lines={8} />
        ) : (
          <ProjectReel data={evolution.data} />
        )
      ) : (
      <>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1 rounded-lg bg-sunken p-1" role="tablist" aria-label="Filter by status">
          {FILTERS.map((f) => (
            <button
              key={f}
              role="tab"
              aria-selected={filter === f}
              onClick={() => setFilter(f)}
              className={cx(
                "flex h-8 items-center gap-1.5 rounded-md px-3 text-[13px] capitalize transition-colors pointer-coarse:h-10",
                filter === f ? "bg-raised font-medium text-fg shadow-sm" : "text-soft hover:text-fg",
              )}
            >
              {f}
              <span className="text-[11px] text-faint tabular-nums">{counts[f]}</span>
            </button>
          ))}
        </div>
        {adding ? (
          <form onSubmit={create} className="flex w-full gap-2 sm:w-auto">
            <Input autoFocus placeholder="New project name" required value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Escape" && setAdding(false)} className="min-w-0 flex-1 sm:w-56" />
            <Button type="submit" disabled={!!busy || !name.trim()}>
              Create
            </Button>
            <Button type="button" variant="quiet" onClick={() => setAdding(false)}>
              Cancel
            </Button>
          </form>
        ) : (
          <Button type="button" variant="ghost" onClick={() => setAdding(true)}>
            <Plus size={15} /> New project
          </Button>
        )}
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
        // grouped by the portfolio's own clusters (Algorithmic Play, LLM & Agents…), biggest first
        <div className="space-y-7">
          {groups.map(([cluster, list]) => (
            <section key={cluster} aria-label={cluster}>
              <h2 className="mb-2 flex items-baseline gap-2 px-1 text-sm font-medium text-soft">
                {cluster} <span className="text-xs text-faint tabular-nums">{list.length}</span>
              </h2>
              <ul className="list-in divide-y divide-line overflow-hidden rounded-xl border border-line bg-raised">
                {list.map((p) => (
                  <li key={p.id}>
                    <Link href={`/projects/${p.id}`} className="group flex items-start gap-3 px-4 py-3.5 transition-colors duration-150 hover:bg-sunken/60">
                      <span className={cx("mt-[7px] size-2 shrink-0 rounded-full", STATUS_DOT[p.status] ?? "bg-faint")} aria-hidden />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="font-medium group-hover:text-core">{p.name}</span>
                          {p.status !== "active" && <span className={cx("rounded-full px-2 py-px text-[11px] capitalize", p.status === "paused" ? "bg-core/12 text-core" : "bg-sunken text-soft")}>{p.status}</span>}
                          {p.metadata?.auto && <Badge tone="core">auto</Badge>}
                        </div>
                        {p.description && <p className="mt-0.5 line-clamp-2 text-sm leading-relaxed text-soft sm:line-clamp-1">{p.description}</p>}
                        <p className="mt-1 text-xs text-faint tabular-nums sm:hidden">
                          {[p.metadata?.year, itemsLabel(p.items)].filter(Boolean).join(" · ")}
                        </p>
                      </div>
                      <span className="hidden shrink-0 pt-0.5 text-right text-xs text-faint tabular-nums sm:block">
                        <span className={p.items ? "text-data" : ""}>{itemsLabel(p.items)}</span>
                        {p.metadata?.year && <span className="block">{p.metadata.year}</span>}
                      </span>
                      <ChevronRight size={16} className="mt-0.5 shrink-0 text-faint transition-transform duration-150 group-hover:translate-x-0.5" aria-hidden />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
      </>
      )}
    </div>
  );
}
