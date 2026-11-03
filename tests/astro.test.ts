import { describe, expect, it } from "vitest";
import { bodyAt, brightness, compass, heightWords, julianDay, moonPhaseName, nextMoons, sunAltitude, tonightSky, type BodyId } from "@/lib/astro";

// Reference values from NASA JPL Horizons for Chennai (13.0827 N, 80.2707 E) at 2026-11-03 15:00 UT: [azimuth, altitude, lit %].
const AT = new Date("2026-11-03T15:00:00Z");
const JPL: Record<BodyId, [number, number, number]> = {
  moon: [29.859, -64.417, 30.74],
  venus: [265.108, -57.464, 4.04],
  mars: [40.979, -51.356, 89.46],
  jupiter: [38.296, -55.881, 99.17],
  saturn: [117.795, 65.784, 99.92],
  mercury: [259.166, -39.15, 0.41],
};

describe("astronomy", () => {
  it("knows the Julian day of J2000", () => {
    expect(julianDay(new Date("2000-01-01T12:00:00Z"))).toBeCloseTo(2451545, 6);
  });

  it("puts the Moon and the planets where NASA JPL Horizons says they are (within a few hundredths of a degree)", () => {
    for (const id of Object.keys(JPL) as BodyId[]) {
      const [az, alt, lit] = JPL[id];
      const b = bodyAt(id, AT);
      expect(Math.abs(b.az - az), `${id} azimuth`).toBeLessThan(0.3);
      expect(Math.abs(b.alt - alt), `${id} altitude`).toBeLessThan(0.3);
      expect(Math.abs(b.illum * 100 - lit), `${id} lit fraction`).toBeLessThan(1.5);
    }
  });

  it("the Sun is at the right height", () => {
    // Chennai, local noon at the March equinox: the Sun is about 90 - latitude above the horizon.
    expect(sunAltitude(new Date("2026-03-20T06:40:00Z"))).toBeGreaterThan(75.5);
    expect(sunAltitude(new Date("2026-03-20T06:40:00Z"))).toBeLessThan(78.5);
    expect(sunAltitude(new Date("2026-03-19T18:30:00Z"))).toBeLessThan(-20);
  });

  it("finds the next new and full moon, and the Moon looks that way at those times", () => {
    const from = new Date("2026-11-03T15:00:00Z");
    const { nextNew, nextFull } = nextMoons(from);
    for (const t of [nextNew, nextFull]) {
      expect(t.getTime()).toBeGreaterThan(from.getTime());
      expect(t.getTime()).toBeLessThan(from.getTime() + 31 * 86400_000);
    }
    expect(bodyAt("moon", nextNew).illum).toBeLessThan(0.01);
    expect(bodyAt("moon", nextFull).illum).toBeGreaterThan(0.99);
    // About half a month apart.
    const gap = Math.abs(nextFull.getTime() - nextNew.getTime()) / 86400_000;
    expect(gap).toBeGreaterThan(13);
    expect(gap).toBeLessThan(17);
  });

  it("tonight's sky: dark now, or 9 pm this evening when it is daytime, brightest first", () => {
    const day = new Date("2026-11-03T06:30:00Z"); // noon in Chennai
    const sky = tonightSky(day);
    expect(sky.dark).toBe(true);
    expect(sky.when.getTime()).toBeGreaterThan(day.getTime());
    expect(sky.bodies.map((b) => b.id).sort()).toEqual(["jupiter", "mars", "mercury", "moon", "saturn", "venus"]);
    for (let i = 1; i < sky.bodies.length; i++) expect(sky.bodies[i - 1].mag).toBeLessThanOrEqual(sky.bodies[i].mag);
    // Already dark: it is "now".
    const night = new Date("2026-11-03T16:30:00Z");
    expect(tonightSky(night).when.getTime()).toBe(night.getTime());
    expect(sky.moonAge).toBeGreaterThan(0);
    expect(sky.moonAge).toBeLessThan(29.6);
  });

  it("gives rise and set times for something that is up in a day, and Saturn's rings are tilted", () => {
    const sky = tonightSky(new Date("2026-11-03T06:30:00Z"));
    const moon = sky.bodies.find((b) => b.id === "moon")!;
    expect(moon.rises || moon.sets).toBeTruthy();
    // Something that rises does so in the east half of the sky, and sets in the west half (at Chennai's latitude).
    for (const b of sky.bodies) {
      if (b.riseAz != null) expect(b.riseAz < 180).toBe(true);
      if (b.setAz != null) expect(b.setAz > 180).toBe(true);
    }
    const saturn = sky.bodies.find((b) => b.id === "saturn")!;
    expect(Math.abs(saturn.ringTilt ?? 99)).toBeLessThan(28.1);
  });

  it("words", () => {
    expect(compass(0)).toBe("north");
    expect(compass(92)).toBe("east");
    expect(compass(200)).toBe("south-southwest");
    expect(compass(359)).toBe("north");
    expect(heightWords(-3)).toBe("below the horizon");
    expect(heightWords(80)).toBe("almost overhead");
    expect(moonPhaseName(0.2)).toBe("New moon");
    expect(moonPhaseName(14.77)).toBe("Full moon");
    expect(moonPhaseName(7.4)).toBe("First quarter");
    expect(moonPhaseName(22.1)).toBe("Last quarter");
    expect(brightness(-4.4)).toMatch(/brightest/);
    expect(brightness(2.5)).toMatch(/dim/);
  });
});
