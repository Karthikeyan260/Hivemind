import { z } from "zod";
import { handle, parseBody } from "@/lib/api";
import { activeVoiceId } from "@/lib/my-voice";
import { synthesize } from "@/lib/tts";

export const maxDuration = 30;

const Body = z.object({ text: z.string().trim().min(1).max(1200) });

/** Natural speech for one sentence. A 429 tells the client to fall back to the browser's voice. */
export const POST = handle(async (req: Request) => {
  const { text } = await parseBody(req, Body);
  // "Speak in my voice" on: the owner's cloned voice, speaking like them (no fast-narrator style).
  const { audio, mime } = await synthesize(text, await activeVoiceId());
  return new Response(new Uint8Array(audio), { headers: { "Content-Type": mime, "Cache-Control": "no-store" } });
});
