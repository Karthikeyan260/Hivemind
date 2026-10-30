/**
 * The clock tower's bell, made from sound waves (no audio file): a bell is a handful of partials that are NOT whole
 * multiples of the base note, each dying away at its own rate. A soft strike, once per `gap` seconds.
 */
const PARTIALS: [ratio: number, gain: number, decay: number][] = [
  [0.5, 0.55, 3.2], // the hum
  [1, 1, 2.6], // the strike note
  [1.19, 0.6, 2.0], // the minor third that makes it a bell
  [1.56, 0.4, 1.5],
  [2, 0.45, 1.3],
  [2.74, 0.25, 0.9],
  [3.0, 0.18, 0.8],
  [4.07, 0.12, 0.5],
];

let ctx: AudioContext | null = null;

/** Strikes the bell `count` times (1 to 12), `gap` seconds apart. Must come from a tap (browsers keep audio quiet until then). */
export function strikeBell(count: number, gap = 1.2) {
  try {
    ctx ??= new AudioContext();
    const ac = ctx;
    if (ac.state === "suspended") void ac.resume();
    const n = Math.min(12, Math.max(1, Math.round(count)));
    const out = ac.createGain();
    out.gain.value = 0.16;
    out.connect(ac.destination);
    for (let i = 0; i < n; i++) {
      const t0 = ac.currentTime + 0.02 + i * gap;
      for (const [ratio, gain, decay] of PARTIALS) {
        const o = ac.createOscillator();
        const g = ac.createGain();
        o.type = "sine";
        o.frequency.value = 330 * ratio;
        g.gain.setValueAtTime(0, t0);
        g.gain.linearRampToValueAtTime(gain, t0 + 0.006);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + decay);
        o.connect(g).connect(out);
        o.start(t0);
        o.stop(t0 + decay + 0.05);
      }
    }
  } catch {
    // No audio on this device: the bell still swings.
  }
}
