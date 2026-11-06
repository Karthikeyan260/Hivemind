/** Mission Control: turns what each background job has been doing into a crew of agents with a mood. Pure, so it is testable. */

export type AgentState = "working" | "idle" | "sleeping" | "alert";
export type CrewId = "scheduler" | "autopilot" | "web" | "dream" | "brief" | "reminders" | "apps";
export type CrewAgent = { id: CrewId; name: string; role: string; state: AgentState; line: string; detail: string[]; at: string | null; href: string };

type WebStatus = "queued" | "running" | "needs_approval" | "needs_you" | "done" | "failed" | "cancelled";
export type MissionFacts = {
  now: number;
  /** Local hour 0 to 23, and today's local date (YYYY-MM-DD). */
  hour: number;
  today: string;
  briefHour: number;
  scheduler: { lastRun: string | null; staleMs: number };
  autopilot: { enabled: boolean; startHour: number; endHour: number; everyHours: number; running: boolean; lastRun: string | null; lastFound: number | null; lastError: string | null; fresh: number };
  web: { configured: boolean; tasks: Array<{ goal: string; status: WebStatus; updated_at: string; lastDid: string | null; question: string | null; error: string | null }> };
  dream: { enabled: boolean; hour: number; last: { date: string; at: string; changes: number } | null };
  brief: { enabled: boolean; topics: number; lastDate: string | null };
  reminders: { overdue: number; today: number; next: string | null };
  apps: Array<{ name: string; status: "building" | "ready" | "failed"; updated_at: string }>;
};

const HOUR = 3_600_000;

/** "5 min ago", "3 h ago", "2 days ago". */
export function ago(iso: string | null, now: number): string {
  if (!iso) return "never";
  const ms = now - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 60_000) return "just now";
  if (ms < HOUR) return `${Math.floor(ms / 60_000)} min ago`;
  if (ms < 24 * HOUR) return `${Math.floor(ms / HOUR)} h ago`;
  const d = Math.floor(ms / (24 * HOUR));
  return `${d} day${d === 1 ? "" : "s"} ago`;
}

