import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readJSON, writeJSON } from "@/lib/private-store";

/**
 * The owner's permanent Draw & Guess link: one room that every game uses, so friends keep the same
 * link. "New link" replaces it (the old one stops working). A friend opening it while the owner
 * isn't there "knocks": the owner gets a notification, at most every 30 seconds.
 */
type GameRoom = { room: string; created: string; knocked?: string };
const KEY = "games/room";

const fresh = (): GameRoom => ({ room: crypto.randomUUID().replace(/-/g, "").slice(0, 16), created: new Date().toISOString() });

export async function gameRoom(supabase: SupabaseClient, reset = false) {
  const r = await readJSON<GameRoom | null>(supabase, KEY, null);
  if (r && !reset) return r;
  const next = fresh();
  await writeJSON(supabase, KEY, next);
  return next;
}

/** True when this is the owner's real game room and it hasn't knocked in the last 30 s (then marks it). */
export async function claimKnock(supabase: SupabaseClient, room: string) {
  const r = await readJSON<GameRoom | null>(supabase, KEY, null);
  if (!r || r.room !== room) return false;
  if (r.knocked && Date.now() - +new Date(r.knocked) < 30_000) return false;
  await writeJSON(supabase, KEY, { ...r, knocked: new Date().toISOString() });
  return true;
}
