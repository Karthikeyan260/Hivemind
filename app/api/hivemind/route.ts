import { z } from "zod";
import { runAgent } from "@/lib/agents/orchestrator";
import { routeAgent } from "@/lib/agents/router";
import type { Action, AgentEvent, AgentId, RunContext, Source } from "@/lib/agents/types";
import { generateWithFallback } from "@/lib/ai/providers";
import type { ChatMessage } from "@/lib/ai/types";
import { dbError, handle, HttpError, parseBody } from "@/lib/api";
import { db } from "@/lib/db";
import type { Job } from "@/lib/external/jobs";
import { productQuery, SHOPPING, storeSearchLinks, storesIn } from "@/lib/external/products";
import { listProjects } from "@/lib/organizer";
import { getPrefs, languageRule } from "@/lib/prefs";
import { getProfile, profileForPrompt } from "@/lib/profile";
import { searchKnowledge, sourceHref } from "@/lib/rag/retrieval";
import { agenda, agendaForPrompt } from "@/lib/reminders";
import { listRoutines, triggeredRoutine } from "@/lib/routines";

// Checking a found job runs the ATS analysis and the tailored resume back to back.
export const maxDuration = 120;

const Body = z.object({
  message: z.string().trim().min(1).max(4000),
  conversation_id: z.uuid().nullable().optional(),
  project_id: z.uuid().nullable().optional(),
  location: z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180), accuracy: z.number().min(0).max(100_000).optional(), device: z.string().max(60).optional() }).nullable().optional(),
});

export type StreamEvent =
  | AgentEvent
  | { type: "meta"; conversation_id: string; intent: string; sources: Source[] }
  | { type: "delta"; text: string }
  | { type: "action"; label: string; href?: string; navigate?: boolean; open?: boolean }
  | { type: "jobs"; jobs: Job[] }
  | { type: "done"; provider?: string; model?: string; latency_ms?: number; changed?: boolean }
  | { type: "error"; message: string };

const persona = (profile: string, projects: string, schedule: string) => `You are HIVEMIND, the owner's personal AI: part memory, part chief of staff.
You know them from their own stored knowledge. Speak directly to them as "you", warm but efficient, like a
trusted aide. Be concrete. Use short paragraphs and bullet lists when listing things.

What you understand about the owner:
${profile}

Their projects: ${projects || "(none yet)"}

Their schedule:
${schedule}
When greeting them or when it matters, briefly mention what is on today (and tomorrow).

When context from their brain is given, ground every claim in it and cite like [1], [2].
If the brain doesn't contain the answer, say so plainly and suggest what to save. Never invent facts about them.`;

/**
 * The HIVEMIND orchestrator: routes each message to a specialist agent (Memory, Knowledge, Research,
 * Career, Project, Profile or Core), which runs its own tools and may delegate to colleagues. Streams
 * newline-delimited JSON events (agent → tool → delta → done) so the console shows the work live.
 */
