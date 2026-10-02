import "server-only";
import OpenAI from "openai";
import type { AIProvider, ChatMessage, GenerateOptions, ProviderName } from "./types";

function makeProvider(cfg: {
  name: ProviderName;
  baseURL: string;
  keyEnv: string;
  model: string;
  supportsJsonMode: boolean;
  timeoutMs: number;
  /** Free tiers cap the answer length; asking for more is an error, not a shorter answer. */
  maxTokensCap?: number;
  /** Provider-specific request fields (OpenRouter's backup "models" list). */
  extraBody?: Record<string, unknown>;
  headers?: Record<string, string>;
}): AIProvider {
  let client: OpenAI | null = null;
  return {
    name: cfg.name,
    model: cfg.model,
    isConfigured: () => !!process.env[cfg.keyEnv],
    async generate(messages: ChatMessage[], opts: GenerateOptions = {}) {
      // Free endpoints can hang for minutes; fail fast so the fallback chain fits in Vercel's 60s.
      client ??= new OpenAI({ apiKey: process.env[cfg.keyEnv], baseURL: cfg.baseURL, timeout: cfg.timeoutMs, maxRetries: 0, defaultHeaders: cfg.headers });
      const res = await client.chat.completions.create({
        ...cfg.extraBody,
        model: cfg.model,
        temperature: opts.temperature ?? 0.3,
        max_tokens: Math.min(opts.maxTokens ?? 1500, cfg.maxTokensCap ?? Infinity),
        response_format: opts.json && cfg.supportsJsonMode ? { type: "json_object" } : undefined,
        messages: [
          ...(opts.system ? [{ role: "system" as const, content: opts.system }] : []),
          ...messages,
        ],
      });
      return (res.choices?.[0]?.message?.content ?? "").replace(/<think>[\s\S]*?<\/think>/g, "").trim();
    },
  };
}

export const nvidiaProvider = makeProvider({
  name: "nvidia",
  baseURL: "https://integrate.api.nvidia.com/v1",
  keyEnv: "NVIDIA_API_KEY",
  model: process.env.NVIDIA_MODEL || "nvidia/nemotron-3-super-120b-a12b",
  supportsJsonMode: false,
  timeoutMs: 25_000,
});

export const groqProvider = makeProvider({
  name: "groq",
  baseURL: "https://api.groq.com/openai/v1",
  keyEnv: "GROQ_API_KEY",
  model: process.env.GROQ_MODEL || "qwen/qwen3.8-27b",
  supportsJsonMode: true,
  timeoutMs: 8_000,
});

// OpenRouter's free models (":free"): no card needed. The free tier allows a limited number of
// requests a day, so it backs up Gemini/NVIDIA rather than leading. If the main model is busy,
// OpenRouter itself tries the others in "models".
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || "nvidia/nemotron-3.5-lightning:free";
export const openrouterProvider = makeProvider({
  name: "openrouter",
  baseURL: "https://openrouter.ai/api/v1",
  keyEnv: "OPENROUTER_API_KEY",
  model: OPENROUTER_MODEL,
  supportsJsonMode: true,
  timeoutMs: 25_000,
  extraBody: {
    models: [OPENROUTER_MODEL, "google/gemma-4-31b-it:free", "qwen/qwen3.8-27b:free"].filter((m, i, a) => a.indexOf(m) === i),
    // These free models "think" first by default: slow, and the thinking eats the answer's token budget.
    reasoning: { enabled: false },
  },
  headers: { "HTTP-Referer": process.env.APP_URL || "https://hivemind.local", "X-Title": "HIVEMIND" },
});

// GitHub Models: free with a GitHub token ("Models: read"). Rate-limited per day, and free
// requests are capped at about 8k tokens in and 4k out, so long prompts fall through to the next provider.
export const githubProvider = makeProvider({
  name: "github",
  baseURL: "https://models.github.ai/inference",
  keyEnv: "GITHUB_MODELS_TOKEN",
  model: process.env.GITHUB_MODEL || "openai/gpt-4.1-mini",
  supportsJsonMode: true,
  timeoutMs: 20_000,
  maxTokensCap: 4000,
});
