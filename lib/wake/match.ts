/**
 * Few-shot wake-word matching. The owner records their word ~8 times; each recording becomes a short
 * sequence of 96-number speech embeddings (one per 80 ms). Live audio is compared with those
 * recordings by dynamic time warping (so saying it a bit faster or slower still matches), and the
 * threshold comes from how alike the recordings are vs. how unlike the owner's ordinary speech is.
 * Pure functions: no audio, no browser.
 */
export type Seq = Float32Array[];

export function normalize(v: Float32Array): Float32Array {
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n) || 1;
  return v.map((x) => x / n);
}

/** Cosine distance of two normalized vectors (0 = same, 2 = opposite). */
function dist(a: Float32Array, b: Float32Array) {
  let d = 0;
  for (let i = 0; i < a.length; i++) d += a[i] * b[i];
  return 1 - d;
}

/**
 * Average per-step distance of the best alignment of the whole template against part of `s`: the
 * match may start anywhere in `s`, and ends at the last frame of `s` (`anyEnd` lets it end anywhere).
 */
export function dtw(t: Seq, s: Seq, anyEnd = false): number {
  const n = t.length;
  const m = s.length;
  if (!n || !m) return Infinity;
  // Cost and path length of the best alignment ending at (i, j); rows reused.
  let prevC = new Float64Array(m);
  let prevL = new Float64Array(m);
  let curC = new Float64Array(m);
  let curL = new Float64Array(m);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < m; j++) {
      const d = dist(t[i], s[j]);
      if (i === 0) {
        // Free start: the template may begin at any frame of s.
        curC[j] = d;
        curL[j] = 1;
        continue;
      }
      // Pick the predecessor with the lowest average cost so far.
      let bc = prevC[j];
      let bl = prevL[j];
      if (j > 0 && prevC[j - 1] / prevL[j - 1] <= bc / bl) {
        bc = prevC[j - 1];
        bl = prevL[j - 1];
      }
      if (j > 0 && curC[j - 1] / curL[j - 1] < bc / bl) {
        bc = curC[j - 1];
        bl = curL[j - 1];
      }
      curC[j] = bc + d;
      curL[j] = bl + 1;
    }
    [prevC, curC] = [curC, prevC];
    [prevL, curL] = [curL, prevL];
  }
  if (!anyEnd) return prevC[m - 1] / prevL[m - 1];
  let best = Infinity;
  for (let j = 0; j < m; j++) best = Math.min(best, prevC[j] / prevL[j]);
  return best;
}

/** How far `s` is from the word: the mean of the 3 closest recordings (robust to one odd take). */
export function score(templates: Seq[], s: Seq, anyEnd = false): number {
  const ds = templates.map((t) => dtw(t, s, anyEnd)).sort((a, b) => a - b);
  const k = Math.min(3, ds.length);
  if (!k) return Infinity;
  return ds.slice(0, k).reduce((a, b) => a + b, 0) / k;
}

/** The longest stretch of live audio worth comparing (a little longer than the longest recording). */
export const windowFor = (templates: Seq[]) => Math.ceil(Math.max(0, ...templates.map((t) => t.length)) * 1.6) + 2;

/**
 * The part of a recording that holds the word, from per-chunk loudness: from the first loud chunk to
 * a few chunks after the last one (each embedding looks back ~0.8 s, so it "hears" the word late).
 * Null when nothing was said or it was too long to be a wake word.
 */
export function trim(seq: Seq, rms: number[]): Seq | null {
  const sorted = [...rms].sort((a, b) => a - b);
  const floor = sorted[Math.floor(sorted.length * 0.2)] ?? 0;
  const peak = sorted[sorted.length - 1] ?? 0;
  if (peak < 300 || peak < floor * 4) return null; // nothing said
  const loud = Math.max(floor * 3, peak * 0.15);
  let a = rms.findIndex((r) => r >= loud);
  let b = rms.length - 1 - [...rms].reverse().findIndex((r) => r >= loud);
  if (a < 0) return null;
  if (b - a + 1 > 25) return null; // over 2 s: a sentence, not a word
  a = Math.max(0, a + 1);
  b = Math.min(seq.length - 1, b + 4);
  return seq.slice(a, b + 1);
}

/**
 * Where the threshold can sit: `pos` is the worst match of a recording against the others (the word
 * must score at least this well), `neg` the best match anywhere in ordinary speech (anything said
 * that scores this well is a false alarm).
 */
export function calibrate(templates: Seq[], clips: Seq[], background: Seq): { pos: number; neg: number } {
  let pos = 0;
  for (let i = 0; i < templates.length; i++) {
    const others = templates.filter((_, j) => j !== i);
    pos = Math.max(pos, score(others, clips[i], true));
  }
  const w = windowFor(templates);
  let neg = Infinity;
  for (let end = 4; end <= background.length; end++) neg = Math.min(neg, score(templates, background.slice(Math.max(0, end - w), end)));
  return { pos, neg: Number.isFinite(neg) ? neg : pos * 2 };
}

/** The threshold for a sensitivity from 0 (strict) to 1 (eager). */
export function threshold(pos: number, neg: number, sensitivity: number) {
  const s = Math.min(1, Math.max(0, sensitivity));
  // Close to how far apart the owner's own recordings are (similar-sounding phrases land just past
  // that), with a floor for a mic that's further away than at enrolment, and never as far as
  // ordinary speech.
  const t = Math.max(pos * (1.1 + 0.5 * s), 0.06 + 0.03 * s);
  return Math.min(t, neg > pos ? pos + (neg - pos) * 0.6 : pos * 1.05);
}