export const POST = handle(async (req: Request) => {
  const supabase = db();
  const { message, conversation_id, project_id, location } = await parseBody(req, Body);

  let conversationId = conversation_id ?? null;
  let history: ChatMessage[] = [];
  let previousAgent: AgentId | null = null;
  if (conversationId) {
    const { data, error } = await supabase
      .from("messages")
      .select("role, content, agent:metadata->>agent")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: false })
      .limit(8);
    dbError(error);
    const rows = (data ?? []) as (ChatMessage & { agent?: AgentId | null })[];
    previousAgent = rows.find((m) => m.role === "assistant")?.agent ?? null;
    history = rows.reverse().map(({ role, content }) => ({ role, content }));
  } else {
    const { data, error } = await supabase.from("conversations").insert({ title: message.slice(0, 80) }).select("id").single();
    dbError(error);
    conversationId = data!.id as string;
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (e: StreamEvent) => controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
      let reply = "";
      const sources: Source[] = [];
      const trace: AgentEvent[] = [];
      const actions: Action[] = [];
      let done: Extract<StreamEvent, { type: "done" }> = { type: "done" };
      let intent = "rag";
      let via = "rules";

      try {
        const [route, profile, projects, schedule, prefs] = await Promise.all([
          // A routine's phrase ("good morning", "gym mode") goes straight to Core, which runs it.
          listRoutines(supabase)
            .then((all) => triggeredRoutine(all, message))
            .catch(() => null)
            .then((r) => (r ? { agent: "core" as const, via: "rules" as const, routine: r.name } : routeAgent(message, previousAgent))),
          getProfile(supabase),
          listProjects(supabase),
          agenda(supabase, 2).then(agendaForPrompt).catch(() => "(unavailable)"),
          getPrefs(supabase).catch(() => ({ language: "auto" as const })),
        ]);
        intent = route.agent;
        via = route.via;
        send({ type: "meta", conversation_id: conversationId!, intent, sources });

        const ctx: RunContext = { supabase, projectId: project_id ?? null, conversationId: conversationId!, origin: process.env.APP_URL || new URL(req.url).origin, sources, actions, changed: false, jobs: null, pendingDelete: null, location: location ?? undefined, emit: (e) => {
            trace.push(e);
            send(e);
          } };
        const system = persona(profileForPrompt(profile), projects.map((p) => p.name).join(", "), schedule);
        // Tamil script is unambiguous, so say it outright rather than leave it to the model.
        const tamil = prefs.language !== "en" && /[஀-௿]/.test(message);
        const closing = [languageRule(prefs.language), tamil ? "The owner just wrote in Tamil script: write your whole answer in Tamil script (technical terms may stay in English)." : ""].filter(Boolean).join("\n");
        const started = Date.now();
        try {
          const r = await runAgent({
            agentId: route.agent,
            message: "routine" in route ? `${message}\n\n(This is the owner's "${route.routine}" routine: call run_routine.)` : message,
            history,
            persona: system,
            closing,
            ctx,
            onText: (t) => {
              reply += t;
              send({ type: "delta", text: t });
            },
          });
          done = { type: "done", provider: "gemini agents", model: r.model, latency_ms: Date.now() - started };
        } catch (err) {
          if (reply) throw err;
          console.warn("agents unavailable, plain answer:", err instanceof Error ? err.message : err);
          // A shopping request still gets real store links (no AI needed), not a "nothing in your brain" reply.
          const product = SHOPPING.test(message) ? productQuery(message) : "";
          if (product) {
            // find_product may have run before the model gave out: keep its product pages, add nothing twice.
            for (const l of storeSearchLinks(product, storesIn(message))) {
              if (!actions.some((a) => a.href === l.url)) actions.push({ label: `Search ${l.store}`, href: l.url });
            }
            const links = actions.filter((a) => a.href?.startsWith("http"));
            reply = `The AI is busy right now (Google's free limit), so here are the store links for **${product}**:\n\n${links.map((l) => `- [${l.label}](${l.href})`).join("\n")}\n\nAsk again in a minute for exact product pages and prices.`;
            send({ type: "delta", text: reply });
            done = { type: "done", provider: "store links", model: "none", latency_ms: Date.now() - started };
          } else {
            // Gemini down before the first token: answer from the brain with NVIDIA/Groq, no tools.
            const context = await searchKnowledge(supabase, message, { projectId: project_id, limit: 8 });
            context.forEach((c, i) => sources.push({ n: i + 1, type: c.source_type, title: c.title, href: sourceHref(c), similarity: Math.round(c.similarity * 100) / 100 }));
            const userTurn = context.length
              ? `Context from my brain:\n${context.map((c, i) => `[${i + 1}] (${c.source_type}) ${c.title}\n${c.content.slice(0, 1500)}`).join("\n\n---\n\n")}\n\nMe: ${message}`
              : message;
            const res = await generateWithFallback([...history, { role: "user", content: userTurn }], { system: `${system}\n\n${closing}`, order: ["nvidia", "openrouter", "github", "groq"], temperature: 0.3 });
            reply = res.text;
            send({ type: "delta", text: reply });
            done = { type: "done", provider: res.provider, model: res.model, latency_ms: res.latencyMs };
          }
        }
        // Final sources (tools add them as they run) and whether the brain changed.
        send({ type: "meta", conversation_id: conversationId!, intent, sources });
        done.changed = ctx.changed;

        if (ctx.jobs) send({ type: "jobs", jobs: ctx.jobs });
        for (const a of actions) send({ type: "action", ...a });
        send(done);

        await supabase.from("messages").insert([
          { conversation_id: conversationId, role: "user", content: message, metadata: {} },
          {
            conversation_id: conversationId,
            role: "assistant",
            content: reply,
            metadata: { intent, agent: intent, router: via, trace, sources, actions, jobs: ctx.jobs ?? undefined, pending_delete: ctx.pendingDelete ?? undefined, provider: done.provider, model: done.model, latency_ms: done.latency_ms },
          },
        ]);
      } catch (err) {
        console.error("hivemind:", err instanceof Error ? err.message : err);
        send({ type: "error", message: err instanceof HttpError ? err.message : "I hit a problem answering that. Try again in a moment." });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" },
  });
});
