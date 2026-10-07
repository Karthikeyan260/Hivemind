"use client";

import { ArrowLeft, Check, Loader2, Music2, Play, RotateCcw, Trophy, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { MascotFrame, type MascotFrameName } from "@/components/mascot";
import { Button, cx, ErrorText } from "@/components/ui";
import { useVoiceActions } from "@/components/voice/provider";
import { api, MEDIA_START_EVENT, useFetch } from "@/lib/client-api";

type Kind = "film" | "hero" | "singer" | "year" | "song";
type Question = { kind: Kind; options: string[]; answer: number; start: number; song: { title: string; artists: string; album: string; image: string; year: string; media: string; hero?: string } };
type Quiz = { theme: string; label: string; angle: string; questions: Question[] };

const ASK: Record<Kind, string> = {
  film: "Which film is this song from?",
  hero: "Who's the hero on screen?",
  singer: "Who sang this?",
  year: "Which year did it release?",
  song: "Which song is this?",
};
type Themes = { themes: { id: string; label: string; best: number }[] };

const CLIP_S = 12;
const LIMIT_S = 20;

/** Paattu Quiz: a few seconds of a Tamil song — which film is it from? Ten songs a round. */
export default function PaattuQuiz() {
  const meta = useFetch<Themes>("/api/games/paattu");
  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [i, setI] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [score, setScore] = useState(0);
  const [streak, setStreak] = useState(0);
  const [right, setRight] = useState(0);
  const [left, setLeft] = useState(LIMIT_S);
  const [done, setDone] = useState<{ record: boolean; best: number } | null>(null);
  const [buffering, setBuffering] = useState(false);
  const [hard, setHard] = useState(false);
  const audio = useRef<HTMLAudioElement | null>(null);
  const started = useRef(0);
  const stopAt = useRef<ReturnType<typeof setTimeout> | null>(null);
  const q = quiz?.questions[i] ?? null;

  async function start(theme: string) {
    setLoading(theme);
    setError(null);
    // A tap: browsers allow sound from here on. Pause HIVEMIND's music while the quiz plays.
    audio.current ??= new Audio();
    window.dispatchEvent(new CustomEvent(MEDIA_START_EVENT, { detail: { source: "game" } }));
    try {
      const r = await api<{ quiz: Quiz }>(`/api/games/paattu?theme=${theme}&level=${hard ? "hard" : "easy"}`);
      setQuiz(r.quiz);
      setI(0);
      setScore(0);
      setStreak(0);
      setRight(0);
      setDone(null);
      setPicked(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(null);
    }
  }

  // Each question: fetch a fresh link, jump to the hook, play the clip.
  useEffect(() => {
    if (!q || picked !== null) return;
    let alive = true;
    const a = audio.current!;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- a new question starts loading its clip
    setBuffering(true);
    setLeft(LIMIT_S);
    (async () => {
      try {
        const { url } = await api<{ url: string }>("/api/music/stream", { method: "POST", json: { media: q.song.media } });
        if (!alive) return;
        a.src = url;
        a.currentTime = q.start;
        await a.play();
        if (!alive) return a.pause();
        setBuffering(false);
        started.current = Date.now();
        stopAt.current = setTimeout(() => a.pause(), CLIP_S * 1000);
      } catch {
        if (alive) setBuffering(false);
      }
    })();
    return () => {
      alive = false;
      if (stopAt.current) clearTimeout(stopAt.current);
    };
  }, [q, picked]);

  // The countdown (starts when the clip actually plays).
  useEffect(() => {
    if (!q || picked !== null || buffering) return;
    const t = setInterval(() => {
      const s = LIMIT_S - Math.floor((Date.now() - started.current) / 1000);
      setLeft(Math.max(0, s));
      if (s <= 0) choose(-1);
    }, 250);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- restarts per question
  }, [q, picked, buffering]);

  function choose(n: number) {
    if (!q || picked !== null) return;
    setPicked(n);
    const ok = n === q.answer;
    if (ok) {
      const secs = (Date.now() - started.current) / 1000;
      const gained = 100 + Math.max(0, Math.round((LIMIT_S - secs) * 5)) + streak * 25;
      setScore((s) => s + gained);
      setStreak((s) => s + 1);
      setRight((r) => r + 1);
    } else setStreak(0);
    // Let the song play on a little after the answer.
    const a = audio.current;
    if (a) {
      if (stopAt.current) clearTimeout(stopAt.current);
      void a.play().catch(() => {});
      stopAt.current = setTimeout(() => a.pause(), 6000);
    }
  }

  async function next() {
    if (!quiz) return;
    if (i + 1 < quiz.questions.length) {
      setPicked(null);
      setI(i + 1);
      return;
    }
    audio.current?.pause();
    const r = await api<{ record: boolean; best: number }>("/api/games/paattu", { method: "POST", json: { theme: quiz.theme, score } }).catch(() => ({ record: false, best: score }));
    setDone(r);
    void meta.reload();
  }

  // Stop the clip when leaving the page.
  useEffect(() => () => audio.current?.pause(), []);

  useVoiceActions({
    paattu_start: {
      description: `Paattu Quiz: start a round. input: theme, one of ${meta.data?.themes.map((t) => `${t.id} (${t.label})`).join(", ") ?? "mix, anirudh, arr, ilaiyaraaja, vijay, melody, kuthu, latest"}.`,
      run: async ({ input }) => {
        const id = meta.data?.themes.find((t) => `${t.id} ${t.label}`.toLowerCase().includes(String(input ?? "").toLowerCase().trim()))?.id ?? "mix";
        await start(id);
        return { started: id, note: "Stay quiet while the clip plays; the owner answers." };
      },
    },
    paattu_answer: {
      description: "Paattu Quiz: answer the current question (it may ask the film, the hero, the singer or the year). input: the option number (1-4) or the name / year the owner said.",
      run: ({ input }) => {
        if (!q || picked !== null) return { error: "No question waiting." };
        const s = String(input ?? "").toLowerCase().trim();
        const n = Number(s.match(/\d/)?.[0]);
        const idx = n >= 1 && n <= 4 ? n - 1 : q.options.findIndex((o) => o.toLowerCase().includes(s) || s.includes(o.toLowerCase()));
        choose(idx);
        return { correct: idx === q.answer, answer: q.options[q.answer], song: q.song.title };
      },
    },
    paattu_next: {
      description: "Paattu Quiz: next song (after an answer).",
      run: async () => {
        await next();
        return { ok: true };
      },
    },
  });

  const face: MascotFrameName = done ? (done.record ? "starstruck" : right >= 5 ? "sparkle" : "bashful") : picked === null ? (buffering ? "up-right" : "up") : picked === q?.answer ? "delighted" : "dizzy";

  return (
    <div className="mx-auto max-w-2xl">
      <Link href="/games" className="mb-3 inline-flex items-center gap-1 font-mono text-[11px] uppercase tracking-wider text-soft hover:text-data">
        <ArrowLeft size={13} /> Games
      </Link>
      <div className="mb-4 flex items-center gap-3">
        <MascotFrame frame={face} size={84} />
        <div>
          <h1 className="text-xl font-semibold">Paattu Quiz</h1>
          <p className="text-sm text-soft">{quiz ? `${quiz.label}${quiz.angle ? ` · ${quiz.angle}` : ""} · ${Math.min(i + 1, quiz.questions.length)}/${quiz.questions.length}` : "Hear a few seconds of a Tamil song: guess the film, the hero, the singer or the year. New songs every round."}</p>
        </div>
        {quiz && !done && (
          <div className="ml-auto text-right">
            <div className="font-mono text-2xl font-semibold tabular-nums text-core">{score}</div>
            <div className="font-mono text-[10px] uppercase tracking-wider text-faint">{streak > 1 ? `🔥 ${streak} streak` : "points"}</div>
          </div>
        )}
      </div>
      <ErrorText error={error ?? meta.error} />

      {!quiz || done ? (
        <>
          {done && (
            <div className="mb-5 rounded-xl border border-core/50 bg-panel p-5 text-center">
              <Trophy size={28} className="mx-auto text-core" />
              <div className="mt-2 text-3xl font-semibold">{score}</div>
              <p className="text-sm text-soft">
                {right} of {quiz?.questions.length} right{done.record ? " · new best! 🎉" : ` · best ${done.best}`}
              </p>
            </div>
          )}
          <div className="mb-2 flex items-center justify-between">
            <h2 className="font-mono text-[11px] uppercase tracking-wider text-faint">{done ? "Play again" : "Pick a theme"}</h2>
            <div className="flex overflow-hidden rounded-full border border-line text-xs" role="group" aria-label="Difficulty">
              {(["Easy", "Hard"] as const).map((l) => (
                <button key={l} type="button" aria-pressed={(l === "Hard") === hard} onClick={() => setHard(l === "Hard")} className={cx("px-3 py-1", (l === "Hard") === hard ? "bg-core text-core-ink" : "text-soft")}>
                  {l}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {(meta.data?.themes ?? []).map((t) => (
              <button
                key={t.id}
                type="button"
                disabled={!!loading}
                onClick={() => start(t.id)}
                className="flex flex-col items-start gap-1 rounded-xl border border-line bg-panel p-3 text-left hover:border-core/60 disabled:opacity-50"
              >
                <span className="flex items-center gap-1.5 text-sm font-medium">
                  {loading === t.id ? <Loader2 size={13} className="animate-spin" /> : <Music2 size={13} className="text-core" />} {t.label}
                </span>
                <span className="font-mono text-[10px] text-faint">{t.best ? `best ${t.best}` : "not played"}</span>
              </button>
            ))}
          </div>
          {done && (
            <Button className="mt-4" variant="quiet" onClick={() => start(quiz!.theme)}>
              <RotateCcw size={14} /> Same theme again
            </Button>
          )}
        </>
      ) : (
        q && (
          <div className="rounded-xl border border-line bg-panel p-4">
            <div className="mb-3 flex items-center gap-2 text-sm text-soft">
              {buffering ? <Loader2 size={14} className="animate-spin text-core" /> : <Play size={14} className="text-core" />}
              {buffering ? "Loading the song…" : picked === null ? ASK[q.kind] : "Answer"}
              {picked === null && !buffering && <span className={cx("ml-auto font-mono tabular-nums", left <= 5 ? "text-alert" : "text-faint")}>{left}s</span>}
            </div>
            {picked === null && !buffering && (
              <div className="mb-3 h-1 overflow-hidden rounded bg-raised">
                <div className="h-full bg-core transition-[width] duration-300" style={{ width: `${(left / LIMIT_S) * 100}%` }} />
              </div>
            )}
            <div className="grid gap-2 sm:grid-cols-2">
              {q.options.map((o, n) => (
                <button
                  key={n}
                  type="button"
                  disabled={picked !== null || buffering}
                  onClick={() => choose(n)}
                  className={cx(
                    "flex items-center gap-2 rounded-lg border px-3 py-3 text-left text-sm transition-colors",
                    picked === null ? "border-line hover:border-core/60" : n === q.answer ? "border-ok bg-ok/15 text-ok" : n === picked ? "border-alert bg-alert/15 text-alert" : "border-line opacity-50",
                  )}
                >
                  <span className="font-mono text-[11px] text-faint">{n + 1}</span>
                  <span className="min-w-0 flex-1">{o}</span>
                  {picked !== null && n === q.answer && <Check size={15} />}
                  {picked !== null && n === picked && n !== q.answer && <X size={15} />}
                </button>
              ))}
            </div>
            {picked !== null && (
              <div className="mt-4 flex items-center gap-3 rounded-lg bg-raised p-3">
                {/* eslint-disable-next-line @next/next/no-img-element -- remote album art */}
                {q.song.image && <img src={q.song.image} alt="" className="size-14 rounded" />}
                <div className="min-w-0 flex-1 text-sm">
                  <div className="font-medium">{q.song.title}</div>
                  <div className="truncate text-soft">
                    {q.song.album} {q.song.year && `(${q.song.year})`}
                    {q.song.hero ? ` · ${q.song.hero}` : ""} · {q.song.artists}
                  </div>
                  <div className={cx("text-xs", picked === q.answer ? "text-ok" : "text-alert")}>{picked === q.answer ? "Correct!" : picked === -1 ? "Time's up" : "Not this time"}</div>
                </div>
                <Button onClick={next}>{i + 1 < (quiz?.questions.length ?? 0) ? "Next" : "Finish"}</Button>
              </div>
            )}
          </div>
        )
      )}
    </div>
  );
}
