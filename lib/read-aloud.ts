"use client";

import { Speaker } from "@/lib/voice";

/**
 * One shared reader for "hear your day" (the morning card and the brief page), so starting one
 * stops the other. HIVEMIND's voice, falling back to the phone's own when out of quota.
 */
let speaker: Speaker | null = null;
const listeners = new Set<(on: boolean) => void>();

function get() {
  if (!speaker) {
    speaker = new Speaker();
    speaker.rate = 1.05;
    speaker.onSpeakingChange = (on) => listeners.forEach((f) => f(on));
  }
  return speaker;
}

/** Call from a tap (browsers only allow sound after one). */
export function readAloud(text: string) {
  const s = get();
  s.stop();
  s.unlock();
  return s.say(text);
}

export const stopReading = () => speaker?.stop();
export const isReading = () => !!speaker?.speaking;

export function onReading(f: (on: boolean) => void) {
  listeners.add(f);
  return () => void listeners.delete(f);
}
