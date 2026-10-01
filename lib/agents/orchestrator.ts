import "server-only";
import type { Content, FunctionDeclaration, Part } from "@google/genai";
import { geminiClient } from "@/lib/ai/gemini";
import type { ChatMessage } from "@/lib/ai/types";
import { nowForPrompt } from "@/lib/reminders";
import { agentRoster, AGENTS } from "./registry";
import { TOOLS } from "./tools";
import { AGENT_IDS, type AgentId, type RunContext } from "./types";

const MODELS = [...new Set([process.env.GEMINI_CHAT_MODEL || "gemini-3.5-flash-lite", process.env.GEMINI_FALLBACK_MODEL || "gemini-2.5-flash"])];
const MAX_STEPS = 6;
// Free-tier models sometimes stall without erroring; if nothing arrives by then, try the next model.
const FIRST_CHUNK_MS = 8000;

const ASK_AGENT: FunctionDeclaration = {
  name: "ask_agent",
  description: "Hand a sub-task to a specialist colleague and get their answer back (e.g. ask the research agent for live facts while you handle the rest).",
  parametersJsonSchema: {
    type: "object",
    properties: { agent: { type: "string", enum: [...AGENT_IDS] }, task: { type: "string", description: "Self-contained instruction for the colleague" } },
    required: ["agent", "task"],
  },
};

const RULES = `Rules for tools:
- When the owner asks for something a tool can do, do it with the tool instead of describing it.
- NEVER claim something was saved, created, generated or found unless a tool just returned success for it. If a tool returns an error, say what went wrong in plain words.
- Cite brain or web results like [1] using the numbers the tools give you.
- Keep the final answer concise and useful; use short bullet lists for multiple items.`;

type RunOpts = {
  agentId: AgentId;
  message: string;
  history: ChatMessage[];
  persona: string;
  /** Appended last (strongest position): the language rule. */
  closing?: string;
  ctx: RunContext;
  /** Receives the answer as it streams (top-level agent only). */
  onText?: (delta: string) => void;
  depth?: number;
};

/** One model turn, streamed. Falls back to the next model only if nothing has been streamed yet. */
async function step(contents: Content[], system: string, tools: FunctionDeclaration[], onText?: (t: string) => void) {
  let lastErr: unknown;
  for (const model of MODELS) {
    let streamed = false;
    const abort = new AbortController();
    const stall = setTimeout(() => abort.abort(), FIRST_CHUNK_MS);
    try {
      const stream = await geminiClient().models.generateContentStream({
        model,
        contents,
        config: {
          systemInstruction: system,
          temperature: 0.3,
          tools: tools.length ? [{ functionDeclarations: tools }] : undefined,
          abortSignal: abort.signal,
        },
      });
      const parts: Part[] = [];
      let text = "";
      for await (const chunk of stream) {
        clearTimeout(stall);
        for (const part of chunk.candidates?.[0]?.content?.parts ?? []) {
          parts.push(part);
          if (part.text && !part.thought) {
            text += part.text;
            streamed = true;
            onText?.(part.text);
          }
        }
      }
      return { parts, text, model, calls: parts.filter((p) => p.functionCall).map((p) => p.functionCall!) };
    } catch (err) {
      clearTimeout(stall);
      if (streamed) throw err;
      lastErr = err;
      console.warn(`agent step: ${model} ${abort.signal.aborted ? "stalled" : "failed"}, trying next model`, abort.signal.aborted ? "" : err instanceof Error ? err.message.slice(0, 120) : err);
    }
  }
  throw lastErr;
}

/**
 * Runs one specialist agent: a tool-calling loop over its own tools, streaming the final answer.
 * Top-level agents may delegate to colleagues via ask_agent (one level deep).
 */
export async function runAgent(o: RunOpts): Promise<{ text: string; model: string }> {
  const depth = o.depth ?? 0;
  const agent = AGENTS[o.agentId];
  o.ctx.emit({ type: "agent", agent: agent.id, name: agent.name, via: depth ? "delegation" : "router" });

  const declarations: FunctionDeclaration[] = agent.tools.map((n) => ({ name: n, description: TOOLS[n].description, parametersJsonSchema: TOOLS[n].parameters }));
  if (depth === 0) declarations.push(ASK_AGENT);
  const system = [
    o.persona,
    `You are acting as HIVEMIND's ${agent.name}: ${agent.role}`,
    agent.instructions,
    depth === 0 ? `Colleagues you can hand work to with ask_agent:\n${agentRoster()}` : "You were asked by a colleague; return a complete, factual answer to their task.",
    RULES,
    `Current local time: ${nowForPrompt()}.`,
    // Sub-agents report to the top agent, which writes the final answer in the owner's language.
    depth === 0 ? (o.closing ?? "") : "",
  ].join("\n\n");

  const contents: Content[] = [
    ...o.history.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })),
    { role: "user", parts: [{ text: o.message }] },
  ];

  let text = "";
  let model = MODELS[0];
  for (let i = 0; i < MAX_STEPS; i++) {
    const last = i === MAX_STEPS - 1;
    const r = await step(contents, system, last ? [] : declarations, depth === 0 ? o.onText : undefined);
    text += r.text;
    model = r.model;
    if (!r.calls.length) return { text, model };

    contents.push({ role: "model", parts: r.parts });
    const responses = await Promise.all(
      r.calls.map(async (call): Promise<Part> => {
        const name = call.name ?? "";
        const args = (call.args ?? {}) as Record<string, unknown>;
        o.ctx.emit({ type: "tool", agent: agent.id, tool: name, status: "run", detail: summarize(args) });
        try {
          let response: Record<string, unknown>;
          if (name === "ask_agent" && depth === 0) {
            const target = String(args.agent) as AgentId;
            if (!AGENTS[target] || target === agent.id) throw new Error(`Can't delegate to "${args.agent}".`);
            const sub = await runAgent({ ...o, agentId: target, message: String(args.task ?? o.message), history: [], depth: 1, onText: undefined });
            response = { answer: sub.text };
          } else if (agent.tools.includes(name)) {
            response = await TOOLS[name].run(args, o.ctx);
          } else {
            throw new Error(`${agent.name} has no tool "${name}".`);
          }
          const failed = typeof response.error === "string";
          o.ctx.emit({ type: "tool", agent: agent.id, tool: name, status: failed ? "error" : "ok", detail: failed ? String(response.error) : undefined });
          return { functionResponse: { id: call.id, name, response } };
        } catch (err) {
          const message = err instanceof Error ? err.message : "failed";
          o.ctx.emit({ type: "tool", agent: agent.id, tool: name, status: "error", detail: message });
          return { functionResponse: { id: call.id, name, response: { error: message } } };
        }
      }),
    );
    contents.push({ role: "user", parts: responses });
  }
  return { text, model };
}

function summarize(args: Record<string, unknown>) {
  const v = Object.values(args).find((x) => typeof x === "string") as string | undefined;
  return v ? (v.length > 70 ? `${v.slice(0, 70)}…` : v) : undefined;
}
