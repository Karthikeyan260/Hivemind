"use client";

import { Check, ChevronRight, CircleAlert, ExternalLink, Globe, Hand, Loader2, MonitorPlay, Play, RotateCcw, Square, Trash2, X } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { Badge, Button, cx, Empty, ErrorText, PageHeader, RichText } from "@/components/ui";

/** 'click a ""' (a link with no text) → "click a link": the browser's raw step names, in words. */
const ELEMENT: Record<string, string> = { a: "a link", button: "a button", input: "a field", img: "an image", div: "an element", span: "an element" };
const stepLabel = (did: string) => did.replace(/^(click|tap|hover) (\w+) ""$/, (_, verb: string, tag: string) => `${verb} ${ELEMENT[tag] ?? tag}`);
import { useVoiceActions } from "@/components/voice/provider";
import { api, timeAgo, useFetch, WEB_TASK_EVENT } from "@/lib/client-api";

type Step = { at: string; thought: string; did: string; ok: boolean; note?: string };
type Task = {
  id: string;
  goal: string;
  start_url?: string;
  status: "queued" | "running" | "needs_approval" | "needs_you" | "done" | "failed" | "cancelled";
  created_at: string;
  updated_at: string;
  steps: Step[];
  live_url?: string;
  url?: string;
  title?: string;
  has_shot?: boolean;
  shots?: number[];
  pending?: { label: string; thought: string };
  question?: string;
  result?: string;
  error?: string;
};
type List = { configured: boolean; tasks: Task[] };

