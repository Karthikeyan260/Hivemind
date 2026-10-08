import "server-only";
import { obj, S, str } from "./shared";
import type { Tool } from "../types";

/** Autopilot. */
export const autopilot: Record<string, Tool> = {
  /* ───── autopilot (imported lazily: Autopilot itself runs agents) ───── */
  autopilot_feed: {
    name: "autopilot_feed",
    description: "What Autopilot (HIVEMIND working on its own in the background) noticed lately and hasn't been dealt with: insights with links and one-tap requests. Use for 'what did autopilot find', 'anything I should know', 'what needs my attention'.",
    parameters: obj({}),
    async run(_args, ctx) {
      const { getFeed } = await import("@/lib/autopilot");
      const f = await getFeed(ctx.supabase);
      ctx.actions.push({ label: "Open Autopilot", href: "/autopilot" });
      return {
        last_run: f.lastRun,
        enabled: f.settings.enabled,
        open_insights: f.items.filter((i) => i.status === "new").slice(0, 8).map((i) => ({ title: i.title, body: i.body, priority: i.priority, link: i.link?.url, ask: i.ask })),
      };
    },
  },
  autopilot_update: {
    name: "autopilot_update",
    description:
      "Change Autopilot: mark an insight 'done' or 'dismissed' (not useful: it won't suggest anything like it again) using words from its title in 'which' (or 'all' to mark every open one done); and/or change settings: enabled (run on its own), every_hours (1-24), push (notify when urgent). Only on the owner's own request.",
    parameters: obj({
      which: S,
      status: { type: "string", enum: ["done", "dismissed"] },
      enabled: { type: "boolean" },
      every_hours: { type: "number" },
      push: { type: "boolean" },
    }),
    async run(args, ctx) {
      const { getFeed, saveSettings, setInsightStatus } = await import("@/lib/autopilot");
      const out: Record<string, unknown> = {};
      const settings: Record<string, unknown> = {};
      if (typeof args.enabled === "boolean") settings.enabled = args.enabled;
      if (typeof args.push === "boolean") settings.push = args.push;
      if (typeof args.every_hours === "number") settings.every_hours = Math.min(24, Math.max(1, Math.round(args.every_hours)));
      if (Object.keys(settings).length) out.settings = await saveSettings(ctx.supabase, settings);
      const status = str(args.status) as "done" | "dismissed";
      if (status) {
        const open = (await getFeed(ctx.supabase)).items.filter((i) => i.status === "new");
        const words = str(args.which).toLowerCase();
        const hits = /^(all|everything)$/.test(words) ? open : open.filter((i) => words && `${i.title} ${i.body}`.toLowerCase().includes(words)).slice(0, 1);
        if (!hits.length) return { ...out, error: `No open insight matching "${words}".`, open: open.map((i) => i.title) };
        for (const i of hits) await setInsightStatus(ctx.supabase, i.id, status);
        out.marked = hits.map((i) => i.title);
        out.as = status;
      }
      if (!Object.keys(out).length) return { error: "Say which insight to mark, or which setting to change." };
      ctx.changed = true;
      return out;
    },
  },
  run_autopilot: {
    name: "run_autopilot",
    description: "Run Autopilot now: it looks across the owner's whole brain (schedule, habits, birthdays, projects, job hunt) plus the web and reports what needs attention. Takes up to a minute. Use when they say 'run autopilot' or 'check everything for me'.",
    parameters: obj({}),
    async run(_args, ctx) {
      const { runAutopilot } = await import("@/lib/autopilot");
      const r = await runAutopilot(ctx.supabase, { manual: true, origin: ctx.origin });
      ctx.actions.push({ label: "Open Autopilot", href: "/autopilot" });
      if ("skipped" in r) return { error: "Autopilot is already running; try again in a minute." };
      return { found: r.insights.map((i) => ({ title: i.title, body: i.body, priority: i.priority, link: i.link?.url })), ...(r.error ? { error: r.error } : {}) };
    },
  },
};
