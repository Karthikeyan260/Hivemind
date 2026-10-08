import { NextResponse } from "next/server";
import { z } from "zod";
import { intentCheck, isGuarded } from "@/lib/agents/intent";
import { TOOLS } from "@/lib/agents/tools";
import type { Action, RunContext, Source } from "@/lib/agents/types";
import { handle, HttpError, parseBody } from "@/lib/api";
import { db } from "@/lib/db";
import type { Job } from "@/lib/external/jobs";

// check_listed_job runs the ATS analysis and the tailored resume back to back.
export const maxDuration = 120;

const Body = z.object({
  name: z.string().min(1).max(60),
  args: z.record(z.string(), z.unknown()).default({}),
  /** What the owner said this turn (voice transcript): guarded tools are checked against it here too. */
  said: z.string().max(4000).default(""),
  /** A routine is running this turn: its steps never use guarded tools. */
  routine: z.boolean().default(false),
  state: z
    .object({
      jobs: z.array(z.record(z.string(), z.unknown())).max(20).optional(),
      pending_delete: z
        .object({ id: z.uuid(), title: z.string() })
        .nullable()
        .optional(),
      location: z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180), accuracy: z.number().min(0).max(100_000).optional(), device: z.string().max(60).optional() }).optional(),
    })
    .default({}),
});

/**
 * Runs one of the chat agents' tools directly, so live voice can do everything the chat can.
 * Multi-turn state (last job search, a memory awaiting delete confirmation) is kept by the caller.
 */
export const POST = handle(async (req: Request) => {
  const { name, args, state, said, routine } = await parseBody(req, Body);
  const tool = TOOLS[name];
  if (!tool) throw new HttpError(404, `Unknown tool "${name}"`);
  // The same owner-intent guard as chat, on the server: deleting, sending, calling, approving or
  // changing only when the owner's own words this turn asked for it (the browser checks too).
  if (isGuarded(name)) {
    const refused = routine ? "Routines can't delete, send, call or change things. Ask the owner to ask for it directly." : intentCheck(name, said);
    if (refused) return NextResponse.json({ result: { error: refused }, sources: [], actions: [], changed: false, jobs: null });
  }
  const sources: Source[] = [];
  const actions: Action[] = [];
  const ctx: RunContext = {
    supabase: db(),
    projectId: null,
    conversationId: "",
    origin: process.env.APP_URL || new URL(req.url).origin,
    sources,
    actions,
    changed: false,
    jobs: null,
    pendingDelete: null,
    carried: {
      jobs: state.jobs as Job[] | undefined,
      pendingDelete: state.pending_delete ?? undefined,
    },
    emit: () => {},
    location: state.location,
  };
  const result = await tool.run(args, ctx);
  return NextResponse.json({
    result,
    sources,
    actions,
    changed: ctx.changed,
    jobs: ctx.jobs,
    pending_delete: ctx.pendingDelete,
  });
});
