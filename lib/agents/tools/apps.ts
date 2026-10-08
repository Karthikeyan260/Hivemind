import "server-only";
import { obj, S, str } from "./shared";
import type { Tool } from "../types";

/** Self-built apps. */
export const apps: Record<string, Tool> = {
  /* ───── self-built apps ("make me an app to track my petrol expenses") ───── */
  create_app: {
    name: "create_app",
    description:
      "Build a new small app for the owner from a description (a tracker, log, calculator, planner, flashcards…). HIVEMIND writes it in about 30 seconds and adds it to the menu; it saves its own data and gets its own voice commands. 'description' = everything they asked for, in full.",
    parameters: obj({ description: S }, ["description"]),
    async run(args, ctx) {
      const description = str(args.description);
      if (description.length < 5) return { error: "Say what the app should do." };
      const { kickBuild, startApp } = await import("@/lib/apps");
      const app = await startApp(ctx.supabase, description);
      await kickBuild(ctx.origin, app.id);
      ctx.changed = true;
      ctx.actions.push({ label: "Open the new app", href: `/apps/${app.id}`, navigate: true });
      return { building: true, note: "Tell the owner it's being written (about 30 seconds) and it opens on screen when ready, with its own voice commands." };
    },
  },
  list_apps: {
    name: "list_apps",
    description: "The apps HIVEMIND has built for the owner.",
    parameters: obj({}),
    async run(_args, ctx) {
      const { listApps } = await import("@/lib/apps");
      const apps = await listApps(ctx.supabase);
      ctx.actions.push({ label: "Open Apps", href: "/apps" });
      return { apps: apps.map((a) => ({ name: a.name, about: a.description, status: a.status })) };
    },
  },
  open_app: {
    name: "open_app",
    description: "Open one of the owner's apps. 'which' = words from its name ('petrol').",
    parameters: obj({ which: S }, ["which"]),
    async run(args, ctx) {
      const { findApp } = await import("@/lib/apps");
      const app = await findApp(ctx.supabase, str(args.which));
      if (!app) return { error: `No app like "${str(args.which)}".` };
      ctx.actions.push({ label: `Open ${app.name}`, href: `/apps/${app.id}`, navigate: true });
      return { opening: app.name, note: "On its page, its own voice commands work too." };
    },
  },
  change_app: {
    name: "change_app",
    description: "Change or add a feature to one of the owner's apps ('add a field for km driven to the petrol app'). Takes about 30 seconds; the old version can be restored. Only on the owner's own request.",
    parameters: obj({ which: S, change: S }, ["which", "change"]),
    async run(args, ctx) {
      const { findApp, kickBuild, markBuilding } = await import("@/lib/apps");
      const app = await findApp(ctx.supabase, str(args.which));
      if (!app) return { error: `No app like "${str(args.which)}".` };
      await markBuilding(ctx.supabase, app.id, str(args.change));
      await kickBuild(ctx.origin, app.id);
      ctx.changed = true;
      ctx.actions.push({ label: `Open ${app.name}`, href: `/apps/${app.id}`, navigate: true });
      return { changing: app.name, note: "About 30 seconds; the app reloads by itself. 'Undo' on its page brings the old version back." };
    },
  },
  delete_app: {
    name: "delete_app",
    description:
      "Delete one of the owner's apps and everything it saved. Call it first WITHOUT confirm: say the app's name and ask 'Delete it?'. Call again with confirm=true ONLY after they say yes. Only on the owner's own request.",
    parameters: obj({ which: S, confirm: { type: "boolean" } }, ["which"]),
    async run(args, ctx) {
      const { deleteApp, findApp } = await import("@/lib/apps");
      const app = await findApp(ctx.supabase, str(args.which));
      if (!app) return { error: `No app like "${str(args.which)}".` };
      if (args.confirm !== true) return { confirm_needed: true, app: app.name, about: app.description, note: "Ask the owner to confirm; nothing is deleted yet." };
      await deleteApp(ctx.supabase, app.id);
      ctx.changed = true;
      return { deleted: app.name };
    },
  },
};
