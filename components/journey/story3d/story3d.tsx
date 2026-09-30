"use client";

import { ChevronLeft, ChevronRight, Loader2, Pause, Play, Volume2, VolumeX } from "lucide-react";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { cx } from "@/components/ui";
import { Speaker, splitSentences } from "@/lib/voice";
import type { Commit, Lane } from "../git-graph";
import { LANE_COLOR } from "../git-graph";
import { buildStages, type StoryHandle } from "../story/stages";
import type { LifeWorld } from "./world";

const TYPE_MS = 22;
const STORY_VOICE_RATE = 1.2;

/**
 * The life story in 3D: the owner's own avatar walks between milestone scenes and tells each one.
 * Calls onFail if the avatar or WebGL isn't available, so the page can fall back to the 2D story.
 */
export const LifeStory3D = forwardRef<StoryHandle, { lanes: Lane[]; commits: Commit[]; onFail: (reason: string) => void }>(function LifeStory3D({ commits, onFail }, ref) {
  const stages = useMemo(() => buildStages(commits), [commits]);
  const canvas = useRef<HTMLCanvasElement>(null);
  const world = useRef<LifeWorld | null>(null);
  const [ready, setReady] = useState(false);
  const [fade, setFade] = useState(1);
  const [missing, setMissing] = useState<string[]>([]);
  const [index, setIndex] = useState(0);
  const [walking, setWalking] = useState(false);
  const [text, setText] = useState("");
  const [talking, setTalking] = useState(false);
  const [touring, setTouring] = useState(false);
  const [voice, setVoice] = useState(false);
  const typer = useRef<ReturnType<typeof setInterval> | null>(null);
  const speaker = useRef<Speaker | null>(null);
  const tourId = useRef(0);
  const indexRef = useRef(0);
  const voiceRef = useRef(voice);
  useEffect(() => {
    voiceRef.current = voice;
  }, [voice]);

  /** The story's voice: HIVEMIND TTS at a brisker 1.2× speed. */
  const voice$ = useCallback(() => {
    speaker.current ??= new Speaker();
    speaker.current.rate = STORY_VOICE_RATE;
    return speaker.current;
  }, []);

  const say = useCallback(
    (line: string) =>
      new Promise<void>((resolve) => {
        if (typer.current) clearInterval(typer.current);
        setTalking(true);
        world.current?.setTalking(true);
        setText("");
        let n = 0;
        let spoken = !voiceRef.current;
        let typed = false;
        const finish = () => {
          if (!typed || !spoken) return;
          setTalking(false);
          world.current?.setTalking(false);
          resolve();
        };
        if (voiceRef.current) {
          // Audio was prefetched while walking, so playback starts right away.
          void voice$().say(line).then(() => {
            spoken = true;
            finish();
          });
        }
        typer.current = setInterval(() => {
          n += 2;
          setText(line.slice(0, n));
          if (n >= line.length) {
            clearInterval(typer.current!);
            typer.current = null;
            // Leave the text up long enough to read before the story moves on.
            setTimeout(() => {
              typed = true;
              finish();
            }, Math.min(7000, Math.max(2500, line.length * 38)));
          }
        }, TYPE_MS);
      }),
    [voice$],
  );

  const goTo = useCallback(
    async (target: number) => {
      const w = world.current;
      if (!w) return;
      const i = Math.max(0, Math.min(stages.length - 1, target));
      speaker.current?.stop();
      // Generate the voice for this milestone during the walk, not after arriving.
      if (voiceRef.current) voice$().prefetch(splitSentences(stages[i].line));
      if (typer.current) clearInterval(typer.current);
      setText("");
      setTalking(false);
      indexRef.current = i;
      setIndex(i);
      setWalking(true);
      await w.goTo(i);
      if (indexRef.current !== i) return;
      setWalking(false);
      await say(stages[i].line);
    },
    [stages, say, voice$],
  );

  const stopTour = useCallback(() => {
    tourId.current++;
    setTouring(false);
  }, []);

  /** Plays the story in order from a milestone: arrive, tell it, move on. */
  const runTour = useCallback(async (from = 0) => {
    const id = ++tourId.current;
    setTouring(true);
    for (let i = from; i < stages.length; i++) {
      if (tourId.current !== id) return;
      await goTo(i);
      await new Promise((r) => setTimeout(r, 600));
    }
    if (tourId.current === id) setTouring(false);
  }, [stages.length, goTo]);

  useEffect(() => {
    let alive = true;
    let w: LifeWorld | null = null;
    const tours = tourId;
    import("./world")
      .then(({ LifeWorld }) => {
        if (!alive || !canvas.current) return;
        w = new LifeWorld(canvas.current, stages, {
          onReady: ({ clips }) => {
            if (!alive) return;
            setReady(true);
            setMissing((["walk", "wave", "talk"] as const).filter((c) => !clips.includes(c)));
            // Start at the very first milestone, then flow through the story in order.
            void runTour(0);
          },
          onError: (msg) => alive && onFail(msg),
          onStage: () => {},
          onFade: (v) => alive && setFade(v),
        });
        world.current = w;
      })
      .catch((e) => alive && onFail(e instanceof Error ? e.message : "3D unavailable"));
    return () => {
      alive = false;
      tours.current++;
      if (typer.current) clearInterval(typer.current);
      speaker.current?.stop();
      w?.dispose();
      world.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stages]);

  useImperativeHandle(ref, () => ({
    goTo: (i) => {
      stopTour();
      void goTo(i);
    },
    next: () => {
      stopTour();
      void goTo(indexRef.current + 1);
    },
    prev: () => {
      stopTour();
      void goTo(indexRef.current - 1);
    },
    replay: () => void runTour(0),
    tour: (on) => (on ? void runTour() : stopTour()),
    index: () => indexRef.current,
  }));

  const s = stages[index];

  return (
    <div className="relative h-[72vh] min-h-[540px] w-full overflow-hidden border border-data/20 bg-[#05080d]">
      <canvas ref={canvas} className="absolute inset-0 h-full w-full" />
      {/* Scene-change fade */}
      <div className="pointer-events-none absolute inset-0 bg-[#05080d]" style={{ opacity: fade }} />

      {!ready && (
        <div className="absolute inset-0 flex items-center justify-center gap-2 font-mono text-[11px] tracking-widest text-soft">
          <Loader2 size={14} className="animate-spin" /> LOADING YOUR AVATAR…
        </div>
      )}

      {/* Speech bubble */}
      {text && !walking && s && (
        <div className="st-bubble absolute left-3 right-3 top-14 border bg-[#0b1016]/92 p-4 backdrop-blur-md sm:left-[3%] sm:right-auto sm:top-[10%] sm:w-[min(25rem,31%)]" style={{ borderColor: `${LANE_COLOR[s.commit.lane]}99` }}>
          <div className="mb-1 flex items-center justify-between font-mono text-[10px] uppercase tracking-widest" style={{ color: LANE_COLOR[s.commit.lane] }}>
            <span>{s.commit.period}</span>
            <span className="text-faint">
              {index + 1}/{stages.length}
            </span>
          </div>
          <p className="text-[14px] leading-relaxed text-fg">
            {text}
            {talking && <span className="stream-caret" aria-hidden />}
          </p>
          {s.commit.tags.length > 0 && !talking && (
            <div className="mt-2 flex flex-wrap gap-1">
              {s.commit.tags.slice(0, 6).map((t) => (
                <span key={t} className="bg-data/10 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-data">
                  {t}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Controls */}
      <div className="absolute left-3 top-3 flex items-center gap-2">
        <button type="button" disabled={!ready} onClick={() => (touring ? stopTour() : void runTour(indexRef.current))} className="flex items-center gap-1.5 border border-core/60 bg-[#0b1016]/85 px-2.5 py-1.5 font-mono text-[10px] tracking-widest text-core backdrop-blur hover:bg-core/10 disabled:opacity-40">
          {touring ? <Pause size={12} /> : <Play size={12} />} {touring ? "PAUSE" : "PLAY MY STORY"}
        </button>
        <button
          type="button"
          onClick={() => {
            speaker.current ??= new Speaker();
            speaker.current.unlock();
            if (voice) speaker.current.stop();
            setVoice((v) => !v);
          }}
          className={cx("flex items-center gap-1.5 border bg-[#0b1016]/85 px-2.5 py-1.5 font-mono text-[10px] tracking-widest backdrop-blur", voice ? "border-data/60 text-data" : "border-line text-soft hover:text-fg")}
        >
          {voice ? <Volume2 size={12} /> : <VolumeX size={12} />} VOICE
        </button>
      </div>
      {ready && missing.length > 0 && (
        <p className="absolute right-3 top-3 max-w-[16rem] border border-line bg-[#0b1016]/85 px-2.5 py-1.5 text-right font-mono text-[9.5px] leading-snug tracking-wider text-faint backdrop-blur">
          ADD MIXAMO {missing.join(", ").toUpperCase()} ANIMATIONS FOR FULL MOTION
        </p>
      )}

      {/* Timeline */}
      <div className="absolute inset-x-3 bottom-3 flex items-center gap-2 border border-line bg-[#0b1016]/85 px-2 py-2 backdrop-blur">
        <button type="button" aria-label="Previous" onClick={() => { stopTour(); void goTo(index - 1); }} className="p-1 text-soft hover:text-fg">
          <ChevronLeft size={16} />
        </button>
        <div className="relative flex flex-1 items-center justify-between">
          <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-line" />
          <div className="absolute left-0 top-1/2 h-px -translate-y-1/2 bg-core/70 transition-[width] duration-700" style={{ width: `${(index / Math.max(1, stages.length - 1)) * 100}%` }} />
          {stages.map((st, i) => (
            <button
              key={st.commit.id}
              type="button"
              title={`${st.commit.period} · ${st.commit.kind === "now" ? "Now" : st.commit.title}`}
              aria-label={st.commit.kind === "now" ? "Now" : st.commit.title}
              onClick={() => { stopTour(); void goTo(i); }}
              className={cx("relative z-10 rounded-full transition-all", i === index ? "h-3.5 w-3.5" : "h-2 w-2 opacity-70 hover:scale-150 hover:opacity-100")}
              style={{ background: LANE_COLOR[st.commit.lane], boxShadow: i === index ? `0 0 12px ${LANE_COLOR[st.commit.lane]}` : undefined }}
            />
          ))}
        </div>
        <button type="button" aria-label="Next" onClick={() => { stopTour(); void goTo(index + 1); }} className="p-1 text-soft hover:text-fg">
          <ChevronRight size={16} />
        </button>
      </div>
    </div>
  );
});
