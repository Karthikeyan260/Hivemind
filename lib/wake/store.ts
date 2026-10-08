import { normalize, type Seq } from "./match";

/**
 * The owner's wake word, kept on this device only (localStorage): the recordings' speech features
 * (not the audio), and the calibration. Each device learns it separately, since mics differ.
 */
export type WakeModel = {
  word: string;
  templates: number[][][];
  /** Calibration (see match.ts `calibrate`). */
  pos: number;
  neg: number;
  /** 0 = strict, 1 = eager. */
  sensitivity: number;
  enabled: boolean;
  at: string;
};

const KEY = "hm-wake-v1";
export const WAKE_CHANGED = "hm:wake-changed";

export function loadWake(): WakeModel | null {
  try {
    const m = JSON.parse(localStorage.getItem(KEY) ?? "null") as WakeModel | null;
    return m?.templates?.length ? m : null;
  } catch {
    return null;
  }
}

export function saveWake(m: WakeModel | null) {
  try {
    if (m) localStorage.setItem(KEY, JSON.stringify(m));
    else localStorage.removeItem(KEY);
  } catch {}
  window.dispatchEvent(new Event(WAKE_CHANGED));
}

export const packSeq = (s: Seq) => s.map((v) => Array.from(v, (x) => Math.round(x * 1e4) / 1e4));
export const unpackSeqs = (m: WakeModel): Seq[] => m.templates.map((t) => t.map((v) => normalize(Float32Array.from(v))));
