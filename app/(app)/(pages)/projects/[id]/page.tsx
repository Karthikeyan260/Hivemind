"use client";

import { ArrowLeft, ChevronRight, MessageSquare, Pencil } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { Badge, Button, Empty, ErrorText, PageHeader, Select, Skeleton, Textarea } from "@/components/ui";
import { api, fmtDate, useFetch } from "@/lib/client-api";

type Detail = {
  id: string;
  name: string;
  description: string | null;
  status: string;
  metadata: { auto?: boolean; source?: string; cluster?: string | null; year?: number | null; reason?: string };
  created_at: string;
  memories: { id: string; title: string; content: string; memory_type: string; updated_at: string }[];
  notes: { id: string; title: string; summary: string | null; updated_at: string }[];
  documents: { id: string; filename: string; summary: string | null; chunk_count: number; created_at: string }[];
};

export default function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const project = useFetch<Detail>(`/api/projects/${id}`);
  const [editing, setEditing] = useState(false);
  const [desc, setDesc] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function update(body: object) {
    setError(null);
    try {
      await api(`/api/projects/${id}`, { method: "PUT", json: body });
      project.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function remove() {
    if (!confirm("Delete this project? Items filed under it are kept, just unfiled.")) return;
    await api(`/api/projects/${id}`, { method: "DELETE" });
    router.replace("/projects");
  }

  const p = project.data;
  if (!p) {
    return (
      <div className="mx-auto max-w-4xl">
        <ErrorText error={project.error} />
        {!project.error && <Skeleton lines={6} />}
      </div>
    );
  }
  const total = p.memories.length + p.notes.length + p.documents.length;

  return (
    <div className="mx-auto max-w-4xl">
      <Link href="/projects" className="-ml-2 mb-4 inline-flex h-10 items-center gap-1.5 rounded-md px-2 text-sm text-soft transition-colors hover:bg-raised hover:text-fg">
        <ArrowLeft size={14} /> Projects
      </Link>
      <PageHeader
        eyebrow={[p.metadata.source === "portfolio-mcp" ? "From portfolio" : p.metadata.auto ? "Created by HIVEMIND" : "Project", p.metadata.cluster, p.metadata.year]
          .filter(Boolean)
          .join(" · ")}
        title={p.name}
        actions={
          <>
            <Select value={p.status} onChange={(e) => update({ status: e.target.value })} aria-label="Status">
              <option value="active">Active</option>
              <option value="paused">Paused</option>
              <option value="done">Done</option>
            </Select>
            <Link href={`/?project=${p.id}`} className="inline-flex h-9 items-center gap-2 rounded-md bg-core px-3.5 text-sm font-medium text-core-ink hover:bg-core/85">
              <MessageSquare size={15} /> Ask about this
            </Link>
          </>
        }
      />
      <ErrorText error={error} />

      <section className="mb-10">
        {editing ? (
          <div className="space-y-2">
            <Textarea rows={4} value={desc} onChange={(e) => setDesc(e.target.value)} />
            <div className="flex gap-2">
              <Button size="sm" onClick={() => (update({ description: desc }), setEditing(false))}>Save</Button>
              <Button size="sm" variant="quiet" onClick={() => setEditing(false)}>Cancel</Button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => (setDesc(p.description ?? ""), setEditing(true))}
            title="Edit the description"
            className="group max-w-[65ch] text-left text-[15px] leading-relaxed text-soft hover:text-fg"
          >
            {p.description || "Add a description…"}
            {/* it's editable: say so (it looked like plain text) */}
            <Pencil size={13} className="ml-1.5 inline -translate-y-px text-faint opacity-60 transition-opacity group-hover:opacity-100" aria-hidden />
          </button>
        )}
        {p.metadata.reason && <p className="mt-2 font-mono text-[11px] text-faint">HIVEMIND created this {p.metadata.reason}</p>}
      </section>

      <div className="hud-label mb-4">Filed here · {total}</div>
      {total === 0 ? (
        <Empty>Nothing filed yet. Save a memory or note about {p.name} and HIVEMIND will file it here.</Empty>
      ) : (
        <div className="space-y-10">
          {p.memories.length > 0 && (
            <Group title="Memories">
              {p.memories.map((m) => (
                <Row
                  key={m.id}
                  href={`/memories?open=${m.id}`}
                  title={m.title}
                  // a type badge only when they differ (all "project context" here said nothing)
                  meta={new Set(p.memories.map((x) => x.memory_type)).size > 1 ? <Badge>{m.memory_type.replace("_", " ")}</Badge> : null}
                  body={preview(m.content)}
                />
              ))}
            </Group>
          )}
          {p.notes.length > 0 && (
            <Group title="Notes">
              {p.notes.map((n) => (
                <Row key={n.id} href={`/notes?open=${n.id}`} title={n.title} meta={<span className="font-mono text-[11px] text-faint">{fmtDate(n.updated_at)}</span>} body={n.summary ?? ""} />
              ))}
            </Group>
          )}
          {p.documents.length > 0 && (
            <Group title="Documents">
              {p.documents.map((d) => (
                <Row key={d.id} href={`/documents?open=${d.id}`} title={d.filename} meta={<Badge tone="data">{d.chunk_count} chunks</Badge>} body={d.summary ?? ""} />
              ))}
            </Group>
          )}
        </div>
      )}

      <div className="mt-16 border-t border-line pt-6">
        <Button variant="danger" size="sm" onClick={remove}>Delete project</Button>
      </div>
    </div>
  );
}

/**
 * Portfolio imports store a "Name: … Cluster: … Year: … Mission: …" dump. The page already shows the
 * name, cluster and year, so preview the Mission line when there is one; anything else is shown as is.
 */
function preview(content: string) {
  const mission = /\bMission:\s*([\s\S]+?)(?=\s+[A-Z][A-Za-z ]{1,20}:\s|$)/.exec(content);
  return mission ? mission[1].trim() : content;
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 px-1 text-sm font-semibold">{title}</h2>
      <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-raised">{children}</ul>
    </section>
  );
}

function Row({ href, title, meta, body }: { href: string; title: string; meta: React.ReactNode; body: string }) {
  return (
    <li>
      <Link href={href} className="group flex items-start gap-3 px-4 py-3 transition-colors duration-150 hover:bg-sunken/60">
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <span className="truncate text-sm font-medium group-hover:text-core">{title}</span>
            {meta}
          </div>
          {body && <p className="mt-1 line-clamp-2 text-sm leading-relaxed text-soft">{body}</p>}
        </div>
        <ChevronRight size={16} className="mt-0.5 shrink-0 text-faint transition-transform duration-150 group-hover:translate-x-0.5" aria-hidden />
      </Link>
    </li>
  );
}
