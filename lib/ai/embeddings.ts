import "server-only";
import { geminiClient } from "./gemini";

// Fixed forever for this database: changing model or size means re-embedding everything.
export const EMBED_DIM = 768;
const EMBED_MODEL = process.env.GEMINI_EMBED_MODEL || "gemini-embedding-001";
const BATCH = 50;

type TaskType = "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY";

export async function embedMany(texts: string[], taskType: TaskType = "RETRIEVAL_DOCUMENT") {
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += BATCH) {
    const res = await geminiClient().models.embedContent({
      model: EMBED_MODEL,
      contents: texts.slice(i, i + BATCH).map((t) => t.slice(0, 8000)),
      config: { taskType, outputDimensionality: EMBED_DIM },
    });
    for (const e of res.embeddings ?? []) {
      if (!e.values || e.values.length !== EMBED_DIM) throw new Error("Unexpected embedding size");
      out.push(e.values);
    }
  }
  return out;
}

export async function embedOne(text: string, taskType: TaskType = "RETRIEVAL_DOCUMENT") {
  const [v] = await embedMany([text], taskType);
  return v;
}

export const embedQuery = (text: string) => embedOne(text, "RETRIEVAL_QUERY");
