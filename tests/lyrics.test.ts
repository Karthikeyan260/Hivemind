import { describe, expect, it } from "vitest";
import { activeLine, cleanTitle, parseLrc, pickLyrics } from "@/lib/lyrics";

describe("parseLrc", () => {
  it("reads timed lines in order and skips tags", () => {
    const lines = parseLrc("[ar: Someone]\n[00:12.50] முதல் வரி\n[00:05.00]intro\n[01:02.345] third\nno stamp here");
    expect(lines).toEqual([
      { t: 5, text: "intro" },
      { t: 12.5, text: "முதல் வரி" },
      { t: 62.345, text: "third" },
    ]);
  });
  it("a line with several stamps repeats, and empty lines (music breaks) are kept", () => {
    const lines = parseLrc("[00:10.00][00:40.00] chorus\n[00:20.00]");
    expect(lines.map((l) => [l.t, l.text])).toEqual([
      [10, "chorus"],
      [20, ""],
      [40, "chorus"],
    ]);
  });
  it("drops word-level stamps inside a line", () => {
    expect(parseLrc("[00:01.00] <00:01.00>one <00:01.50>two")[0].text).toBe("one two");
  });
});

describe("cleanTitle", () => {
  it("drops film notes and punctuation", () => {
    expect(cleanTitle('Munbe Vaa (From "Sillunu Oru Kaadhal")')).toBe("munbe vaa");
    expect(cleanTitle("Vaathi Coming - Reprise")).toBe("vaathi coming");
    expect(cleanTitle("Why This Kolaveri Di?")).toBe("why this kolaveri di");
  });
});

describe("pickLyrics", () => {
  const lrc = "[00:01.00] a\n[00:02.00] b\n[00:03.00] c\n[00:04.00] d";
  const rows = [
    { trackName: "Munbe Vaa", artistName: "Cover Band", duration: 149, syncedLyrics: lrc, plainLyrics: "cover words" },
    { trackName: "Munbe Vaa", artistName: "Shreya Ghoshal", duration: 357, syncedLyrics: lrc, plainLyrics: "a\nb\nc\nd" },
    { trackName: "Munbe Vaa (Karaoke)", artistName: "X", duration: 356, instrumental: true, syncedLyrics: null, plainLyrics: null },
    { trackName: "Another Song", artistName: "Y", duration: 356, syncedLyrics: lrc },
  ];
  it("takes the synced lyrics of the recording with the same length, not a cover", () => {
    const got = pickLyrics(rows, { title: 'Munbe Vaa (From "Sillunu Oru Kaadhal")', duration: 356 });
    expect(got.synced).toBe(true);
    expect(got.match?.artist).toBe("Shreya Ghoshal");
    expect(got.lines).toHaveLength(4);
  });
  it("falls back to plain words when no recording of that length is synced (timings would be wrong)", () => {
    const got = pickLyrics(rows, { title: "Munbe Vaa", duration: 250 });
    expect(got.synced).toBe(false);
    expect(got.lines).toHaveLength(0);
    expect(got.plain.length).toBeGreaterThan(0);
  });
  it("skips the dubbed version's lyrics (another script), keeps Tamil and Tanglish", () => {
    const telugu = "[00:01.00] హే నా నాటు కోడివే\n[00:02.00] నా నాటు కోడివే నువ్వే\n[00:03.00] రౌడీ బేబీ రౌడీ బేబీ\n[00:04.00] హే నా నాటు కోడివే";
    const tamil = "[00:01.00] ஹே என் கோலி சோடாவே\n[00:02.00] என் கறி கொழம்பே\n[00:03.00] ரவுடி பேபி\n[00:04.00] உன் குட்டி பப்பி நான்";
    const got = pickLyrics(
      [
        { trackName: "Rowdy Baby", artistName: "Dub", duration: 281, syncedLyrics: telugu },
        { trackName: "Rowdy Baby", artistName: "Dhanush", duration: 283, syncedLyrics: tamil },
      ],
      { title: "Rowdy Baby", duration: 281 },
    );
    expect(got.match?.artist).toBe("Dhanush");
    expect(got.lines[0].text).toContain("கோலி");
    expect(pickLyrics([{ trackName: "Rowdy Baby", duration: 281, syncedLyrics: "[00:01.00] hey en goli sodave\n[00:02.00] en kari kozhambe\n[00:03.00] rowdy baby\n[00:04.00] un kutti puppy naan" }], { title: "Rowdy Baby", duration: 281 }).synced).toBe(true);
  });
  it("never uses another song's lyrics", () => {
    const got = pickLyrics(rows, { title: "Kannaana Kanney", duration: 356 });
    expect(got).toEqual({ lines: [], plain: [], synced: false });
  });
});

describe("activeLine", () => {
  const lines = [5, 10, 20].map((t) => ({ t, text: "x" }));
  it("is -1 before the first line, then the last line that has started", () => {
    expect(activeLine(lines, 0)).toBe(-1);
    expect(activeLine(lines, 5)).toBe(0);
    expect(activeLine(lines, 9.99)).toBe(0);
    expect(activeLine(lines, 15)).toBe(1);
    expect(activeLine(lines, 999)).toBe(2);
    expect(activeLine([], 3)).toBe(-1);
  });
});
