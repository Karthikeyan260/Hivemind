import { z } from "zod";
import { geminiClient } from "@/lib/ai/gemini";
import { handle, HttpError, parseBody } from "@/lib/api";
import { activeVoiceId } from "@/lib/my-voice";

export const maxDuration = 30;

const MODEL = process.env.GEMINI_TTS_MODEL || "gemini-3.8-flash-tts";
const VOICE = process.env.GEMINI_TTS_VOICE || "Charon";

const Body = z.object({ text: z.string().trim().min(1).max(1200) });

/** Natural speech for one sentence. A 429 tells the client to fall back to the browser's voice. */
export const POST = handle(async (req: Request) => {
  const { text } = await parseBody(req, Body);
  // "Speak in my voice" on: the owner's cloned voice, speaking like them (no fast-narrator style).
  const mine = await activeVoiceId();
  try {
    const res = await geminiClient().models.generateContent({
      model: MODEL,
      // A cloned voice reads any style hint aloud: give it only the words (it keeps the owner's own way of speaking).
      contents: [{ role: "user", parts: [{ text: mine ? text : `Say at a brisk, energetic, fast pace: ${text}` }] }],
      config: {
        responseModalities: ["AUDIO"],
        speechConfig: { voiceConfig: mine ? { voice: mine } : { prebuiltVoiceConfig: { voiceName: VOICE } } },
      },
    });
    const part = res.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
    if (!part?.inlineData?.data) throw new HttpError(502, "No audio returned");
    const audio = Buffer.from(part.inlineData.data, "base64");
    return new Response(new Uint8Array(audio), {
      headers: { "Content-Type": part.inlineData.mimeType || "audio/wav", "Cache-Control": "no-store" },
    });
  } catch (err) {
    if (err instanceof HttpError) throw err;
    const status = (err as { status?: number }).status;
    console.warn("tts failed:", err instanceof Error ? err.message.slice(0, 120) : err);
    throw new HttpError(status === 429 ? 429 : 502, "Voice unavailable");
  }
});
