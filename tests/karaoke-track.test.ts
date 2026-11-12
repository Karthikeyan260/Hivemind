import { describe, expect, it } from "vitest";
import { clockSeconds, pickKaraokeTrack } from "@/lib/karaoke-track";

describe("clockSeconds", () => {
  it("reads m:ss and h:mm:ss, and 0 for anything else", () => {
    expect(clockSeconds("4:33")).toBe(273);
    expect(clockSeconds("1:02:10")).toBe(3730);
    expect(clockSeconds("")).toBe(0);
    expect(clockSeconds("LIVE")).toBe(0);
  });
});

describe("pickKaraokeTrack", () => {
  const v = (id: string, title: string, duration: string) => ({ id, title, channel: "ch", duration });
  it("takes the karaoke video closest to the song's length", () => {
    const got = pickKaraokeTrack([v("a", "Kannaana Kanney - Karaoke | Viswasam", "4:33"), v("b", "Kannaana Kanney HD+ | Karaoke | Tamil Lyrics", "4:30"), v("c", "Kannana kanne karaoke with sinking lyrics", "4:34")], { duration: 270 });
    expect(got?.id).toBe("b");
    expect(got?.seconds).toBe(270);
  });
  it("ignores the full song, clips, covers and reactions", () => {
    const got = pickKaraokeTrack(
      [v("song", "Vaathi Coming - Video Song | Master", "3:48"), v("clip", "Master - Vaathi Coming Karaoke | Thalapathy", "1:10"), v("cover", "Vaathi Coming karaoke cover by Anu", "3:49"), v("react", "Vaathi Coming Karaoke REACTION", "3:48"), v("ok", "Vaathi Coming Karaoke | Tamil Songs Karaoke", "3:49")],
      { duration: 228 },
    );
    expect(got?.id).toBe("ok");
  });
  it("returns nothing when no karaoke track is about the right length (the lyrics would not line up)", () => {
    expect(pickKaraokeTrack([v("x", "Some Song Karaoke (short version)", "2:00")], { duration: 300 })).toBeNull();
    expect(pickKaraokeTrack([v("x", "Some Song | Official Video", "5:00")], { duration: 300 })).toBeNull();
    expect(pickKaraokeTrack([], { duration: 300 })).toBeNull();
  });
  it("trusts the search order when lengths are unknown", () => {
    expect(pickKaraokeTrack([v("full", "Song - Lyric Video", ""), v("k1", "Song Karaoke", ""), v("k2", "Song Instrumental", "")], { duration: 300 })?.id).toBe("k1");
  });
  it("accepts 'no vocals' and 'instrumental' wordings", () => {
    expect(pickKaraokeTrack([v("n", "Chinna Chinna Aasai No Vocals", "4:56")], { duration: 295 })?.id).toBe("n");
  });
});
