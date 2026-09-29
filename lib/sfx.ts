"use client";

// Tiny synthesized UI sounds. No audio files, nothing plays until the user has interacted.
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
const KEY = "hivemind-muted";

export function isMuted() {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}
export function setMuted(m: boolean) {
  try {
    localStorage.setItem(KEY, m ? "1" : "0");
  } catch {}
}

function audio() {
  if (isMuted()) return null;
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.16;
    master.connect(ctx.destination);
  }
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  return ctx;
}

function tone(freq: number, dur: number, opts: { type?: OscillatorType; delay?: number; to?: number; gain?: number } = {}) {
  const a = audio();
  if (!a || !master) return;
  const t0 = a.currentTime + (opts.delay ?? 0);
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = opts.type ?? "sine";
  osc.frequency.setValueAtTime(freq, t0);
  if (opts.to) osc.frequency.exponentialRampToValueAtTime(opts.to, t0 + dur);
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(opts.gain ?? 0.6, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(master);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

export const sfx = {
  boot() {
    tone(180, 0.9, { type: "sine", to: 720, gain: 0.35 });
    tone(360, 0.5, { type: "triangle", delay: 0.55, gain: 0.25 });
    tone(540, 0.6, { type: "triangle", delay: 0.72, gain: 0.2 });
  },
  send() {
    tone(660, 0.09, { type: "triangle", gain: 0.4 });
    tone(990, 0.12, { type: "sine", delay: 0.06, gain: 0.3 });
  },
  lock() {
    tone(1320, 0.05, { type: "square", gain: 0.08 });
  },
  done() {
    tone(784, 0.18, { type: "sine", gain: 0.3 });
    tone(1175, 0.28, { type: "sine", delay: 0.09, gain: 0.25 });
  },
  hover() {
    tone(2200, 0.025, { type: "sine", gain: 0.05 });
  },
  error() {
    tone(220, 0.25, { type: "sawtooth", to: 140, gain: 0.15 });
  },
};
