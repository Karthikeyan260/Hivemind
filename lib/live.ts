"use client";

import { GoogleGenAI, type LiveConnectConfig, type LiveServerMessage, type Session } from "@google/genai";

export type LiveState = "off" | "connecting" | "listening" | "thinking" | "speaking";
export type LiveSource = { n: number; type: string; title: string; href: string; similarity: number };

type Handlers = {
  onState: (s: LiveState) => void;
  /** Accumulated transcript of what the owner is saying in the current turn. */
  onUserText: (text: string) => void;
  /** New words from HIVEMIND's spoken reply. */
  onModelText: (delta: string) => void;
  /** A turn finished (or was interrupted by the owner speaking). */
  onTurnEnd: (interrupted: boolean) => void;
  onSources: (sources: LiveSource[]) => void;
  onBrainChanged: () => void;
  onError: (message: string) => void;
  /** Tools that run in the page itself (navigation, reading the screen). */
  clientTools?: Record<string, (args: Record<string, unknown>) => Promise<Record<string, unknown>> | Record<string, unknown>>;
};

// Captures mic audio as Float32 frames on the audio thread.
const WORKLET = `
class Capture extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) this.port.postMessage(ch.slice(0));
    return true;
  }
}
registerProcessor("hive-capture", Capture);
`;

function toBase64(bytes: Uint8Array) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromBase64(b64: string) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Real-time voice conversation with Gemini Live. Mic audio streams up as 16 kHz PCM; the model's
 * voice streams back as 24 kHz PCM and is scheduled gap-free. Server-side voice activity detection
 * decides when you've finished speaking and lets you interrupt (barge in) at any time.
 * Brain tools (search / remember / create project) run against HIVEMIND's own API.
 */
export class LiveVoice {
  private session: Session | null = null;
  private mic: MediaStream | null = null;
  private inCtx: AudioContext | null = null;
  private outCtx: AudioContext | null = null;
  private outAnalyser: AnalyserNode | null = null;
  private inAnalyser: AnalyserNode | null = null;
  private buf = new Uint8Array(new ArrayBuffer(256));
  private pending: Int16Array[] = [];
  private pendingLen = 0;
  private nextTime = 0;
  private sources = new Set<AudioBufferSourceNode>();
  private userText = "";
  private modelSpeaking = false;
  private state: LiveState = "off";
  private closedByUs = false;

  constructor(private h: Handlers) {}

  get active() {
    return this.state !== "off";
  }

  async start() {
    if (this.active) return;
    this.closedByUs = false;
    this.set("connecting");
    try {
      // Mic first: the permission prompt must come from the user's click.
      this.mic = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
      });
      this.outCtx = new AudioContext({ sampleRate: 24000 });
      this.outAnalyser = this.outCtx.createAnalyser();
      this.outAnalyser.fftSize = 256;
      this.outAnalyser.connect(this.outCtx.destination);

      const res = await fetch("/api/live/token", { method: "POST" });
      if (!res.ok) throw new Error(res.status === 401 ? "Locked: unlock HIVEMIND first." : "Couldn't start a live session.");
      const { token, model, config } = (await res.json()) as { token: string; model: string; config: LiveConnectConfig };

