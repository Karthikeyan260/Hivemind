import "server-only";
import { z } from "zod";
import { groqProvider } from "./openai-compatible";
import { parseJson } from "./providers";

export const INTENTS = ["SEARCH", "STORE_MEMORY", "UPDATE_MEMORY", "CREATE_PROJECT", "WEATHER", "WEB_SEARCH", "RESEARCH", "GENERAL_CHAT"] as const;
export type Intent = (typeof INTENTS)[number];

const RouteSchema = z.object({ intent: z.enum(INTENTS) });

const SYSTEM = `Classify the user's message for a personal AI called HIVEMIND. Reply ONLY with JSON {"intent": "..."}.
SEARCH: asks about their own notes, memories, documents, projects, what they learned/built/did.
STORE_MEMORY: tells the app to remember/save/store something ("remember that...", "note: ...").
UPDATE_MEMORY: asks to change/correct/update something previously saved.
CREATE_PROJECT: asks to start/create/add a new project ("start a project called X", "new project: X").
WEATHER: asks about weather, temperature, rain, humidity or forecast anywhere.
WEB_SEARCH: needs current or outside-world information from the internet: news, prices, scores, releases, recent events, public facts, "search the web / google ...".
RESEARCH: asks to research, collect or gather information from the web and keep it ("research X and save it", "collect data about X", "gather info on X").
GENERAL_CHAT: greetings or general questions unrelated to their own knowledge.
If unsure, use SEARCH.`;

export function ruleBasedIntent(message: string): Intent {
  const m = message.trim().toLowerCase();
  if (/^(please\s+)?(research|collect|gather|compile)\b/.test(m)) return "RESEARCH";
  if (/\b(weather|temperature|forecast|raining|rain today|humidity)\b/.test(m)) return "WEATHER";
  if (/\b(search (the )?(web|internet|online)|google|latest news|news (about|on)|stock price|live score)\b/.test(m)) return "WEB_SEARCH";
  if (/^(please\s+)?(remember|save|store|note)\b|^note:/.test(m)) return "STORE_MEMORY";
  if (/^(please\s+)?(update|change|edit|correct)\b.*\b(memory|note|saved)\b/.test(m)) return "UPDATE_MEMORY";
  if (/^(please\s+)?(create|start|add|new)\b.*\bproject\b/.test(m)) return "CREATE_PROJECT";
  if (/^(hi|hello|hey|thanks|thank you)\b[\s!.]*$/.test(m)) return "GENERAL_CHAT";
  return "SEARCH";
}

/** Cheap/fast LLM router (Groq free tier); falls back to rules when unavailable. */
export async function detectIntent(message: string): Promise<{ intent: Intent; via: "groq" | "rules" }> {
  if (groqProvider.isConfigured()) {
    try {
      const text = await groqProvider.generate([{ role: "user", content: message.slice(0, 2000) }], {
        system: SYSTEM,
        json: true,
        temperature: 0,
        maxTokens: 30,
      });
      const parsed = parseJson(text, RouteSchema);
      if (parsed) return { intent: parsed.intent, via: "groq" };
    } catch (err) {
      console.warn("router fallback to rules:", err instanceof Error ? err.message : err);
    }
  }
  return { intent: ruleBasedIntent(message), via: "rules" };
}