const ACTIVE = ["queued", "running", "needs_approval", "needs_you"];
const STATUS: Record<Task["status"], { label: string; tone: "core" | "data" | "ok" | "neutral" | "accent" }> = {
  queued: { label: "Starting", tone: "data" },
  running: { label: "Working", tone: "data" },
  needs_approval: { label: "Needs approval", tone: "core" },
  needs_you: { label: "Needs you", tone: "core" },
  done: { label: "Done", tone: "ok" },
  failed: { label: "Stopped", tone: "neutral" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};
const EXAMPLES = [
  "Find the price of a Milton 1L steel water bottle on Amazon.in and Flipkart and tell me which is cheaper",
  "Open the Zoho careers page and list the open AI / ML roles in Chennai with their links",
  "Check today's top 5 posts on Hacker News and summarise them",
];

export default function WebPage() {
  return (
    <Suspense>
      <WebTasks />
    </Suspense>
  );
}

function WebTasks() {
  const params = useSearchParams();
  const router = useRouter();
  const list = useFetch<List>("/api/web-tasks");
  const [goal, setGoal] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // What the viewer shows, per task: null = automatic (live while working, latest after).
  const [pickFor, setPickFor] = useState<{ id: string; v: number | "latest" | null } | null>(null);
  const [controlFor, setControlFor] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [tick, setTick] = useState(0);

  const tasks = list.data?.tasks ?? [];
  const openId = params.get("task") ?? tasks[0]?.id ?? null;
  const task = tasks.find((t) => t.id === openId) ?? null;
  const anyActive = tasks.some((t) => ACTIVE.includes(t.status));

  // Viewer: live browser while it works (watch-only unless the owner takes control), then the
  // latest screenshot, or any step's screenshot for the replay.
  const canLive = !!task?.live_url && ACTIVE.includes(task.status);
  const view = task && pickFor?.id === task.id ? pickFor.v : null;
  const showLive = canLive && view === null;
  const control = !!task && controlFor === task.id;
  const shots = [...(task?.shots ?? [])].sort((a, b) => a - b);
  const lastShot = shots[shots.length - 1] ?? 0;
  const setView = (v: number | "latest" | null) => task && setPickFor({ id: task.id, v });
  const setControl = (on: boolean) => setControlFor(on && task ? task.id : null);
  /** "Look first" / "Take over": open the live browser with control. */
  const setLive = (on: boolean) => {
    setView(on ? null : "latest");
    setControl(on);
  };
  const replay = () => {
    if (!shots.length) return;
    setView(shots[0]);
    setPlaying(true);
  };
  // Replay: step through the screenshots, about one a second.
  const replayFrom = typeof view === "number" ? view : null;
  useEffect(() => {
    if (!playing || replayFrom === null || !task) return;
    const next = shots.find((k) => k > replayFrom);
    const t = setTimeout(() => (next === undefined ? setPlaying(false) : setPickFor({ id: task.id, v: next })), 1100);
    return () => clearTimeout(t);
  }, [playing, replayFrom, shots, task]);

  // Follow the agent while it works; keep an eye out for tasks started elsewhere (voice, chat,
  // another device) even when nothing here is running, and pick them up at once when voice starts one.
  const reload = list.reload;
  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void reload();
      setTick((n) => n + 1);
    }, anyActive ? 2500 : 10_000);
    const now = () => void reload();
    window.addEventListener(WEB_TASK_EVENT, now);
    return () => {
      clearInterval(t);
      window.removeEventListener(WEB_TASK_EVENT, now);
    };
  }, [anyActive, reload]);

  async function start(g = goal) {
    if (!g.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const t = await api<Task>("/api/web-tasks", { method: "POST", json: { goal: g.trim(), ...(url.trim() ? { start_url: url.trim() } : {}) } });
      setGoal("");
      setUrl("");
      await list.reload();
      router.replace(`/web?task=${t.id}`);
      return t;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const finishedCount = tasks.filter((t) => !ACTIVE.includes(t.status)).length;

  async function remove(t: Task) {
    const working = ACTIVE.includes(t.status);
    if (!confirm(working ? "This task is still working. Stop it and delete it?" : "Delete this task?")) return;
    setError(null);
    // Gone from the list at once; the server catches up.
    list.setData((d) => (d ? { ...d, tasks: d.tasks.filter((x) => x.id !== t.id) } : d));
    if (t.id === openId) router.replace("/web");
    try {
      await api(`/api/web-tasks/${t.id}`, { method: "DELETE" });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      await list.reload();
    }
  }

  async function clearFinished() {
    if (!confirm(`Delete ${finishedCount} finished task${finishedCount === 1 ? "" : "s"}? Tasks still working stay.`)) return;
    setError(null);
    list.setData((d) => (d ? { ...d, tasks: d.tasks.filter((x) => ACTIVE.includes(x.status)) } : d));
    if (task && !ACTIVE.includes(task.status)) router.replace("/web");
    try {
      await api("/api/web-tasks", { method: "DELETE" });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      await list.reload();
    }
  }

  async function decide(decision: "approve" | "reject" | "continue" | "cancel" | "retry") {
    if (!task) return;
    setError(null);
    try {
      await api(`/api/web-tasks/${task.id}`, { method: "POST", json: { decision } });
      await list.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  // Starting, approving, cancelling and deleting work by voice from any page (server tools);
  // these are the things only this page can do.
  useVoiceActions({
    web_task_open: {
      description: "Web page: show one task. input: its number in the list (1 = newest) or words from its goal.",
      run: ({ input }) => {
        const q = String(input ?? "").toLowerCase().trim();
        const n = Number(q.match(/\d+/)?.[0]);
        const t = n ? tasks[n - 1] : tasks.find((x) => x.goal.toLowerCase().includes(q)) ?? tasks[0];
        if (!t) return { error: "No task like that.", tasks: tasks.map((x) => x.goal) };
        router.replace(`/web?task=${t.id}`);
        return { showing: t.goal, status: t.status, result: t.result };
      },
    },
    web_task_live: {
      description: "Web page: switch the open task between its live browser view and the screenshot. input: 'on' or 'off'.",
      run: ({ input }) => {
        if (!task?.live_url || !ACTIVE.includes(task.status)) return { error: "No live browser for this task (it isn't running)." };
        const on = !/off|close|hide|screenshot/i.test(String(input ?? ""));
        setLive(on);
        return { live: on };
      },
    },
  });

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        eyebrow="Agentic"
        title="Web tasks"
        subtitle="HIVEMIND drives a real cloud browser for you. It stops for your Approve before anything it can't undo (submit, pay, send, delete), and hands you the live view for logins and OTPs."
      />

      {list.data && !list.data.configured && (
        <p className="mb-4 rounded-lg border border-core/40 bg-core/5 p-3 text-sm">
          Add <code className="font-mono">STEEL_API_KEY</code> (from steel.dev) to <code className="font-mono">.env.local</code> and Vercel to turn the web agent on.
        </p>
      )}

      <section className="mb-6 space-y-2 rounded-2xl border border-line bg-panel p-4 transition-colors focus-within:border-data/50">
        <textarea
          rows={2}
          placeholder="What should I do on the web?"
          aria-label="What should I do on the web?"
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && (e.metaKey || e.ctrlKey) && start()}
          className="w-full resize-none bg-transparent text-[15px] leading-relaxed placeholder:text-faint focus:outline-none"
        />
        <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
          <span className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-line bg-sunken/60 px-2.5 transition-colors focus-within:border-data/60">
            <Globe size={14} className="shrink-0 text-faint" />
            <input placeholder="Start at a URL (optional)" aria-label="Start at a URL (optional)" value={url} onChange={(e) => setUrl(e.target.value)} className="h-9 min-w-0 flex-1 bg-transparent text-sm placeholder:text-faint focus:outline-none" />
          </span>
          <span className="hidden font-mono text-[10px] text-faint sm:inline">Ctrl+Enter</span>
          <Button onClick={() => start()} disabled={busy || goal.trim().length < 3 || list.data?.configured === false}>
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />} Start
          </Button>
        </div>
        {!tasks.length && (
          <div className="flex flex-wrap gap-2 pt-1">
            {EXAMPLES.map((x) => (
              <button key={x} type="button" onClick={() => setGoal(x)} className="rounded-md border border-line px-2 py-1 text-left text-xs text-soft hover:border-data hover:text-data">
                {x}
              </button>
            ))}
          </div>
        )}
        <ErrorText error={error ?? list.error} />
      </section>

      <div className="grid gap-6 lg:grid-cols-[300px_1fr]">
        <ul className="list-in space-y-2">
          {tasks.length === 0 && !list.loading && <Empty>No web tasks yet.</Empty>}
          {finishedCount > 0 && (
            <li className="flex justify-end">
              <button type="button" onClick={clearFinished} className="flex h-9 items-center gap-1.5 rounded-md px-2 text-[13px] text-soft transition-colors hover:bg-alert/10 hover:text-alert">
                <Trash2 size={13} /> Clear finished ({finishedCount})
              </button>
            </li>
          )}
          {tasks.map((t) => (
            <li key={t.id} className="group relative">
              <button
                type="button"
                onClick={() => router.replace(`/web?task=${t.id}`)}
                className={cx("w-full rounded-md border p-3 pr-11 text-left", t.id === openId ? "border-core bg-core/5" : "border-line bg-raised hover:border-line-strong")}
              >
                <div className="line-clamp-2 text-sm">{t.goal}</div>
                <div className="mt-2 flex items-center gap-2">
                  <Badge tone={STATUS[t.status].tone}>{STATUS[t.status].label}</Badge>
                  <span className="font-mono text-[10.5px] text-faint">{timeAgo(t.updated_at)}</span>
                </div>
              </button>
              <button
                type="button"
                onClick={() => remove(t)}
                title="Delete this task"
                aria-label={`Delete task: ${t.goal}`}
                className="absolute right-1.5 top-1.5 grid size-9 place-items-center rounded-md text-faint transition-colors hover:bg-alert/10 hover:text-alert pointer-coarse:size-11"
              >
                <Trash2 size={14} />
              </button>
            </li>
          ))}
        </ul>

        {task ? (
          <div className="min-w-0 space-y-4">
            <h2 className="font-medium">{task.goal}</h2>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={STATUS[task.status].tone}>{STATUS[task.status].label}</Badge>
              {ACTIVE.includes(task.status) && (
                <Button size="sm" variant="danger" onClick={() => decide("cancel")}>
                  <Square size={12} /> Stop
                </Button>
              )}
              {["failed", "cancelled", "done"].includes(task.status) && (
                <Button size="sm" variant="ghost" onClick={() => decide("retry")}>
                  <RotateCcw size={12} /> Retry
                </Button>
              )}
            </div>

            {task.status === "needs_approval" && task.pending && (
              <div className="rounded-xl border border-core/60 bg-core/5 p-4">
                <div className="flex items-center gap-2 font-medium">
                  <Hand size={16} className="text-core" /> Approve this step?
                </div>
                <p className="mt-1 text-sm">{task.pending.label}</p>
                {task.pending.thought && <p className="mt-1 text-xs text-soft">Why: {task.pending.thought}</p>}
                <div className="mt-3 flex gap-2">
                  <Button onClick={() => decide("approve")}>
                    <Check size={14} /> Approve
                  </Button>
                  <Button variant="ghost" onClick={() => decide("reject")}>
                    <X size={14} /> Reject
                  </Button>
                  {task.live_url && (
                    <Button variant="quiet" onClick={() => setLive(true)}>
                      <MonitorPlay size={14} /> Look first
                    </Button>
                  )}
                </div>
              </div>
            )}

            {task.status === "needs_you" && (
              <div className="rounded-xl border border-core/60 bg-core/5 p-4">
                <div className="flex items-center gap-2 font-medium">
                  <Hand size={16} className="text-core" /> Your turn
                </div>
                <p className="mt-1 text-sm">{task.question}</p>
                <p className="mt-1 text-xs text-soft">Open the live view, do it yourself (log in, enter the OTP, solve the check), then tap Continue.</p>
                <div className="mt-3 flex gap-2">
                  {task.live_url && (
                    <Button variant="ghost" onClick={() => setLive(true)}>
                      <MonitorPlay size={14} /> Open live view
                    </Button>
                  )}
                  <Button onClick={() => decide("continue")}>
                    <Play size={14} /> Continue
                  </Button>
                </div>
              </div>
            )}

            {task.result && (
              <div className="rounded-xl border border-ok/40 bg-ok/5 p-4 text-sm">
                <div className="mb-1 font-mono text-[11px] uppercase tracking-wider text-ok">Result</div>
                {/* formatted: lists, and long shop links as short "flipkart.com ↗" links */}
                <div className="leading-relaxed [&_p]:my-1">
                  <RichText text={task.result} />
                </div>
              </div>
            )}
            {task.error && (
              <p className="flex items-center gap-2 text-sm text-alert">
                <CircleAlert size={14} /> {task.error}
              </p>
            )}

            <div className="overflow-hidden rounded-xl border border-line bg-panel">
              <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2 font-mono text-[11px] text-soft">
                {showLive ? (
                  <span className="flex items-center gap-1.5 text-alert">
                    <span className="h-2 w-2 animate-pulse rounded-full bg-alert" /> LIVE
                  </span>
                ) : typeof view === "number" ? (
                  <span className="text-data">
                    STEP {view} OF {lastShot}
                  </span>
                ) : (
                  <Globe size={13} />
                )}
                <span className="min-w-0 flex-1 truncate">{task.url ?? task.start_url ?? "about:blank"}</span>
                {canLive && (
                  <button type="button" onClick={() => setView(showLive ? "latest" : null)} className="flex shrink-0 items-center gap-1 text-data hover:underline">
                    <MonitorPlay size={13} /> {showLive ? "Screenshot" : "Live"}
                  </button>
                )}
                {showLive && (
                  <button type="button" onClick={() => setControl(!control)} className={cx("flex shrink-0 items-center gap-1 hover:underline", control ? "text-core" : "text-soft")} title="Use the browser yourself (log in, enter an OTP, pass a check)">
                    <Hand size={13} /> {control ? "You're in control" : "Take control"}
                  </button>
                )}
                {shots.length > 1 && !showLive && (
                  <button type="button" onClick={() => (playing ? setPlaying(false) : replay())} className="-my-1.5 flex h-8 shrink-0 items-center gap-1 rounded px-1.5 text-data hover:bg-data/10">
                    {playing ? <Square size={11} /> : <Play size={12} />} {playing ? "Stop" : "Replay"}
                  </button>
                )}
                {task.url && (
                  <a href={task.url} target="_blank" rel="noopener noreferrer" className="flex shrink-0 items-center gap-1 hover:text-data" title="Open this page in your browser">
                    <ExternalLink size={12} />
                  </a>
                )}
              </div>
              {showLive ? (
                <iframe
                  key={control ? "control" : "watch"}
                  src={task.live_url + (task.live_url!.includes("?") ? "&" : "?") + "interactive=" + (control ? "true" : "false")}
                  title="Live browser"
                  className="aspect-[16/10] w-full bg-black"
                  allow="clipboard-read; clipboard-write"
                />
              ) : typeof view === "number" ? (
                // eslint-disable-next-line @next/next/no-img-element -- private step screenshot
                <img src={"/api/web-tasks/" + task.id + "/shot?step=" + view} alt={"After step " + view} className="w-full" />
              ) : task.has_shot ? (
                // eslint-disable-next-line @next/next/no-img-element -- private, frequently changing screenshot
                <img src={"/api/web-tasks/" + task.id + "/shot?t=" + task.updated_at + "-" + tick} alt={task.title ?? "Browser screenshot"} className="w-full" />
              ) : (
                <div className="flex aspect-[16/10] items-center justify-center text-sm text-soft">
                  {ACTIVE.includes(task.status) ? <Loader2 size={18} className="animate-spin" /> : "No screenshot"}
                </div>
              )}
              {shots.length > 1 && (
                <div className="flex gap-1 overflow-x-auto border-t border-line p-2">
                  {shots.map((k) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => {
                        setPlaying(false);
                        setView(k);
                      }}
                      className={cx("shrink-0 border", view === k ? "border-core" : "border-line opacity-70 hover:opacity-100")}
                      title={k === 0 ? "Start" : "After step " + k + ": " + (task.steps[k - 1]?.did ?? "")}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element -- private step thumbnail */}
                      <img src={"/api/web-tasks/" + task.id + "/shot?step=" + k} alt="" className="h-12 w-20 object-cover object-top" loading="lazy" />
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* the step log: open while it works, folded once finished (the result and screenshots matter more then) */}
            <details key={task.id + (ACTIVE.includes(task.status) ? "-live" : "-done")} open={ACTIVE.includes(task.status)} className="group max-w-3xl">
              <summary className="flex min-h-10 cursor-pointer list-none items-center gap-2 text-sm text-soft hover:text-fg">
                <ChevronRight size={15} className="transition-transform duration-150 group-open:rotate-90" />
                Steps <span className="text-faint tabular-nums">({task.steps.length})</span>
                {task.steps.some((s) => !s.ok) && <span className="text-xs text-alert">· {task.steps.filter((s) => !s.ok).length} had trouble</span>}
              </summary>
            <ol className="mt-1 space-y-1.5">
              {task.steps.map((s, i) => (
                <li key={s.at + "-" + i}>
                  <button
                    type="button"
                    disabled={!shots.includes(i + 1)}
                    onClick={() => {
                      setPlaying(false);
                      setView(i + 1);
                    }}
                    className={cx("flex w-full gap-2 rounded px-1 py-0.5 text-left text-sm enabled:hover:bg-raised", view === i + 1 && "bg-core/10")}
                  >
                    <span className="w-6 shrink-0 text-right font-mono text-[11px] text-faint">{i + 1}</span>
                    <span className="min-w-0">
                      <span className={s.ok ? "" : "text-alert"}>{stepLabel(s.did)}</span>
                      {s.note && <span className="text-alert"> · {s.note}</span>}
                      {s.thought && <span className="block text-xs text-soft">{s.thought}</span>}
                    </span>
                  </button>
                </li>
              ))}
              {task.status === "running" && (
                <li className="flex items-center gap-2 pl-8 text-xs text-soft">
                  <Loader2 size={12} className="animate-spin" /> thinking…
                </li>
              )}
            </ol>
            </details>
          </div>
        ) : (
          <Empty>Start a task to watch HIVEMIND work in the browser.</Empty>
        )}
      </div>
    </div>
  );
}
