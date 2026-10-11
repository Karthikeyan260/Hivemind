import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Starting live voice when it is stopped half-way, or when an older session closes late: the bug on
 * the phone was "createMediaStreamSource: parameter 1 is not of type MediaStream" because a stale
 * teardown cleared the new session's microphone mid-start.
 */
type Cb = { onclose?: (e: { reason?: string }) => void };
const sessions: { cb: Cb; closed: boolean }[] = [];
let connectGate: Promise<void> = Promise.resolve();
vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    live = {
      connect: async ({ callbacks }: { callbacks: Cb }) => {
        await connectGate;
        const s = { cb: callbacks, closed: false, close() {}, sendRealtimeInput() {}, sendToolResponse() {} };
        s.close = () => {
          s.closed = true;
        };
        sessions.push(s);
        return s;
      },
    };
  },
}));

const tracks: { stopped: boolean }[] = [];
const sources: unknown[] = [];
let micGate: Promise<void> = Promise.resolve();
class FakeCtx {
  state = "running";
  currentTime = 0;
  destination = {};
  audioWorklet = { addModule: async () => {} };
  createAnalyser = () => ({ fftSize: 0, connect() {}, getByteTimeDomainData() {} });
  createMediaStreamSource = (m: unknown) => {
    if (!m || !(m as { getTracks?: unknown }).getTracks) throw new TypeError("parameter 1 is not of type 'MediaStream'");
    sources.push(m);
    return { connect() {} };
  };
  close = async () => {};
}
const fakes = {
  AudioContext: FakeCtx,
  AudioWorkletNode: class {
    port = { onmessage: null };
  },
  navigator: {
    mediaDevices: {
      getUserMedia: async () => {
        await micGate;
        const t = { stopped: false, stop() {} };
        t.stop = () => {
          t.stopped = true;
        };
        tracks.push(t);
        return { getTracks: () => [t] };
      },
    },
  },
  fetch: async () => new Response(JSON.stringify({ token: "t", model: "m", config: {} }), { status: 200 }),
};
for (const [k, v] of Object.entries(fakes)) vi.stubGlobal(k, v);

URL.createObjectURL = () => "blob:x";
URL.revokeObjectURL = () => {};
const { LiveVoice } = await import("@/lib/live");
const handlers = () => {
  const errors: string[] = [];
  const states: string[] = [];
  return { errors, states, h: { onState: (s: string) => states.push(s), onUserText() {}, onModelText() {}, onTurnEnd() {}, onSources() {}, onBrainChanged() {}, onError: (m: string) => errors.push(m) } };
};

describe("starting live voice", () => {
  beforeEach(() => {
    sessions.length = 0;
    tracks.length = 0;
    sources.length = 0;
    micGate = Promise.resolve();
    connectGate = Promise.resolve();
  });

  it("starts normally", async () => {
    const { h, errors, states } = handlers();
    const v = new LiveVoice(h as never);
    await v.start();
    expect(errors).toEqual([]);
    expect(states.at(-1)).toBe("listening");
    expect(sources).toHaveLength(1);
  });

  it("an old session closing late doesn't tear down the new one", async () => {
    const { h, errors, states } = handlers();
    const v = new LiveVoice(h as never);
    await v.start();
    const old = sessions[0];
    v.stop();
    // Restart, and while it connects, the first session's close event finally arrives.
    let open!: () => void;
    connectGate = new Promise((r) => (open = r));
    const starting = v.start();
    await new Promise((r) => setTimeout(r, 0));
    old.cb.onclose?.({ reason: "late" });
    open();
    await starting;
    expect(errors).toEqual([]);
    expect(states.at(-1)).toBe("listening");
    expect(sources).toHaveLength(2);
  });

  it("stopping while the mic is being opened leaves nothing running and no error", async () => {
    const { h, errors } = handlers();
    const v = new LiveVoice(h as never);
    let grant!: () => void;
    micGate = new Promise((r) => (grant = r));
    const starting = v.start();
    v.stop();
    grant();
    await starting;
    expect(errors).toEqual([]);
    expect(tracks.every((t) => t.stopped)).toBe(true);
    expect(sessions).toHaveLength(0);
  });

  it("stopping while connecting closes the session that arrives late", async () => {
    const { h, errors } = handlers();
    const v = new LiveVoice(h as never);
    let open!: () => void;
    connectGate = new Promise((r) => (open = r));
    const starting = v.start();
    await new Promise((r) => setTimeout(r, 0));
    v.stop();
    open();
    await starting;
    expect(errors).toEqual([]);
    expect(sessions[0]?.closed).toBe(true);
    expect(sources).toHaveLength(0);
  });
});

describe("tool guard", () => {
  it("checks built-in voice tools too (remember can't skip guest mode or the voiceprint)", async () => {
    const posted: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      posted.push(url);
      return new Response(JSON.stringify({ title: "x" }), { status: 200 });
    });
    const asked: string[] = [];
    const { h } = handlers();
    const v = new LiveVoice({ ...h, beforeTool: async (name: string) => (asked.push(name), name === "remember" ? { error: "Guest mode" } : null) } as never);
    const tool = (v as unknown as { tool: (n: string, a: object) => Promise<Record<string, unknown>> }).tool.bind(v);
    expect(await tool("remember", { content: "x" })).toEqual({ error: "Guest mode" });
    expect(posted).toEqual([]);
    await tool("search_brain", { query: "x" }).catch(() => {});
    expect(asked).toEqual(["remember", "search_brain"]);
    expect(posted).toEqual(["/api/search"]);
  });
});
