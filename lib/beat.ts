"use client";

import { type BeatColor, DEFAULT_COLOR, hueRgb, rgbOf, vividOf } from "@/lib/beat-color";

/**
 * Listens to the song that's playing and finds its beat, for the music lights: the app's glow, the
 * galaxy core and the pet pulse with the bass, and a bass drop flashes the screen.
 *
 * It listens to a COPY of the audio (captureStream), never the player's own output, so if a song
 * can't be listened to (the browser can't capture it, or its server doesn't allow it) the music
 * still plays normally and the lights fall back to a gentle steady pulse.
 *
 * Shared state, no React: level() for animation loops, onBeat / onDrop for events, and a CSS
 * variable --beat (0..1) plus the class "music-live" on <html> for stylesheets.
 */
type Listener = () => void;

let ctx: AudioContext | null = null;
let analyser: AnalyserNode | null = null;
let source: MediaStreamAudioSourceNode | null = null;
let raf = 0;
let running = false;
let synthetic = false;
let lvl = 0; // smoothed bass level 0..1, what the lights show
let avg = 0; // recent average (what counts as a beat is relative to it)
let slow = 0; // long average (a drop is a jump far above it)
let lastBeat = 0;
let lastDrop = 0;
let silentSince = 0;
let prevBass = 0;
let beatCount = 0;
let fluxAvg = 0;
let songStart = 0;
let rainbowAt = 0;
const debug = typeof localStorage !== "undefined" && (() => { try { return localStorage.getItem("hm-beat-debug") === "1"; } catch { return false; } })();
let lastCss = -1;
let bins: Uint8Array<ArrayBuffer> | null = null;
const beats = new Set<Listener>();
const drops = new Set<Listener>();

export const level = () => lvl;

/* ───── colour ───── */
const COLOR_KEY = "hm-beat-color";
let color: BeatColor = (() => {
  try {
    return (typeof localStorage !== "undefined" && localStorage.getItem(COLOR_KEY)) || DEFAULT_COLOR;
  } catch {
    return DEFAULT_COLOR;
  }
})();
let cover: [number, number, number] | null = null;
let lastHue = 0;

export const getColor = () => color;
/** The current light colour as RGB (what the lights show right now). */
export function currentRgb(): [number, number, number] {
  if (color === "rainbow") return hueRgb(lastHue);
  if (color === "auto") return cover ?? rgbOf(DEFAULT_COLOR);
  return rgbOf(color);
}
function paint(rgb = currentRgb()) {
  if (typeof document !== "undefined") document.documentElement.style.setProperty("--beat-rgb", rgb.join(" "));
}
/** "blue", "#ff00aa", "rainbow", "auto" (the song's cover). Remembered on this device. */
export function setColor(c: BeatColor) {
  color = c;
  try {
    if (c === DEFAULT_COLOR) localStorage.removeItem(COLOR_KEY);
    else localStorage.setItem(COLOR_KEY, c);
  } catch {}
  paint();
  window.dispatchEvent(new Event(COLOR_EVENT));
}
export const COLOR_EVENT = "hivemind:beat-color";

/** The song's cover, for the "auto" colour: its most vivid tone (gold if it can't be read). */
export function setCover(url: string | undefined) {
  cover = null;
  paint();
  if (!url) return;
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.onload = () => {
    try {
      const c = document.createElement("canvas");
      c.width = c.height = 24;
      const g = c.getContext("2d", { willReadFrequently: true });
      if (!g) return;
      g.drawImage(img, 0, 0, 24, 24);
      cover = vividOf(g.getImageData(0, 0, 24, 24).data);
      paint();
    } catch {}
  };
  img.src = url;
}
export const isSynthetic = () => synthetic;
export function onBeat(f: Listener) {
  beats.add(f);
  return () => void beats.delete(f);
}
export function onDrop(f: Listener) {
  drops.add(f);
  return () => void drops.delete(f);
}

const OFF_KEY = "hm-beat-off";
export function lightsOn() {
  try {
    return localStorage.getItem(OFF_KEY) !== "1" && !matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return true;
  }
}
export function setLights(on: boolean) {
  try {
    if (on) localStorage.removeItem(OFF_KEY);
    else localStorage.setItem(OFF_KEY, "1");
  } catch {}
  if (!on) return stop();
  // Turned on while a song is already playing: start listening to it now.
  const playing = [...document.querySelectorAll("audio")].find((a) => !a.paused && a.src);
  if (playing) start(playing);
}

function css(v: number) {
  // About 30 updates a second is plenty for a glow.
  const q = Math.round(v * 30) / 30;
  if (q === lastCss) return;
  lastCss = q;
  document.documentElement.style.setProperty("--beat", q.toFixed(3));
}

