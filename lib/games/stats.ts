import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { readJSON, writeJSON } from "@/lib/private-store";

/** The owner's game record: one line per finished game (the last 500). */
export const GameResult = z.object({
  game: z.enum(["chess", "cards", "ludo", "draw", "dots"]),
  mode: z.enum(["bot", "friend"]),
  outcome: z.enum(["win", "loss", "draw"]),
  vs: z.string().trim().max(40),
  /** Chess vs bot: the bot's level. */
  level: z.string().max(20).optional(),
  /** e.g. "checkmate", "time", "12 – 9". */
  detail: z.string().max(60).optional(),
  /** Set by the browser so the same game can't be counted twice. */
  key: z.string().max(120),
});
export type GameResult = z.infer<typeof GameResult> & { at: string };

const KEY = "games/stats";
export const listResults = (supabase: SupabaseClient) => readJSON<GameResult[]>(supabase, KEY, []);

export async function addResult(supabase: SupabaseClient, r: z.infer<typeof GameResult>) {
  const all = await listResults(supabase);
  if (all.some((x) => x.key === r.key)) return all.length;
  const next = [...all, { ...r, at: new Date().toISOString() }].slice(-500);
  await writeJSON(supabase, KEY, next);
  return next.length;
}
