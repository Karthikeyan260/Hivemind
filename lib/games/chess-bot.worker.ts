/// <reference lib="webworker" />
import { bestMove, type Level } from "./chess-bot";

// The bot thinks here, off the page's main thread, so the board never freezes while it does.
self.onmessage = (e: MessageEvent<{ id: number; fen: string; level: Level }>) => {
  const { id, fen, level } = e.data;
  let san: string | null = null;
  try {
    san = bestMove(fen, level);
  } catch {
    san = null;
  }
  (self as unknown as Worker).postMessage({ id, san });
};
