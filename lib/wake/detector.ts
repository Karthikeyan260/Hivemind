import { CHUNK, loadWakeFeatures, RATE, rmsOf } from "./features";
import { normalize, score, threshold, windowFor, type Seq } from "./match";
import { openMic } from "./mic";
import { unpackSeqs, type WakeModel } from "./store";

/** Feeds mic chunks through a feature extractor strictly in order (skipping when far behind). */
function serial(fn: (chunk: Float32Array) => Promise<void>) {
  let chain = Promise.resolve();
  let queued = 0;
  return (chunk: Float32Array) => {
    if (queued > 6) return; // the device can't keep up: drop rather than lag seconds behind
    queued++;
    chain = chain.then(() => fn(chunk)).catch(() => {}).finally(() => queued--);
  };
}

export type Detector = { stop: () => void };

/**
 * Listens for the wake word until stopped. `onScore` (optional) reports each comparison, for the
 * settings test screen. Quiet audio is never compared, so silence costs almost nothing.
 */
export async function startDetector(model: WakeModel, onWake: () => void, onScore?: (s: number, thr: number) => void): Promise<Detector> {
  const make = await loadWakeFeatures();
  const feat = make();
  const templates = unpackSeqs(model);
  const w = windowFor(templates);
  const thr = threshold(model.pos, model.neg, model.sensitivity);
  let buf: Seq = [];
  let loud: number[] = [];
  let noise = 0;
  let quietUntil = 0;
  let stopped = false;

  const close = await openMic(
    serial(async (chunk) => {
      if (stopped) return;
      const r = rmsOf(chunk);
      noise = noise ? (r < noise ? noise * 0.9 + r * 0.1 : noise * 0.995 + r * 0.005) : r;
      buf.push(normalize(await feat.push(chunk)));
      loud.push(r);
      if (buf.length > w) {
        buf = buf.slice(-w);
        loud = loud.slice(-w);
      }
      if (stopped || Date.now() < quietUntil || buf.length < 4) return;
      // Only compare when something was actually said in the window.
      if (Math.max(...loud) < Math.max(300, noise * 3)) return;
      const s = score(templates, buf);
      onScore?.(s, thr);
      if (s < thr) {
        quietUntil = Date.now() + 2500;
        buf = [];
        loud = [];
        onWake();
      }
    }),
  );
  return {
    stop() {
      stopped = true;
      close();
    },
  };
}

/**
 * Records `seconds` of audio and returns its speech features (normalized) and per-chunk loudness.
 * `onLevel` gets 0–1 for a meter.
 */
export async function recordFeatures(seconds: number, onLevel?: (l: number) => void): Promise<{ seq: Seq; rms: number[] }> {
  const make = await loadWakeFeatures();
  const feat = make();
  const need = Math.round((seconds * RATE) / CHUNK);
  const seq: Seq = [];
  const rms: number[] = [];
  let done!: () => void;
  const full = new Promise<void>((r) => (done = r));
  let got = 0;
  const close = await openMic(
    serial(async (chunk) => {
      if (got >= need) return;
      got++;
      const r = rmsOf(chunk);
      onLevel?.(Math.min(1, r / 6000));
      seq.push(normalize(await feat.push(chunk)));
      rms.push(r);
      if (seq.length >= need) done();
    }),
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      full,
      new Promise((_, reject) => (timer = setTimeout(() => reject(new Error("The microphone didn't start. Tap the page and try again.")), seconds * 1000 + 8000))),
    ]);
  } finally {
    clearTimeout(timer);
    close();
  }
  return { seq, rms };
}
