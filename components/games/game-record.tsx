"use client";

import { Crown, Dices, Grid3x3, Layers, PenLine, Trophy } from "lucide-react";
import { cx } from "@/components/ui";
import { useFetch } from "@/lib/client-api";

type Row = { game: "chess" | "cards" | "ludo" | "draw" | "dots"; mode: "bot" | "friend"; outcome: "win" | "loss" | "draw"; vs: string; level?: string; detail?: string; at: string };

const GAMES = { chess: { title: "Chess", icon: Crown }, cards: { title: "Colour Clash", icon: Layers }, ludo: { title: "Ludo", icon: Dices }, draw: { title: "Draw & Guess", icon: PenLine }, dots: { title: "Dots & Boxes", icon: Grid3x3 } } as const;
const LEVELS = ["beginner", "easy", "medium", "hard"] as const;
const LABEL: Record<string, string> = { beginner: "Beginner", easy: "Easy", medium: "Medium", hard: "Hard" };
const TONE = { win: "bg-ok text-black", loss: "bg-alert text-white", draw: "bg-raised text-soft" } as const;

const ago = (iso: string) => {
  const m = Math.round((Date.now() - +new Date(iso)) / 60_000);
  return m < 60 ? `${Math.max(1, m)}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`;
};
const tally = (rows: Row[]) => ({ win: rows.filter((r) => r.outcome === "win").length, loss: rows.filter((r) => r.outcome === "loss").length, draw: rows.filter((r) => r.outcome === "draw").length });

/** The level you're at: the hardest one you've beaten at least half of your last 5 games against. */
function chessLevel(bot: Row[]) {
  let at: string | null = null;
  for (const lv of LEVELS) {
    const last = bot.filter((r) => r.level === lv).slice(0, 5);
    if (last.length && last.filter((r) => r.outcome === "win").length * 2 >= last.length) at = lv;
  }
  return at;
}

/** Your record on the Games page: wins and losses per game, your chess level, recent games. */
export function GameRecord() {
  const { data } = useFetch<{ results: Row[] }>("/api/games/stats");
  const rows = data?.results ?? [];
  if (!rows.length) return null;
  const bot = rows.filter((r) => r.game === "chess" && r.mode === "bot");
  const level = chessLevel(bot);
  // Oldest first, so the strip reads left to right like a timeline.
  const timeline = bot.slice(0, 20).reverse();

  return (
    <section className="mt-6 rounded-xl border border-line bg-panel p-4">
      <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold">
        <Trophy size={18} className="text-core" /> Your record
      </h2>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {(Object.keys(GAMES) as Row["game"][]).map((g) => {
          const t = tally(rows.filter((r) => r.game === g));
          const n = t.win + t.loss + t.draw;
          const G = GAMES[g];
          return (
            <div key={g} className={cx("rounded-lg border border-line p-3", !n && "opacity-50")}>
              <div className="flex items-center gap-1.5 text-xs text-soft">
                <G.icon size={13} /> {G.title}
              </div>
              <div className="mt-1 font-mono text-lg font-bold">
                <span className={t.win ? "text-ok" : "text-faint"}>{t.win}W</span> <span className={t.loss ? "text-alert" : "text-faint"}>{t.loss}L</span>
                {!!t.draw && <span className="text-soft"> {t.draw}D</span>}
              </div>
              <div className="text-[11px] text-faint">{n ? `${Math.round((t.win / n) * 100)}% wins · ${n} played` : "Not played yet"}</div>
            </div>
          );
        })}
      </div>

      {!!bot.length && (
        <div className="mt-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-sm font-semibold">Chess vs HIVEMIND</h3>
            <span className="text-xs text-soft">
              Your level: <b className="text-core">{level ? LABEL[level] : "Getting started"}</b>
              {level && level !== "hard" && ` · next: beat ${LABEL[LEVELS[LEVELS.indexOf(level as (typeof LEVELS)[number]) + 1]]}`}
            </span>
          </div>
          <div className="mt-2 grid grid-cols-4 gap-2 text-center text-xs">
            {LEVELS.map((lv) => {
              const t = tally(bot.filter((r) => r.level === lv));
              return (
                <div key={lv} className={cx("rounded-md border px-1 py-1.5", lv === level ? "border-core/60 bg-core/10" : "border-line")}>
                  <div className="text-soft">{LABEL[lv]}</div>
                  <div className="font-mono">
                    {t.win}–{t.loss}
                    {t.draw ? `–${t.draw}` : ""}
                  </div>
                </div>
              );
            })}
          </div>
          {/* Level over time: each game, oldest to newest, coloured by the result and tagged with the level. */}
          <div className="mt-2 flex flex-wrap gap-1" aria-label="Your last games against HIVEMIND, oldest first">
            {timeline.map((r, i) => (
              <span key={i} title={`${LABEL[r.level ?? ""] ?? "?"}: ${r.outcome}${r.detail ? ` by ${r.detail}` : ""} · ${ago(r.at)}`} className={cx("flex size-6 items-center justify-center rounded text-[10px] font-bold", TONE[r.outcome])}>
                {(r.level ?? "?")[0].toUpperCase()}
              </span>
            ))}
          </div>
          <p className="mt-1 text-[11px] text-faint">Each square is a game (B/E/M/H = level; green won, red lost), oldest first.</p>
        </div>
      )}

      <h3 className="mb-1.5 mt-4 text-sm font-semibold">Recent games</h3>
      <ul className="divide-y divide-line text-sm">
        {rows.slice(0, 8).map((r, i) => {
          const G = GAMES[r.game];
          return (
            <li key={i} className="flex items-center gap-2 py-1.5">
              <G.icon size={14} className="shrink-0 text-soft" />
              <span className="min-w-0 flex-1">
                <span className="block truncate">
                  {G.title} vs {r.vs}
                  {r.level ? ` (${LABEL[r.level] ?? r.level})` : ""}
                </span>
                {r.detail && <span className="block truncate text-xs text-faint">{r.detail}</span>}
              </span>
              <span className={cx("shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase", TONE[r.outcome])}>{r.outcome}</span>
              <span className="w-14 shrink-0 text-right font-mono text-[10.5px] text-faint">{ago(r.at)}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
