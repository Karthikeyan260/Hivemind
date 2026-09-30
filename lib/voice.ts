"use client";

/* ───────────── Speaking (Gemini voice, browser fallback) ───────────── */

/** Strip markdown, citations and links so the voice reads clean prose. */
export function speakable(text: string) {
  return text
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "the link")
    .replace(/\[\d+(?:,\s*\d+)*\]/g, "")
    .replace(/[*_`#>]+/g, "")
    .replace(/^\s*[-•]\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Turns a token stream into speech-sized chunks: the first chunk is released at the first full
 * sentence (so the voice starts fast); later chunks are grouped up to ~260 characters to keep the
 * number of voice requests low on the free tier.
 */
export class SentenceStream {
  private buf = "";
  private first = true;
  constructor(private emit: (chunk: string) => void) {}

  push(delta: string) {
    this.buf += delta;
    for (;;) {
      const ends = [...this.buf.matchAll(/[.!?](?=\s)|\n/g)].map((m) => m.index! + 1);
      if (!ends.length) return;
      let cut: number;
      if (this.first) {
        cut = ends[0];
      } else {
        if (this.buf.length < 160) return; // wait to batch more text (flush() speaks the rest)
        const within = ends.filter((e) => e <= 260);
        cut = within.length ? within[within.length - 1] : ends[0];
      }
      const chunk = speakable(this.buf.slice(0, cut));
      this.buf = this.buf.slice(cut);
      if (chunk.length > 1) {
        this.emit(chunk);
        this.first = false;
      }
    }
  }

  flush() {
    const rest = speakable(this.buf);
    this.buf = "";
    if (rest.length > 1) this.emit(rest);
  }
}

/**
 * Plays chunks in order. Each chunk's audio is requested as soon as it arrives (so the next one is
 * ready while the current one plays). Exposes a live level from an AnalyserNode for visuals.
 */
/** Splits on sentence ends before a capital, so "1.6M" or "e.g." mid-sentence stay together. */
export function splitSentences(text: string) {
  return text.split(/(?<=[.!?])\s+(?=[A-Z(])/).map((x) => x.trim()).filter(Boolean);
}

export class Speaker {
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private data: Uint8Array<ArrayBuffer> | null = null;
  private chain: Promise<void> = Promise.resolve();
  private generation = 0;
  private sources = new Set<AudioBufferSourceNode>();
  private browserVoiceUntil = 0;
  private active = 0;
  private fakeLevel = 0;
  private cache = new Map<string, Promise<AudioBuffer | null>>();
  onSpeakingChange?: (speaking: boolean) => void;
  /** Playback speed (1 = normal). The journey story uses a brisker 1.2. */
  rate = 1;

  /** Start generating audio for these lines now (e.g. while the character walks), so it's ready instantly. */
  prefetch(texts: string[]) {
    if (Date.now() < this.browserVoiceUntil) return;
    for (const t of texts) if (t.trim() && !this.cache.has(t)) this.cache.set(t, this.fetchAudio(t));
    if (this.cache.size > 40) this.cache.delete(this.cache.keys().next().value!);
  }

  /** Speak a paragraph sentence by sentence (the first sentence starts sooner); resolves when all of it has played. */
  say(text: string) {
    for (const part of splitSentences(text)) this.speak(part);
    return this.chain;
  }

  /** Must be called from a user gesture once, so the browser allows audio. */
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 256;
      this.data = new Uint8Array(new ArrayBuffer(this.analyser.frequencyBinCount));
      this.analyser.connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended") this.ctx.resume().catch(() => {});
  }

  speak(text: string) {
    const gen = this.generation;
    const cached = this.cache.get(text);
    this.cache.delete(text);
    const audio = Date.now() < this.browserVoiceUntil ? Promise.resolve(null) : (cached ?? this.fetchAudio(text));
    this.chain = this.chain.then(async () => {
      if (gen !== this.generation) return;
      this.setActive(+1);
      try {
        const buf = await audio;
        if (gen !== this.generation) return;
        if (buf) await this.playBuffer(buf, gen);
        else await this.browserSpeak(text, gen);
      } finally {
        this.setActive(-1);
      }
    });
  }

  stop() {
    this.generation++;
    for (const s of this.sources) {
      try {
        s.stop();
      } catch {}
    }
    this.sources.clear();
    if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
    this.chain = Promise.resolve();
    this.active = 0;
    this.onSpeakingChange?.(false);
  }

  get speaking() {
    return this.active > 0;
  }

  /** 0..1 loudness of whatever is playing right now. */
  level() {
    if (this.analyser && this.data && this.sources.size) {
      this.analyser.getByteTimeDomainData(this.data);
      let sum = 0;
      for (const v of this.data) sum += ((v - 128) / 128) ** 2;
      return Math.min(1, Math.sqrt(sum / this.data.length) * 4);
    }
    this.fakeLevel *= 0.9;
    return this.fakeLevel;
  }

  private setActive(d: number) {
    const was = this.active > 0;
    this.active = Math.max(0, this.active + d);
    if (was !== this.active > 0) this.onSpeakingChange?.(this.active > 0);
  }

  private async fetchAudio(text: string): Promise<AudioBuffer | null> {
    try {
      const res = await fetch("/api/tts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
      if (!res.ok) {
        // Out of free voice quota (or voice down): use the browser voice for a while.
        this.browserVoiceUntil = Date.now() + (res.status === 429 ? 5 * 60_000 : 30_000);
        return null;
      }
      this.unlock();
      return await this.ctx!.decodeAudioData(await res.arrayBuffer());
    } catch {
      this.browserVoiceUntil = Date.now() + 30_000;
      return null;
    }
  }

  private playBuffer(buf: AudioBuffer, gen: number) {
    return new Promise<void>((resolve) => {
      if (!this.ctx || !this.analyser || gen !== this.generation) return resolve();
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = this.rate;
      src.connect(this.analyser);
      src.onended = () => {
        this.sources.delete(src);
        resolve();
      };
      this.sources.add(src);
      src.start();
    });
  }

  private browserSpeak(text: string, gen: number) {
    return new Promise<void>((resolve) => {
      if (typeof speechSynthesis === "undefined" || gen !== this.generation) return resolve();
      const u = new SpeechSynthesisUtterance(text);
      const voices = speechSynthesis.getVoices();
      u.voice =
        voices.find((v) => /natural/i.test(v.name) && v.lang.startsWith("en")) ??
        voices.find((v) => /Google UK English Male/i.test(v.name)) ??
        voices.find((v) => v.lang.startsWith("en")) ??
        null;
      u.rate = 1.02 * this.rate;
      u.onboundary = () => (this.fakeLevel = 0.7);
      u.onend = () => resolve();
      u.onerror = () => resolve();
      speechSynthesis.speak(u);
    });
  }
}
