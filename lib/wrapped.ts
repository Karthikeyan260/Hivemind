import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { generateWithFallback } from "@/lib/ai/providers";
import { listCheckins, MOODS } from "@/lib/checkin";
import { gameName } from "@/lib/games/names";
import { listResults } from "@/lib/games/stats";
import { listHabits } from "@/lib/habits";
import { listPhotos } from "@/lib/photos";
import { listPlays } from "@/lib/plays";
import { readJSON, writeJSON } from "@/lib/private-store";
import { addDays, localDayStart, localParts } from "@/lib/reminders";

/**
 * My Wrapped: a month of the owner's life as story cards — moods, habits, songs, games, photos and
 * places, and how much went into their brain. Numbers come straight from their data; only the
 * one-line headline is written by the AI. A finished month is kept as it was; the current month is
 * "so far" and recomputed (its headline is kept for the day).
 */
export type Wrapped = {
  month: string;
  label: string;
  complete: boolean;
  headline: string;
  activeDays: number;
  moods: { count: number; faces: number[]; average: number | null; best: { date: string; mood: number; words: string } | null };
  habits: { name: string; emoji: string; done: number; scheduled: number; bestRun: number }[];
  music: { plays: number; top: { title: string; artists: string; image?: string; count: number }[]; topArtist: string | null };
  games: { played: number; won: number; lost: number; drawn: number; favourite: string | null; byGame: Record<string, { won: number; lost: number; drawn: number }> };
  photos: { count: number; places: { place: string; count: number }[]; covers: string[] };
  brain: { notes: number; memories: number; documents: number; chats: number; remindersDone: number; kurals: number };
};


/** "2026-10" → its days ("2026-10-01" … "2026-10-31") and the instants it starts and ends (home time). */
function monthSpan(month: string) {
  const [y, m] = month.split("-").map(Number);
  const first = `${month}-01`;
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
  const days: string[] = [];
  for (let d = first; d < next; d = addDays(d, 1)) days.push(d);
  const at = (date: string) => localDayStart(new Date(`${date}T12:00:00Z`));
  return { days, from: at(first), to: at(next), first, next };
}

/** The longest run of scheduled days done one after another (days the habit isn't scheduled don't break it, as in the app's streak). */
export function longestRun(days: string[], done: Set<string>, weekdays: number[]) {
  let run = 0;
  let best = 0;
  for (const d of days) {
    if (!weekdays.includes(new Date(`${d}T00:00:00Z`).getUTCDay())) continue;
    if (done.has(d)) best = Math.max(best, ++run);
    else run = 0;
  }
  return best;
}

const inMonth = (iso: string, from: Date, to: Date) => +new Date(iso) >= +from && +new Date(iso) < +to;
const dayOf = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

/** Rows created in the month (messages: only the owner's own). */
async function count(supabase: SupabaseClient, table: string, from: Date, to: Date, ownerOnly = false) {
  let q = supabase.from(table).select("id", { count: "exact", head: true }).gte("created_at", from.toISOString()).lt("created_at", to.toISOString());
  if (ownerOnly) q = q.eq("role", "user");
  const { count: n } = await q;
  return n ?? 0;
}

