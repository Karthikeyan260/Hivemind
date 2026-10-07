import { NextResponse } from "next/server";
import { z } from "zod";
import { handle, HttpError, parseBody } from "@/lib/api";
import { db } from "@/lib/db";
import { buildQuiz, THEMES } from "@/lib/games/paattu";
import { readJSON, writeJSON } from "@/lib/private-store";

const SCORES = "games/paattu-best";
// Songs already played, per theme, so the next rounds bring new ones.
const SEEN = "games/paattu-seen";

/** A new round: ten songs from the theme, with answer options. Also the themes and best scores. */
export const GET = handle(async (req: Request) => {
  const params = new URL(req.url).searchParams;
  const theme = params.get("theme");
  const supabase = db();
  const best = await readJSON<Record<string, number>>(supabase, SCORES, {});
  const themes = Object.entries(THEMES).map(([id, t]) => ({ id, label: t.label, best: best[id] ?? 0 }));
  if (!theme) return NextResponse.json({ themes });
  if (!THEMES[theme]) throw new HttpError(400, "Unknown theme");
  try {
    const seen = await readJSON<Record<string, string[]>>(supabase, SEEN, {});
    const quiz = await buildQuiz(theme, { hard: params.get("level") === "hard", avoid: seen[theme] ?? [] });
    await writeJSON(supabase, SEEN, { ...seen, [theme]: [...(seen[theme] ?? []), ...quiz.questions.map((q) => q.song.title)].slice(-80) }).catch(() => {});
    return NextResponse.json({ themes, quiz });
  } catch (err) {
    throw new HttpError(502, err instanceof Error ? err.message : "Couldn't make the quiz.");
  }
});

/** Saves a finished round's score; returns whether it's a new best. */
export const POST = handle(async (req: Request) => {
  const { theme, score } = await parseBody(req, z.object({ theme: z.string().max(20), score: z.number().int().min(0).max(100_000) }));
  if (!THEMES[theme]) throw new HttpError(400, "Unknown theme");
  const supabase = db();
  const best = await readJSON<Record<string, number>>(supabase, SCORES, {});
  const record = score > (best[theme] ?? 0);
  if (record) await writeJSON(supabase, SCORES, { ...best, [theme]: score });
  return NextResponse.json({ record, best: Math.max(score, best[theme] ?? 0) });
});
