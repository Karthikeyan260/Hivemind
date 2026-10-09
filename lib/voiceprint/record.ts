import { openMic } from "@/lib/wake/mic";

/** Records `seconds` of 16 kHz mic audio (±32768 scale). `onLevel` gets 0–1 for a meter. */
export async function recordSamples(seconds: number, onLevel?: (l: number) => void): Promise<Float32Array> {
  const need = Math.round(seconds * 16000);
  const chunks: Float32Array[] = [];
  let got = 0;
  let done!: () => void;
  const full = new Promise<void>((r) => (done = r));
  const close = await openMic((c) => {
    if (got >= need) return;
    chunks.push(c.slice());
    got += c.length;
    let s = 0;
    for (const x of c) s += x * x;
    onLevel?.(Math.min(1, Math.sqrt(s / c.length) / 6000));
    if (got >= need) done();
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      full,
      new Promise((_, reject) => (timer = setTimeout(() => reject(new Error("The microphone didn't start. Tap the page and try again.")), seconds * 1000 + 8000))),
    ]);
  } finally {
    clearTimeout(timer);
    close();
  }
  const out = new Float32Array(got);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out.subarray(0, need);
}
