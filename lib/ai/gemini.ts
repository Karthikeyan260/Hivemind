import "server-only";
import { GoogleGenAI } from "@google/genai";
import type { AIProvider, ChatMessage, GenerateOptions } from "./types";

let client: GoogleGenAI | null = null;
export function geminiClient() {
  if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not set");
  client ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY, httpOptions: { timeout: 20_000 } });
  return client;
}

// Flash-lite: fast, no hidden "thinking" tokens, and less often overloaded on the free tier.
const PRIMARY = process.env.GEMINI_CHAT_MODEL || "gemini-3.5-flash-lite";
const FALLBACK = process.env.GEMINI_FALLBACK_MODEL || "gemini-2.5-flash";

// Overloaded / rate-limited / timed out → worth trying the other Gemini model. Bad key (400/403) is not.
function isTransient(err: unknown) {
  const status = (err as { status?: number })?.status;
  return status === undefined || status === 429 || status >= 500;
}

const toContents = (messages: ChatMessage[]) =>
  messages.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] }));

/**
 * Streams text. Switches to the fallback model only if the primary fails before
 * producing any text; once tokens have been sent, errors propagate to the caller.
 */
export async function* streamGemini(messages: ChatMessage[], opts: GenerateOptions = {}) {
  const models = PRIMARY === FALLBACK ? [PRIMARY] : [PRIMARY, FALLBACK];
  let lastErr: unknown;
  for (const model of models) {
    let started = false;
    try {
      const stream = await geminiClient().models.generateContentStream({
        model,
        contents: toContents(messages),
        config: { systemInstruction: opts.system, temperature: opts.temperature ?? 0.3, maxOutputTokens: opts.maxTokens },
      });
      for await (const chunk of stream) {
        const text = chunk.text;
        if (text) {
          started = true;
          yield { text, model };
        }
      }
      if (started) return;
      lastErr = new Error(`${model} returned empty text`);
    } catch (err) {
      if (started) throw err;
      lastErr = err;
      if (!isTransient(err)) throw err;
    }
  }
  throw lastErr;
}

export const geminiProvider: AIProvider = {
  name: "gemini",
  model: PRIMARY,
  isConfigured: () => !!process.env.GEMINI_API_KEY,
  async generate(messages: ChatMessage[], opts: GenerateOptions = {}) {
    const models = PRIMARY === FALLBACK ? [PRIMARY] : [PRIMARY, FALLBACK];
    let lastErr: unknown;
    for (const model of models) {
      try {
        const res = await geminiClient().models.generateContent({
          model,
          contents: messages.map((m) => ({
            role: m.role === "assistant" ? "model" : "user",
            parts: [{ text: m.content }],
          })),
          config: {
            systemInstruction: opts.system,
            temperature: opts.temperature ?? 0.3,
            maxOutputTokens: opts.maxTokens,
            responseMimeType: opts.json ? "application/json" : undefined,
          },
        });
        const text = res.text ?? "";
        if (text.trim()) return text;
        lastErr = new Error(`${model} returned empty text`);
      } catch (err) {
        lastErr = err;
        if (!isTransient(err)) throw err;
        console.warn(`gemini ${model} failed, trying next:`, err instanceof Error ? err.message.slice(0, 120) : err);
      }
    }
    throw lastErr;
  },
};
