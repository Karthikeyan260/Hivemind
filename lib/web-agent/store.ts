import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readFile, readJSON, removeFiles, writeFile, writeJSON } from "@/lib/private-store";
import type { Action } from "./page";

/** One web task: a goal HIVEMIND carries out in a cloud browser, step by step, pausing for the owner. */
export type TaskStatus = "queued" | "running" | "needs_approval" | "needs_you" | "done" | "failed" | "cancelled";
export type Step = { at: string; thought: string; did: string; ok: boolean; note?: string; url?: string };
export type WebTask = {
  id: string;
  goal: string;
  start_url?: string;
  status: TaskStatus;
  created_at: string;
  updated_at: string;
  steps: Step[];
  /** Live state. */
  session_id?: string;
  live_url?: string;
  url?: string;
  title?: string;
  has_shot?: boolean;
  /** Whoever is driving right now, and when they last checked in (one driver at a time). */
  runner?: string;
  heartbeat?: string;
  /** Waiting on the owner: the risky action to approve, or what to do in the live view. */
  pending?: { action: Action; label: string; thought: string };
  question?: string;
  /** Brain facts the agent looked up, shown to it on the next steps. */
  notes?: string[];
  result?: string;
  error?: string;
};

const INDEX = "web-tasks/index";
const KEEP = 30;
const taskKey = (id: string) => `web-tasks/${id}`;
export const shotPath = (id: string) => `web-tasks/${id}.jpg`;
/** Cancel marker: a separate file the driver never writes, so a cancel can't be overwritten mid-step. */
const stopPath = (id: string) => `web-tasks/${id}.stop`;

export const ACTIVE: TaskStatus[] = ["queued", "running", "needs_approval", "needs_you"];

export async function getTask(supabase: SupabaseClient, id: string) {
  const task = await readJSON<WebTask | null>(supabase, taskKey(id), null);
  if (task && ACTIVE.includes(task.status) && (await readFile(supabase, stopPath(id)))) {
    task.status = "cancelled";
    task.error ??= "Cancelled by you";
  }
  return task;
}

export const markStopped = (supabase: SupabaseClient, id: string) => writeFile(supabase, stopPath(id), Buffer.from("1"), "text/plain");
export const clearStopped = (supabase: SupabaseClient, id: string) => removeFiles(supabase, [stopPath(id)]).catch(() => {});

export async function saveTask(supabase: SupabaseClient, task: WebTask) {
  task.updated_at = new Date().toISOString();
  await writeJSON(supabase, taskKey(task.id), task);
  return task;
}

export async function listTasks(supabase: SupabaseClient) {
  const ids = await readJSON<string[]>(supabase, INDEX, []);
  const tasks = await Promise.all(ids.map((id) => getTask(supabase, id)));
  return tasks.filter((t): t is WebTask => !!t);
}

export async function createTask(supabase: SupabaseClient, goal: string, startUrl?: string) {
  const now = new Date().toISOString();
  const task: WebTask = { id: crypto.randomUUID(), goal, ...(startUrl ? { start_url: startUrl } : {}), status: "queued", created_at: now, updated_at: now, steps: [] };
  await saveTask(supabase, task);
  const ids = await readJSON<string[]>(supabase, INDEX, []);
  const keep = [task.id, ...ids];
  await writeJSON(supabase, INDEX, keep.slice(0, KEEP));
  // Old tasks fall off the list: drop their files too.
  const old = keep.slice(KEEP);
  if (old.length) await removeFiles(supabase, old.flatMap((id) => [`${taskKey(id)}.json`, shotPath(id), stopPath(id)])).catch(() => {});
  return task;
}

/** Removes tasks from the list along with their files (state, screenshot, stop marker). */
export async function deleteTasks(supabase: SupabaseClient, ids: string[]) {
  if (!ids.length) return 0;
  const gone = new Set(ids);
  const index = await readJSON<string[]>(supabase, INDEX, []);
  await writeJSON(supabase, INDEX, index.filter((id) => !gone.has(id)));
  await removeFiles(supabase, ids.flatMap((id) => [`${taskKey(id)}.json`, shotPath(id), stopPath(id)])).catch(() => {});
  return ids.length;
}

export const saveShot =(supabase: SupabaseClient, id: string, jpg: Buffer) => writeFile(supabase, shotPath(id), jpg, "image/jpeg");
export const readShot = (supabase: SupabaseClient, id: string) => readFile(supabase, shotPath(id));
