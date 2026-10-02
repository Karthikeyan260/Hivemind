import "server-only";
import { z } from "zod";
import { geminiProvider } from "./gemini";
import { githubProvider, groqProvider, nvidiaProvider, openrouterProvider } from "./openai-compatible";
import type { AIProvider, ChatMessage, GenerateOptions, GenerateResult, ProviderName } from "./types";

export const providers: Record<ProviderName, AIProvider> = {
  gemini: geminiProvider,
  nvidia: nvidiaProvider,
  groq: groqProvider,
  openrouter: openrouterProvider,
  github: githubProvider,
};

export const ANSWER_PROVIDERS = ["gemini", "nvidia"] as const;

/**
 * Tries the preferred provider, then the rest in order. Free tiers rate-limit often,
 * so falling over to another free provider keeps the app usable.
 */
export async function generateWithFallback(
  messages: ChatMessage[],
  opts: GenerateOptions & { prefer?: ProviderName; order?: ProviderName[] } = {},
): Promise<GenerateResult> {
  const order = opts.order ?? ["gemini", "nvidia", "openrouter", "github", "groq"];
  const chain = [opts.prefer, ...order].filter(
    (p, i, arr): p is ProviderName => !!p && arr.indexOf(p) === i && providers[p].isConfigured(),
  );
  if (chain.length === 0) throw new Error("No AI provider keys configured");

  let lastErr: unknown;
  for (const name of chain) {
    const p = providers[name];
    const started = Date.now();
    try {
      const text = await p.generate(messages, opts);
      if (!text.trim()) throw new Error("empty response");
      return { text, provider: name, model: p.model, latencyMs: Date.now() - started };
    } catch (err) {
      lastErr = err;
      console.warn(`provider ${name} failed:`, err instanceof Error ? err.message : err);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("All providers failed");
}

/** Parses model output as JSON (tolerating ```json fences / prose) and validates it. */
export function parseJson<T extends z.ZodType>(text: string, schema: T): z.infer<T> | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const parsed = schema.safeParse(JSON.parse(text.slice(start, end + 1)));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
