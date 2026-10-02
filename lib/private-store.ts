import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Tiny server-only JSON store in a private Supabase Storage bucket, for small app state that doesn't
 * deserve a table (push subscriptions, open call rooms, "brief sent today"). No migration needed.
 */
const BUCKET = "hivemind-private";
let ready: Promise<void> | null = null;

function ensureBucket(supabase: SupabaseClient) {
  ready ??= (async () => {
    const { data } = await supabase.storage.getBucket(BUCKET);
    if (!data) await supabase.storage.createBucket(BUCKET, { public: false });
  })().catch((err) => {
    ready = null;
    throw err;
  });
  return ready;
}

export async function readJSON<T>(supabase: SupabaseClient, key: string, fallback: T): Promise<T> {
  await ensureBucket(supabase);
  const { data, error } = await supabase.storage.from(BUCKET).download(`${key}.json`);
  if (error || !data) return fallback;
  try {
    return JSON.parse(await data.text()) as T;
  } catch {
    return fallback;
  }
}

/**
 * Event markers: one tiny file per event under a prefix. Counting files can't lose updates the way
 * read-modify-write of a JSON counter does when requests run in parallel (e.g. login guessing).
 */
export async function addMarker(supabase: SupabaseClient, prefix: string) {
  await ensureBucket(supabase);
  const name = `${prefix}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  await supabase.storage.from(BUCKET).upload(name, new Blob(["1"]), { upsert: false, contentType: "text/plain" });
}

/** Markers under a prefix newer than `sinceMs`; older ones are deleted while we're here. */
export async function countMarkers(supabase: SupabaseClient, prefix: string, sinceMs: number) {
  await ensureBucket(supabase);
  const { data } = await supabase.storage.from(BUCKET).list(prefix, { limit: 1000 });
  const files = data ?? [];
  const old = files.filter((f) => Number(f.name.split("-")[0]) < sinceMs).map((f) => `${prefix}/${f.name}`);
  if (old.length) await supabase.storage.from(BUCKET).remove(old);
  return files.length - old.length;
}

export async function clearMarkers(supabase: SupabaseClient, prefix: string) {
  await ensureBucket(supabase);
  const { data } = await supabase.storage.from(BUCKET).list(prefix, { limit: 1000 });
  if (data?.length) await supabase.storage.from(BUCKET).remove(data.map((f) => `${prefix}/${f.name}`));
}

export async function writeJSON(supabase: SupabaseClient, key: string, value: unknown) {
  await ensureBucket(supabase);
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(`${key}.json`, new Blob([JSON.stringify(value)], { type: "application/json" }), { upsert: true, contentType: "application/json" });
  if (error) throw new Error(`store write failed: ${error.message}`);
}

/** A binary file (e.g. a web-task screenshot) next to the JSON state. */
export async function writeFile(supabase: SupabaseClient, path: string, body: Blob | Buffer | Uint8Array, contentType: string) {
  await ensureBucket(supabase);
  const { error } = await supabase.storage.from(BUCKET).upload(path, body, { upsert: true, contentType });
  if (error) throw new Error(`store write failed: ${error.message}`);
}

export async function readFile(supabase: SupabaseClient, path: string) {
  await ensureBucket(supabase);
  const { data, error } = await supabase.storage.from(BUCKET).download(path);
  return error || !data ? null : data;
}

export async function removeFiles(supabase: SupabaseClient, paths: string[]) {
  await ensureBucket(supabase);
  if (paths.length) await supabase.storage.from(BUCKET).remove(paths);
}

/** File names directly under a folder (e.g. a web task's step screenshots). */
export async function listFiles(supabase: SupabaseClient, folder: string) {
  await ensureBucket(supabase);
  const { data } = await supabase.storage.from(BUCKET).list(folder, { limit: 1000 });
  return (data ?? []).map((f) => `${folder}/${f.name}`);
}
