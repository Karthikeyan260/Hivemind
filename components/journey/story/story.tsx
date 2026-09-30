"use client";

import gsap from "gsap";
import { ChevronLeft, ChevronRight, Pause, Play, Users, Volume2, VolumeX, X } from "lucide-react";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { cx } from "@/components/ui";
import { Speaker } from "@/lib/voice";
import type { Commit, Lane } from "../git-graph";
import { LANE_COLOR } from "../git-graph";
import { type Age, Avatar, AvatarDefs } from "./avatar";
import { GROUND, Scene, SKY, STAND_X, W } from "./scenes";
import { buildStages, type Stage, type StoryHandle, year } from "./stages";

export type { StoryHandle };

const WALK_BASE = 0.9;
const WALK_PER_STAGE = 0.5;
const TYPE_MS = 22;

export const LifeStory = forwardRef<StoryHandle, { lanes: Lane[]; commits: Commit[] }>(function LifeStory({ commits }, ref) {
  const stages: Stage[] = useMemo(() => buildStages(commits), [commits]);

  const start = Math.max(0, stages.findIndex((s) => s.scene === "office"));
  const [index, setIndex] = useState(0);
  const [age, setAge] = useState<Age>(stages[0]?.age ?? "kid");
  const [walking, setWalking] = useState(false);
  const [facing, setFacing] = useState(1);
  const [text, setText] = useState("");
  const [talking, setTalking] = useState(false);
  const [waving, setWaving] = useState(false);
  const [touring, setTouring] = useState(false);
  const [voice, setVoice] = useState(false);
  const [parallel, setParallel] = useState(false);

  const world = useRef<SVGGElement>(null);
  const hero = useRef<SVGGElement>(null);
  const sky = useRef<SVGStopElement>(null);
  const sky2 = useRef<SVGStopElement>(null);
  const pos = useRef({ x: STAND_X });
  const walk = useRef<gsap.core.Tween | null>(null);
  const typer = useRef<ReturnType<typeof setInterval> | null>(null);
  const speaker = useRef<Speaker | null>(null);
  const tourId = useRef(0);
  const indexRef = useRef(0);

  const place = useCallback((x: number) => {
    const anchor = typeof window !== "undefined" && window.innerWidth < 640 ? W / 2 : STAND_X;
    world.current?.setAttribute("transform", `translate(${-(x - anchor)} 0)`);
    hero.current?.setAttribute("transform", `translate(${x} ${GROUND})`);
  }, []);

  const say = useCallback(
    (line: string) =>
      new Promise<void>((resolve) => {
        if (typer.current) clearInterval(typer.current);
        setTalking(true);
        setText("");
        let n = 0;
        let spoken = !voice;
        let typed = false;
        const finish = () => {
          if (typed && spoken) {
            setTalking(false);
            resolve();
          }
        };
        if (voice) {
          speaker.current ??= Object.assign(new Speaker(), { engine: "browser" as const, rate: 1.35 });
          const sp = speaker.current;
          sp.stop();
          sp.onSpeakingChange = (on) => {
            if (!on) {
              spoken = true;
              finish();
            }
          };
          sp.speak(line);
        }
        typer.current = setInterval(() => {
          n += 2;
          setText(line.slice(0, n));
          if (n >= line.length) {
            clearInterval(typer.current!);
            typer.current = null;
            setTimeout(() => {
              typed = true;
              finish();
            }, 900);
          }
        }, TYPE_MS);
      }),
    [voice],
  );

  /** Walk to a milestone (growing up on the way), then turn and tell the story of it. */
  const goTo = useCallback(
    (target: number) =>
      new Promise<void>((resolve) => {
        const i = Math.max(0, Math.min(stages.length - 1, target));
        const from = pos.current.x;
        const to = i * W + STAND_X;
        walk.current?.kill();
        speaker.current?.stop();
        setParallel(false);
        setText("");
        setTalking(false);
        indexRef.current = i;
        setIndex(i);
        const arrive = () => {
          setWalking(false);
          setFacing(1);
          setAge(stages[i].age);
          setWaving(true);
          setTimeout(() => setWaving(false), 1100);
          void say(stages[i].line).then(() => {
            if (stages[i].scene === "future") setParallel(true);
            resolve();
          });
        };
        if (Math.abs(to - from) < 1) return arrive();
        setFacing(to > from ? 1 : -1);
        setWalking(true);
        const [c0, c1] = SKY[stages[i].scene];
        if (sky.current && sky2.current) {
          gsap.to(sky.current, { attr: { "stop-color": c0 }, duration: 1.2 });
          gsap.to(sky2.current, { attr: { "stop-color": c1 }, duration: 1.2 });
        }
        walk.current = gsap.to(pos.current, {
          x: to,
          duration: Math.min(4.5, WALK_BASE + WALK_PER_STAGE * Math.abs(to - from) / W),
          ease: "power1.inOut",
          onUpdate: () => {
            place(pos.current.x);
            // Grow up (or back) as you cross into each stage.
            const here = Math.round((pos.current.x - STAND_X) / W);
            const a = stages[Math.max(0, Math.min(stages.length - 1, here))].age;
            setAge((prev) => (prev === a ? prev : a));
          },
          onComplete: arrive,
        });
      }),
    [stages, place, say],
  );

  const stopTour = useCallback(() => {
    tourId.current++;
    setTouring(false);
  }, []);

  const runTour = useCallback(async () => {
    const id = ++tourId.current;
    setTouring(true);
    for (let i = 0; i < stages.length; i++) {
      if (tourId.current !== id) return;
      await goTo(i);
      await new Promise((r) => setTimeout(r, 700));
    }
    if (tourId.current === id) setTouring(false);
  }, [stages.length, goTo]);

  // Intro: start as the kid at school, then walk to today.
  useEffect(() => {
    place(STAND_X);
    const t = setTimeout(() => void goTo(start), 900);
    return () => {
      clearTimeout(t);
      walk.current?.kill();
      if (typer.current) clearInterval(typer.current);
      speaker.current?.stop();
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
    replay: () => {
      stopTour();
      walk.current?.kill();
      pos.current.x = STAND_X;
      place(STAND_X);
      setAge(stages[0].age);
      void goTo(0);
    },
    tour: (on) => (on ? void runTour() : stopTour()),
    index: () => indexRef.current,
  }));

  const s = stages[index];
  const lanesOf = (a: Age) => stages.filter((x) => x.age === a);

  return (
    <div className="relative h-[70vh] min-h-[520px] w-full overflow-hidden border border-data/20 bg-[#05080d]">
      <svg viewBox={`0 0 ${W} 520`} preserveAspectRatio="xMidYMid slice" className="absolute inset-0 h-full w-full">
        <AvatarDefs />
        <defs>
          <linearGradient id="st-sky" x1="0" y1="0" x2="0" y2="1">
            <stop ref={sky} offset="0" stopColor={SKY[stages[0]?.scene ?? "school"][0]} />
            <stop ref={sky2} offset="1" stopColor={SKY[stages[0]?.scene ?? "school"][1]} />
          </linearGradient>
        </defs>
        <rect width={W} height={520} fill="url(#st-sky)" />
        <g ref={world}>
          {stages.map((st, i) => (
            <g key={st.commit.id} transform={`translate(${i * W} 0)`}>
              <Scene kind={st.scene} commit={st.commit} />
            </g>
          ))}
          {/* continuous ground + path */}
          <rect x={-W} y={GROUND} width={W * (stages.length + 2)} height={80} fill="#1b2430" />
          <rect x={-W} y={GROUND} width={W * (stages.length + 2)} height={4} fill="#2c3a4a" />
          {stages.map((st, i) => (
            <circle key={st.commit.id} cx={i * W + STAND_X} cy={GROUND + 26} r={i === index ? 7 : 4} fill={LANE_COLOR[st.commit.lane]} opacity={i === index ? 1 : 0.5} />
          ))}
          <g ref={hero}>
            <g transform={`scale(${facing} 1)`}>
              <Avatar age={age} walking={walking} talking={talking} waving={waving} />
            </g>
          </g>
        </g>
      </svg>

      {/* Speech bubble */}
      {text && !walking && (
        <div className="st-bubble absolute left-3 right-3 top-14 border bg-[#0b1016]/92 p-4 backdrop-blur-md sm:left-[3%] sm:right-auto sm:top-[9%] sm:w-[min(25rem,31%)]" style={{ borderColor: `${LANE_COLOR[s.commit.lane]}99` }}>
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
        <button type="button" onClick={() => (touring ? stopTour() : void runTour())} className="flex items-center gap-1.5 border border-core/60 bg-[#0b1016]/85 px-2.5 py-1.5 font-mono text-[10px] tracking-widest text-core backdrop-blur hover:bg-core/10">
          {touring ? <Pause size={12} /> : <Play size={12} />} {touring ? "PAUSE" : "PLAY MY STORY"}
        </button>
        <button
          type="button"
          onClick={() => {
            speaker.current ??= Object.assign(new Speaker(), { engine: "browser" as const, rate: 1.35 });
            speaker.current.unlock();
            if (voice) speaker.current.stop();
            setVoice((v) => !v);
          }}
          className={cx("flex items-center gap-1.5 border bg-[#0b1016]/85 px-2.5 py-1.5 font-mono text-[10px] tracking-widest backdrop-blur", voice ? "border-data/60 text-data" : "border-line text-soft hover:text-fg")}
        >
          {voice ? <Volume2 size={12} /> : <VolumeX size={12} />} VOICE
        </button>
        <button type="button" onClick={() => setParallel((p) => !p)} className="flex items-center gap-1.5 border border-line bg-[#0b1016]/85 px-2.5 py-1.5 font-mono text-[10px] tracking-widest text-soft backdrop-blur hover:text-fg">
          <Users size={12} /> PARALLEL YOU
        </button>
      </div>

      {/* Parallel You: every version of you side by side */}
      {parallel && (
        <div className="rise-in absolute inset-0 z-20 flex flex-col bg-[#05080d]/90 backdrop-blur-sm">
          <div className="flex items-center justify-between px-5 pt-4">
            <div>
              <div className="font-mono text-[10px] tracking-[0.25em] text-core">PARALLEL YOU</div>
              <div className="text-[13px] text-soft">Every version of you, and what each one knew.</div>
            </div>
            <button type="button" onClick={() => setParallel(false)} aria-label="Close" className="text-soft hover:text-fg">
              <X size={16} />
            </button>
          </div>
          <div className="flex flex-1 items-end justify-center gap-2 overflow-x-auto px-4 pb-6 sm:gap-6">
            {(["kid", "teen", "student", "grad", "pro", "future"] as Age[]).map((a) => {
              const own = lanesOf(a);
              if (!own.length) return null;
              const first = own[0].commit;
              const skills = [...new Set(own.flatMap((x) => x.commit.tags))].slice(0, 4);
              const labels: Record<Age, string> = { kid: "School", teen: "Higher sec.", student: "College", grad: "Graduate", pro: "Professional", future: "Future you" };
              return (
                <button key={a} type="button" onClick={() => void goTo(stages.indexOf(own[0]))} className="group flex w-28 shrink-0 flex-col items-center text-center sm:w-32">
                  <div className="mb-2 min-h-[3.5rem] space-y-0.5">
                    {skills.map((k) => (
                      <div key={k} className="font-mono text-[9.5px] uppercase tracking-wider text-data/80">
                        {k}
                      </div>
                    ))}
                  </div>
                  <svg viewBox="-60 -290 120 300" className="h-44 w-full transition-transform group-hover:-translate-y-1">
                    <AvatarDefs />
                    <Avatar age={a} />
                  </svg>
                  <div className="mt-1 font-mono text-[11px]" style={{ color: LANE_COLOR[first.lane] }}>
                    {a === "future" ? "Next" : year(first)}
                  </div>
                  <div className="text-[12px] font-medium">{labels[a]}</div>
                </button>
              );
            })}
          </div>
        </div>
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
