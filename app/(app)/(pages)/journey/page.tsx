"use client";

import { ExternalLink, Film, GitBranch, List } from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";
import { Holo } from "@/components/bridge/holo";
import {
  type Commit,
  GitGraph,
  type Lane,
  LANE_COLOR,
} from "@/components/journey/git-graph";
import { LifeStory, type StoryHandle } from "@/components/journey/story/story";
import { LifeStory3D } from "@/components/journey/story3d/story3d";
import { useVoiceActions } from "@/components/voice/provider";
import { Badge, cx, Empty, PageHeader } from "@/components/ui";
import { useFetch } from "@/lib/client-api";

type Journey = { lanes: Lane[]; commits: Commit[]; sourced: number };

export default function JourneyPage() {
  const journey = useFetch<Journey>("/api/journey");
  const [picked, setPicked] = useState<Commit | null>(null);
  const [view, setView] = useState<"story" | "log">("story");
  // 3D avatar first; if the avatar files or WebGL are missing, fall back to the 2D story.
  const [flat, setFlat] = useState<string | null>(null);
  const story = useRef<StoryHandle>(null);
  const j = journey.data;

  // Voice: "show my Zinnov role", "walk me through my journey", "next", "switch to the log view"…
  const find = (q: string) => {
    const words = q
      .toLowerCase()
      .split(/W+/)
      .filter((w) => w.length > 2);
    const score = (c: Commit) =>
      words.filter((w) =>
        `${c.title} ${c.subtitle ?? ""} ${c.period} ${c.lane} ${c.tags.join(" ")}`
          .toLowerCase()
          .includes(w),
      ).length;
    const best = (j?.commits ?? [])
      .map((c, i) => ({ c, i, s: score(c) }))
      .sort((a, b) => b.s - a.s)[0];
    return best && best.s > 0 ? best : null;
  };
  const describe = (c: Commit) => ({
    title: c.kind === "now" ? "HEAD (now)" : c.title,
    where: c.subtitle,
    when: c.period,
    branch: c.lane,
    details: c.description,
    tags: c.tags,
  });
  const show = (i: number) => {
    const c = j!.commits[i];
    if (view === "story") story.current?.goTo(i);
    else setPicked(c);
    return describe(c);
  };
  useVoiceActions({
    go_to_milestone: {
      description:
        "Fly to / highlight a milestone in the journey (input: e.g. 'Zinnov', 'B.Tech', 'NutrifyAI', '2024 internship').",
      run: ({ input }) => {
        const hit = find(String(input ?? ""));
        return hit
          ? { showing: show(hit.i) }
          : { error: `No milestone matching "${input}".` };
      },
    },
    next_milestone: {
      description: "Move to the next milestone in time.",
      run: () => {
        const i = Math.min(
          (j?.commits.length ?? 1) - 1,
          (story.current?.index() ??
            j!.commits.findIndex((c) => c.id === current?.id)) + 1,
        );
        return { showing: show(i) };
      },
    },
    previous_milestone: {
      description: "Move to the previous milestone.",
      run: () => {
        const i = Math.max(
          0,
          (story.current?.index() ??
            j!.commits.findIndex((c) => c.id === current?.id)) - 1,
        );
        return { showing: show(i) };
      },
    },
    start_tour: {
      description:
        "Play the animated life story: the character walks through every milestone and tells it. Keep your own narration brief while it plays.",
      run: () => {
        setView("story");
        setTimeout(() => story.current?.tour(true), 50);
        return {
          touring: true,
          milestones: j!.commits.map(
            (c) =>
              `${c.period}: ${c.kind === "now" ? "HEAD, now" : c.title}${c.subtitle ? ` (${c.subtitle})` : ""}`,
          ),
        };
      },
    },
    stop_tour: {
      description: "Stop the guided tour.",
      run: () => (story.current?.tour(false), { stopped: true }),
    },
    replay_animation: {
      description: "Replay the journey's intro animation.",
      run: () => (story.current?.replay(), { replaying: true }),
    },
    switch_view: {
      description:
        "Switch the journey view. input: 'story' (animated life story) or 'log' (git log list).",
      run: ({ input }) => {
        const v = /log|list|git/i.test(String(input)) ? "log" : "story";
        setView(v);
        return { view: v };
      },
    },
  });
  // Default focus: the current role (HEAD's branch), else the latest commit.
  const current =
    picked ?? j?.commits.find((c) => c.current) ?? j?.commits.at(-2) ?? null;

  const years = j
    ? Number(j.commits.at(-1)?.at.slice(0, 4)) -
      Number(j.commits[0]?.at.slice(0, 4))
    : 0;
  const stats = j
    ? [
        { label: "Years", value: years, color: LANE_COLOR.main },
        {
          label: "Roles",
          value: j.commits.filter((c) => c.kind === "work").length,
          color: LANE_COLOR.experience,
        },
        {
          label: "Projects",
          value: j.commits
            .filter((c) => c.kind === "project")
            .reduce(
              (n, c) =>
                n +
                (c.id.startsWith("minor:")
                  ? Number(c.title.match(/\d+/)?.[0] ?? 0)
                  : 1),
              0,
            ),
          color: LANE_COLOR.projects,
        },
        {
          label: "Certs & awards",
          value: Number(
            j.commits
              .find((c) => c.kind === "milestone")
              ?.title.match(/\d+/)?.[0] ?? 0,
          ),
          color: LANE_COLOR.current,
        },
      ]
    : [];

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        eyebrow="Journey"
        title="My journey"
        subtitle="Walk through my story, from school uniform to the Zinnov office. Click any point on the timeline and I'll walk there and tell you what I did. Built live from the portfolio in HIVEMIND's brain."
      />

      {journey.error && <p className="text-sm text-alert">{journey.error}</p>}
      {!j ? (
        <p className="font-mono text-[11px] text-faint">
          {journey.loading ? "CHECKING OUT HISTORY…" : ""}
        </p>
      ) : !j.commits.length || j.sourced === 0 ? (
        <Empty>
          No career data yet. Sync your portfolio in{" "}
          <Link href="/sources" className="text-data hover:underline">
            Sources
          </Link>{" "}
          to build the graph.
        </Empty>
      ) : (
        <>
          <div className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {stats.map((s) => (
              <div
                key={s.label}
                className="border border-line bg-sunken/40 px-4 py-3"
              >
                <div
                  className="font-mono text-2xl tabular-nums"
                  style={{ color: s.color }}
                >
                  {s.value}
                </div>
                <div className="hud-label">{s.label}</div>
              </div>
            ))}
          </div>

          <div className="mb-3 flex items-center gap-1">
            {(
              [
                ["story", "Story", Film],
                ["log", "Log", List],
              ] as const
            ).map(([v, label, Icon]) => (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                className={cx(
                  "flex items-center gap-1.5 border px-3 py-1.5 font-mono text-[10.5px] tracking-widest",
                  view === v
                    ? "border-core/60 bg-core/10 text-core"
                    : "border-line text-soft hover:text-fg",
                )}
              >
                <Icon size={13} /> {label.toUpperCase()}
              </button>
            ))}
            <span className="ml-3 hidden font-mono text-[10px] text-faint sm:inline">
              Try voice: “walk me through my journey” · “show my Zinnov role”
            </span>
          </div>

          {view === "story" ? (
            flat ? (
              <LifeStory ref={story} lanes={j.lanes} commits={j.commits} />
            ) : (
              <LifeStory3D
                ref={story}
                lanes={j.lanes}
                commits={j.commits}
                onFail={(why) => {
                  console.warn("3D story unavailable:", why);
                  setFlat(why);
                }}
              />
            )
          ) : (
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
              <Holo
                title="git log --graph --all"
                right={
                  <div className="hidden items-center gap-3 sm:flex">
                    {j.lanes.map((l) => (
                      <span
                        key={l.id}
                        className="flex items-center gap-1 font-mono text-[10px] text-soft"
                      >
                        <span
                          className="h-2 w-2 rounded-full"
                          style={{ background: LANE_COLOR[l.id] }}
                        />
                        {l.label}
                      </span>
                    ))}
                  </div>
                }
              >
                <div className="overflow-x-auto p-5 pt-12">
                  <div className="min-w-[520px]">
                    <GitGraph
                      lanes={j.lanes}
                      commits={j.commits}
                      selected={current?.id ?? null}
                      onSelect={setPicked}
                    />
                  </div>
                </div>
              </Holo>

              <div className="lg:sticky lg:top-6 lg:self-start">
                {current && (
                  <Holo
                    title={current.kind === "now" ? "HEAD" : "Commit details"}
                    tone="core"
                  >
                    <div className="space-y-3 p-5">
                      <div
                        className="flex items-center gap-2 font-mono text-[10.5px] uppercase tracking-widest"
                        style={{ color: LANE_COLOR[current.lane] }}
                      >
                        <GitBranch size={13} />{" "}
                        {j.lanes.find((l) => l.id === current.lane)?.label}
                      </div>
                      <div>
                        <h2 className="text-lg font-semibold leading-snug">
                          {current.kind === "now"
                            ? "You are here"
                            : current.title}
                        </h2>
                        {current.subtitle && (
                          <p className="text-[13px] text-soft">
                            {current.subtitle}
                          </p>
                        )}
                        <p className="mt-1 font-mono text-[11.5px] text-data">
                          {current.period}
                        </p>
                      </div>
                      {current.description && (
                        <p className="text-[13.5px] leading-relaxed">
                          {current.description}
                        </p>
                      )}
                      {current.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {current.tags.map((t) => (
                            <Badge key={t} tone="data">
                              {t}
                            </Badge>
                          ))}
                        </div>
                      )}
                      {current.mergeFrom && (
                        <p className="font-mono text-[11px] text-soft">
                          Merged{" "}
                          {current.mergeFrom
                            .map((m) => j.lanes.find((l) => l.id === m)?.label)
                            .join(" + ")}{" "}
                          into main
                        </p>
                      )}
                      {current.memoryId && (
                        <Link
                          href={`/memories?open=${current.memoryId}`}
                          className="inline-flex items-center gap-1 font-mono text-[10.5px] tracking-widest text-soft hover:text-core"
                        >
                          <ExternalLink size={12} /> OPEN IN MEMORY EXPLORER
                        </Link>
                      )}
                    </div>
                  </Holo>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
