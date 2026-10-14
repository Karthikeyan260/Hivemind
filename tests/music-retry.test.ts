import { describe, expect, it } from "vitest";
import { MUSIC_RETRY } from "@/lib/agents/orchestrator";
import { byArtist } from "@/lib/music";

describe("music: retries and artists", () => {
  it("knows when the owner says the music is wrong or not playing", () => {
    for (const m of ["its an not ilayaraja song", "no song playing", "still not playing", "play", "now play", "actully its not an vijay song right", "play another song", "wrong song"]) expect(MUSIC_RETRY.test(m), m).toBe(true);
    for (const m of ["play some Anirudh songs for me while I work", "what's the weather", "remind me to call amma"]) expect(MUSIC_RETRY.test(m), m).toBe(false);
  });

  it("keeps the named artist's songs first, whatever the spelling", () => {
    const song = (title: string, artists: string) => ({ id: title, title, artists, album: "", image: "", duration: 0, language: "tamil", year: "", media: "" });
    const list = [song("Other 1", "Deva"), song("A", "Ilaiyaraaja"), song("Other 2", "Harris Jayaraj"), song("B", "K.J. Yesudas, Ilaiyaraaja"), song("C", "Ilaiyaraaja, S. Janaki")];
    expect(byArtist(list, "any motiation song from ilayaraja").slice(0, 3).map((s) => s.title)).toEqual(["A", "B", "C"]);
    expect(byArtist(list, "relaxing melody").map((s) => s.title)).toEqual(list.map((s) => s.title)); // no artist named
  });
});
