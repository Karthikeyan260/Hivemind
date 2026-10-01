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

export async function writeJSON(supabase: SupabaseClient, key: string, value: unknown) {
  await ensureBucket(supabase);
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(`${key}.json`, new Blob([JSON.stringify(value)], { type: "application/json" }), { upsert: true, contentType: "application/json" });
  if (error) throw new Error(`store write failed: ${error.message}`);
}
