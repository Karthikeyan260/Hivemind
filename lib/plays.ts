import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readJSON, writeJSON } from "@/lib/private-store";
import { localParts } from "@/lib/reminders";

/** Songs played, one small list per month (for Wrapped: top songs and artists). */
export type Play = { at: string; title: string; artists: string; image?: string };
const key = (month: string) => `plays/${month}`;

export const listPlays = (supabase: SupabaseClient, month: string) => readJSON<Play[]>(supabase, key(month), []);

export async function logPlay(supabase: SupabaseClient, p: Omit<Play, "at">) {
  const month = localParts().date.slice(0, 7);
  const all = await listPlays(supabase, month);
  const last = all.at(-1);
  // The same song asked for twice in a row within a minute (a retry): count it once.
  if (last && last.title === p.title && Date.now() - +new Date(last.at) < 60_000) return;
  await writeJSON(supabase, key(month), [...all, { ...p, at: new Date().toISOString() }].slice(-3000));
}
