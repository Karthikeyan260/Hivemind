import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readJSON, writeJSON } from "@/lib/private-store";

/** Each device's last known spot (only devices where the owner switched location sharing on). */
export type DeviceFix = { id: string; name: string; lat: number; lng: number; accuracy: number; at: string };
const KEY = "device-locations";

export const listDevices = (supabase: SupabaseClient) => readJSON<Record<string, DeviceFix>>(supabase, KEY, {}).then((m) => Object.values(m).sort((a, b) => b.at.localeCompare(a.at)));

export async function saveFix(supabase: SupabaseClient, fix: DeviceFix) {
  const all = await readJSON<Record<string, DeviceFix>>(supabase, KEY, {});
  all[fix.id] = fix;
  await writeJSON(supabase, KEY, all);
}

export async function forgetDevice(supabase: SupabaseClient, id: string) {
  const all = await readJSON<Record<string, DeviceFix>>(supabase, KEY, {});
  delete all[id];
  await writeJSON(supabase, KEY, all);
}
