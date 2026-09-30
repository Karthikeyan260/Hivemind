import "server-only";
import { z } from "zod";
import { groqProvider } from "@/lib/ai/openai-compatible";
import { parseJson } from "@/lib/ai/providers";
import { agentRoster } from "./registry";
import { AGENT_IDS, type AgentId } from "./types";

const RouteSchema = z.object({ agent: z.enum(AGENT_IDS) });

/** Instant keyword routing: used when Groq is unavailable, and to skip the LLM for obvious cases. */
export function ruleBasedAgent(message: string): AgentId | null {
  const m = message.trim().toLowerCase();
  if (/^(hi|hello|hey|thanks|thank you|good (morning|night|evening))\b[\s!.]*$/.test(m)) return "core";
  if (/\b(remind(er)?s?|schedule|meeting|appointment|deadline|agenda|calendar|my day|on today|on tomorrow)\b|\bmark\b.*\b(done|complete)\b|\b(today|tomorrow)\b.*\b(at \d|am\b|pm\b)/.test(m)) return "scheduler";
  if (/^(please\s+)?(remember|save|store|note)\b|^note:|\b(update|correct|change)\b.*\b(memory|saved)\b/.test(m)) return "memory";
  if (/^(please\s+)?(research|collect|gather|compile)\b|\b(weather|temperature|forecast|raining|humidity)\b|\b(search (the )?(web|internet)|google|latest news|news (about|on))\b/.test(m)) return "research";
  if (/\b(job analys[ie]s|job match(es)?|job description|jd\b|resume|cv\b|cover letter|interview|ats\b|hiring|apply(ing)? (for|to))\b/.test(m) || m.length > 900) return "career";
  if (/^(please\s+)?(create|start|add|new)\b.*\bproject\b|\b(my projects|list projects|project status)\b/.test(m)) return "project";
  if (/\b(who am i|about me|my profile|my skills|my goals|refresh (my )?profile)\b/.test(m)) return "profile";
  return null;
}

const SYSTEM = `You are the dispatcher of HIVEMIND, a personal AI with a team of specialist agents.
Pick the ONE agent best suited to handle the owner's message. Reply ONLY with JSON {"agent": "<id>"}.
Agents:
${agentRoster()}
If unsure between knowledge questions and others, pick "rag".`;

/** Picks the specialist for a message (fast Groq model, rules as fallback), like an auto-routing chat room. */
export async function routeAgent(message: string): Promise<{ agent: AgentId; via: "rules" | "groq" | "default" }> {
  const rule = ruleBasedAgent(message);
  if (rule) return { agent: rule, via: "rules" };
  if (groqProvider.isConfigured()) {
    try {
      const text = await groqProvider.generate([{ role: "user", content: message.slice(0, 2000) }], { system: SYSTEM, json: true, temperature: 0, maxTokens: 30 });
      const parsed = parseJson(text, RouteSchema);
      if (parsed) return { agent: parsed.agent, via: "groq" };
    } catch (err) {
      console.warn("agent router fallback:", err instanceof Error ? err.message : err);
    }
  }
  return { agent: "rag", via: "default" };
}