function frame(now: number) {
  if (!running) return;
  raf = requestAnimationFrame(frame);
  let bass = 0;
  if (!synthetic && analyser && bins) {
    analyser.getByteFrequencyData(bins);
    // ~40-190 Hz: kick and bass.
    const hz = (ctx?.sampleRate ?? 48000) / analyser.fftSize;
    const lo = Math.max(1, Math.floor(40 / hz));
    const hi = Math.max(lo + 1, Math.ceil(190 / hz));
    let sum = 0;
    for (let i = lo; i <= hi; i++) sum += bins[i];
    bass = sum / ((hi - lo + 1) * 255);
    // Nothing at all for 2.5 s while playing: the copy is silent (not allowed to listen) → steady pulse.
    if (bass < 0.005) {
      silentSince ||= now;
      if (now - silentSince > 2500) synthetic = true;
    } else silentSince = 0;
  }
  if (synthetic) {
    // ~118 bpm, soft.
    const phase = (now % 508) / 508;
    bass = phase < 0.12 ? 0.55 : 0.18;
  }
  // A beat is a sudden JUMP in the bass (a kick landing), not loud bass: modern songs keep the bass
  // loud all the time, so loudness alone never stands out.
  const flux = Math.max(0, bass - prevBass);
  prevBass = bass;
  fluxAvg += (flux - fluxAvg) * 0.06;
  avg += (bass - avg) * 0.08;
  slow += (bass - slow) * 0.004;
  if (flux > Math.max(0.045, fluxAvg * 3.2) && bass > 0.15 && now - lastBeat > 320) {
    lastBeat = now;
    lvl = Math.max(lvl, Math.min(1, 0.45 + flux * 3.5));
    beatCount++;
    beats.forEach((f) => f());
  }
  // A drop: the bass suddenly far above where it has been for the last several seconds.
  if (!synthetic && bass > 0.6 && bass > slow * 1.6 && now - lastDrop > 8000 && now - songStart > 4000) {
    lastDrop = now;
    drops.forEach((f) => f());
  }
  lvl = Math.max(0, lvl - 0.035);
  css(lvl);
  // Rainbow: the colour drifts around the wheel (a full turn every ~12 s), a step every ~100 ms.
  if (color === "rainbow" && now - rainbowAt > 100) {
    rainbowAt = now;
    lastHue = (now / 33) % 360;
    paint(hueRgb(lastHue));
  }
  // Debug readout for tests (only when asked for).
  if (debug) (window as unknown as { __beat?: unknown }).__beat = { bass: +bass.toFixed(3), avg: +avg.toFixed(3), synthetic, tracks: source ? 1 : 0, beats: beatCount };
}

/** The player started playing: listen to it (or pulse gently if it can't be listened to). */
export function start(audio: HTMLAudioElement) {
  if (!lightsOn()) return;
  stopListening();
  synthetic = false;
  silentSince = 0;
  prevBass = 0;
  fluxAvg = 0;
  songStart = performance.now();
  try {
    const capture = (audio as HTMLAudioElement & { captureStream?: () => MediaStream; mozCaptureStream?: () => MediaStream }).captureStream ?? (audio as unknown as { mozCaptureStream?: () => MediaStream }).mozCaptureStream;
    const stream = capture?.call(audio);
    if (!stream || !stream.getAudioTracks().length) throw new Error("no capture");
    ctx ??= new AudioContext();
    void ctx.resume().catch(() => {});
    analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    // Little smoothing (kicks are short) and headroom for loud masters, so the bass doesn't sit at the top.
    analyser.smoothingTimeConstant = 0.35;
    analyser.minDecibels = -85;
    analyser.maxDecibels = -12;
    bins = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));
    source = ctx.createMediaStreamSource(stream);
    // Only into the analyser, never the speakers: the player plays the song itself.
    source.connect(analyser);
  } catch {
    synthetic = true;
  }
  paint();
  document.documentElement.classList.add("music-live");
  if (!running) {
    running = true;
    raf = requestAnimationFrame(frame);
  }
}

function stopListening() {
  try {
    source?.disconnect();
  } catch {}
  source = null;
  analyser = null;
}

/** The music paused or stopped: the lights fade out. */
export function stop() {
  running = false;
  cancelAnimationFrame(raf);
  stopListening();
  lvl = 0;
  avg = 0;
  if (typeof document !== "undefined") {
    document.documentElement.classList.remove("music-live");
    document.documentElement.style.setProperty("--beat", "0");
  }
  lastCss = -1;
}
