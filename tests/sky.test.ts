import { describe, expect, it } from "vitest";
import { skyFor, skyFromWords } from "@/lib/sky";

describe("skyFor", () => {
  it("maps the weather to a sky", () => {
    expect(skyFor(95, true)).toBe("thunder");
    expect(skyFor(99, false)).toBe("thunder");
    expect(skyFor(61, true)).toBe("rain");
    expect(skyFor(81, false)).toBe("rain");
    expect(skyFor(53, true)).toBe("rain"); // drizzle
    expect(skyFor(0, true)).toBe("sunny");
    expect(skyFor(1, true)).toBe("sunny");
    expect(skyFor(3, true)).toBe("calm"); // overcast day
    expect(skyFor(0, false)).toBe("night");
    expect(skyFor(3, false)).toBe("night");
  });
  it("rain falling now wins over the code", () => {
    expect(skyFor(2, true, 1.2)).toBe("rain");
    expect(skyFor(2, true, 0.1)).toBe("calm");
  });
});

describe("skyFromWords", () => {
  it("understands previews", () => {
    expect(skyFromWords("show me the rain")).toBe("rain");
    expect(skyFromWords("thunderstorm please")).toBe("thunder");
    expect(skyFromWords("make it sunny")).toBe("sunny");
    expect(skyFromWords("night with stars")).toBe("night");
    expect(skyFromWords("banana")).toBeNull();
  });
});
