import { NextResponse } from "next/server";
import { z } from "zod";
import { geminiClient } from "@/lib/ai/gemini";
import { handle, HttpError, parseBody } from "@/lib/api";

export const maxDuration = 20;

const MODELS = [process.env.GEMINI_CHAT_MODEL || "gemini-3.5-flash-lite", "gemini-2.5-flash"];

/**
 * Draw & Guess: HIVEMIND's guess for a drawing in progress (it plays as the third player). Only the
 * owner's browser calls this; the word is never sent, so it guesses honestly.
 */
export const POST = handle(async (req: Request) => {
  const { image, tried } = await parseBody(
    req,
    z.object({ image: z.string().startsWith("data:image/").max(600_000), tried: z.array(z.string().max(40)).max(20).default([]) }),
  );
  const data = image.slice(image.indexOf(",") + 1);
  for (const model of MODELS) {
    try {
      const res = await geminiClient().models.generateContent({
        model,
        contents: [
          {
            role: "user",
            parts: [
              {
                text: `You're playing Pictionary in Chennai. Guess what this (possibly unfinished) drawing shows: an everyday object, animal, food, place or thing from Tamil Nadu life. Answer with the most likely thing in 1-3 words, in English (Tamil things by their usual name, e.g. "idli", "auto rickshaw", "kolam").${tried.length ? ` Already guessed wrong: ${tried.join(", ")}. Guess something different.` : ""} If it's still too empty to tell, answer "???". Return JSON only: {"guess": "..."}`,
              },
              { inlineData: { mimeType: image.slice(5, image.indexOf(";")), data } },
            ],
          },
        ],
        config: { temperature: 0.4, responseMimeType: "application/json" },
      });
      const j = JSON.parse((res.text ?? "{}").replace(/^```(json)?|```$/g, "").trim()) as { guess?: string };
      return NextResponse.json({ guess: String(j.guess ?? "???").replace(/[^\p{L}\p{N} '-]/gu, "").trim().slice(0, 40) || "???" });
    } catch (err) {
      console.warn("draw guess:", model, err instanceof Error ? err.message.slice(0, 100) : err);
    }
  }
  throw new HttpError(503, "HIVEMIND is thinking too slowly right now.");
});
