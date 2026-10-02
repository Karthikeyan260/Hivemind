import { NextResponse } from "next/server";
import { z } from "zod";
import { handle, HttpError, parseBody } from "@/lib/api";
import { CONSENT_TEXT, createMyVoice, deleteMyVoice, getMyVoice, setMyVoiceEnabled } from "@/lib/my-voice";

export const maxDuration = 60;

/** Whether the owner's voice exists and is switched on (never the voice id itself). */
export const GET = handle(async () => {
  const v = await getMyVoice(true);
  return NextResponse.json({ exists: !!v.id, enabled: v.enabled && !!v.id, created_at: v.created_at ?? null, consent_text: CONSENT_TEXT });
});

// ~30 s of 24 kHz 16-bit mono WAV is ~1.4 MB; base64 adds a third.
const Wav = z.string().min(1000).max(3_500_000);
const Create = z.object({ sample: Wav, consent: Wav });

/** Clone the owner's voice from their sample + consent recording. */
export const POST = handle(async (req: Request) => {
  const { sample, consent } = await parseBody(req, Create);
  try {
    const v = await createMyVoice(sample, consent);
    return NextResponse.json({ exists: true, enabled: v.enabled, created_at: v.created_at });
  } catch (err) {
    throw new HttpError(422, err instanceof Error ? err.message : "Couldn't create the voice.");
  }
});

/** Switch "speak in my voice" on or off. */
export const PATCH = handle(async (req: Request) => {
  const { enabled } = await parseBody(req, z.object({ enabled: z.boolean() }));
  const v = await setMyVoiceEnabled(enabled);
  if (enabled && !v.id) throw new HttpError(400, "Record your voice first.");
  return NextResponse.json({ exists: !!v.id, enabled: v.enabled });
});

/** Delete the cloned voice (here and at Google). */
export const DELETE = handle(async () => {
  await deleteMyVoice();
  return NextResponse.json({ exists: false, enabled: false });
});
