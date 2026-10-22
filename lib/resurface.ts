import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { CAREER_SOURCE } from "@/lib/career";
import { hash01 } from "@/lib/garden-layout";
import { readJSON, writeJSON } from "@/lib/private-store";
import { addDays, localParts } from "@/lib/reminders";

/**
 * "From your brain": each day one older memory comes back in the morning card, so what was saved is
 * seen again. One per day (the same one however often the card is built), not one shown in the last
 * three months, nothing recent (under three weeks), and only memories the owner saved themselves.
 */
export type Resurfaced = { id: string; title: string; snippet: string; ageDays: number };
type Row = { id: string; title: string; content: string; created_at: string };
type State = { date: string; id: string | null; seen: Record<string, string> };

const KEY = "resurface/state";
/** Only what the owner saved themselves: no job analyses, master resume or imported portfolio pages. A source of NULL (saved by hand) stays in. */
const OWN_MEMORIES = `metadata->>source.is.null,metadata->>source.not.in.(${CAREER_SOURCE},resume-master,portfolio-mcp)`;
const MIN_AGE_DAYS = 21;
const REPEAT_DAYS = 90;

const days = (from: string, to: string) => Math.round((+new Date(`${to}T00:00:00Z`) - +new Date(`${from}T00:00:00Z`)) / 86_400_000);

/** Which memory to show today (pure): old enough, not shown lately, a different one each day. */
export function pickResurface(rows: Row[], seen: Record<string, string>, today: string): Row | null {
  const ok = rows.filter((r) => {
    const made = r.created_at.slice(0, 10);
    const last = seen[r.id];
    return days(made, today) >= MIN_AGE_DAYS && r.content.trim().length >= 20 && (!last || days(last, today) >= REPEAT_DAYS);
  });
  if (!ok.length) return null;
  return ok.reduce((best, r) => (hash01(`${today}${r.id}`) < hash01(`${today}${best.id}`) ? r : best));
}

const snippet = (s: string) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > 140 ? `${t.slice(0, 137).trimEnd()}…` : t;
};

/** Today's memory from the brain, or null when there is nothing old enough to show. */
export async function resurfacedToday(supabase: SupabaseClient, today = localParts().date): Promise<Resurfaced | null> {
  const state = await readJSON<State>(supabase, KEY, { date: "", id: null, seen: {} });
  const shape = (r: Row): Resurfaced => ({ id: r.id, title: r.title, snippet: snippet(r.content), ageDays: days(r.created_at.slice(0, 10), today) });
  if (state.date === today) {
    if (!state.id) return null;
    const { data } = await supabase.from("memories").select("id, title, content, created_at").eq("id", state.id).maybeSingle();
    if (data) return shape(data as Row);
  }
  const { data } = await supabase
    .from("memories")
    .select("id, title, content, created_at")
    .lte("created_at", `${addDays(today, -MIN_AGE_DAYS)}T23:59:59+05:30`)
    .or(OWN_MEMORIES)
    .order("created_at", { ascending: true })
    .limit(300);
  const pick = pickResurface((data ?? []) as Row[], state.seen, today);
  const seen = Object.fromEntries(Object.entries(state.seen).filter(([, d]) => days(d, today) < REPEAT_DAYS));
  if (pick) seen[pick.id] = today;
  await writeJSON(supabase, KEY, { date: today, id: pick?.id ?? null, seen } satisfies State).catch(() => {});
  return pick ? shape(pick) : null;
}
