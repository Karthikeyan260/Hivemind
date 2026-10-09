import type { Strictness } from "./policy";

/**
 * The owner's voiceprint, kept on this device only (localStorage): 512 numbers describing their
 * voice, not any recording. Each device learns it separately, since mics differ.
 */
export type Voiceprint = { print: number[]; strictness: Strictness; enabled: boolean; at: string; quality: "good" | "ok" | "poor" };

const KEY = "hm-voiceprint-v1";
export const VOICEPRINT_CHANGED = "hm:voiceprint-changed";

export function loadVoiceprint(): Voiceprint | null {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null") as Voiceprint | null;
    return v?.print?.length ? v : null;
  } catch {
    return null;
  }
}

export function saveVoiceprint(v: Voiceprint | null) {
  try {
    if (v) localStorage.setItem(KEY, JSON.stringify(v));
    else localStorage.removeItem(KEY);
  } catch {}
  window.dispatchEvent(new Event(VOICEPRINT_CHANGED));
}
