/**
 * Listens through the browser's own speech recogniser (Chrome, Edge and Safari have one; Firefox doesn't) and hands each
 * finished phrase to a callback. Nothing is recorded or sent by us: the browser (and, in Chrome, Google's speech service)
 * does the recognising, and only while the mic button is on. Languages: English (India) and Tamil.
 *
 * The same callback also receives phrases sent as a page event (`hm-theatre-voice`, detail = the text), which is how the
 * tests speak without a microphone and how another tool (a switch, a keyboard shortcut) could drive the room.
 */
export type SpeechLang = "en-IN" | "ta-IN";
export type SpeechState = "off" | "listening" | "denied" | "unsupported";

type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
};

export const VOICE_EVENT = "hm-theatre-voice";

const ctor = (): (new () => Recognition) | null => {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
};

export const speechSupported = () => ctor() !== null;

export class SpeechListener {
  private rec: Recognition | null = null;
  private wanted = false;
  private lang: SpeechLang = "en-IN";
  private restart: ReturnType<typeof setTimeout> | null = null;
  private onEvent = (e: Event) => {
    const text = (e as CustomEvent<unknown>).detail;
    if (typeof text === "string" && text.length < 300) this.onText(text);
  };

  constructor(
    private onText: (text: string) => void,
    private onState: (s: SpeechState) => void,
  ) {
    if (typeof window !== "undefined") window.addEventListener(VOICE_EVENT, this.onEvent);
  }

  start(lang: SpeechLang) {
    this.lang = lang;
    const C = ctor();
    if (!C) {
      this.onState("unsupported");
      return;
    }
    this.wanted = true;
    this.rec?.abort();
    const r = new C();
    r.lang = lang;
    r.continuous = true;
    r.interimResults = false;
    r.maxAlternatives = 1;
    r.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal && res[0]?.transcript) this.onText(res[0].transcript);
      }
    };
    r.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        this.wanted = false;
        this.onState("denied");
      }
      // "no-speech", "aborted", "network": the browser stops listening now and then; onend restarts it
    };
    r.onend = () => {
      if (!this.wanted) return;
      this.restart = setTimeout(() => this.wanted && this.start(this.lang), 350);
    };
    this.rec = r;
    try {
      r.start();
      this.onState("listening");
    } catch {
      // already started
    }
  }

  stop() {
    this.wanted = false;
    if (this.restart) clearTimeout(this.restart);
    this.rec?.abort();
    this.rec = null;
    this.onState("off");
  }

  destroy() {
    this.stop();
    if (typeof window !== "undefined") window.removeEventListener(VOICE_EVENT, this.onEvent);
  }
}
