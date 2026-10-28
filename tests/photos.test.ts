import { describe, expect, it } from "vitest";
import { dateRange, searchPhotos, type Photo } from "@/lib/photos";

const photo = (id: string, p: Partial<Photo>): Photo => ({ id, added: "2026-01-01T00:00:00Z", taken: "2026-01-01T00:00:00Z", hasTakenDate: true, title: "", description: "", tags: [], w: 1, h: 1, ...p });
const ALL = [
  photo("ooty", { title: "Misty tea gardens", place: "Ooty, Tamil Nadu", tags: ["hills", "tea", "trip"], taken: "2025-12-20T10:00:00Z" }),
  photo("cake", { title: "Birthday party", description: "Friends cutting a chocolate birthday cake with candles.", tags: ["cake", "birthday", "party"], taken: "2026-03-02T19:00:00Z" }),
  photo("beach", { title: "Sunset at Marina", place: "Marina Beach, Chennai", tags: ["beach", "sunset"], taken: "2025-12-05T12:00:00Z" }),
];
const NOW = new Date("2026-10-13T10:00:00+05:30");
/** A range edge as the date in Chennai. */
const ist = (d?: Date) => d?.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

describe("photo search", () => {
  it("finds by place, by what's in it, and by month", () => {
    expect(searchPhotos(ALL, "Ooty trip photos", NOW).photos.map((p) => p.id)).toEqual(["ooty"]);
    expect(searchPhotos(ALL, "the one with the birthday cake", NOW).photos[0].id).toBe("cake");
    expect(searchPhotos(ALL, "beach last December", NOW).photos.map((p) => p.id)).toEqual(["beach"]);
    expect(searchPhotos(ALL, "December", NOW).photos.map((p) => p.id).sort()).toEqual(["beach", "ooty"]);
  });

  it("an empty search lists everything, newest first; nonsense finds nothing", () => {
    expect(searchPhotos(ALL, "", NOW).photos.map((p) => p.id)).toEqual(["cake", "ooty", "beach"]);
    expect(searchPhotos(ALL, "spaceship", NOW).photos).toEqual([]);
  });

  it("understands everyday date words", () => {
    expect(ist(dateRange("last december", NOW)?.from)).toBe("2025-12-01");
    expect(ist(dateRange("last december", NOW)?.to)).toBe("2026-01-01");
    expect(ist(dateRange("photos from 2024", NOW)?.from)).toBe("2024-01-01");
    expect(ist(dateRange("march", NOW)?.from)).toBe("2026-03-01"); // March has passed this year
    // Just after midnight in Chennai (still the previous day in UTC): today is the Chennai day.
    expect(ist(dateRange("today", new Date("2026-10-14T00:30:00+05:30"))?.from)).toBe("2026-10-14");
    expect(dateRange("today", new Date("2026-10-14T00:30:00+05:30"))?.from.toISOString()).toBe("2026-10-13T18:30:00.000Z");
    expect(dateRange("the cake", NOW)).toBeNull();
  });
});

describe("photo search: names and short words", () => {
  const ooty = photo("o", { title: "Winding mountain road", description: "A road cuts through green hills by the valley.", place: "Udhagamandalam", tags: ["mountains", "road"] });
  it("knows Ooty is Udhagamandalam, and short words don't match long ones", () => {
    expect(searchPhotos([ooty], "Ooty trip", NOW).photos).toHaveLength(1);
    expect(searchPhotos([ooty], "birthday cake", NOW).photos).toHaveLength(0);
  });
});

describe("place nicknames", () => {
  it("shows the name people say, but not for cities that changed names", async () => {
    const { nickname } = await import("@/lib/photos");
    expect(nickname("Udhagamandalam")).toBe("Ooty (Udhagamandalam)");
    expect(nickname("Ooty")).toBe("Ooty");
    expect(nickname("Chennai")).toBe("Chennai");
  });
});

describe("photo search: the same word, not just the same first letters", () => {
  const pics = [
    photo("tri", { title: "Playground", tags: ["triangle", "tribe", "trek"] }),
    photo("trips", { title: "Weekend", tags: ["trips", "beaches", "birthdays"] }),
  ];
  it("'trip' doesn't match triangle, tribe or trek", () => {
    expect(searchPhotos(pics, "trip", NOW).photos.map((p) => p.id)).toEqual(["trips"]);
    expect(searchPhotos(pics, "tree", NOW).photos).toHaveLength(0);
  });
  it("plurals still match: trip ~ trips, beach ~ beaches, birthday ~ birthdays", () => {
    expect(searchPhotos(pics, "trip", NOW).photos).toHaveLength(1);
    expect(searchPhotos(pics, "beach", NOW).photos.map((p) => p.id)).toEqual(["trips"]);
    expect(searchPhotos(pics, "birthday", NOW).photos.map((p) => p.id)).toEqual(["trips"]);
    expect(searchPhotos(pics, "birthdays", NOW).photos.map((p) => p.id)).toEqual(["trips"]);
  });
});

describe("photo search in other scripts", () => {
  const more: Photo[] = [
    photo("cafe", { title: "Morning at the Café", tags: ["coffee"], taken: "2026-02-01T10:00:00Z" }),
    photo("tamil1", { title: "ஊட்டி பயணம்", tags: [], taken: "2026-02-02T10:00:00Z" }),
    photo("tamil2", { title: "கல் கோயில்", tags: [], taken: "2026-02-03T10:00:00Z" }),
  ];
  it("accents on Latin letters don't matter", () => {
    expect(searchPhotos(more, "cafe", NOW).photos.map((p) => p.id)).toEqual(["cafe"]);
    expect(searchPhotos(more, "Café", NOW).photos.map((p) => p.id)).toEqual(["cafe"]);
  });
  it("Tamil words are found whole, and a word that differs only in a vowel sign is a different word", () => {
    expect(searchPhotos(more, "ஊட்டி", NOW).photos.map((p) => p.id)).toEqual(["tamil1"]);
    expect(searchPhotos(more, "கல்", NOW).photos.map((p) => p.id)).toEqual(["tamil2"]);
    expect(searchPhotos(more, "கால்", NOW).photos).toEqual([]);
  });
});
