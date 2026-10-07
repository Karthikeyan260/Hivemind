import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readJSON, writeJSON } from "@/lib/private-store";

/**
 * Calls the owner started, so a guest opening the link can ring the owner's phone (and only those).
 * Plus one permanent "call me" link the owner can share anywhere (reset it to stop old copies working).
 */
export type Room = { room: string; name: string; to?: string; from: string; created: string; rang?: string; permanent?: boolean };

const KEY = "call-rooms";
const TTL = 24 * 3600_000;

const live = (x: Room, now: number) => x.permanent || now - +new Date(x.created) < TTL;

export async function saveRoom(supabase: SupabaseClient, r: Omit<Room, "created">) {
  const now = Date.now();
  const rooms = (await readJSON<Room[]>(supabase, KEY, [])).filter((x) => live(x, now));
  rooms.push({ ...r, created: new Date(now).toISOString() });
  await writeJSON(supabase, KEY, [...rooms.filter((x) => x.permanent), ...rooms.filter((x) => !x.permanent).slice(-50)]);
}

/** The room if it's real and fresh, and marks it rung; null when unknown, expired, or rung in the last 30 s. */
export async function claimRing(supabase: SupabaseClient, room: string): Promise<Room | null> {
  const now = Date.now();
  const rooms = await readJSON<Room[]>(supabase, KEY, []);
  const r = rooms.find((x) => x.room === room && live(x, now));
  if (!r || (r.rang && now - +new Date(r.rang) < 30_000)) return null;
  r.rang = new Date(now).toISOString();
  await writeJSON(supabase, KEY, rooms);
  return r;
}

/** A real room the owner created in the last 24 h (or the permanent link), or null. */
export async function getRoom(supabase: SupabaseClient, room: string): Promise<Room | null> {
  const now = Date.now();
  const rooms = await readJSON<Room[]>(supabase, KEY, []);
  return rooms.find((x) => x.room === room && live(x, now)) ?? null;
}

/** The owner's permanent "call me" link (made on first use); reset = a new link, the old one stops working. */
export async function personalRoom(supabase: SupabaseClient, host: string, reset = false): Promise<Room> {
  const rooms = await readJSON<Room[]>(supabase, KEY, []);
  const mine = rooms.find((x) => x.permanent);
  if (mine && !reset) return mine;
  const r: Room = { room: `me${crypto.randomUUID().replace(/-/g, "").slice(0, 22)}`, name: "Someone", from: host, created: new Date().toISOString(), permanent: true };
  await writeJSON(supabase, KEY, [...rooms.filter((x) => !x.permanent), r]);
  return r;
}
