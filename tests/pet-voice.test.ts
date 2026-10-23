import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** A device speech engine that only records what it was told. */
const spoken: string[] = [];
let speaking = false;
let cancels = 0;
class FakeUtterance {
  text: string;
  voice: unknown = null;
  lang = "";
  pitch = 1;
  rate = 1;
  volume = 1;
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(text: string) {
    this.text = text;
  }
}

beforeEach(() => {
  spoken.length = 0;
  speaking = false;
  cancels = 0;
  vi.useFakeTimers();
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {}, removeItem: () => {} });
  vi.stubGlobal("SpeechSynthesisUtterance", FakeUtterance);
  const engine = {
    getVoices: () => [],
    get speaking() {
      return speaking;
    },
    speak: (u: FakeUtterance) => {
      spoken.push(u.text);
      speaking = true;
    },
    cancel: () => {
      cancels++;
      speaking = false;
    },
  };
  vi.stubGlobal("speechSynthesis", engine);
  vi.stubGlobal("window", { speechSynthesis: engine });
  // The app's mute flag lives in localStorage too: not muted.
  vi.stubGlobal("sessionStorage", { getItem: () => null });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("the pet's voice", () => {
  it("says a line, without its emoji", async () => {
    const { petSay } = await import("@/components/pet/talk");
    petSay("Good night 🌙 sleep well");
    expect(spoken).toEqual(["Good night sleep well"]);
  });
  it("hush stops what it is saying", async () => {
    const { petSay, petHush } = await import("@/components/pet/talk");
    petSay("A long bedtime line");
    expect(speaking).toBe(true);
    petHush();
    expect(speaking).toBe(false);
    expect(cancels).toBeGreaterThan(0);
  });
  it("hush leaves someone else's speech alone", async () => {
    const { petHush } = await import("@/components/pet/talk");
    speaking = true; // HIVEMIND reading aloud, not the pet
    petHush();
    expect(speaking).toBe(true);
    expect(cancels).toBe(0);
  });
  it("a line that was waiting its turn is dropped by hush, not said on the next page", async () => {
    const { petSay, petHush } = await import("@/components/pet/talk");
    speaking = true; // someone else is speaking: the pet's line waits
    petSay("Waiting line");
    petHush();
    speaking = false;
    vi.advanceTimersByTime(9000);
    expect(spoken).toEqual([]);
  });
  it("lines said after hush are spoken as normal", async () => {
    const { petSay, petHush } = await import("@/components/pet/talk");
    petHush();
    petSay("A new line");
    expect(spoken).toEqual(["A new line"]);
  });
});