      const ai = new GoogleGenAI({ apiKey: token, httpOptions: { apiVersion: "v1alpha" } });
      this.session = await ai.live.connect({
        model,
        config,
        callbacks: {
          onmessage: (m) => this.onMessage(m),
          onerror: () => this.h.onError("Live connection error."),
          onclose: (e) => {
            if (!this.closedByUs && this.state !== "off") this.h.onError(e.reason ? `Live session ended: ${e.reason}` : "Live session ended.");
            this.teardown();
          },
        },
      });
      await this.startMic();
      this.set("listening");
    } catch (err) {
      this.h.onError(err instanceof Error ? (err.name === "NotAllowedError" ? "Microphone permission is blocked for this site." : err.message) : "Couldn't start voice.");
      this.teardown();
    }
  }

  stop() {
    this.closedByUs = true;
    try {
      this.session?.close();
    } catch {}
    this.teardown();
  }

  /** Send typed text into the live conversation. */
  sendText(text: string) {
    this.stopPlayback();
    this.session?.sendRealtimeInput({ text });
    this.set("thinking");
  }

  /** Loudness 0..1: HIVEMIND's voice while it speaks, otherwise a softer echo of your mic. */
  level() {
    const a = this.modelSpeaking || this.sources.size ? this.outAnalyser : this.inAnalyser;
    if (!a) return 0;
    a.getByteTimeDomainData(this.buf);
    let sum = 0;
    for (let i = 0; i < a.fftSize && i < this.buf.length; i++) sum += ((this.buf[i] - 128) / 128) ** 2;
    const rms = Math.sqrt(sum / Math.min(a.fftSize, this.buf.length));
    return Math.min(1, rms * (a === this.outAnalyser ? 4 : 2.2));
  }

  private set(s: LiveState) {
    if (this.state !== s) {
      this.state = s;
      this.h.onState(s);
    }
  }

  private async startMic() {
    this.inCtx = new AudioContext({ sampleRate: 16000 });
    const url = URL.createObjectURL(new Blob([WORKLET], { type: "application/javascript" }));
    await this.inCtx.audioWorklet.addModule(url);
    URL.revokeObjectURL(url);
    const src = this.inCtx.createMediaStreamSource(this.mic!);
    this.inAnalyser = this.inCtx.createAnalyser();
    this.inAnalyser.fftSize = 256;
    const node = new AudioWorkletNode(this.inCtx, "hive-capture");
    src.connect(this.inAnalyser);
    src.connect(node);
    node.port.onmessage = (e: MessageEvent<Float32Array>) => this.capture(e.data);
  }

  // Batch ~100 ms of 16-bit PCM per message.
  private capture(f32: Float32Array) {
    if (!this.session) return;
    const i16 = new Int16Array(f32.length);
    for (let i = 0; i < f32.length; i++) i16[i] = Math.max(-1, Math.min(1, f32[i])) * 0x7fff;
    this.pending.push(i16);
    this.pendingLen += i16.length;
    if (this.pendingLen < 1600) return;
    const all = new Int16Array(this.pendingLen);
    let o = 0;
    for (const p of this.pending) {
      all.set(p, o);
      o += p.length;
    }
    this.pending = [];
    this.pendingLen = 0;
    this.session.sendRealtimeInput({ audio: { data: toBase64(new Uint8Array(all.buffer)), mimeType: "audio/pcm;rate=16000" } });
  }

  private onMessage(m: LiveServerMessage) {
    const sc = m.serverContent;

    if (m.toolCall?.functionCalls?.length) {
      this.set("thinking");
      void this.runTools(m.toolCall.functionCalls);
    }

    if (sc?.inputTranscription?.text) {
      // The owner is talking; if HIVEMIND was mid-reply, that's a barge-in.
      if (this.modelSpeaking) this.endTurn(true);
      this.userText += sc.inputTranscription.text;
      this.h.onUserText(this.userText.trim());
      if (this.state === "listening" || this.state === "speaking") this.set("listening");
    }

    if (sc?.interrupted) {
      this.stopPlayback();
      this.endTurn(true);
      this.set("listening");
    }

    for (const part of sc?.modelTurn?.parts ?? []) {
      if (part.inlineData?.data && part.inlineData.mimeType?.startsWith("audio/")) {
        this.modelSpeaking = true;
        this.play(fromBase64(part.inlineData.data), Number(part.inlineData.mimeType.match(/rate=(\d+)/)?.[1] ?? 24000));
        this.set("speaking");
      }
    }
    if (sc?.outputTranscription?.text) {
      this.modelSpeaking = true;
      this.h.onModelText(sc.outputTranscription.text);
    }

    if (sc?.turnComplete && this.modelSpeaking) this.endTurn(false);
    if (m.goAway) this.h.onError("Live session is about to end (time limit). Start it again to keep talking.");
  }

  private endTurn(interrupted: boolean) {
    this.h.onTurnEnd(interrupted);
    this.userText = "";
    this.modelSpeaking = false;
    if (!interrupted) {
      // Return to listening once the queued audio finishes.
      const wait = Math.max(0, (this.nextTime - (this.outCtx?.currentTime ?? 0)) * 1000);
      setTimeout(() => {
        if (this.state === "speaking" && !this.sources.size) this.set("listening");
      }, wait + 60);
    }
  }

  private play(pcm: Uint8Array, rate: number) {
    const ctx = this.outCtx;
    if (!ctx || !this.outAnalyser) return;
    const samples = new Int16Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.byteLength / 2));
    const audio = ctx.createBuffer(1, samples.length, rate);
    const ch = audio.getChannelData(0);
    for (let i = 0; i < samples.length; i++) ch[i] = samples[i] / 0x8000;
    const src = ctx.createBufferSource();
    src.buffer = audio;
    src.connect(this.outAnalyser);
    const at = Math.max(ctx.currentTime + 0.02, this.nextTime);
    src.start(at);
    this.nextTime = at + audio.duration;
    this.sources.add(src);
    src.onended = () => {
      this.sources.delete(src);
      if (!this.sources.size && this.state === "speaking" && !this.modelSpeaking) this.set("listening");
    };
  }

  private stopPlayback() {
    for (const s of this.sources) {
      try {
        s.stop();
      } catch {}
    }
    this.sources.clear();
    this.nextTime = 0;
  }

  private async runTools(calls: { id?: string; name?: string; args?: Record<string, unknown> }[]) {
    const responses = await Promise.all(
      calls.map(async (c) => {
        try {
          return { id: c.id, name: c.name, response: await this.tool(c.name ?? "", c.args ?? {}) };
        } catch (err) {
          return { id: c.id, name: c.name, response: { error: err instanceof Error ? err.message : "failed" } };
        }
      }),
    );
    this.session?.sendToolResponse({ functionResponses: responses });
  }

  private async tool(name: string, args: Record<string, unknown>) {
    const post = async (url: string, body: object) => {
      const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      return j;
    };
    const client = this.h.clientTools?.[name];
    if (client) return await client(args);
    if (name === "search_brain") {
      type Hit = { source_type: string; title: string; content: string; parent_id: string; similarity: number };
      const hits = (await post("/api/search", { query: String(args.query ?? ""), limit: 8 })) as Hit[];
      const href = (h: Hit) => `/${h.source_type === "note" ? "notes" : h.source_type === "memory" ? "memories" : "documents"}?open=${h.parent_id}`;
      this.h.onSources(hits.map((h, i) => ({ n: i + 1, type: h.source_type, title: h.title, href: href(h), similarity: Math.round(h.similarity * 100) / 100 })));
      return { results: hits.map((h) => ({ title: h.title, type: h.source_type, content: h.content.slice(0, 700) })) };
    }
    if (name === "remember") {
      const m = (await post("/api/memories", { content: String(args.content ?? "") })) as { title: string };
      this.h.onBrainChanged();
      return { saved: true, title: m.title };
    }
    if (name === "create_project") {
      const p = (await post("/api/projects", { name: String(args.name ?? ""), description: args.description ? String(args.description) : undefined })) as { name: string };
      this.h.onBrainChanged();
      return { created: true, name: p.name };
    }
    return { error: `unknown tool ${name}` };
  }

  private teardown() {
    this.stopPlayback();
    this.mic?.getTracks().forEach((t) => t.stop());
    this.mic = null;
    this.inCtx?.close().catch(() => {});
    this.outCtx?.close().catch(() => {});
    this.inCtx = this.outCtx = null;
    this.inAnalyser = this.outAnalyser = null;
    this.session = null;
    this.pending = [];
    this.pendingLen = 0;
    this.userText = "";
    this.modelSpeaking = false;
    this.set("off");
  }
}
