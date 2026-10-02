import "server-only";
import { geminiClient } from "@/lib/ai/gemini";
import { db } from "@/lib/db";
import { readJSON, writeJSON } from "@/lib/private-store";

/**
 * "My voice": HIVEMIND speaking in the owner's own cloned voice (Gemini TTS voice replication).
 * The owner records a 10-30 s sample and Google's consent sentence once; Google returns a voice id
 * kept here (server-only). Off by default; the owner switches it on in Settings.
 */
export const CONSENT_TEXT = "I am the owner of this voice and I consent to Google using this voice to create a synthetic voice model.";

export type MyVoice = { id: string | null; enabled: boolean; created_at?: string };
const KEY = "my-voice";

// Every spoken sentence asks for this: keep it in memory for a short while.
let cached: { v: MyVoice; at: number } | null = null;

export async function getMyVoice(fresh = false): Promise<MyVoice> {
  if (!fresh && cached && Date.now() - cached.at < 30_000) return cached.v;
  const v = await readJSON<MyVoice>(db(), KEY, { id: null, enabled: false });
  cached = { v, at: Date.now() };
  return v;
}

async function save(v: MyVoice) {
  await writeJSON(db(), KEY, v);
  cached = { v, at: Date.now() };
  return v;
}

/** The voice to speak with right now, or null for HIVEMIND's usual voice. */
export async function activeVoiceId() {
  const v = await getMyVoice().catch(() => null);
  return v?.enabled && v.id ? v.id : null;
}

type Voices = {
  create(p: unknown): Promise<{ id?: string; key?: string }>;
  delete(id: string): Promise<unknown>;
};
const voices = () => (geminiClient() as unknown as { voices: Voices }).voices;

/** Clones the owner's voice from a sample and the consent recording (both 24 kHz mono 16-bit WAV, base64). */
export async function createMyVoice(sample: string, consent: string) {
  const old = await getMyVoice(true);
  let out: { id?: string; key?: string };
  try {
    out = await voices().create({
      store: true,
      voice: {
        type: "replicated",
        display_name: "HIVEMIND owner",
        description: "The owner's own voice for HIVEMIND (English, Tamil, Tanglish).",
        replicated: { source_audio: { data: sample, mime_type: "audio/wav" }, consent_audio: { data: consent, mime_type: "audio/wav" } },
      },
    });
  } catch (err) {
    const m = err instanceof Error ? err.message : String(err);
    if (/consent/i.test(m)) throw new Error(`Google couldn't verify the consent recording. Read it word for word, in the same voice as the sample: "${CONSENT_TEXT}"`);
    if (/RESOURCE_EXHAUSTED|quota|429/i.test(m)) throw new Error("Google's voice limit is reached right now. Try again later.");
    throw new Error(`Couldn't create the voice: ${m.replace(/\s+/g, " ").slice(0, 160)}`);
  }
  const id = out.id ?? out.key;
  if (!id) throw new Error("Google didn't return a voice.");
  // Replacing an older clone: remove it from Google too.
  if (old.id && old.id !== id) await voices().delete(old.id).catch(() => {});
  return save({ id, enabled: true, created_at: new Date().toISOString() });
}

export const setMyVoiceEnabled = async (enabled: boolean) => save({ ...(await getMyVoice(true)), enabled });

export async function deleteMyVoice() {
  const v = await getMyVoice(true);
  if (v.id) await voices().delete(v.id).catch(() => {});
  return save({ id: null, enabled: false });
}
