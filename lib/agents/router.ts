import "server-only";
import { z } from "zod";
import { groqProvider } from "@/lib/ai/openai-compatible";
import { parseJson } from "@/lib/ai/providers";
import { SHOPPING } from "@/lib/external/products";
import { agentRoster } from "./registry";
import { AGENT_IDS, type AgentId } from "./types";

const RouteSchema = z.object({ agent: z.enum(AGENT_IDS) });

/** Instant keyword routing: used when Groq is unavailable, and to skip the LLM for obvious cases. */
export function ruleBasedAgent(message: string, previous?: AgentId | null): AgentId | null {
  const m = message.trim().toLowerCase();
  if (/^(hi|hello|hey|thanks|thank you|good (morning|night|evening))\b[\s!.]*$/.test(m)) return "core";
  if (/\bauto ?pilot\b|\b(anything|what) (i should know|needs my attention)\b/.test(m)) return "core";
  if (/\b(birthdays?|bday|anniversar(y|ies)|habits?|streaks?)\b|^i (just )?(did|finished|completed) (my |the )?\w+|^done with (my |the )?\w+|\b(track|log)\b.*\b(daily|every|habit)\b/.test(m)) return "scheduler";
  if (/\b(remind(er)?s?|schedule|meeting|appointment|deadline|agenda|calendar|my day|on today|on tomorrow)\b|\bmark\b.*\b(done|complete)\b|\b(cancel|reschedule|postpone|move)\b.*\b(meeting|call|reminder|appointment|it)\b|\b(plans?|free|busy)\b.*\b(today|tomorrow|tonight)\b|\b(today|tomorrow)\b.*\b(at \d|am\b|pm\b)/.test(m)) return "scheduler";
  // Projects, notes, documents and settings by name ("delete the HIVEMIND project", "add milk to my shopping note").
  if (/\b(delete|remove|rename|update|change|pause|finish|mark)\b.*\bprojects?\b/.test(m)) return "project";
  if (/\bnotes?\b|\bdocuments?\b|\bfiles?\b/.test(m) && !/\bjob\b/.test(m)) return "memory";
  if (/\b(reply|speak|talk|answer|respond)\b.*\b(tamil|english|tanglish)\b|\blanguage\b/.test(m)) return "profile";
  if (/^(please\s+)?(remember|save|store|note)\b|^note:|\b(update|correct|change)\b.*\b(memory|saved)\b/.test(m)) return "memory";
  if (/\b(delete|remove|erase)\b.*\b(job analys[ie]s|analys[ie]s|job match)\b/.test(m)) return "career";
  // "call Arif", "whatsapp Vijay …", "send a message to …", "Arif's number is 98…"
  if (/^(please\s+)?(call|ring|dial|phone|whatsapp|text|sms|message)\s+(?!me\b)\w|\bsend (an? )?(message|whatsapp|text|sms)\b|\bstart (a |an )?(voice |video |internet )?call\b|\b(phone )?number (is|=)\s*[+\d]|'s (phone |mobile |contact )?number\b/.test(m)) return "comms";
  if (/^(please\s+)?(forget|delete|remove|erase)\b|\b(delete|remove|erase|forget)\b.*\bmemor(y|ies)\b/.test(m)) return "memory";
  // "Yes" to a delete confirmation goes back to the Memory agent that asked.
  if ((previous === "memory" || previous === "career") && /^(yes|yeah|yep|yup|sure|ok(ay)?|confirm(ed)?|do it|go ahead|delete it|please do)\b/.test(m)) return "memory";
  // "Yes" to "Delete the project …?" goes back to the Project agent that asked.
  if (previous === "project" && /^(yes|yeah|yep|yup|sure|ok(ay)?|confirm(ed)?|do it|go ahead|delete it|please do)\b/.test(m)) return "project";
  if (/\b(where did (you|that|this|it) (get|come)|where (is|was) (that|this|it) from|take me (there|to (it|that|the source))|open (the |that )?source|show (me )?(the )?source|go to (the )?source)\b/.test(m)) return "rag";
  // A short follow-up to a job search ("check #2", "the second one", "ATS for Quest Global") stays with Career.
  if (previous === "career" && m.length < 160 && /#?\b\d{1,2}\b|\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|last|that|this) (one|job|role)\b|\b(check|pick|choose|select|analy[sz]e|ats|go with)\b/.test(m)) return "career";
  if (/\b(jobs|job (openings?|search|listings?|vacanc(y|ies))|openings|vacanc(y|ies))\b/.test(m)) return "career";
  // "open the first one" / "click the Flipkart link" right after links were shown stays with that agent.
  if ((previous === "research" || previous === "career") && /\b(open|click|tap|go to|visit)\b.*\b(link|first|second|third|fourth|fifth|last|one|it|that|\d|flipkart|amazon|meesho|zepto|blinkit|instamart|bigbasket|page|apply)\b/.test(m)) return previous;
  // Shopping: "boAt earbuds on Flipkart", "price of iPhone 16", "buy a kurti from Meesho"
  if (SHOPPING.test(m)) return "research";
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
export async function routeAgent(message: string, previous?: AgentId | null): Promise<{ agent: AgentId; via: "rules" | "groq" | "default" }> {
  const rule = ruleBasedAgent(message, previous);
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
