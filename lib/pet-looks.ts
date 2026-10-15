/**
 * The pet's looks: festival outfits on their days (a few days around each, since calendars differ by
 * a day) and accessories unlocked as it grows. Pure data, used by the page and the server.
 */
export type Festival = {
  id: "deepavali" | "karthigai" | "pongal" | "puthandu" | "christmas" | "newyear" | "india";
  name: string;
  /** What it says on the day (Tanglish). */
  line: string;
  /** Its glow colour that day. */
  glow: string;
};

const F: Record<Festival["id"], Omit<Festival, "id">> = {
  deepavali: { name: "Deepavali", line: "Happy Deepavali! 🪔 Pattasu vedikalama?", glow: "#ffa94d" },
  karthigai: { name: "Karthigai Deepam", line: "Karthigai Deepam vazhthukkal! 🪔 Ellarum vilakku ethunga", glow: "#ff922b" },
  pongal: { name: "Pongal", line: "Pongalo Pongal! 🌾 Sakkarai pongal ready-ah?", glow: "#ffd43b" },
  puthandu: { name: "Tamil New Year", line: "Puthandu vazhthukkal! 🥭 Indha varusham semma-ya irukkum", glow: "#8ce99a" },
  christmas: { name: "Christmas", line: "Merry Christmas! 🎄 Cake enga?", glow: "#ff8787" },
  newyear: { name: "New Year", line: "Happy New Year! 🎉 Puthu resolutions ready-ah?", glow: "#da77f2" },
  india: { name: "India", line: "Jai Hind! 🇮🇳", glow: "#ffa94d" },
};

// Lunar festivals move every year: the Tamil Nadu dates (the day before and after count too).
const MOVING: [string, Festival["id"]][] = [
  ["2026-11-07", "deepavali"],
  ["2026-11-24", "karthigai"],
  ["2027-10-28", "deepavali"],
  ["2028-10-17", "deepavali"],
];
// The same date every year ("MM-DD" ranges).
const FIXED: [string, string, Festival["id"]][] = [
  ["01-13", "01-16", "pongal"],
  ["01-26", "01-26", "india"],
  ["04-13", "04-14", "puthandu"],
  ["08-15", "08-15", "india"],
  ["12-24", "12-25", "christmas"],
  ["12-31", "12-31", "newyear"],
  ["01-01", "01-01", "newyear"],
];

const shift = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/** The festival on a local date ("2026-11-07"), if any. */
export function festivalOn(date: string): Festival | null {
  const moving = MOVING.find(([d]) => date >= shift(d, -1) && date <= shift(d, 1));
  const md = date.slice(5);
  const id = moving?.[1] ?? FIXED.find(([from, to]) => md >= from && md <= to)?.[2];
  return id ? { id, ...F[id] } : null;
}

export const festivalById = (id: string): Festival | null => (id in F ? { id: id as Festival["id"], ...F[id as Festival["id"]] } : null);
export const FESTIVAL_IDS = Object.keys(F) as Festival["id"][];

/** Accessories, each unlocked at a growth stage. */
export const ACCESSORIES = [
  { id: "bow", name: "Bow", emoji: "🎀", stage: 1 },
  { id: "garland", name: "Malli garland", emoji: "🌼", stage: 2 },
  { id: "shades", name: "Shades", emoji: "😎", stage: 3 },
] as const;
export type AccessoryId = (typeof ACCESSORIES)[number]["id"];

export const unlocked = (stage: number) => ACCESSORIES.filter((a) => stage >= a.stage).map((a) => a.id);

/** Which accessory a request means ("wear the garland", "sunglasses", "remove it" = none). */
export function accessoryFor(said: string): AccessoryId | "none" | null {
  const t = said.toLowerCase();
  if (/\b(none|nothing|remove|take (it )?off|no accessor)/.test(t)) return "none";
  if (/bow|ribbon/.test(t)) return "bow";
  if (/garland|malli|flower|poo\b|maalai/.test(t)) return "garland";
  if (/shade|sunglass|glasses|cooling/.test(t)) return "shades";
  return null;
}
