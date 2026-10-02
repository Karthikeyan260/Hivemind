import "server-only";
import { z } from "zod";
import { generateWithFallback, parseJson } from "./providers";

export const MEMORY_TYPES = [
  "fact",
  "knowledge",
  "experience",
  "decision",
  "idea",
  "preference",
  "project_context",
  "learning",
] as const;

const MetadataSchema = z.object({
  title: z.string().max(200).optional(),
  summary: z.string().max(1000).default(""),
  category: z.string().max(60).default("General"),
  tags: z.array(z.string().max(40)).max(10).default([]),
  importance: z.coerce.number().int().min(1).max(10).default(5),
  memory_type: z.enum(MEMORY_TYPES).catch("knowledge"),
  entities: z.array(z.string().max(80)).max(15).default([]),
});
export type ExtractedMetadata = z.infer<typeof MetadataSchema>;

const SYSTEM = `You extract metadata from a personal knowledge item.
Return ONLY a JSON object with keys:
title (short, <= 80 chars), summary (1-2 sentences), category (one or two words),
tags (3-6 short lowercase tags), importance (integer 1-10), memory_type (one of ${MEMORY_TYPES.join(", ")}),
entities (named tools, technologies, people, projects mentioned).`;

const FALLBACK: ExtractedMetadata = {
  summary: "",
  category: "General",
  tags: [],
  importance: 5,
  memory_type: "knowledge",
  entities: [],
};

/** Never throws: metadata is a nice-to-have, saving the user's text must not fail on it. */
export async function extractMetadata(text: string): Promise<ExtractedMetadata> {
  try {
    const res = await generateWithFallback([{ role: "user", content: text.slice(0, 12000) }], {
      system: SYSTEM,
      json: true,
      temperature: 0.1,
      maxTokens: 500,
      // Runs on every save: keep it off Gemini, whose daily quota is for the agents.
      order: ["groq", "openrouter", "github", "gemini", "nvidia"],
    });
    return parseJson(res.text, MetadataSchema) ?? FALLBACK;
  } catch {
    return FALLBACK;
  }
}
