"use client";

import { Speaker } from "@/lib/voice";

/**
 * One shared reader for "hear your day", today's kural and the brief, so starting one stops the
 * other. HIVEMIND's voice, falling back to the phone's own when out of quota. Listeners hear WHICH
 * text is being read, so only that button shows "Stop".
 */
let speaker: Speaker | null = null;
let current: string | null = null;
const listeners = new Set<(text: string | null) => void>();
const tell = () => listeners.forEach((f) => f(speaker?.speaking ? current : null));

function get() {
  if (!speaker) {
    speaker = new Speaker();
    speaker.rate = 1.05;
    speaker.onSpeakingChange = (on) => {
      if (!on) current = null;
      tell();
    };
  }
  return speaker;
}

/** Call from a tap (browsers only allow sound after one). */
export function readAloud(text: string) {
  const s = get();
  s.stop();
  current = text;
  s.unlock();
  const done = s.say(text);
  tell();
  return done;
}

export const stopReading = () => speaker?.stop();
/** Is this text (or, without one, anything) being read right now? */
export const isReading = (text?: string) => !!speaker?.speaking && (text === undefined || current === text);

export function onReading(f: (text: string | null) => void) {
  listeners.add(f);
  return () => void listeners.delete(f);
}
