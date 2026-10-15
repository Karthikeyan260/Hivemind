import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { listCheckins } from "@/lib/checkin";
import { listResults } from "@/lib/games/stats";
import { listHabits } from "@/lib/habits";
import { listPlays } from "@/lib/plays";
import { readJSON, writeJSON } from "@/lib/private-store";
import { addDays, localParts } from "@/lib/reminders";

/**
 * Nova: a little glowing lantern that lives in HIVEMIND and grows with the owner (the owner can rename it).
 * Nothing extra to log: it feeds on finished habits, check-ins, game wins, saved memories and music,
 * all counted from the day it was born, so it starts as a seed and grows over weeks.
 */
/** walks: the local date of each finished lantern walk (all sparks found). */
/** missedFor / stageNotified: which absence and which stage already got a push (so each one goes once). */
type Saved = { born: string; lastSeen: string; name?: string; walks?: string[]; missedFor?: string; stageNotified?: number };
export const DEFAULT_NAME = "Nova";
const KEY = "pet";

export const STAGES = [
  { at: 0, name: "Star seed" },
  { at: 60, name: "Baby" },
  { at: 300, name: "Glowing" },
  { at: 900, name: "Crowned" },
] as const;

export type PetMood = "happy" | "hungry" | "sulking" | "missed";
export type Pet = {
  name: string;
  born: string;
  days: number;
  xp: number;
  stage: number;
  stageName: string;
  /** Growth points still needed for the next stage (null at the last one). */
  toNext: number | null;
  /** 0..1 within the current stage. */
  progress: number;
  mood: PetMood;
  fed: { done: number; due: number };
  today: string[];
  line: string;
};

/** Growth points per thing done (music is capped so leaving a playlist on doesn't count much). */
const XP = { habit: 10, checkin: 8, win: 6, game: 2, memory: 2, play: 1, playsPerDay: 10, walk: 5, walksPerDay: 3 } as const;

/** The owner looking at it (the app) marks today as seen; the scheduler checking on it (touch: false) doesn't. */
export async function getPet(supabase: SupabaseClient, now = new Date(), opts: { touch?: boolean } = {}): Promise<Pet> {
  const today = localParts(now).date;
  const saved = await readJSON<Saved | null>(supabase, KEY, null);
  const born = saved?.born ?? today;
  const name = saved?.name || DEFAULT_NAME;
  const walks = saved?.walks ?? [];
  const away = saved ? Math.round((+new Date(`${today}T00:00:00Z`) - +new Date(`${saved.lastSeen}T00:00:00Z`)) / 86_400_000) : 0;
  if ((opts.touch ?? true) && (!saved || saved.lastSeen !== today)) await writeJSON(supabase, KEY, { ...saved, born, lastSeen: today } satisfies Saved).catch(() => {});

  const months = [...new Set([born.slice(0, 7), today.slice(0, 7)])];
  const [habits, checkins, games, plays, memories] = await Promise.all([
    listHabits(supabase).catch(() => []),
    listCheckins(supabase).catch(() => []),
    listResults(supabase).catch(() => []),
    Promise.all(months.map((m) => listPlays(supabase, m).catch(() => []))).then((x) => x.flat()),
    supabase
      .from("memories")
      .select("id", { count: "exact", head: true })
      .gte("created_at", `${born}T00:00:00+05:30`)
      .then((r) => r.count ?? 0),
  ]);

  const habitDays = habits.flatMap((h) => h.log.filter((d) => d >= born));
  const myCheckins = checkins.filter((c) => c.date >= born);
  const myGames = games.filter((g) => localParts(new Date(g.at)).date >= born);
  const playsByDay = new Map<string, number>();
  for (const p of plays) {
    const d = localParts(new Date(p.at)).date;
    if (d >= born) playsByDay.set(d, (playsByDay.get(d) ?? 0) + 1);
  }
  const playXp = [...playsByDay.values()].reduce((a, n) => a + Math.min(n, XP.playsPerDay) * XP.play, 0);
  const wins = myGames.filter((g) => g.outcome === "win").length;
  const xp = habitDays.length * XP.habit + myCheckins.length * XP.checkin + wins * XP.win + myGames.length * XP.game + memories * XP.memory + playXp + walks.length * XP.walk;

  const stage = STAGES.reduce((s, x, i) => (xp >= x.at ? i : s), 0);
  const next = STAGES[stage + 1];
  const progress = next ? (xp - STAGES[stage].at) / (next.at - STAGES[stage].at) : 1;

  // Today: what fed it, and how hungry it still is.
  const dow = new Date(`${today}T00:00:00Z`).getUTCDay();
  const dueToday = habits.filter((h) => h.days.includes(dow) && h.created.slice(0, 10) <= today);
  const doneToday = dueToday.filter((h) => h.log.includes(today));
  const todayList = [
    ...doneToday.map((h) => `${h.emoji || "✅"} ${h.name} (+${XP.habit})`),
    ...(myCheckins.some((c) => c.date === today) ? [`🌙 Night check-in (+${XP.checkin})`] : []),
    ...myGames.filter((g) => localParts(new Date(g.at)).date === today && g.outcome === "win").map((g) => `🏆 Won ${g.game} (+${XP.win + XP.game})`),
    ...(walks.filter((d) => d === today).length ? [`🏮 ${walks.filter((d) => d === today).length} lantern walk${walks.filter((d) => d === today).length === 1 ? "" : "s"} (+${walks.filter((d) => d === today).length * XP.walk})`] : []),
    ...(playsByDay.get(today) ? [`🎵 ${playsByDay.get(today)} songs (+${Math.min(playsByDay.get(today)!, XP.playsPerDay)})`] : []),
  ];

  // Sulks when habits were skipped two scheduled days running (and nothing else happened since).
  const missedDay = (d: string) => {
    const w = new Date(`${d}T00:00:00Z`).getUTCDay();
    const due = habits.filter((h) => h.days.includes(w) && h.created.slice(0, 10) <= d && d >= born);
    return due.length > 0 && due.every((h) => !h.log.includes(d));
  };
  const sulking = missedDay(addDays(today, -1)) && missedDay(addDays(today, -2)) && doneToday.length === 0;
  const hour = localParts(now).hour;
  const mood: PetMood = away >= 3 ? "missed" : sulking ? "sulking" : dueToday.length > doneToday.length && doneToday.length === 0 && hour >= 11 ? "hungry" : "happy";

  return {
    name,
    born,
    days: Math.round((+new Date(`${today}T00:00:00Z`) - +new Date(`${born}T00:00:00Z`)) / 86_400_000) + 1,
    xp,
    stage,
    stageName: stage === 0 ? STAGES[0].name : `${STAGES[stage].name} ${name}`,
    toNext: next ? next.at - xp : null,
    progress: Math.max(0, Math.min(1, progress)),
    mood,
    fed: { done: doneToday.length, due: dueToday.length },
    today: todayList,
    line: petLine(mood, dueToday.length - doneToday.length, away),
  };
}

