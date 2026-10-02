"use client";

import { Check, CircleAlert, ExternalLink, Globe, Hand, Loader2, MonitorPlay, Play, RotateCcw, Square, Trash2, X } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { Badge, Button, cx, Empty, ErrorText, Input, PageHeader, Textarea } from "@/components/ui";
import { useVoiceActions } from "@/components/voice/provider";
import { api, timeAgo, useFetch } from "@/lib/client-api";

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
  const [live, setLive] = useState(false);
  const [tick, setTick] = useState(0);

  const tasks = list.data?.tasks ?? [];
  const openId = params.get("task") ?? tasks[0]?.id ?? null;
  const task = tasks.find((t) => t.id === openId) ?? null;
  const anyActive = tasks.some((t) => ACTIVE.includes(t.status));

  // Follow the agent while it works.
  const reload = list.reload;
  useEffect(() => {
    if (!anyActive) return;
    const t = setInterval(() => {
      void reload();
      setTick((n) => n + 1);
    }, 2500);
    return () => clearInterval(t);
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

  useVoiceActions({
    web_task_start: {
      description: "Web page: start a browser task. input: what to do on the web (e.g. 'compare the price of X on Amazon and Flipkart').",
      run: async ({ input }) => {
        const t = await start(String(input ?? ""));
        return t ? { started: t.goal, note: "Working in the cloud browser; risky steps will ask for approval." } : { error: "Couldn't start it." };
      },
    },
    web_task_decide: {
      description: "Web page: answer the open task. input: approve, reject, continue, cancel or retry.",
      run: async ({ input }) => {
        const d = String(input ?? "").toLowerCase().match(/approve|reject|continue|cancel|retry/)?.[0] as "approve" | "reject" | "continue" | "cancel" | "retry" | undefined;
        if (!d) return { error: "Say approve, reject, continue, cancel or retry." };
        await decide(d);
        return { done: d };
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

      <section className="mb-6 space-y-2 rounded-xl border border-line bg-panel p-4">
        <Textarea rows={2} placeholder="What should I do on the web?" value={goal} onChange={(e) => setGoal(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.metaKey || e.ctrlKey) && start()} />
        <div className="flex flex-wrap items-center gap-2">
          <Input className="min-w-0 flex-1" placeholder="Start at URL (optional)" value={url} onChange={(e) => setUrl(e.target.value)} />
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
        <ul className="space-y-2">
          {tasks.length === 0 && !list.loading && <Empty>No web tasks yet.</Empty>}
          {finishedCount > 0 && (
            <li className="flex justify-end">
              <button type="button" onClick={clearFinished} className="flex items-center gap-1 font-mono text-[11px] uppercase tracking-wider text-soft hover:text-alert">
                <Trash2 size={12} /> Clear finished ({finishedCount})
              </button>
            </li>
          )}
          {tasks.map((t) => (
            <li key={t.id} className="group relative">
              <button
                type="button"
                onClick={() => router.replace(`/web?task=${t.id}`)}
                className={cx("w-full rounded-md border p-3 pr-9 text-left", t.id === openId ? "border-core bg-core/5" : "border-line bg-raised hover:border-line-strong")}
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
                className="absolute right-2 top-2 rounded p-1 text-faint hover:bg-alert/10 hover:text-alert"
              >
                <Trash2 size={14} />
              </button>
            </li>
          ))}
        </ul>

        {task ? (
          <div className="min-w-0 space-y-4">
            <div className="flex flex-wrap items-start gap-2">
              <h2 className="min-w-0 flex-1 font-medium">{task.goal}</h2>
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
                <p className="whitespace-pre-wrap leading-relaxed">{task.result}</p>
              </div>
            )}
            {task.error && (
              <p className="flex items-center gap-2 text-sm text-alert">
                <CircleAlert size={14} /> {task.error}
              </p>
            )}

            <div className="overflow-hidden rounded-xl border border-line bg-panel">
              <div className="flex items-center gap-2 border-b border-line px-3 py-2 font-mono text-[11px] text-soft">
                <Globe size={13} />
                <span className="truncate">{task.url ?? task.start_url ?? "about:blank"}</span>
                {task.live_url && ACTIVE.includes(task.status) && (
                  <button type="button" onClick={() => setLive(!live)} className="ml-auto flex shrink-0 items-center gap-1 text-data hover:underline">
                    <MonitorPlay size={13} /> {live ? "Screenshot" : "Live view"}
                  </button>
                )}
                {task.url && (
                  <a href={task.url} target="_blank" rel="noopener noreferrer" className={cx("flex shrink-0 items-center gap-1 hover:text-data", !(task.live_url && ACTIVE.includes(task.status)) && "ml-auto")}>
                    <ExternalLink size={12} />
                  </a>
                )}
              </div>
              {live && task.live_url && ACTIVE.includes(task.status) ? (
                <iframe src={`${task.live_url}${task.live_url.includes("?") ? "&" : "?"}interactive=true`} title="Live browser" className="aspect-[16/10] w-full bg-black" allow="clipboard-read; clipboard-write" />
              ) : task.has_shot ? (
                // eslint-disable-next-line @next/next/no-img-element -- private, frequently changing screenshot
                <img src={`/api/web-tasks/${task.id}/shot?t=${task.updated_at}-${tick}`} alt={task.title ?? "Browser screenshot"} className="w-full" />
              ) : (
                <div className="flex aspect-[16/10] items-center justify-center text-sm text-soft">
                  {ACTIVE.includes(task.status) ? <Loader2 size={18} className="animate-spin" /> : "No screenshot"}
                </div>
              )}
            </div>

            <ol className="space-y-1.5">
              {task.steps.map((s, i) => (
                <li key={`${s.at}-${i}`} className="flex gap-2 text-sm">
                  <span className="w-6 shrink-0 text-right font-mono text-[11px] text-faint">{i + 1}</span>
                  <div className="min-w-0">
                    <span className={s.ok ? "" : "text-alert"}>{s.did}</span>
                    {s.note && <span className="text-alert"> · {s.note}</span>}
                    {s.thought && <div className="text-xs text-soft">{s.thought}</div>}
                  </div>
                </li>
              ))}
              {task.status === "running" && (
                <li className="flex items-center gap-2 pl-8 text-xs text-soft">
                  <Loader2 size={12} className="animate-spin" /> thinking…
                </li>
              )}
            </ol>
          </div>
        ) : (
          <Empty>Start a task to watch HIVEMIND work in the browser.</Empty>
        )}
      </div>
    </div>
  );
}
