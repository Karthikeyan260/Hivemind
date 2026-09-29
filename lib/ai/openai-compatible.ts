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
}): AIProvider {
  let client: OpenAI | null = null;
  return {
    name: cfg.name,
    model: cfg.model,
    isConfigured: () => !!process.env[cfg.keyEnv],
    async generate(messages: ChatMessage[], opts: GenerateOptions = {}) {
      // Free endpoints can hang for minutes; fail fast so the fallback chain fits in Vercel's 60s.
      client ??= new OpenAI({ apiKey: process.env[cfg.keyEnv], baseURL: cfg.baseURL, timeout: cfg.timeoutMs, maxRetries: 0 });
      const res = await client.chat.completions.create({
        model: cfg.model,
        temperature: opts.temperature ?? 0.3,
        max_tokens: opts.maxTokens ?? 1500,
        response_format: opts.json && cfg.supportsJsonMode ? { type: "json_object" } : undefined,
        messages: [
          ...(opts.system ? [{ role: "system" as const, content: opts.system }] : []),
          ...messages,
        ],
      });
      return (res.choices[0]?.message?.content ?? "").replace(/<think>[\s\S]*?<\/think>/g, "").trim();
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
