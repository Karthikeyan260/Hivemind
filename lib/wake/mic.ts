import { CHUNK, RATE } from "./features";

// Runs on the audio thread: resamples the mic to 16 kHz (averaging, so higher rates don't alias)
// and posts 80 ms chunks scaled like 16-bit samples.
const WORKLET = `
class WakeTap extends AudioWorkletProcessor {
  constructor() {
    super();
    this.step = sampleRate / ${RATE};
    this.pos = 0; this.acc = 0; this.n = 0;
    this.buf = new Float32Array(${CHUNK}); this.i = 0;
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    for (let k = 0; k < ch.length; k++) {
      this.acc += ch[k]; this.n++; this.pos += 1;
      if (this.pos >= this.step) {
        this.pos -= this.step;
        this.buf[this.i++] = Math.max(-1, Math.min(1, this.acc / this.n)) * 32767;
        this.acc = 0; this.n = 0;
        if (this.i === ${CHUNK}) { this.port.postMessage(this.buf); this.buf = new Float32Array(${CHUNK}); this.i = 0; }
      }
    }
    return true;
  }
}
registerProcessor("wake-tap", WakeTap);
`;

async function context(stream: MediaStream) {
  // Prefer a 16 kHz context (the browser resamples well); some browsers refuse to mix rates.
  for (const opts of [{ sampleRate: RATE }, undefined]) {
    let ctx: AudioContext | null = null;
    try {
      ctx = new AudioContext(opts);
      const src = ctx.createMediaStreamSource(stream);
      return { ctx, src };
    } catch {
      void ctx?.close();
    }
  }
  throw new Error("This browser can't process microphone audio.");
}

/** Opens the mic and calls back with every 80 ms of 16 kHz audio. Returns a function that closes it. */
export async function openMic(onChunk: (chunk: Float32Array) => void): Promise<() => void> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
  try {
    const { ctx, src } = await context(stream);
    const url = URL.createObjectURL(new Blob([WORKLET], { type: "application/javascript" }));
    try {
      await ctx.audioWorklet.addModule(url);
    } finally {
      URL.revokeObjectURL(url);
    }
    const node = new AudioWorkletNode(ctx, "wake-tap");
    node.port.onmessage = (e: MessageEvent<Float32Array>) => onChunk(e.data);
    // A silent route to the speakers, so the browser keeps pulling audio through the tap.
    const mute = ctx.createGain();
    mute.gain.value = 0;
    src.connect(node).connect(mute).connect(ctx.destination);
    // Without a tap/click on the page yet, the browser keeps audio paused until the first one.
    const wake = () => void ctx.resume().catch(() => {});
    if (ctx.state === "suspended") {
      wake();
      for (const ev of ["pointerdown", "keydown"]) window.addEventListener(ev, wake, { once: true });
    }
    return () => {
      for (const ev of ["pointerdown", "keydown"]) window.removeEventListener(ev, wake);
      node.port.onmessage = null;
      src.disconnect();
      stream.getTracks().forEach((t) => t.stop());
      void ctx.close();
    };
  } catch (e) {
    stream.getTracks().forEach((t) => t.stop());
    throw e;
  }
}