/** What Nova says (Tanglish, short). */
function petLine(mood: PetMood, left: number, away: number) {
  switch (mood) {
    case "missed":
      return `${away} days aachu! Enga poneenga? I missed you 🥺`;
    case "sulking":
      return "Hmph. Rendu naal habits skip panniteenga… pesa maatten 😤";
    case "hungry":
      return `Saapadu podu! ${left} habit${left === 1 ? "" : "s"} innum pending 🍚`;
    default:
      return left > 0 ? `Vayiru konjam full. Innum ${left} habit${left === 1 ? "" : "s"} irukku!` : "Full vayiru, full happy! ✨";
  }
}

/** A new name for the pet: letters (any script), spaces, - and ', up to 20 characters. */
export function cleanPetName(raw: string) {
  const name = raw.normalize("NFC").replace(/[^\p{L}\p{M}\p{N} '-]/gu, "").replace(/\s+/g, " ").trim().slice(0, 20);
  return name ? name.charAt(0).toUpperCase() + name.slice(1) : "";
}

export async function renamePet(supabase: SupabaseClient, raw: string) {
  const name = cleanPetName(raw);
  if (!name) throw new Error("Give it a name with letters, up to 20 characters.");
  const today = localParts().date;
  const saved = await readJSON<Saved | null>(supabase, KEY, null);
  await writeJSON(supabase, KEY, { ...saved, born: saved?.born ?? today, lastSeen: saved?.lastSeen ?? today, name } satisfies Saved);
  return name;
}

/** A lantern walk where every spark was found: growth points, up to 3 walks a day. */
export async function logWalk(supabase: SupabaseClient) {
  const today = localParts().date;
  const saved = await readJSON<Saved | null>(supabase, KEY, null);
  const walks = saved?.walks ?? [];
  const todays = walks.filter((d) => d === today).length;
  if (todays >= XP.walksPerDay) return { counted: false, xp: 0 };
  await writeJSON(supabase, KEY, { ...saved, born: saved?.born ?? today, lastSeen: today, walks: [...walks, today].slice(-500) } satisfies Saved);
  return { counted: true, xp: XP.walk };
}

/**
 * The pet's own pushes (the scheduler runs this): "misses you" once the owner has been away 3 days
 * (once per absence, daytime only), and "evolved!" once per new stage. Its evening "hungry" nudge
 * lives with the habit reminders (lib/habits.ts), where it replaces the old one-per-habit nudge.
 */
export async function runPetNudges(supabase: SupabaseClient, now = new Date()) {
  const saved = await readJSON<Saved | null>(supabase, KEY, null);
  if (!saved) return 0;
  const { notify } = await import("@/lib/push");
  const lp = localParts(now);
  const name = saved.name || DEFAULT_NAME;
  const changes: Partial<Saved> = {};
  let sent = 0;

  const away = Math.round((+new Date(`${lp.date}T00:00:00Z`) - +new Date(`${saved.lastSeen}T00:00:00Z`)) / 86_400_000);
  if (away >= 3 && lp.hour >= 10 && lp.hour < 21 && saved.missedFor !== saved.lastSeen) {
    sent += await notify(supabase, { title: `🥺 ${name} misses you`, body: `${away} days aachu! Vaa, konjam pesalam. Your habits and ${name} are waiting.`, url: "/", tag: "pet" });
    changes.missedFor = saved.lastSeen;
  }

  const pet = await getPet(supabase, now, { touch: false });
  if (saved.stageNotified === undefined) changes.stageNotified = pet.stage;
  else if (pet.stage > saved.stageNotified && lp.hour >= 8 && lp.hour < 22) {
    sent += await notify(supabase, { title: `✨ ${name} evolved!`, body: `Now a ${pet.stageName}. Come see the new look 🏮`, url: "/", tag: "pet" });
    changes.stageNotified = pet.stage;
  }

  // Merged into a fresh read, so a rename or walk logged meanwhile isn't lost.
  if (Object.keys(changes).length) {
    const fresh = await readJSON<Saved | null>(supabase, KEY, null);
    if (fresh) await writeJSON(supabase, KEY, { ...fresh, ...changes } satisfies Saved);
  }
  return sent;
}

/** The pet's current name (the default until renamed). */
export const petName = async (supabase: SupabaseClient) => (await readJSON<Saved | null>(supabase, KEY, null).catch(() => null))?.name || DEFAULT_NAME;
