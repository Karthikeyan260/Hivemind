import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readJSON, writeJSON } from "@/lib/private-store";
import { isRoomCode, newRoomCode } from "./protocol";

/**
 * The owner's one permanent Friends Theatre room. The code is made once (random, unguessable), kept in the private
 * store, and gives the same link on every device and every day: /theatre/<code>. Whoever opens the link first holds the
 * room; leaving and coming back works (see lib/theatre/net.ts). If the link ever leaks, `rotateRoomCode` makes a new one
 * and the old one stops being the owner's room (anyone still holding it just sits in an empty room).
 */
const KEY = "theatre-room";

export async function getRoomCode(supabase: SupabaseClient): Promise<string> {
  const saved = await readJSON<{ code?: unknown }>(supabase, KEY, {});
  if (isRoomCode(saved.code)) return saved.code;
  return rotateRoomCode(supabase);
}

export async function rotateRoomCode(supabase: SupabaseClient): Promise<string> {
  const code = newRoomCode();
  await writeJSON(supabase, KEY, { code, at: new Date().toISOString() });
  return code;
}
