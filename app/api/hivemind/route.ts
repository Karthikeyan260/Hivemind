import { z } from "zod";
import { streamGemini } from "@/lib/ai/gemini";
import { generateWithFallback, parseJson } from "@/lib/ai/providers";
import { detectIntent } from "@/lib/ai/router";
import type { ChatMessage } from "@/lib/ai/types";
import { logActivity } from "@/lib/activity";
import { dbError, handle, parseBody } from "@/lib/api";
import { db } from "@/lib/db";
import { createMemory } from "@/lib/knowledge";
import { listProjects } from "@/lib/organizer";
import { getProfile, profileForPrompt } from "@/lib/profile";
import { searchKnowledge, sourceHref } from "@/lib/rag/retrieval";

export const maxDuration = 60;

const Body = z.object({
  message: z.string().trim().min(1).max(4000),
  conversation_id: z.uuid().nullable().optional(),
  project_id: z.uuid().nullable().optional(),
});

type Source = { n: number; type: string; title: string; href: string; similarity: number };
export type StreamEvent =
  | { type: "meta"; conversation_id: string; intent: string; sources: Source[] }
  | { type: "delta"; text: string }
  | { type: "action"; label: string; href?: string }
  | { type: "done"; provider?: string; model?: string; latency_ms?: number }
  | { type: "error"; message: string };

const persona = (profile: string, projects: string) => `You are HIVEMIND, the owner's personal AI: part memory, part chief of staff.
You know them from their own stored knowledge. Speak directly to them as "you", warm but efficient, like a
trusted aide. Be concrete. Use short paragraphs and bullet lists when listing things.

What you understand about the owner:
${profile}

Their projects: ${projects || "(none yet)"}

When context from their brain is given, ground every claim in it and cite like [1], [2].
If the brain doesn't contain the answer, say so plainly and suggest what to save. Never invent facts about them.`;

const ProjectAsk = z.object({ name: z.string().min(1).max(120), description: z.string().max(500).default("") });

/** Streams newline-delimited JSON events so the HUD can react (thinking → answering) in real time. */
export const POST = handle(async (req: Request) => {
  const supabase = db();
  const { message, conversation_id, project_id } = await parseBody(req, Body);

  let conversationId = conversation_id ?? null;
  let history: ChatMessage[] = [];
  if (conversationId) {
    const { data, error } = await supabase
      .from("messages")
      .select("role, content")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: false })
      .limit(8);
    dbError(error);
    history = (data ?? []).reverse() as ChatMessage[];
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
      let sources: Source[] = [];
      const actions: { label: string; href?: string }[] = [];
      let done: Extract<StreamEvent, { type: "done" }> = { type: "done" };
      let intent = "SEARCH";

      try {
        const [route, profile, projects] = await Promise.all([detectIntent(message), getProfile(supabase), listProjects(supabase)]);
        intent = route.intent;

        if (intent === "STORE_MEMORY") {
          const content = message.replace(/^(please\s+)?(remember|save|store|note)( that)?[:,]?\s*/i, "").trim() || message;
          send({ type: "meta", conversation_id: conversationId!, intent, sources });
          const memory = await createMemory(supabase, { content, project_id });
          const filed = projects.find((p) => p.id === memory!.project_id)?.name ?? (await projectName(memory!.project_id));
          reply = `Stored: **${memory!.title}** (${memory!.memory_type.replace("_", " ")}).${filed ? ` Filed under **${filed}**.` : ""}`;
          actions.push({ label: "Open memory", href: `/memories?open=${memory!.id}` });
          send({ type: "delta", text: reply });
        } else if (intent === "CREATE_PROJECT") {
          send({ type: "meta", conversation_id: conversationId!, intent, sources });
          const res = await generateWithFallback([{ role: "user", content: message }], {
            system: 'Extract the project the user wants to create. Respond in JSON only: {"name": string, "description": string}.',
            json: true,
            temperature: 0,
            maxTokens: 200,
            order: ["groq", "gemini", "nvidia"],
          });
          const ask = parseJson(res.text, ProjectAsk);
          if (!ask) {
            reply = "I couldn't tell what to call the project. Try: “start a project called …”.";
          } else {
            const { data: existing } = await supabase.from("projects").select("id, name").ilike("name", ask.name).maybeSingle();
            if (existing) {
              reply = `You already have **${existing.name}**.`;
              actions.push({ label: "Open project", href: `/projects/${existing.id}` });
            } else {
              const { data: p, error } = await supabase
                .from("projects")
                .insert({ name: ask.name, description: ask.description || null, metadata: { created_by: "hivemind" } })
                .select("id, name")
                .single();
              dbError(error);
              await logActivity(supabase, "project_created", `Created project “${p!.name}” on your request`, { type: "project_created", project_id: p!.id });
              reply = `Project **${p!.name}** is live. Anything you save about it from now on gets filed there automatically.`;
              actions.push({ label: "Open project", href: `/projects/${p!.id}` });
            }
          }
          send({ type: "delta", text: reply });
        } else {
          const context = intent === "GENERAL_CHAT" ? [] : await searchKnowledge(supabase, message, { projectId: project_id, limit: 8 });
          sources = context.map((c, i) => ({
            n: i + 1,
            type: c.source_type,
            title: c.title,
            href: sourceHref(c),
            similarity: Math.round(c.similarity * 100) / 100,
          }));
          send({ type: "meta", conversation_id: conversationId!, intent, sources });

          const system = persona(profileForPrompt(profile), projects.map((p) => p.name).join(", "));
          const userTurn = context.length
            ? `Context from my brain:\n${context.map((c, i) => `[${i + 1}] (${c.source_type}) ${c.title}\n${c.content.slice(0, 1500)}`).join("\n\n---\n\n")}\n\nMe: ${message}`
            : message;
          const messages: ChatMessage[] = [...history, { role: "user", content: userTurn }];
          const started = Date.now();

          try {
            for await (const chunk of streamGemini(messages, { system, temperature: 0.3 })) {
              reply += chunk.text;
              send({ type: "delta", text: chunk.text });
              done = { type: "done", provider: "gemini", model: chunk.model };
            }
            done.latency_ms = Date.now() - started;
          } catch (err) {
            if (reply) throw err;
            // Gemini unavailable before the first token: answer in one piece from NVIDIA/Groq.
            const res = await generateWithFallback(messages, { system, order: ["nvidia", "groq"], temperature: 0.3 });
            reply = res.text;
            send({ type: "delta", text: reply });
            done = { type: "done", provider: res.provider, model: res.model, latency_ms: res.latencyMs };
          }
        }

        for (const a of actions) send({ type: "action", ...a });
        send(done);

        await supabase.from("messages").insert([
          { conversation_id: conversationId, role: "user", content: message, metadata: {} },
          {
            conversation_id: conversationId,
            role: "assistant",
            content: reply,
            metadata: { intent, router: route.via, sources, actions, provider: done.provider, model: done.model, latency_ms: done.latency_ms },
          },
        ]);
      } catch (err) {
        console.error("hivemind:", err instanceof Error ? err.message : err);
        send({ type: "error", message: "I hit a problem answering that. Try again in a moment." });
      } finally {
        controller.close();
      }

      async function projectName(id: string | null) {
        if (!id) return null;
        const { data } = await supabase.from("projects").select("name").eq("id", id).maybeSingle();
        return data?.name ?? null;
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" },
  });
});
