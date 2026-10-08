import type * as Ort from "onnxruntime-web";

/**
 * Speech features for the wake word, from openWakeWord's two small models (in public/wake/): 16 kHz
 * audio → mel spectrogram (8 frames per 80 ms) → one 96-number embedding per 80 ms, each describing
 * the last ~0.8 s of sound. Runs on this device; no audio leaves it.
 */
export const RATE = 16_000;
/** Samples per step (80 ms). */
export const CHUNK = 1280;
const CONTEXT = 480; // the mel model needs 3 extra hops of the previous audio
const MEL_BINS = 32;
const MEL_WINDOW = 76; // mel frames per embedding

type Session = Ort.InferenceSession;

export class WakeFeatures {
  private tail = new Float32Array(CONTEXT);
  private mel: Float32Array[] = [];

  constructor(
    private ort: typeof Ort,
    private melModel: Session,
    private embModel: Session,
  ) {
    this.reset();
  }

  /** Forget earlier audio (start of a new recording). */
  reset() {
    this.tail = new Float32Array(CONTEXT);
    this.mel = Array.from({ length: MEL_WINDOW }, () => new Float32Array(MEL_BINS).fill(1));
  }

  /** One 80 ms chunk (int16-scaled samples) → the embedding for the audio up to its end. */
  async push(chunk: Float32Array): Promise<Float32Array> {
    const x = new Float32Array(CONTEXT + CHUNK);
    x.set(this.tail);
    x.set(chunk.subarray(0, CHUNK), CONTEXT);
    this.tail = x.slice(x.length - CONTEXT);
    const melOut = await this.melModel.run({ [this.melModel.inputNames[0]]: new this.ort.Tensor("float32", x, [1, x.length]) });
    const m = melOut[this.melModel.outputNames[0]].data as Float32Array;
    for (let f = 0; f + MEL_BINS <= m.length; f += MEL_BINS) this.mel.push(m.slice(f, f + MEL_BINS).map((v) => v / 10 + 2));
    this.mel.splice(0, this.mel.length - MEL_WINDOW);
    const flat = new Float32Array(MEL_WINDOW * MEL_BINS);
    this.mel.forEach((row, i) => flat.set(row, i * MEL_BINS));
    const embOut = await this.embModel.run({ [this.embModel.inputNames[0]]: new this.ort.Tensor("float32", flat, [1, MEL_WINDOW, MEL_BINS, 1]) });
    return (embOut[this.embModel.outputNames[0]].data as Float32Array).slice();
  }
}

/** Loudness of a chunk (int16 scale), for finding where the word is. */
export function rmsOf(chunk: Float32Array) {
  let s = 0;
  for (const v of chunk) s += v * v;
  return Math.sqrt(s / (chunk.length || 1));
}

let loading: Promise<() => WakeFeatures> | null = null;

/** Loads the runtime and both models once (browser only); returns a maker of independent extractors. */
export function loadWakeFeatures() {
  loading ??= (async () => {
    const ort = await import("onnxruntime-web/wasm");
    // The 14 MB runtime comes from the npm CDN (cached by the browser), not the app bundle.
    ort.env.wasm.wasmPaths = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ort.env.versions.web}/dist/`;
    ort.env.wasm.numThreads = 1;
    const model = async (name: string) => {
      const r = await fetch(`/wake/${name}.onnx`);
      if (!r.ok) throw new Error(`Couldn't load the wake word model (${r.status}).`);
      return ort.InferenceSession.create(new Uint8Array(await r.arrayBuffer()), { executionProviders: ["wasm"] });
    };
    const [mel, emb] = await Promise.all([model("melspectrogram"), model("embedding_model")]);
    return () => new WakeFeatures(ort, mel, emb);
  })().catch((e) => {
    loading = null;
    throw e;
  });
  return loading;
}
