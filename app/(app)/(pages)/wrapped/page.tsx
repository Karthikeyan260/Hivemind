"use client";

import { ChevronLeft, ChevronRight, Loader2, Pause, Play, Share2 } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { cx, ErrorText, PageHeader } from "@/components/ui";
import { useVoiceActions } from "@/components/voice/provider";
import { useFetch } from "@/lib/client-api";
import type { Wrapped } from "@/lib/wrapped";

type Feed = { wrapped: Wrapped; months: string[] };
const FACES = ["😞", "😕", "😐", "🙂", "😄"];
const CARD_MS = 7000;
const monthName = (m: string) => new Date(`${m}-15T12:00:00Z`).toLocaleDateString("en-IN", { month: "short", year: "2-digit" });

export default function WrappedPage() {
  return (
    <Suspense>
      <WrappedView />
    </Suspense>
  );
}

/** My Wrapped: a month of your life as story cards. Tap the right side for next, the left for back. */
function WrappedView() {
  const router = useRouter();
  const params = useSearchParams();
  const m = params.get("m") ?? "";
  const feed = useFetch<Feed>(`/api/wrapped${m ? `?m=${m}` : ""}`);
  const w = feed.data?.wrapped;
  const cards = useMemo(() => (w ? buildCards(w) : []), [w]);
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  // The timer works on refs (one source of truth), and copies the time into state for the bars.
  const at = useRef({ i: 0, ms: 0 });

  useEffect(() => {
    at.current = { i: 0, ms: 0 };
    // eslint-disable-next-line react-hooks/set-state-in-effect -- a new month starts at its first card
    setI(0);
    setElapsed(0);
  }, [w?.month]);

  // Auto-advance like stories: each card ~7 s, paused while held or with the pause button.
  useEffect(() => {
    if (!cards.length || paused) return;
    const t = setInterval(() => {
      const a = at.current;
      a.ms += 100;
      if (a.ms >= CARD_MS) {
        a.ms = 0;
        if (a.i < cards.length - 1) setI(++a.i);
      }
      setElapsed(a.ms);
    }, 100);
    return () => clearInterval(t);
  }, [cards.length, paused]);

  const go = (d: number) => {
    const a = at.current;
    a.i = Math.min(cards.length - 1, Math.max(0, a.i + d));
    a.ms = 0;
    setI(a.i);
    setElapsed(0);
  };
  const pick = (month: string) => router.replace(`/wrapped?m=${month}`);

  async function share() {
    if (!w) return;
    const text = summary(w);
    try {
      if (navigator.share) await navigator.share({ title: `My ${w.label} Wrapped`, text });
      else await navigator.clipboard.writeText(text);
    } catch {}
  }

  useVoiceActions({
    wrapped_month: {
      description: "Wrapped page: show a month's Wrapped. input: the month, e.g. 'september', 'last month', '2026-09', or empty for this month.",
      run: ({ input }) => {
        const t = String(input ?? "").toLowerCase();
        const months = feed.data?.months ?? [];
        const longName = (x: string) => new Date(`${x}-15T12:00:00Z`).toLocaleDateString("en-IN", { month: "long" }).toLowerCase();
        const target = /last month/.test(t) ? months[1] : (months.find((x) => t.includes(x)) ?? months.find((x) => t.includes(longName(x))) ?? months[0]);
        if (!target) return { error: "No months yet." };
        pick(target);
        return { showing: target };
      },
    },
    wrapped_card: {
      description: "Wrapped page: go to the 'next' or 'previous' card, or 'pause' / 'play' the stories.",
      run: ({ input }) => {
        const t = String(input ?? "").toLowerCase();
        if (/pause|stop|hold/.test(t)) return setPaused(true), { paused: true };
        if (/play|resume|continue/.test(t)) return setPaused(false), { playing: true };
        go(/prev|back/.test(t) ? -1 : 1);
        return { card: cards[Math.min(cards.length - 1, Math.max(0, i + (/prev|back/.test(t) ? -1 : 1)))]?.key };
      },
    },
    wrapped_read: {
      description: "Wrapped page: the month's facts in words, to read out.",
      run: () => (w ? { month: w.label, so_far: !w.complete, summary: summary(w) } : { error: "Still loading." }),
    },
  });

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader eyebrow="Your month" title="My Wrapped" subtitle="Your month in story cards: moods, habits, songs, games, photos and places. Tap the right side for next, the left to go back." />
      <div className="no-scrollbar -mx-1 mb-4 flex gap-1.5 overflow-x-auto px-1">
        {(feed.data?.months ?? []).map((x) => (
          <button key={x} type="button" onClick={() => pick(x)} className={cx("shrink-0 rounded-full border px-3 py-1 text-xs", (w?.month ?? "") === x ? "border-core bg-core/15 text-core" : "border-line text-soft hover:text-fg")}>
            {monthName(x)}
          </button>
        ))}
      </div>
      <ErrorText error={feed.error} />
      {!w ? (
        <div className="flex h-[60dvh] items-center justify-center gap-2 text-sm text-soft">
          <Loader2 size={16} className="animate-spin text-core" /> Putting your month together…
        </div>
      ) : (
        <div className="mx-auto w-full max-w-sm">
          <div
            className="relative aspect-[9/16] max-h-[78dvh] w-full select-none overflow-hidden rounded-3xl shadow-2xl"
            onPointerDown={() => setPaused(true)}
            onPointerUp={() => setPaused(false)}
            onPointerLeave={() => setPaused(false)}
          >
            {/* Progress bars, one per card. */}
            <div className="absolute inset-x-3 top-3 z-20 flex gap-1">
              {cards.map((c, k) => (
                <div key={c.key} className="h-1 flex-1 overflow-hidden rounded-full bg-white/25">
                  <div className="h-full bg-white transition-[width] duration-100 ease-linear" style={{ width: k < i ? "100%" : k === i ? `${Math.min(100, (elapsed / CARD_MS) * 100)}%` : "0%" }} />
                </div>
              ))}
            </div>
            {cards[i] && (
              <div key={`${w.month}-${cards[i].key}`} className={cx("wrapped-in absolute inset-0 flex flex-col p-6 pt-10 text-white", cards[i].bg)}>
                {cards[i].body}
              </div>
            )}
            {/* Tap areas: left third back, the rest next. */}
            <button type="button" aria-label="Previous card" onClick={() => go(-1)} className="absolute inset-y-0 left-0 z-10 w-1/3" />
            <button type="button" aria-label="Next card" onClick={() => go(1)} className="absolute inset-y-0 right-0 z-10 w-2/3" />
          </div>
          <div className="mt-3 flex items-center justify-center gap-2">
            <button type="button" onClick={() => go(-1)} disabled={i === 0} aria-label="Previous" className="rounded-full border border-line p-2 disabled:opacity-30">
              <ChevronLeft size={16} />
            </button>
            <button type="button" onClick={() => setPaused((p) => !p)} aria-label={paused ? "Play" : "Pause"} className="rounded-full border border-line p-2">
              {paused ? <Play size={16} /> : <Pause size={16} />}
            </button>
            <button type="button" onClick={() => go(1)} disabled={i === cards.length - 1} aria-label="Next" className="rounded-full border border-line p-2 disabled:opacity-30">
              <ChevronRight size={16} />
            </button>
            <button type="button" onClick={share} className="ml-2 flex items-center gap-1.5 rounded-full bg-core px-4 py-2 text-sm font-semibold text-core-ink">
              <Share2 size={14} /> Share
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** The month in words (for Share and for the voice). */
function summary(w: Wrapped) {
  const parts = [`My ${w.label}${w.complete ? "" : " so far"} on HIVEMIND: ${w.headline}.`];
  if (w.moods.count) parts.push(`Mood: ${FACES[Math.round(w.moods.average ?? 3) - 1]} over ${w.moods.count} check-ins.`);
  if (w.habits[0]) parts.push(`Top habit: ${w.habits[0].name}, ${w.habits[0].done} days (best run ${w.habits[0].bestRun}).`);
  if (w.music.top[0]) parts.push(`Most played: ${w.music.top[0].title}${w.music.topArtist ? `; top artist ${w.music.topArtist}` : ""}.`);
  if (w.games.played) parts.push(`Games: ${w.games.won} won, ${w.games.lost} lost${w.games.favourite ? `, mostly ${w.games.favourite}` : ""}.`);
  if (w.photos.count) parts.push(`${w.photos.count} photos${w.photos.places[0] ? `, most at ${w.photos.places[0].place}` : ""}.`);
  parts.push(`${w.brain.chats} chats, ${w.brain.notes} notes, ${w.brain.memories} memories.`);
  return parts.join(" ");
}

type Card = { key: string; bg: string; body: React.ReactNode };

function Big({ children }: { children: React.ReactNode }) {
  return <div className="text-6xl font-black leading-none tracking-tight">{children}</div>;
}
function Kicker({ children }: { children: React.ReactNode }) {
  return <div className="mb-3 font-mono text-[11px] uppercase tracking-[0.25em] text-white/70">{children}</div>;
}

function buildCards(w: Wrapped): Card[] {
  const so = w.complete ? "" : " so far";
  const cards: Card[] = [
    {
      key: "intro",
      bg: "bg-gradient-to-br from-[#f5b400] via-[#e5484d] to-[#7c3aed]",
      body: (
        <div className="flex flex-1 flex-col justify-center">
          <Kicker>My Wrapped</Kicker>
          <div className="text-5xl font-black leading-[0.95] tracking-tight">{w.label}</div>
          <p className="mt-5 text-xl font-semibold leading-snug">{w.headline}</p>
          <p className="mt-6 text-sm text-white/80">
            {w.activeDays} active {w.activeDays === 1 ? "day" : "days"} with HIVEMIND{so}.
          </p>
        </div>
      ),
    },
  ];
  if (w.moods.count) {
    const max = Math.max(1, ...w.moods.faces);
    cards.push({
      key: "moods",
      bg: "bg-gradient-to-br from-[#2f7fe8] to-[#0f172a]",
      body: (
        <div className="flex flex-1 flex-col justify-center">
          <Kicker>Your mood</Kicker>
          <Big>{FACES[Math.round(w.moods.average ?? 3) - 1]}</Big>
          <p className="mt-3 text-lg font-semibold">
            {w.moods.count} night check-ins{so}
          </p>
          <div className="mt-6 flex h-32 items-end gap-3">
            {w.moods.faces.map((n, k) => (
              <div key={k} className="flex flex-1 flex-col items-center gap-1">
                <span className="text-xs text-white/80">{n || ""}</span>
                <div className="w-full rounded-t-md bg-white/85" style={{ height: `${(n / max) * 100}%`, minHeight: n ? 6 : 2, opacity: n ? 1 : 0.25 }} />
                <span className="text-lg">{FACES[k]}</span>
              </div>
            ))}
          </div>
          {w.moods.best?.words && (
            <p className="mt-6 border-l-2 border-white/60 pl-3 text-sm italic text-white/90">
              &ldquo;{w.moods.best.words}&rdquo;
              <span className="mt-1 block text-xs not-italic text-white/60">{new Date(`${w.moods.best.date}T12:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</span>
            </p>
          )}
        </div>
      ),
    });
  }
  if (w.habits.length) {
    const h = [...w.habits].sort((a, b) => b.bestRun - a.bestRun)[0];
    cards.push({
      key: "habits",
      bg: "bg-gradient-to-br from-[#16a34a] to-[#052e16]",
      body: (
        <div className="flex flex-1 flex-col justify-center">
          <Kicker>Habits</Kicker>
          <Big>🔥 {h.bestRun}</Big>
          <p className="mt-3 text-lg font-semibold">
            days in a row of {h.emoji} {h.name}
          </p>
          <ul className="mt-6 space-y-2 text-sm">
            {w.habits.map((x) => (
              <li key={x.name} className="flex items-center gap-2">
                <span className="w-28 truncate">
                  {x.emoji} {x.name}
                </span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/20">
                  <div className="h-full bg-white" style={{ width: `${x.scheduled ? (x.done / x.scheduled) * 100 : 0}%` }} />
                </div>
                <span className="w-12 text-right font-mono text-xs">
                  {x.done}/{x.scheduled}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ),
    });
  }
  if (w.music.plays) {
    cards.push({
      key: "music",
      bg: "bg-gradient-to-br from-[#db2777] to-[#3b0764]",
      body: (
        <div className="flex flex-1 flex-col justify-center">
          <Kicker>On repeat</Kicker>
          <Big>{w.music.plays}</Big>
          <p className="mt-2 text-lg font-semibold">songs played{so}</p>
          {w.music.topArtist && <p className="text-sm text-white/80">Top artist: {w.music.topArtist}</p>}
          <ol className="mt-5 space-y-2.5">
            {w.music.top.map((s, k) => (
              <li key={s.title + k} className="flex items-center gap-3">
                <span className="w-4 font-mono text-sm text-white/70">{k + 1}</span>
                {s.image ? (
                  // eslint-disable-next-line @next/next/no-img-element -- album art from the music service
                  <img src={s.image} alt="" className="size-10 rounded-md object-cover" />
                ) : (
                  <div className="size-10 rounded-md bg-white/20" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold">{s.title}</div>
                  <div className="truncate text-xs text-white/70">{s.artists}</div>
                </div>
                <span className="font-mono text-xs text-white/70">×{s.count}</span>
              </li>
            ))}
          </ol>
        </div>
      ),
    });
  }
  if (w.games.played) {
    cards.push({
      key: "games",
      bg: "bg-gradient-to-br from-[#f97316] to-[#431407]",
      body: (
        <div className="flex flex-1 flex-col justify-center">
          <Kicker>Game time</Kicker>
          <Big>{w.games.played}</Big>
          <p className="mt-2 text-lg font-semibold">games played{so}</p>
          <p className="mt-1 text-sm text-white/85">
            {w.games.won} won · {w.games.lost} lost{w.games.drawn ? ` · ${w.games.drawn} drawn` : ""}
          </p>
          {w.games.favourite && <p className="mt-4 text-2xl font-black">Favourite: {w.games.favourite}</p>}
          <ul className="mt-4 space-y-1 text-sm text-white/85">
            {Object.entries(w.games.byGame).map(([g, r]) => (
              <li key={g}>
                {g}: {r.won}W {r.lost}L{r.drawn ? ` ${r.drawn}D` : ""}
              </li>
            ))}
          </ul>
        </div>
      ),
    });
  }
  if (w.photos.count) {
    cards.push({
      key: "photos",
      bg: "bg-gradient-to-br from-[#0d9488] to-[#042f2e]",
      body: (
        <div className="flex flex-1 flex-col justify-center">
          <Kicker>Places & photos</Kicker>
          <Big>{w.photos.count}</Big>
          <p className="mt-2 text-lg font-semibold">photos{so}</p>
          {w.photos.places[0] && <p className="text-sm text-white/85">📍 Most at {w.photos.places[0].place}</p>}
          <div className="mt-5 grid grid-cols-3 gap-1.5">
            {w.photos.covers.map((id) => (
              // eslint-disable-next-line @next/next/no-img-element -- the owner's private photo
              <img key={id} src={`/api/photos/${id}?t=1`} alt="" className="aspect-square w-full rounded-lg object-cover" />
            ))}
          </div>
          {w.photos.places.length > 1 && <p className="mt-3 text-xs text-white/75">Also: {w.photos.places.slice(1).map((p) => p.place).join(" · ")}</p>}
        </div>
      ),
    });
  }
  const b = w.brain;
  cards.push({
    key: "brain",
    bg: "bg-gradient-to-br from-[#7c3aed] to-[#1e1b4b]",
    body: (
      <div className="flex flex-1 flex-col justify-center">
        <Kicker>Your second brain</Kicker>
        <div className="grid grid-cols-2 gap-4">
          {(
            [
              [b.chats, "chats with HIVEMIND"],
              [b.memories, "memories saved"],
              [b.notes, "notes"],
              [b.documents, "documents"],
              [b.remindersDone, "reminders done"],
              [b.kurals, "kurals read"],
            ] as const
          ).map(([n, label]) => (
            <div key={label}>
              <div className="text-4xl font-black">{n}</div>
              <div className="text-xs text-white/75">{label}</div>
            </div>
          ))}
        </div>
      </div>
    ),
  });
  cards.push({
    key: "outro",
    bg: "bg-gradient-to-br from-[#111827] via-[#1f2937] to-[#f5b400]",
    body: (
      <div className="flex flex-1 flex-col items-start justify-center">
        <Kicker>{w.complete ? "That was" : "So far"}</Kicker>
        <div className="text-5xl font-black leading-[0.95]">{w.label}</div>
        <p className="mt-5 text-base text-white/85">{w.complete ? "See you next month." : "The full story arrives on the 1st."}</p>
        <p className="mt-2 text-xs text-white/60">Tap Share to send it to a friend.</p>
      </div>
    ),
  });
  return cards;
}
