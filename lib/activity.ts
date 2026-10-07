import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { dbError, HttpError } from "@/lib/api";

export type ActivityPayload =
  | { type: "project_created"; project_id: string }
  | { type: "linked"; table: "notes" | "memories" | "documents"; id: string; prev_project_id: string | null }
  /** The full row (embedding included), so undo restores it exactly. */
  | { type: "memory_deleted"; memory: Record<string, unknown> }
  /** An automatic edit (Dream mode): undo puts the previous words back. */
  | { type: "memory_updated"; id: string; prev: { title: string; content: string } }
  /** An automatic new memory (Dream mode): undo removes it. */
  | { type: "memory_created"; id: string }
  | { type: "info" };

/** Logs an action; returns its id (so it can be undone from elsewhere), or null if logging failed. */
export async function logActivity(supabase: SupabaseClient, kind: string, message: string, payload: ActivityPayload = { type: "info" }): Promise<string | null> {
  const { data, error } = await supabase.from("activity").insert({ kind, message, payload }).select("id").single();
  if (error) console.warn("activity log failed:", error.message);
  return (data?.id as string | undefined) ?? null;
}

export async function undoActivity(supabase: SupabaseClient, id: string) {
  const { data, error } = await supabase.from("activity").select("id, payload, undone").eq("id", id).maybeSingle();
  dbError(error);
  if (!data) throw new HttpError(404, "Activity not found");
  if (data.undone) return;
  const p = data.payload as ActivityPayload;

  if (p.type === "project_created") {
    const { error: e } = await supabase.from("projects").delete().eq("id", p.project_id);
    dbError(e);
  } else if (p.type === "linked") {
    const { error: e } = await supabase.from(p.table).update({ project_id: p.prev_project_id }).eq("id", p.id);
    dbError(e);
  } else if (p.type === "memory_deleted") {
    const { error: e } = await supabase.from("memories").insert(p.memory);
    dbError(e);
  } else if (p.type === "memory_updated") {
    const { updateMemory } = await import("@/lib/knowledge");
    await updateMemory(supabase, p.id, { title: p.prev.title, content: p.prev.content, change_reason: "undo" });
  } else if (p.type === "memory_created") {
    const { error: e } = await supabase.from("memories").delete().eq("id", p.id);
    dbError(e);
  } else {
    throw new HttpError(400, "This action can't be undone");
  }
  const { error: uErr } = await supabase.from("activity").update({ undone: true }).eq("id", id);
  dbError(uErr);
}
