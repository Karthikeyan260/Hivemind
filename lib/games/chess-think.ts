"use client";

import type { Level } from "./chess-bot";

/**
 * Asks HIVEMIND's chess bot for a move in a background worker (falls back to the page itself, after
 * a beat, where workers aren't available). Resolves to the move in SAN, or null.
 */
let worker: Worker | null = null;
let nextId = 0;
/** A reply (the move, or null for none), or undefined when the worker failed (the caller then thinks on the page). */
const waiting = new Map<number, (san: string | null | undefined) => void>();
/** The most any level searches is a few seconds: a worker silent for this long has died. */
const WORKER_TIMEOUT_MS = 25_000;

function failWorker(w: Worker) {
  if (worker === w) worker = null;
  w.terminate();
  // Whoever was waiting on it is told, instead of waiting for ever.
  for (const [id, done] of [...waiting]) {
    waiting.delete(id);
    done(undefined);
  }
}

function getWorker(): Worker | null {
  if (worker) return worker;
  try {
    const w = new Worker(new URL("./chess-bot.worker.ts", import.meta.url), { type: "module" });
    w.onmessage = (e: MessageEvent<{ id: number; san: string | null }>) => {
      waiting.get(e.data.id)?.(e.data.san);
      waiting.delete(e.data.id);
    };
    w.onerror = () => failWorker(w);
    worker = w;
    return w;
  } catch {
    return null;
  }
}

export async function think(fen: string, level: Level): Promise<string | null> {
  const w = getWorker();
  if (w) {
    const id = ++nextId;
    const reply = await new Promise<string | null | undefined>((resolve) => {
      const timer = setTimeout(() => failWorker(w), WORKER_TIMEOUT_MS);
      waiting.set(id, (san) => {
        clearTimeout(timer);
        resolve(san);
      });
      w.postMessage({ id, fen, level });
    });
    if (reply !== undefined) return reply;
  }
  // No worker, or it died: think right here on the page.
  const { bestMove } = await import("./chess-bot");
  await new Promise((r) => setTimeout(r, 50));
  try {
    return bestMove(fen, level);
  } catch {
    return null;
  }
}