export async function monthWrapped(supabase: SupabaseClient, month: string): Promise<Wrapped> {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error("Month looks like 2026-10.");
  const today = localParts().date;
  const thisMonth = today.slice(0, 7);
  if (month > thisMonth) throw new Error("That month hasn't happened yet.");
  const complete = month < thisMonth;
  // A finished month is kept for good only a week after it ends (late photos and check-ins still count).
  const { next } = monthSpan(month);
  const settled = complete && today >= addDays(next, 7);
  const cacheKey = settled ? `wrapped/${month}` : `wrapped/${month}-${today}`;
  if (settled) {
    const kept = await readJSON<Wrapped | null>(supabase, cacheKey, null);
    if (kept) return kept;
  }

  const { days, from, to } = monthSpan(month);
  const label = new Date(`${month}-15T12:00:00Z`).toLocaleDateString("en-IN", { month: "long", year: "numeric" });

  const [checkins, habits, results, photos, plays, notes, memories, documents, chats, chatRows, doneReminders, kuralFiles] = await Promise.all([
    listCheckins(supabase).catch(() => []),
    listHabits(supabase).catch(() => []),
    listResults(supabase).catch(() => []),
    listPhotos(supabase).catch(() => []),
    listPlays(supabase, month).catch(() => []),
    count(supabase, "notes", from, to),
    count(supabase, "memories", from, to),
    count(supabase, "documents", from, to),
    count(supabase, "messages", from, to, true),
    supabase.from("messages").select("created_at").eq("role", "user").gte("created_at", from.toISOString()).lt("created_at", to.toISOString()).limit(5000),
    supabase.from("notes").select("metadata").contains("tags", JSON.stringify(["reminder"])).gte("updated_at", from.toISOString()).lt("updated_at", to.toISOString()).limit(2000),
    supabase.storage.from("hivemind-private").list("kural", { limit: 1000, search: month }),
  ]);

  // Moods (night check-ins).
  const ci = checkins.filter((c) => c.date.startsWith(month));
  const faces = [1, 2, 3, 4, 5].map((m) => ci.filter((c) => c.mood === m).length);
  const bestCi = [...ci].sort((a, b) => b.mood - a.mood || b.date.localeCompare(a.date))[0];
  let bestWords = "";
  if (bestCi?.noteId) {
    const { data } = await supabase.from("notes").select("content").eq("id", bestCi.noteId).maybeSingle();
    bestWords = String((data as { content?: string } | null)?.content ?? "").replace(/^Mood:[^\n]*\n+/, "").split("\n\n")[0].slice(0, 160);
  }

  // Habits: done days this month, and the longest run of done days in it.
  const habitRows = habits
    .map((h) => {
      const done = new Set(h.log.filter((d) => d.startsWith(month)));
      const scheduled = days.filter((d) => d <= today && d >= h.created.slice(0, 10) && h.days.includes(new Date(`${d}T00:00:00Z`).getUTCDay())).length;
      return { name: h.name, emoji: h.emoji, done: done.size, scheduled, bestRun: longestRun(days, done, h.days) };
    })
    .filter((h) => h.scheduled > 0)
    .sort((a, b) => b.done - a.done);

  // Music.
  const songs = new Map<string, { title: string; artists: string; image?: string; count: number }>();
  const artists = new Map<string, number>();
  for (const p of plays) {
    const k = `${p.title}|${p.artists}`;
    const s = songs.get(k) ?? { title: p.title, artists: p.artists, image: p.image?.startsWith("https://") ? p.image : undefined, count: 0 };
    s.count++;
    songs.set(k, s);
    for (const a of p.artists.split(/,\s*/).filter(Boolean)) artists.set(a, (artists.get(a) ?? 0) + 1);
  }
  const top = [...songs.values()].sort((a, b) => b.count - a.count).slice(0, 5);
  const topArtist = [...artists.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  // Games.
  const games = results.filter((r) => inMonth(r.at, from, to));
  const byGame: Wrapped["games"]["byGame"] = {};
  for (const r of games) {
    const g = (byGame[gameName(r.game)] ??= { won: 0, lost: 0, drawn: 0 });
    if (r.outcome === "win") g.won++;
    else if (r.outcome === "loss") g.lost++;
    else g.drawn++;
  }
  const favourite = Object.entries(byGame).sort((a, b) => b[1].won + b[1].lost + b[1].drawn - (a[1].won + a[1].lost + a[1].drawn))[0]?.[0] ?? null;

  // Photos and places (photos taken this month, else added this month).
  const pics = photos.filter((p) => inMonth(p.hasTakenDate ? p.taken : p.added, from, to));
  const placeCount = new Map<string, number>();
  for (const p of pics) if (p.place) placeCount.set(p.place, (placeCount.get(p.place) ?? 0) + 1);
  const places = [...placeCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([place, n]) => ({ place, count: n }));
  const covers = pics.filter((p) => !p.private).slice(0, 6).map((p) => p.id);

  // Brain.
  const remindersDone = ((doneReminders.data ?? []) as { metadata?: { reminder?: { status?: string } } }[]).filter((r) => r.metadata?.reminder?.status === "done").length;
  const kurals = ((kuralFiles.data ?? []) as { name: string }[]).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f.name) && f.name.startsWith(month)).length;
  const activeDays = new Set([...((chatRows.data ?? []) as { created_at: string }[]).map((m) => dayOf(m.created_at)), ...ci.map((c) => c.date), ...games.map((g) => dayOf(g.at))]).size;

  const w: Wrapped = {
    month,
    label,
    complete,
    headline: "",
    activeDays,
    moods: { count: ci.length, faces, average: ci.length ? Math.round((ci.reduce((s, c) => s + c.mood, 0) / ci.length) * 10) / 10 : null, best: bestCi ? { date: bestCi.date, mood: bestCi.mood, words: bestWords } : null },
    habits: habitRows.slice(0, 5),
    music: { plays: plays.length, top, topArtist },
    games: { played: games.length, won: games.filter((g) => g.outcome === "win").length, lost: games.filter((g) => g.outcome === "loss").length, drawn: games.filter((g) => g.outcome === "draw").length, favourite, byGame },
    photos: { count: pics.length, places, covers },
    brain: { notes, memories, documents, chats, remindersDone, kurals },
  };

  // The headline: one warm line from the facts above (the only AI-written part).
  const kept = !settled ? await readJSON<{ headline: string } | null>(supabase, cacheKey, null) : null;
  w.headline =
    kept?.headline ??
    (await generateWithFallback(
      [
        {
          role: "user",
          content: `Facts about the owner's ${label}${complete ? "" : " so far"} (from their own app):\n${JSON.stringify({ moods: w.moods.faces, mood_avg: w.moods.average, top_habit: habitRows[0], top_song: top[0], top_artist: topArtist, games: w.games, photos: pics.length, places: places.map((p) => p.place), brain: w.brain, active_days: activeDays })}`,
        },
      ],
      { system: "Write ONE short, warm, specific headline (max 14 words) summing up this month like a 'Wrapped' title card, in English, a Tamil word is fine. Use only the facts given; no made-up details; no quotes or emojis at the ends.", temperature: 0.7, maxTokens: 60 },
    )
      .then((r) => r.text.trim().replace(/^["']|["']$/g, "").slice(0, 120))
      .catch(() => `Your ${label}${complete ? "" : " so far"}`));

  await writeJSON(supabase, cacheKey, settled ? w : { headline: w.headline }).catch(() => {});
  return w;
}

/** The months that have anything to show: this one and the last eleven. */
export function recentMonths(n = 12) {
  const [y, m] = localParts().date.split("-").map(Number);
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1 - i, 15));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  });
}

export const moodWord = (m: number) => MOODS[m as 1 | 2 | 3 | 4 | 5]?.word ?? "";
