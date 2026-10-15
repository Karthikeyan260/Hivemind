import { describe, expect, it } from "vitest";
import { colorFromWords, hueRgb, rgbOf, vividOf } from "@/lib/beat-color";

describe("music light colours", () => {
  it("understands colour words, Tamil too, and hex", () => {
    expect(colorFromWords("make the music lights blue")).toBe("blue");
    expect(colorFromWords("pink music lights")).toBe("pink");
    expect(colorFromWords("neelam colour")).toBe("blue");
    expect(colorFromWords("sivappu")).toBe("red");
    expect(colorFromWords("pachai")).toBe("green");
    expect(colorFromWords("rainbow lights")).toBe("rainbow");
    expect(colorFromWords("use the album colour")).toBe("auto");
    expect(colorFromWords("#F0A")).toBe("#ff00aa");
    expect(colorFromWords("make it nice")).toBeNull();
  });
  it("turns settings into RGB", () => {
    expect(rgbOf("blue")).toEqual([80, 150, 255]);
    expect(rgbOf("#ff00aa")).toEqual([255, 0, 170]);
    expect(rgbOf("nonsense")).toEqual([255, 180, 70]);
    const [r, g, b] = hueRgb(0);
    expect(r).toBeGreaterThan(g);
    expect(r).toBeGreaterThan(b);
  });
  it("finds a cover's vivid colour and ignores greys", () => {
    // Half grey, half strong orange.
    const px = new Uint8ClampedArray([128, 128, 128, 255, 120, 120, 120, 255, 240, 120, 20, 255, 230, 110, 30, 255]);
    const c = vividOf(px)!;
    expect(c[0]).toBe(255);
    expect(c[1]).toBeLessThan(160);
    expect(c[2]).toBeLessThan(60);
    expect(vividOf(new Uint8ClampedArray([128, 128, 128, 255]))).toBeNull();
  });
});
