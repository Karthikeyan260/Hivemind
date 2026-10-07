import "server-only";
import { geminiClient } from "@/lib/ai/gemini";
import { HttpError } from "@/lib/api";

const MODEL = process.env.GEMINI_TTS_MODEL || "gemini-3.8-flash-tts";
const VOICE = process.env.GEMINI_TTS_VOICE || "Charon";

/** Speech for one sentence, in a cloned voice (voice id) or HIVEMIND's usual one. 429 = out of free quota. */
let cloneDownUntil = 0;

export async function synthesize(text: string, voiceId: string | null): Promise<{ audio: Buffer; mime: string }> {
  if (voiceId && Date.now() < cloneDownUntil) voiceId = null;
  try {
    const res = await geminiClient().models.generateContent({
      model: MODEL,
      // A cloned voice reads any style hint aloud: give it only the words (it keeps the owner's own way of speaking).
      contents: [{ role: "user", parts: [{ text: voiceId ? text : `Say at a brisk, energetic, fast pace: ${text}` }] }],
      config: {
        responseModalities: ["AUDIO"],
        speechConfig: { voiceConfig: voiceId ? { voice: voiceId } : { prebuiltVoiceConfig: { voiceName: VOICE } } },
      },
    });
    const part = res.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
    if (!part?.inlineData?.data) throw new HttpError(502, "No audio returned");
    return { audio: Buffer.from(part.inlineData.data, "base64"), mime: part.inlineData.mimeType || "audio/wav" };
  } catch (err) {
    // "No audio" from the usual voice is final; from the clone, fall through and use the usual voice.
    if (err instanceof HttpError && !voiceId) throw err;
    const status = (err as { status?: number }).status;
    console.warn("tts failed:", err instanceof Error ? err.message.slice(0, 120) : err);
    // The cloned voice is unavailable (e.g. Google now wants a paid tier for it): speak in the usual
    // voice, and don't retry the clone for a while (each failed try costs seconds).
    if (voiceId) {
      if (status !== 429) cloneDownUntil = Date.now() + 3600_000;
      return synthesize(text, null);
    }
    throw new HttpError(status === 429 ? 429 : 502, "Voice unavailable");
  }
}
