import type * as Ort from "onnxruntime-web";
import { loadOrt, modelBytes } from "@/lib/ort";
import { fbank, voiced } from "./fbank";

/**
 * Voice signatures: WeSpeaker CAM++ (trained on VoxCeleb, 29 MB) turns a few seconds of speech into
 * 512 numbers that are close for the same person and far apart for different people, whatever they
 * say and in any language. Runs on this device; no audio leaves it.
 */
export const MODEL_URL = "https://huggingface.co/csukuangfj/speaker-embedding-models/resolve/main/wespeaker_en_voxceleb_CAM%2B%2B.onnx";
/** Less voiced audio than this gives an unreliable signature. */
export const MIN_SECONDS = 1.0;

export class SpeakerModel {
  constructor(
    private ort: typeof Ort,
    private session: Ort.InferenceSession,
  ) {}

  /** 16 kHz samples (±32768 scale) → a normalised signature, or null when there's too little speech. */
  async embed(samples: Float32Array): Promise<Float32Array | null> {
    const speech = voiced(samples);
    if (speech.length < MIN_SECONDS * 16000) return null;
    const feats = fbank(speech.subarray(0, 16000 * 12));
    const flat = new Float32Array(feats.length * 80);
    feats.forEach((row, i) => flat.set(row, i * 80));
    const out = await this.session.run({ [this.session.inputNames[0]]: new this.ort.Tensor("float32", flat, [1, feats.length, 80]) });
    const v = (out[this.session.outputNames[0]].data as Float32Array).slice();
    let n = 0;
    for (const x of v) n += x * x;
    n = Math.sqrt(n) || 1;
    return v.map((x) => x / n);
  }
}

let loading: Promise<SpeakerModel> | null = null;

/** Loads the runtime and the model once (browser only; the model is cached after the first time). */
export function loadSpeakerModel() {
  loading ??= (async () => {
    const ort = await loadOrt();
    const session = await ort.InferenceSession.create(await modelBytes(MODEL_URL), { executionProviders: ["wasm"] });
    return new SpeakerModel(ort, session);
  })().catch((e) => {
    loading = null;
    throw e;
  });
  return loading;
}
