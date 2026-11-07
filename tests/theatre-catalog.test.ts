import { existsSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { GROUPS, MOVIES, movieById, runtime, type Group } from "@/lib/theatre/catalog";

/**
 * Friends Theatre's catalogue is generated data (YouTube channel lists, Wikimedia Commons files). These checks catch a
 * bad regeneration: duplicate ids, broken links, a wrong order, an empty section. They don't go online; `npm run theatre:links`
 * does that (it asks YouTube and Commons whether every film is still there and may still be embedded).
 */
const YT_ID = /^[A-Za-z0-9_-]{11}$/;
const GROUP_IDS = GROUPS.filter((g) => g.id !== "all").map((g) => g.id as Group);

describe("theatre catalogue", () => {
  it("has a healthy amount in every section", () => {
    const count = (g: Group) => MOVIES.filter((m) => m.group === g).length;
    expect(MOVIES.length).toBeGreaterThan(1000);
    expect(count("tamil")).toBeGreaterThan(250);
    expect(count("hollywood")).toBeGreaterThan(40);
    expect(count("indian")).toBeGreaterThan(15);
    expect(count("anime")).toBeGreaterThan(300);
    expect(count("kids")).toBeGreaterThan(300);
    for (const g of GROUP_IDS) expect(count(g), `nothing in "${g}"`).toBeGreaterThan(0);
  });

  it("gives every film a unique, well-formed id", () => {
    const ids = MOVIES.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const m of MOVIES) {
      expect(m.id, m.title).toMatch(/^[A-Za-z0-9_-]+$/);
      if (m.yt) {
        expect(m.yt, m.title).toMatch(YT_ID);
        expect(m.id).toBe(`yt-${m.yt}`);
        expect(m.page).toBe(`https://www.youtube.com/watch?v=${m.yt}`);
      }
    }
    const yt = MOVIES.filter((m) => m.yt).map((m) => m.yt);
    expect(new Set(yt).size, "the same YouTube video is listed twice").toBe(yt.length);
  });

  it("has the fields the screens rely on", () => {
    for (const m of MOVIES) {
      expect(m.title.trim().length, m.id).toBeGreaterThan(0);
      expect(m.minutes, m.title).toBeGreaterThan(0);
      expect(GROUP_IDS, m.title).toContain(m.group);
      expect(typeof m.embed).toBe("boolean");
      expect(m.poster, m.title).toMatch(/^(https:\/\/|\/theatre\/posters\/)/);
      if (m.year !== null) {
        expect(m.year, m.title).toBeGreaterThanOrEqual(1930);
        expect(m.year, m.title).toBeLessThanOrEqual(2026);
      }
    }
    expect(runtime(95)).toBe("1h 35m");
    expect(runtime(9)).toBe("9m");
  });

  it("plays public-domain classics from Wikimedia Commons, with a local poster", () => {
    const commons = MOVIES.filter((m) => !m.yt);
    expect(commons.length).toBeGreaterThan(25);
    for (const m of commons) {
      expect(m.qualities.length, m.title).toBeGreaterThan(0);
      expect(m.qualities[m.qualities.length - 1].label, m.title).toBe("Original");
      for (const q of m.qualities) expect(q.src, m.title).toMatch(/^https:\/\/upload\.wikimedia\.org\/wikipedia\/commons\//);
      if (m.year !== null) expect(m.year, m.title).toBeLessThanOrEqual(1960);
      expect(m.poster).toMatch(/^\/theatre\/posters\//);
      expect(existsSync(join(process.cwd(), "public", m.poster)), `missing ${m.poster}`).toBe(true);
    }
  });

  it("only keeps a film that YouTube won't embed when it comes from Sony Pictures (it opens on YouTube)", () => {
    for (const m of MOVIES.filter((x) => !x.embed)) {
      expect(m.yt, m.title).toBeTruthy();
      expect(m.channel, m.title).toMatch(/^Sony Pictures/);
    }
    for (const m of MOVIES.filter((x) => x.yt && x.embed)) expect(m.qualities, m.title).toEqual([]);
  });

  it("lists newest first, films with no known year last", () => {
    const years = MOVIES.map((m) => m.year ?? 0);
    for (let i = 1; i < years.length; i++) expect(years[i - 1], `${MOVIES[i - 1].title} before ${MOVIES[i].title}`).toBeGreaterThanOrEqual(years[i]);
  });

  it("keeps each series together: one group and channel, every episode numbered once", () => {
    const bySeries = new Map<string, typeof MOVIES>();
    for (const m of MOVIES) {
      if (m.series === null) {
        expect(m.ep, m.title).toBeNull();
        continue;
      }
      expect(m.series.trim().length).toBeGreaterThan(0);
      expect(m.ep, m.title).toBeGreaterThan(0);
      bySeries.set(m.series, [...(bySeries.get(m.series) ?? []), m]);
    }
    expect(bySeries.size).toBeGreaterThan(40);
    for (const [name, eps] of bySeries) {
      expect(new Set(eps.map((e) => e.group)).size, name).toBe(1);
      const nums = eps.map((e) => e.ep);
      expect(new Set(nums).size, `${name} has a repeated episode number`).toBe(nums.length);
    }
  });

  it("finds a film by id", () => {
    const one = MOVIES[0];
    expect(movieById(one.id)).toBe(one);
    expect(movieById("nope")).toBeNull();
    expect(movieById(null)).toBeNull();
  });
});
