"use client";

import { isMuted } from "@/lib/sfx";

/**
 * The pet's own voice: the device's built-in speech voice, pitched way up so it sounds small and
 * squeaky next to HIVEMIND's. Free, instant and unlimited, so its chatter never uses up HIVEMIND's
 * own (limited) speech quota. Off when the app is muted or the owner turned its voice off.
 */
const VOICE_KEY = "hm-pet-voice-off";

export function petVoiceOn() {
  try {
    return localStorage.getItem(VOICE_KEY) !== "1" && !isMuted();
  } catch {
    return false;
  }
}
export function setPetVoice(on: boolean) {
  try {
    if (on) localStorage.removeItem(VOICE_KEY);
    else localStorage.setItem(VOICE_KEY, "1");
  } catch {}
}

/** Emoji and symbols aren't read out. */
const speakable = (t: string) =>
  t
    .replace(/\p{Extended_Pictographic}|️|‍/gu, "")
    .replace(/\s+/g, " ")
    .trim();

/** An Indian-English voice if the device has one (they read Tanglish best), else any English one. */
function pickVoice() {
  const all = speechSynthesis.getVoices();
  return (
    all.find((v) => /en[-_]IN/i.test(v.lang) && /female|google|heera|neerja|veena|raveena/i.test(v.name)) ??
    all.find((v) => /en[-_]IN/i.test(v.lang)) ??
    all.find((v) => /^en/i.test(v.lang) && /female|samantha|zira|google us/i.test(v.name)) ??
    all.find((v) => /^en/i.test(v.lang)) ??
    null
  );
}

let mine = false;

/**
 * Says a line in the pet's voice. A new line cuts off its own previous one; if something else is
 * speaking (HIVEMIND reading aloud in the browser voice), it waits its turn (up to ~8 s), never interrupts.
 */
export function petSay(line: string, waited = 0) {
  if (!petVoiceOn() || typeof window === "undefined" || !("speechSynthesis" in window)) return;
  if (speechSynthesis.speaking && !mine) {
    if (waited < 8000) setTimeout(() => petSay(line, waited + 400), 400);
    return;
  }
  const text = speakable(line);
  if (!text) return;
  const u = new SpeechSynthesisUtterance(text);
  const voice = pickVoice();
  if (voice) u.voice = voice;
  u.lang = voice?.lang ?? "en-IN";
  // High and a little quick: small and cute.
  u.pitch = 1.9;
  u.rate = 1.08;
  u.volume = 0.9;
  u.onend = u.onerror = () => {
    mine = false;
  };
  speechSynthesis.cancel();
  mine = true;
  speechSynthesis.speak(u);
}
