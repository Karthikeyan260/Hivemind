import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readJSON, writeJSON } from "@/lib/private-store";

/** Calls the owner started, so a guest opening the link can ring the owner's phone (and only those). */
export type Room = { room: string; name: string; to?: string; from: string; created: string; rang?: string };

const KEY = "call-rooms";
const TTL = 24 * 3600_000;

export async function saveRoom(supabase: SupabaseClient, r: Omit<Room, "created">) {
  const now = Date.now();
  const rooms = (await readJSON<Room[]>(supabase, KEY, [])).filter((x) => now - +new Date(x.created) < TTL);
  rooms.push({ ...r, created: new Date(now).toISOString() });
  await writeJSON(supabase, KEY, rooms.slice(-50));
}

/** The room if it's real and fresh, and marks it rung; null when unknown, expired, or rung in the last 30 s. */
export async function claimRing(supabase: SupabaseClient, room: string): Promise<Room | null> {
  const now = Date.now();
  const rooms = await readJSON<Room[]>(supabase, KEY, []);
  const r = rooms.find((x) => x.room === room && now - +new Date(x.created) < TTL);
  if (!r || (r.rang && now - +new Date(r.rang) < 30_000)) return null;
  r.rang = new Date(now).toISOString();
  await writeJSON(supabase, KEY, rooms);
  return r;
}
