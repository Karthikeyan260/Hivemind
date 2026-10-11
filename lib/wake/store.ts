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
  /** Listen as soon as HIVEMIND opens (mic always on while it's open). Off unless chosen. */
  autoStart?: boolean;
  at: string;
};

const KEY = "hm-wake-v1";
export const WAKE_CHANGED = "hm:wake-changed";
/** The wake word was heard but the voice wasn't the owner's. */
export const WAKE_REJECTED = "hm:wake-rejected";

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

/*
 * Listening is off when the app opens: the mic only turns on when the owner taps the mic, or the ear
 * button for hands-free (this tab only), or chose "start listening when I open HIVEMIND" in Settings.
 */
const ON_KEY = "hm-wake-on";
export function wakeOnThisTab(): boolean {
  try {
    return sessionStorage.getItem(ON_KEY) === "1";
  } catch {
    return false;
  }
}
export function setWakeOnThisTab(on: boolean) {
  try {
    if (on) sessionStorage.setItem(ON_KEY, "1");
    else sessionStorage.removeItem(ON_KEY);
  } catch {}
  window.dispatchEvent(new Event(WAKE_CHANGED));
}
