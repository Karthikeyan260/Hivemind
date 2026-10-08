import "server-only";
import { db } from "@/lib/db";
import { readJSON, writeJSON } from "@/lib/private-store";
import { geminiClient } from "./gemini";

// The vector size is fixed by the database columns (vector(768)); a model with another size needs a
// SQL migration as well. The model itself can change: see lib/embedding-migration.ts.
export const EMBED_DIM = 768;
/** The model the deployment asks for. Takes effect only after a re-embed (Settings → Embeddings). */
export const CONFIGURED_MODEL = process.env.GEMINI_EMBED_MODEL || "gemini-embedding-001";
const BATCH = 50;

type TaskType = "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY";

/**
 * Which model made the vectors in the database (`model`), and while a re-embed runs, the model it
 * is moving to (`target`). Vectors from two models can't be compared, so searches always use
 * `model`, and new rows use `target` once the move has started (the move re-embeds everything else).
 */
export type EmbedMarker = { model: string; dim: number; target?: string; since?: string };
export const MARKER_KEY = "embedding-model";

let cached: { m: EmbedMarker; at: number } | null = null;
let warned = false;

export function forgetMarker() {
  cached = null;
}

export async function getMarker(): Promise<EmbedMarker> {
  if (cached && Date.now() - cached.at < 60_000) return cached.m;
  let m: EmbedMarker | null;
  try {
    m = await readJSON<EmbedMarker | null>(db(), MARKER_KEY, null);
  } catch {
    // Storage unreachable: don't guess, but don't record anything either.
    return { model: CONFIGURED_MODEL, dim: EMBED_DIM };
  }
  if (!m?.model) {
    // First run with the marker: the existing vectors were made by the configured model.
    m = { model: CONFIGURED_MODEL, dim: EMBED_DIM };
    await writeJSON(db(), MARKER_KEY, m).catch(() => {});
  }
  if (m.model !== CONFIGURED_MODEL && !m.target && !warned) {
    warned = true;
    console.warn(`GEMINI_EMBED_MODEL is ${CONFIGURED_MODEL} but the database holds ${m.model} vectors: still using ${m.model} until you re-embed (Settings → Embeddings).`);
  }
  cached = { m, at: Date.now() };
  return m;
}

/** Embeds texts with an explicit model (the re-embed job), else the one matching the database. */
export async function embedMany(texts: string[], taskType: TaskType = "RETRIEVAL_DOCUMENT", model?: string) {
  if (!model) {
    const m = await getMarker();
    model = taskType === "RETRIEVAL_QUERY" ? m.model : (m.target ?? m.model);
  }
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += BATCH) {
    const res = await geminiClient().models.embedContent({
      model,
      contents: texts.slice(i, i + BATCH).map((t) => t.slice(0, 8000)),
      config: { taskType, outputDimensionality: EMBED_DIM },
    });
    for (const e of res.embeddings ?? []) {
      if (!e.values || e.values.length !== EMBED_DIM) throw new Error(`${model} didn't return ${EMBED_DIM}-number vectors`);
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
