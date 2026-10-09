import { describe, expect, it } from "vitest";
import { cosine, fbank, voiced } from "@/lib/voiceprint/fbank";
import { enrolQuality, needsOwnerVoice, THRESHOLD } from "@/lib/voiceprint/policy";

const tone = (hz: number, seconds: number, amp = 8000) => Float32Array.from({ length: Math.round(16000 * seconds) }, (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / 16000));

describe("which actions need the owner's voice", () => {
  it("always: ending guest mode and anything that deletes, sends, calls or approves", () => {
    for (const t of ["guest_mode:end", "delete_memory", "message_contact", "call_contact", "web_task_answer"]) expect(needsOwnerVoice(t, { guestSeen: false }), t).toBe(true);
  });
  it("never: reading and looking things up", () => {
    for (const t of ["search_brain", "get_weather", "list_projects", "web_search"]) {
      expect(needsOwnerVoice(t, { guestSeen: false }), t).toBe(false);
      expect(needsOwnerVoice(t, { guestSeen: true }), t).toBe(false);
    }
  });
  it("saving only after a guest has talked (they may still be in the room)", () => {
    expect(needsOwnerVoice("remember", { guestSeen: false })).toBe(false);
    expect(needsOwnerVoice("remember", { guestSeen: true })).toBe(true);
    expect(needsOwnerVoice("create_note", { guestSeen: true })).toBe(true);
  });
  it("orders the strictness levels", () => {
    expect(THRESHOLD.relaxed).toBeLessThan(THRESHOLD.normal);
    expect(THRESHOLD.normal).toBeLessThan(THRESHOLD.strict);
    expect(enrolQuality([0.9, 0.85, 0.92])).toBe("good");
    expect(enrolQuality([0.9, 0.5])).toBe("poor");
  });
});

describe("voice features", () => {
  it("makes 100 frames a second of 80 bins", () => {
    const f = fbank(tone(440, 1));
    expect(f).toHaveLength(98); // 1 + (16000 - 400) / 160
    expect(f[0]).toHaveLength(80);
    expect(fbank(new Float32Array(100))).toEqual([]);
  });
  it("puts a tone's energy in the right band, and removes the average", () => {
    // One second at 300 Hz, then one second at 3 kHz.
    const lo = tone(300, 1);
    const hi = tone(3000, 1);
    const mix = new Float32Array(32000);
    mix.set(lo);
    mix.set(hi, 16000);
    const rows = fbank(mix);
    const m = new Float32Array(80);
    for (const r of rows) for (let b = 0; b < 80; b++) m[b] += r[b] / rows.length;
    for (const x of m) expect(Math.abs(x)).toBeLessThan(1e-3);
    // The first second is loudest in a lower band than the second (frames are 10 ms apart).
    const peak = (r: Float32Array) => r.indexOf(Math.max(...r));
    expect(peak(rows[40])).toBeLessThan(peak(rows[150]));
  });
  it("keeps only the speech, not the silence around it", () => {
    const x = new Float32Array(16000 * 3);
    x.set(tone(200, 1), 16000);
    const v = voiced(x);
    expect(v.length).toBeGreaterThan(15000);
    expect(v.length).toBeLessThan(18000);
  });
  it("scores identical prints as 1 and opposite ones as -1", () => {
    expect(cosine([1, 2, 3], [1, 2, 3])).toBeCloseTo(1);
    expect(cosine([1, 0], [-1, 0])).toBeCloseTo(-1);
  });
});
