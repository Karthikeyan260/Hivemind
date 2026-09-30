import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { embedOne } from "@/lib/ai/embeddings";
import { extractMetadata, MEMORY_TYPES } from "@/lib/ai/metadata";
import { dbError, toVector, HttpError } from "@/lib/api";
import { logActivity } from "@/lib/activity";
import { organizeItem } from "@/lib/organizer";

export const NOTE_COLUMNS = "id, project_id, title, content, summary, category, tags, created_at, updated_at";
export const MEMORY_COLUMNS =
  "id, project_id, title, content, memory_type, category, importance, confidence, tags, metadata, created_at, updated_at";

const projectId = z.uuid().nullable().optional();
const tags = z.array(z.string().trim().min(1).max(40)).max(20);

export const NoteInput = z.object({
  title: z.string().trim().max(200).optional(),
  content: z.string().trim().min(1).max(50000),
  project_id: projectId,
  tags: tags.optional(),
});

export const MemoryInput = z.object({
  title: z.string().trim().max(200).optional(),
  content: z.string().trim().min(1).max(20000),
  memory_type: z.enum(MEMORY_TYPES).optional(),
  category: z.string().trim().max(60).optional(),
  importance: z.number().int().min(1).max(10).optional(),
  confidence: z.number().min(0).max(1).optional(),
  project_id: projectId,
  tags: tags.optional(),
});

export const MemoryUpdate = MemoryInput.partial().extend({
  change_reason: z.string().trim().max(300).optional(),
});

const embedText = (title: string, content: string) => `${title}\n\n${content}`;

export async function createNote(supabase: SupabaseClient, input: z.infer<typeof NoteInput>) {
  const meta = await extractMetadata(input.content);
  const title = input.title || meta.title || input.content.slice(0, 60);
  const embedding = await embedOne(embedText(title, input.content));
  const { data, error } = await supabase
    .from("notes")
    .insert({
      title,
      content: input.content,
      project_id: input.project_id ?? null,
      summary: meta.summary,
      category: meta.category,
      tags: input.tags?.length ? input.tags : meta.tags,
      metadata: { entities: meta.entities, importance: meta.importance },
      embedding: toVector(embedding),
    })
    .select(NOTE_COLUMNS)
    .single();
  dbError(error);
  return autoFile(supabase, "notes", NOTE_COLUMNS, data!);
}

/** Lets HIVEMIND file a new item into a project (possibly a new one) when the user didn't pick one. */
async function autoFile<T extends { id: string; title: string; content: string; project_id: string | null }>(
  supabase: SupabaseClient,
  table: "notes" | "memories",
  columns: string,
  row: T,
): Promise<T> {
  if (row.project_id) return row;
  const r = await organizeItem(supabase, { table, id: row.id, title: row.title, content: row.content });
  if (r.filed === 0) return row;
  const { data } = await supabase.from(table).select(columns).eq("id", row.id).single();
  return (data as unknown as T) ?? row;
}

export async function createMemory(supabase: SupabaseClient, input: z.infer<typeof MemoryInput>) {
  const meta = await extractMetadata(input.content);
  const title = input.title || meta.title || input.content.slice(0, 60);
  const embedding = await embedOne(embedText(title, input.content));
  const { data, error } = await supabase
    .from("memories")
    .insert({
      title,
      content: input.content,
      project_id: input.project_id ?? null,
      memory_type: input.memory_type ?? meta.memory_type,
      category: input.category ?? meta.category,
      importance: input.importance ?? meta.importance,
      confidence: input.confidence ?? 1,
      tags: input.tags?.length ? input.tags : meta.tags,
      metadata: { summary: meta.summary, entities: meta.entities },
      embedding: toVector(embedding),
    })
    .select(MEMORY_COLUMNS)
    .single();
  dbError(error);
  return autoFile(supabase, "memories", MEMORY_COLUMNS, data!);
}

/** Saves the current state as a version, applies the change, and re-embeds if meaning changed. */
export async function updateMemory(
  supabase: SupabaseClient,
  id: string,
  patch: z.infer<typeof MemoryUpdate>,
) {
  const { data: current, error: getErr } = await supabase
    .from("memories")
    .select("id, title, content")
    .eq("id", id)
    .maybeSingle();
  dbError(getErr);
  if (!current) throw new HttpError(404, "Memory not found");

  const { change_reason, ...fields } = patch;
  const title = fields.title ?? current.title;
  const content = fields.content ?? current.content;
  const meaningChanged = title !== current.title || content !== current.content;

  if (meaningChanged) {
    const { data: last } = await supabase
      .from("memory_versions")
      .select("version_number")
      .eq("memory_id", id)
      .order("version_number", { ascending: false })
      .limit(1)
      .maybeSingle();
    const { error: vErr } = await supabase.from("memory_versions").insert({
      memory_id: id,
      version_number: (last?.version_number ?? 0) + 1,
      title: current.title,
      content: current.content,
      change_reason: change_reason ?? "edited",
    });
    dbError(vErr);
  }

  const update: Record<string, unknown> = { ...fields, updated_at: new Date().toISOString() };
  if (meaningChanged) update.embedding = toVector(await embedOne(embedText(title, content)));

  const { data, error } = await supabase
    .from("memories")
    .update(update)
    .eq("id", id)
    .select(MEMORY_COLUMNS)
    .single();
  dbError(error);
  return data;
}

/** Deletes a memory, keeping the full row in the activity log so Undo can restore it exactly. */
export async function deleteMemory(supabase: SupabaseClient, id: string) {
  const { data: row, error } = await supabase.from("memories").select("*").eq("id", id).maybeSingle();
  dbError(error);
  if (!row) throw new HttpError(404, "That memory no longer exists.");
  const { error: delErr } = await supabase.from("memories").delete().eq("id", id);
  dbError(delErr);
  await logActivity(supabase, "memory_deleted", `Deleted memory “${row.title}”`, { type: "memory_deleted", memory: row });
  return { id, title: row.title as string };
}
