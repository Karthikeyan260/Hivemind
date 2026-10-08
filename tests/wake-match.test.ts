import { describe, expect, it } from "vitest";
import { dtw, normalize, score, threshold, trim, type Seq } from "@/lib/wake/match";

// A smooth random walk of 96-number frames, like speech embeddings over time.
function walk(n: number, seed: number): Seq {
  let x = seed;
  const rnd = () => ((x = (x * 16807) % 2147483647) / 2147483647) - 0.5;
  let v = Float32Array.from({ length: 96 }, rnd);
  const out: Seq = [];
  for (let i = 0; i < n; i++) {
    v = v.map((a) => a + rnd() * 0.6);
    out.push(normalize(v));
  }
  return out;
}

describe("wake word matching", () => {
  const word = walk(10, 7);

  it("matches itself perfectly", () => {
    expect(dtw(word, word)).toBeCloseTo(0, 5);
  });

  it("matches the word said slower, with sound before it", () => {
    const slow = word.flatMap((f) => [f, f]);
    expect(dtw(word, [...walk(6, 99), ...slow])).toBeLessThan(0.02);
  });

  it("keeps different sounds far apart", () => {
    expect(dtw(word, walk(14, 12345))).toBeGreaterThan(0.3);
  });

  it("only counts a match that ends at the latest audio, unless asked", () => {
    const after = [...word, ...walk(8, 555)];
    expect(dtw(word, after, true)).toBeLessThan(0.02);
    expect(dtw(word, after)).toBeGreaterThan(dtw(word, after, true));
  });

  it("scores against the closest recordings", () => {
    expect(score([word, walk(10, 3), walk(10, 4)], word)).toBeLessThan(score([walk(10, 3), walk(10, 4)], word));
  });

  it("finds the word in a recording, and rejects silence or a sentence", () => {
    const seq = walk(28, 5);
    const rms = Array.from({ length: 28 }, (_, i) => (i >= 8 && i <= 15 ? 4000 : 80));
    expect(trim(seq, rms)?.length).toBe(15 + 4 - 9 + 1);
    expect(trim(seq, Array(28).fill(80))).toBeNull();
    expect(trim(seq, Array(28).fill(4000).map((v, i) => (i < 1 ? 80 : v)))).toBeNull();
  });

  it("gets more eager with sensitivity, but never as eager as ordinary speech", () => {
    const strict = threshold(0.09, 0.27, 0);
    const eager = threshold(0.09, 0.27, 1);
    expect(eager).toBeGreaterThan(strict);
    expect(eager).toBeLessThan(0.27);
    expect(threshold(0.2, 0.15, 1)).toBeCloseTo(0.21, 6);
  });
});
