"use client";

import type { Level } from "./chess-bot";

/**
 * Asks HIVEMIND's chess bot for a move in a background worker (falls back to the page itself, after
 * a beat, where workers aren't available). Resolves to the move in SAN, or null.
 */
let worker: Worker | null = null;
let nextId = 0;
const waiting = new Map<number, (san: string | null) => void>();

function getWorker(): Worker | null {
  if (worker) return worker;
  try {
    worker = new Worker(new URL("./chess-bot.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (e: MessageEvent<{ id: number; san: string | null }>) => {
      waiting.get(e.data.id)?.(e.data.san);
      waiting.delete(e.data.id);
    };
    worker.onerror = () => {
      worker = null;
    };
    return worker;
  } catch {
    return null;
  }
}

export async function think(fen: string, level: Level): Promise<string | null> {
  const w = getWorker();
  if (w) {
    const id = ++nextId;
    return new Promise((resolve) => {
      waiting.set(id, resolve);
      w.postMessage({ id, fen, level });
    });
  }
  const { bestMove } = await import("./chess-bot");
  await new Promise((r) => setTimeout(r, 50));
  return bestMove(fen, level);
}
