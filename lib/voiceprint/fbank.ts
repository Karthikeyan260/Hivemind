/**
 * Kaldi-style log mel filterbank (80 bins, 25 ms frames every 10 ms, 16 kHz), the input the WeSpeaker
 * speaker model was trained on, followed by per-utterance mean normalisation. Pure: no browser APIs.
 * Input samples are scaled like 16-bit audio (±32768).
 */
const RATE = 16000;
const FRAME = 400;
const SHIFT = 160;
const NFFT = 512;
const BINS = 80;
const LOW = 20;
const HIGH = RATE / 2;

const melOf = (f: number) => 1127 * Math.log(1 + f / 700);

let banks: { start: number; weights: Float32Array }[] | null = null;
function melBanks() {
  if (banks) return banks;
  const lo = melOf(LOW);
  const hi = melOf(HIGH);
  const step = (hi - lo) / (BINS + 1);
  const fftBins = NFFT / 2;
  banks = [];
  for (let b = 0; b < BINS; b++) {
    const left = lo + b * step;
    const center = left + step;
    const right = center + step;
    const w = new Float32Array(fftBins);
    let start = -1;
    let end = 0;
    for (let k = 0; k < fftBins; k++) {
      const mel = melOf((k * RATE) / NFFT);
      if (mel > left && mel < right) {
        w[k] = mel <= center ? (mel - left) / (center - left) : (right - mel) / (right - center);
        if (start < 0) start = k;
        end = k;
      }
    }
    banks.push({ start: Math.max(0, start), weights: w.slice(Math.max(0, start), end + 1) });
  }
  return banks;
}

const HAMMING = (() => {
  const w = new Float32Array(FRAME);
  for (let i = 0; i < FRAME; i++) w[i] = 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (FRAME - 1));
  return w;
})();

/** In-place radix-2 complex FFT. */
function fft(re: Float64Array, im: Float64Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

/** Filterbank features, frames × 80, mean-normalised per bin. Empty when shorter than one frame. */
export function fbank(samples: Float32Array): Float32Array[] {
  const n = samples.length < FRAME ? 0 : 1 + Math.floor((samples.length - FRAME) / SHIFT);
  const mb = melBanks();
  const out: Float32Array[] = [];
  const re = new Float64Array(NFFT);
  const im = new Float64Array(NFFT);
  for (let f = 0; f < n; f++) {
    const off = f * SHIFT;
    let mean = 0;
    for (let i = 0; i < FRAME; i++) mean += samples[off + i];
    mean /= FRAME;
    re.fill(0);
    im.fill(0);
    // Remove DC, pre-emphasis (0.97), Hamming window.
    let prev = samples[off] - mean;
    for (let i = 0; i < FRAME; i++) {
      const x = samples[off + i] - mean;
      re[i] = (x - 0.97 * (i === 0 ? x : prev)) * HAMMING[i];
      prev = x;
    }
    fft(re, im);
    const row = new Float32Array(BINS);
    for (let b = 0; b < BINS; b++) {
      const { start, weights } = mb[b];
      let e = 0;
      for (let k = 0; k < weights.length; k++) {
        const j = start + k;
        e += weights[k] * (re[j] * re[j] + im[j] * im[j]);
      }
      row[b] = Math.log(Math.max(e, 1.1920929e-7));
    }
    out.push(row);
  }
  // Cepstral mean normalisation over the utterance.
  if (out.length) {
    const m = new Float32Array(BINS);
    for (const r of out) for (let b = 0; b < BINS; b++) m[b] += r[b];
    for (let b = 0; b < BINS; b++) m[b] /= out.length;
    for (const r of out) for (let b = 0; b < BINS; b++) r[b] -= m[b];
  }
  return out;
}

/** Cosine similarity of two embeddings (1 = same direction). */
export function cosine(a: Float32Array | number[], b: Float32Array | number[]) {
  let d = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    d += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return d / (Math.sqrt(na * nb) || 1);
}

/** Only the voiced parts (loud 10 ms frames, with a little context), so silence doesn't dilute the print. */
export function voiced(samples: Float32Array, floor = 400): Float32Array {
  const hop = 160;
  const keep: boolean[] = [];
  for (let i = 0; i + hop <= samples.length; i += hop) {
    let s = 0;
    for (let k = 0; k < hop; k++) s += samples[i + k] * samples[i + k];
    keep.push(Math.sqrt(s / hop) > floor);
  }
  // Pad each voiced run by 5 frames either side.
  const pad = keep.map((_, i) => keep.slice(Math.max(0, i - 5), i + 6).some(Boolean));
  const n = pad.filter(Boolean).length;
  const out = new Float32Array(n * hop);
  let o = 0;
  pad.forEach((k, i) => {
    if (k) {
      out.set(samples.subarray(i * hop, i * hop + hop), o);
      o += hop;
    }
  });
  return out;
}
