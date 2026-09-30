import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logActivity } from "@/lib/activity";
import { geminiClient } from "@/lib/ai/gemini";
import { HttpError } from "@/lib/api";
import { createNote } from "@/lib/knowledge";

// Google Search grounding through the Gemini API. On the free tier only the 2.5 models have a
// grounding quota (the 3.x models return 429), so search runs on those.
const MODELS = (process.env.WEB_SEARCH_MODELS || "gemini-2.5-flash,gemini-2.5-flash-lite").split(",").map((m) => m.trim());

export type WebResult = { answer: string; sources: { title: string; url: string }[]; model: string; searched_at: string };

export async function webSearch(query: string, opts: { detailed?: boolean } = {}): Promise<WebResult> {
  const today = new Date().toISOString().slice(0, 10);
  const prompt = opts.detailed
    ? `Research this thoroughly using web search and write a well-organised brief with headings and bullet points: key facts, figures, dates, and differing viewpoints. Today is ${today}.\n\nTopic: ${query}`
    : `Answer using web search. Be concise and factual, include dates and numbers where relevant. Today is ${today}.\n\nQuestion: ${query}`;
  let lastErr: unknown;
  // Free-tier search is rate-limited per minute: if every model is throttled, wait once and retry.
  const attempts = [...MODELS, ...MODELS.map((m) => `wait:${m}`)];
  for (const entry of attempts) {
    const model = entry.replace(/^wait:/, "");
    if (entry.startsWith("wait:")) {
      if (!String(lastErr).includes("429")) break;
      if (entry === `wait:${MODELS[0]}`) await new Promise((r) => setTimeout(r, 8000));
    }
    try {
      const r = await geminiClient().models.generateContent({ model, contents: prompt, config: { tools: [{ googleSearch: {} }], temperature: 0.2 } });
      const chunks = r.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
      const seen = new Set<string>();
      const sources = chunks
        .map((c) => ({ title: c.web?.title ?? "", url: c.web?.uri ?? "" }))
        .filter((s) => s.url && !seen.has(s.title) && seen.add(s.title))
        .slice(0, 8);
      if (!r.text) throw new Error("empty answer");
      return { answer: r.text.trim(), sources, model, searched_at: new Date().toISOString() };
    } catch (err) {
      lastErr = err instanceof Error ? err.message : err;
    }
  }
  console.error("web search failed:", lastErr instanceof Error ? lastErr.message : lastErr);
  throw new HttpError(
    String(lastErr).includes("429") ? 429 : 502,
    String(lastErr).includes("429") ? "Google search's free-tier limit is used up for the moment. Try again in a minute." : "Web search is unavailable right now. Try again in a minute.",
  );
}

/** Researches a topic on the web and files the findings (with sources) as a note in the brain. */
export async function researchAndSave(supabase: SupabaseClient, topic: string, projectId?: string | null) {
  const res = await webSearch(topic, { detailed: true });
  const content = [
    res.answer,
    "",
    "Sources:",
    ...res.sources.map((s, i) => `[${i + 1}] ${s.title} (${s.url})`),
    "",
    `Collected from the web on ${res.searched_at.slice(0, 10)}.`,
  ].join("\n");
  const note = await createNote(supabase, { title: `Research: ${topic.slice(0, 120)}`, content, project_id: projectId ?? undefined, tags: ["web", "research"] });
  await logActivity(supabase, "research", `Researched “${topic.slice(0, 80)}” on the web and saved it`);
  return { note, result: res };
}
