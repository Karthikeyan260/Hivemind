import "server-only";
import { logActivity } from "@/lib/activity";
import { dbError, toVector } from "@/lib/api";
import { CAREER_SOURCE } from "@/lib/career";
import { createMemory, createNote, deleteMemory, updateMemory } from "@/lib/knowledge";
import { embedOne } from "@/lib/ai/embeddings";
import { extractMetadata } from "@/lib/ai/metadata";
import { originOf } from "@/lib/origin";
import { searchKnowledge, sourceHref } from "@/lib/rag/retrieval";
import { cite, findNote, findProject, lastReply, obj, S, str } from "./shared";
import type { Tool } from "../types";

/** Knowledge, memories, notes, documents and projects. */
export const brain: Record<string, Tool> = {
  /* ───── knowledge (RAG) ───── */
  search_brain: {
    name: "search_brain",
    description: "Semantic search over the owner's memories, notes, documents and resume. Returns numbered results to cite as [n].",
    parameters: obj({ query: S }, ["query"]),
    async run(args, ctx) {
      const hits = await searchKnowledge(ctx.supabase, str(args.query), { projectId: ctx.projectId, limit: 8 });
      const ns = cite(
        ctx,
        hits.map((h) => ({ type: h.source_type, title: h.title, href: sourceHref(h), similarity: Math.round(h.similarity * 100) / 100 })),
      );
      if (!hits.length) return { results: [], note: "Nothing relevant in the brain." };
      return { results: hits.map((h, i) => ({ cite: `[${ns[i]}]`, type: h.source_type, title: h.title, content: h.content.slice(0, 1500) })) };
    },
  },

  /* ───── memory ───── */
  remember: {
    name: "remember",
    description: "Save a new memory (fact, idea, decision, preference) exactly as the owner stated it. It is filed into the right project automatically.",
    parameters: obj({ content: S }, ["content"]),
    async run(args, ctx) {
      const m = await createMemory(ctx.supabase, { content: str(args.content), project_id: ctx.projectId });
      ctx.changed = true;
      ctx.actions.push({ label: "Open memory", href: `/memories?open=${m!.id}` });
      return { saved: true, title: m!.title, type: m!.memory_type };
    },
  },
  update_memory: {
    name: "update_memory",
    description: "Correct or update an existing memory. Finds the closest memory to 'which' and replaces its content with 'new_content'.",
    parameters: obj({ which: S, new_content: S }, ["which", "new_content"]),
    async run(args, ctx) {
      const hits = (await searchKnowledge(ctx.supabase, str(args.which), { limit: 5 })).filter((h) => h.source_type === "memory");
      const target = hits[0];
      if (!target) return { error: "No matching memory found." };
      const m = await updateMemory(ctx.supabase, target.parent_id, { content: str(args.new_content), change_reason: "Updated by the owner via chat" });
      ctx.changed = true;
      ctx.actions.push({ label: "Open memory", href: `/memories?open=${target.parent_id}` });
      return { updated: true, title: (m as { title?: string } | null)?.title ?? target.title };
    },
  },
  delete_memory: {
    name: "delete_memory",
    description:
      "Step 1 of deleting a memory ('forget…', 'delete the memory about…'): finds the closest memory to 'which' and asks the owner to confirm. It does NOT delete anything by itself.",
    parameters: obj({ which: S }, ["which"]),
    async run(args, ctx) {
      const hits = (await searchKnowledge(ctx.supabase, str(args.which), { limit: 8, minSimilarity: 0.3 })).filter((h) => h.source_type === "memory");
      const seen = new Set<string>();
      const memories = hits.filter((h) => (seen.has(h.parent_id) ? false : (seen.add(h.parent_id), true)));
      const target = memories[0];
      if (!target) return { error: "No matching memory found." };
      ctx.pendingDelete = { id: target.parent_id, title: target.title };
      ctx.actions.push({ label: "View memory", href: `/memories?open=${target.parent_id}` });
      return {
        needs_confirmation: true,
        memory: { title: target.title, content: target.content.slice(0, 300) },
        other_close_matches: memories.slice(1, 4).map((m) => m.title),
        note: "Ask the owner to confirm deleting this one memory. Only after they say yes, call confirm_delete_memory.",
      };
    },
  },
  confirm_delete_memory: {
    name: "confirm_delete_memory",
    description:
      "Step 2: permanently delete the memory or job analysis proposed by delete_memory / delete_job_analysis in the previous reply, after the owner said yes. Undoable from the activity log.",
    parameters: obj({}),
    async run(_args, ctx) {
      const pending = ctx.carried ? (ctx.carried.pendingDelete ?? null) : await lastReply<{ id: string; title: string }>(ctx, "pending_delete", true);
      if (!pending) return { error: "Nothing is waiting to be deleted. Ask which memory to delete first (delete_memory)." };
      const row = await deleteMemory(ctx.supabase, pending.id);
      ctx.changed = true;
      return { deleted: true, id: row.id, title: row.title, undo: "It can be restored with Undo in the activity log." };
    },
  },
  open_source: {
    name: "open_source",
    description:
      "Take the owner to where a piece of information came from: opens the memory/note/document in the app and gives the original outside link (imported web page, portfolio repo, job posting, web article) when there is one. Use for 'where did that come from', 'take me there', 'open the source', 'show me where you got that'. Leave 'about' empty to use the sources of your previous answer.",
    parameters: obj({ about: { type: "string", description: "What to find. Empty = the source of your last answer." }, cite: { type: "number", description: "Citation number [n] from your last answer, if the owner named one." } }),
    async run(args, ctx) {
      const about = str(args.about);
      type Src = { n: number; type: string; title: string; href: string };
      let item: { type: string; title: string; href: string; id: string } | null = null;
      if (!about || args.cite != null) {
        // The previous answer's sources, else whatever this turn already found.
        const saved = await lastReply<Src[]>(ctx, "sources");
        const prev = saved?.length ? saved : ctx.sources;
        const s = prev.find((x) => x.n === Number(args.cite)) ?? prev[0];
        if (s) item = { type: s.type, title: s.title, href: s.href, id: s.href.split("open=")[1] ?? "" };
      }
      if (!item && about) {
        const hit = (await searchKnowledge(ctx.supabase, about, { projectId: ctx.projectId, limit: 3 }))[0];
        if (hit) item = { type: hit.source_type, title: hit.title, href: sourceHref(hit), id: hit.parent_id };
      }
      if (!item) return { error: "I couldn't find where that came from in your brain." };

      const external = item.href.startsWith("http");
      const origin = external ? item.href : await originOf(ctx.supabase, item.type, item.id);
      if (!external) ctx.actions.push({ label: `Open ${item.title.slice(0, 40)}`, href: item.href, navigate: true });
      if (origin) ctx.actions.push({ label: "Original source", href: origin });
      cite(ctx, [{ type: item.type, title: item.title, href: item.href, similarity: 1 }]);
      return { opening: external ? null : item.href, title: item.title, stored_as: item.type, original_source: origin ?? "none (entered directly into HIVEMIND)" };
    },
  },
  recent_memories: {
    name: "recent_memories",
    description: "List the most recently saved memories.",
    parameters: obj({ limit: { type: "number" } }),
    async run(args, ctx) {
      const { data, error } = await ctx.supabase
        .from("memories")
        .select("title, memory_type, created_at")
        .not("metadata->>source", "in", `(${CAREER_SOURCE},resume-master)`)
        .order("created_at", { ascending: false })
        .limit(Math.min(Number(args.limit) || 8, 20));
      dbError(error);
      return { memories: data ?? [] };
    },
  },

  /* ───── notes, documents, projects, settings ───── */
  create_note: {
    name: "create_note",
    description: "Create a note: longer text the owner dictates or asks to write down as a note.",
    parameters: obj({ title: S, content: S }, ["content"]),
    async run(args, ctx) {
      const note = await createNote(ctx.supabase, { title: str(args.title) || undefined, content: str(args.content), project_id: ctx.projectId ?? undefined });
      ctx.changed = true;
      ctx.actions.push({ label: "Open note", href: `/notes?open=${note.id}` });
      return { saved_note: note.title };
    },
  },
  list_notes: {
    name: "list_notes",
    description: "List the owner's notes (newest first), optionally only those matching some words.",
    parameters: obj({ query: S }),
    async run(args, ctx) {
      const q = str(args.query);
      let req = ctx.supabase.from("notes").select("id, title, summary, updated_at").order("updated_at", { ascending: false }).limit(12);
      if (q) req = req.or(`title.ilike.%${q.replace(/[%,()]/g, " ")}%,content.ilike.%${q.replace(/[%,()]/g, " ")}%`);
      const { data, error } = await req;
      dbError(error);
      return { notes: (data ?? []).map((n) => ({ title: n.title, summary: n.summary, updated: String(n.updated_at).slice(0, 10) })) };
    },
  },
  update_note: {
    name: "update_note",
    description: "Change a note: new title, new content, or text to append ('add to my shopping note: milk'). 'which' is words from its title.",
    parameters: obj({ which: S, title: S, content: S, append: S }, ["which"]),
    async run(args, ctx) {
      const note = await findNote(ctx, str(args.which));
      if (!note) return { error: `No note like "${str(args.which)}".` };
      const title = str(args.title) || note.title;
      const content = str(args.append) ? `${note.content}\n${str(args.append)}` : str(args.content) || note.content;
      const meta = await extractMetadata(content);
      const { error } = await ctx.supabase
        .from("notes")
        .update({ title, content, summary: meta.summary, category: meta.category, tags: meta.tags, embedding: toVector(await embedOne(`${title}\n\n${content}`)), updated_at: new Date().toISOString() })
        .eq("id", note.id);
      dbError(error);
      ctx.changed = true;
      ctx.actions.push({ label: "Open note", href: `/notes?open=${note.id}` });
      return { updated_note: title };
    },
  },
  delete_note: {
    name: "delete_note",
    description: "Delete a note. First call without confirm to name it and ask 'Delete it?'; call again with confirm=true ONLY after the owner says yes.",
    parameters: obj({ which: S, confirm: { type: "boolean" } }, ["which"]),
    async run(args, ctx) {
      const note = await findNote(ctx, str(args.which));
      if (!note) return { error: `No note like "${str(args.which)}".` };
      if (args.confirm !== true) return { needs_confirmation: true, note: note.title, ask: `Delete the note "${note.title}"?` };
      const { error } = await ctx.supabase.from("notes").delete().eq("id", note.id);
      dbError(error);
      ctx.changed = true;
      return { deleted_note: note.title };
    },
  },
  list_documents: {
    name: "list_documents",
    description: "List the owner's uploaded documents with a one-line summary each.",
    parameters: obj({}),
    async run(_args, ctx) {
      const { data, error } = await ctx.supabase.from("documents").select("filename, summary, status, created_at").order("created_at", { ascending: false }).limit(20);
      dbError(error);
      return { documents: (data ?? []).map((d) => ({ file: d.filename, summary: d.summary, status: d.status, added: String(d.created_at).slice(0, 10) })) };
    },
  },
  delete_document: {
    name: "delete_document",
    description: "Delete an uploaded document. First call without confirm to name it and ask; call with confirm=true ONLY after the owner says yes.",
    parameters: obj({ which: S, confirm: { type: "boolean" } }, ["which"]),
    async run(args, ctx) {
      const w = str(args.which).replace(/[%,()]/g, " ");
      const { data } = await ctx.supabase.from("documents").select("id, filename").ilike("filename", `%${w}%`).limit(1).maybeSingle();
      if (!data) return { error: `No document like "${str(args.which)}".` };
      if (args.confirm !== true) return { needs_confirmation: true, document: data.filename, ask: `Delete the document "${data.filename}"?` };
      const { error } = await ctx.supabase.from("documents").delete().eq("id", data.id);
      dbError(error);
      ctx.changed = true;
      return { deleted_document: data.filename };
    },
  },
  update_project: {
    name: "update_project",
    description: "Change a project: rename it, update its description, or set its status (active, paused, done). 'which' is its name.",
    parameters: obj({ which: S, name: S, description: S, status: { type: "string", enum: ["active", "paused", "done"] } }, ["which"]),
    async run(args, ctx) {
      const p = await findProject(ctx, str(args.which));
      if (!p) return { error: `No project like "${str(args.which)}".` };
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (str(args.name)) patch.name = str(args.name).slice(0, 120);
      if (str(args.description)) patch.description = str(args.description).slice(0, 2000);
      if (["active", "paused", "done"].includes(str(args.status))) patch.status = str(args.status);
      const { error } = await ctx.supabase.from("projects").update(patch).eq("id", p.id);
      dbError(error);
      ctx.changed = true;
      ctx.actions.push({ label: "Open project", href: `/projects/${p.id}` });
      return { updated_project: patch.name ?? p.name, ...(patch.status ? { status: patch.status } : {}) };
    },
  },
  delete_project: {
    name: "delete_project",
    description: "Delete a project (its memories, notes and documents stay, just unfiled). First call without confirm to name it and ask; call with confirm=true ONLY after the owner says yes.",
    parameters: obj({ which: S, confirm: { type: "boolean" } }, ["which"]),
    async run(args, ctx) {
      const p = await findProject(ctx, str(args.which));
      if (!p) return { error: `No project like "${str(args.which)}".` };
      if (args.confirm !== true) return { needs_confirmation: true, project: p.name, ask: `Delete the project "${p.name}"? Its memories and notes stay.` };
      const { error } = await ctx.supabase.from("projects").delete().eq("id", p.id);
      dbError(error);
      ctx.changed = true;
      return { deleted_project: p.name };
    },
  },

  /* ───── projects ───── */
  list_projects: {
    name: "list_projects",
    description: "List the owner's projects with status and how many memories/notes each holds.",
    parameters: obj({}),
    async run(_args, ctx) {
      const [p, m, n] = await Promise.all([
        ctx.supabase.from("projects").select("id, name, description, status").order("name"),
        ctx.supabase.from("memories").select("project_id"),
        ctx.supabase.from("notes").select("project_id"),
      ]);
      dbError(p.error);
      const count = (rows: { project_id: string | null }[] | null, id: string) => (rows ?? []).filter((r) => r.project_id === id).length;
      return { projects: (p.data ?? []).map((x) => ({ name: x.name, status: x.status, description: x.description, memories: count(m.data, x.id), notes: count(n.data, x.id) })) };
    },
  },
  project_details: {
    name: "project_details",
    description: "Everything filed under one project: description plus its memories and notes.",
    parameters: obj({ name: S }, ["name"]),
    async run(args, ctx) {
      const { data: p, error } = await ctx.supabase.from("projects").select("id, name, description, status").ilike("name", `%${str(args.name)}%`).limit(1).maybeSingle();
      dbError(error);
      if (!p) return { error: `No project matching "${str(args.name)}".` };
      const [m, n] = await Promise.all([
        ctx.supabase.from("memories").select("title, content").eq("project_id", p.id).limit(15),
        ctx.supabase.from("notes").select("title, summary").eq("project_id", p.id).limit(10),
      ]);
      ctx.actions.push({ label: `Open ${p.name}`, href: `/projects/${p.id}` });
      return { ...p, memories: (m.data ?? []).map((x) => ({ title: x.title, content: x.content.slice(0, 400) })), notes: n.data ?? [] };
    },
  },
  create_project: {
    name: "create_project",
    description: "Create a new project.",
    parameters: obj({ name: S, description: S }, ["name"]),
    async run(args, ctx) {
      const name = str(args.name).slice(0, 120);
      if (!name) return { error: "Project needs a name." };
      const { data: existing } = await ctx.supabase.from("projects").select("id, name").ilike("name", name).maybeSingle();
      if (existing) {
        ctx.actions.push({ label: "Open project", href: `/projects/${existing.id}` });
        return { already_exists: true, name: existing.name };
      }
      const { data: p, error } = await ctx.supabase
        .from("projects")
        .insert({ name, description: str(args.description) || null, metadata: { created_by: "hivemind" } })
        .select("id, name")
        .single();
      dbError(error);
      await logActivity(ctx.supabase, "project_created", `Created project “${p!.name}” on your request`, { type: "project_created", project_id: p!.id });
      ctx.changed = true;
      ctx.actions.push({ label: "Open project", href: `/projects/${p!.id}` });
      return { created: true, name: p!.name };
    },
  },
};