export function buildCrew(f: MissionFacts): CrewAgent[] {
  const crew: CrewAgent[] = [];

  // Clockwork: the outside job that wakes everything else.
  {
    const last = f.scheduler.lastRun;
    const quiet = last ? f.now - Date.parse(last) : null;
    const stale = quiet === null || quiet > f.scheduler.staleMs;
    crew.push({
      id: "scheduler",
      name: "Clockwork",
      role: "Wakes the others on time",
      state: stale ? "alert" : "idle",
      line: quiet === null ? "Has never run. Reminders and the brief can't arrive." : stale ? `Silent for ${Math.round(quiet / HOUR)} h. Check the cron-job.org job.` : `Last tick ${ago(last, f.now)}.`,
      detail: ["Runs from an outside timer (cron-job.org) that calls HIVEMIND every few minutes.", "If it stops, reminders, the brief and Autopilot all stop with it."],
      at: last,
      href: "/settings",
    });
  }

  // Scout: Autopilot.
  {
    const a = f.autopilot;
    const awake = a.enabled && f.hour >= a.startHour && f.hour < a.endHour;
    const state: AgentState = a.running ? "working" : a.lastError ? "alert" : awake ? "idle" : "sleeping";
    crew.push({
      id: "autopilot",
      name: "Scout",
      role: "Looks for things worth your attention",
      state,
      line: a.running ? "Sweeping your brain for things that matter…" : a.lastError ? `Last sweep failed: ${a.lastError}` : !a.enabled ? "Autopilot is switched off." : !awake ? `Off duty until ${a.startHour}:00.` : `Last sweep ${ago(a.lastRun, f.now)}, found ${a.lastFound ?? 0}.`,
      detail: [`Works ${a.startHour}:00 to ${a.endHour}:00, every ${a.everyHours} h.`, `${a.fresh} new insight${a.fresh === 1 ? "" : "s"} waiting.`],
      at: a.lastRun,
      href: "/autopilot",
    });
  }

  // Rover: the cloud-browser agent.
  {
    const w = f.web;
    const needs = w.tasks.find((t) => t.status === "needs_approval" || t.status === "needs_you");
    const running = w.tasks.find((t) => t.status === "running" || t.status === "queued");
    const failed = w.tasks.find((t) => t.status === "failed" && f.now - Date.parse(t.updated_at) < 6 * HOUR);
    const latest = w.tasks[0];
    let state: AgentState = "idle";
    let line = latest ? `Last task ${ago(latest.updated_at, f.now)}.` : "No browser tasks yet.";
    if (!w.configured) {
      state = "sleeping";
      line = "No cloud browser key set, so Rover is resting.";
    } else if (needs) {
      state = "alert";
      line = `Waiting for you: ${needs.question ?? needs.goal}`;
    } else if (running) {
      state = "working";
      line = running.lastDid ?? running.goal;
    } else if (failed) {
      state = "alert";
      line = `A task failed: ${failed.error ?? failed.goal}`;
    }
    crew.push({
      id: "web",
      name: "Rover",
      role: "Drives a real browser for you",
      state,
      line,
      detail: [latest ? `Latest goal: ${latest.goal}` : "Ask HIVEMIND to do something on the web.", `${w.tasks.length} recent task${w.tasks.length === 1 ? "" : "s"}.`],
      at: latest?.updated_at ?? null,
      href: "/web",
    });
  }

  // Night Owl: Dream mode, awake overnight.
  {
    const d = f.dream;
    const night = f.hour < 7 || f.hour >= 22;
    crew.push({
      id: "dream",
      name: "Night Owl",
      role: "Tidies your memories overnight",
      state: !d.enabled || !night ? "sleeping" : "idle",
      line: !d.enabled ? "Dream mode is switched off." : d.last ? `Last night's dream (${d.last.date}): ${d.last.changes} change${d.last.changes === 1 ? "" : "s"}.` : "Hasn't dreamed yet.",
      detail: [`Dreams around ${d.hour}:00 while you sleep.`],
      at: d.last?.at ?? null,
      href: "/dream",
    });
  }

  // Scribe: the morning brief.
  {
    const b = f.brief;
    const have = b.lastDate === f.today;
    const late = !have && f.hour > f.briefHour;
    crew.push({
      id: "brief",
      name: "Scribe",
      role: "Writes your morning brief",
      state: !b.enabled || b.topics === 0 ? "sleeping" : late ? "alert" : "idle",
      line: !b.enabled || b.topics === 0 ? "No topics set, so no brief." : have ? `Today's brief is ready (${b.topics} topic${b.topics === 1 ? "" : "s"}).` : late ? "Today's brief hasn't arrived yet." : `Brief arrives around ${f.briefHour}:00.`,
      detail: [`${b.topics} topic${b.topics === 1 ? "" : "s"} followed.`, b.lastDate ? `Last brief: ${b.lastDate}.` : "No brief written yet."],
      at: b.lastDate ? `${b.lastDate}` : null,
      href: "/brief",
    });
  }

  // Bell: reminders.
  {
    const r = f.reminders;
    crew.push({
      id: "reminders",
      name: "Bell",
      role: "Rings when something is due",
      state: r.overdue > 0 ? "alert" : r.today > 0 ? "working" : "idle",
      line: r.overdue > 0 ? `${r.overdue} overdue reminder${r.overdue === 1 ? "" : "s"}.` : r.today > 0 ? (r.next ? `Due today: ${r.next}` : `${r.today} due today.`) : "Nothing due today.",
      detail: [`${r.today} due today, ${r.overdue} overdue.`],
      at: null,
      href: "/habits",
    });
  }

  // Maker: the app builder.
  {
    const building = f.apps.find((a) => a.status === "building");
    const failed = f.apps.find((a) => a.status === "failed" && f.now - Date.parse(a.updated_at) < 24 * HOUR);
    const latest = [...f.apps].sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];
    crew.push({
      id: "apps",
      name: "Maker",
      role: "Builds the apps you ask for",
      state: building ? "working" : failed ? "alert" : "idle",
      line: building ? `Building ${building.name}…` : failed ? `${failed.name} failed to build.` : f.apps.length ? `${f.apps.length} app${f.apps.length === 1 ? "" : "s"} built.` : "Nothing built yet. Ask for an app.",
      detail: [f.apps.length ? `${f.apps.length} app${f.apps.length === 1 ? "" : "s"} in your library.` : "Say 'build me an app that…' to start."],
      at: latest?.updated_at ?? null,
      href: "/apps",
    });
  }

  return crew;
}

export function summary(crew: CrewAgent[]): string {
  const alerts = crew.filter((c) => c.state === "alert").length;
  const working = crew.filter((c) => c.state === "working").length;
  const parts: string[] = [];
  if (alerts) parts.push(`${alerts} ${alerts === 1 ? "needs" : "need"} you`);
  if (working) parts.push(`${working} working`);
  return parts.length ? parts.join(", ") : "All quiet. Everyone is where they should be";
}
