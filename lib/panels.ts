import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readJSON, writeJSON } from "@/lib/private-store";

/**
 * Panels pinned to the home screen: small live cards (weather, answered calls, routines) and any
 * app HIVEMIND built, running in a little window. Order is the owner's.
 */
export type Pin = "weather" | "calls" | "routines" | `app:${string}`;

const KEY = "home-panels";
const DEFAULT: Pin[] = ["weather", "routines", "calls"];
export const BUILT_IN = ["weather", "calls", "routines"] as const;
export const isPin = (p: string): p is Pin => (BUILT_IN as readonly string[]).includes(p) || /^app:[0-9a-f-]{36}$/.test(p);

export const getPins = async (supabase: SupabaseClient) => (await readJSON<Pin[] | null>(supabase, KEY, null)) ?? DEFAULT;

export async function setPins(supabase: SupabaseClient, pins: string[]) {
  const clean = [...new Set(pins)].filter(isPin).slice(0, 8);
  await writeJSON(supabase, KEY, clean);
  return clean;
}
