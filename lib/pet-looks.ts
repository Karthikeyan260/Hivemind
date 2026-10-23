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

/** How an accessory is earned. */
export type Earn =
  | { type: "stage"; at: number }
  | { type: "streak"; days: number }
  | { type: "winstreak"; n: number }
  | { type: "songs"; n: number }
  | { type: "winter" }
  | { type: "festival"; id: Festival["id"] };

/**
 * Accessories, each earned by something the owner does (or by growing), then kept for good: the pet
 * can wear any it has earned. The festival hats come from being there on the day.
 */
export const ACCESSORIES = [
  { id: "bow", name: "Bow", emoji: "🎀", earn: { type: "stage", at: 1 }, how: "Grow to Baby" },
  { id: "garland", name: "Malli garland", emoji: "🌼", earn: { type: "stage", at: 2 }, how: "Grow to Glowing" },
  { id: "shades", name: "Shades", emoji: "😎", earn: { type: "stage", at: 3 }, how: "Grow to Crowned" },
  { id: "cap", name: "Cap", emoji: "🧢", earn: { type: "streak", days: 7 }, how: "Keep a habit going 7 days in a row" },
  { id: "crown", name: "Crown", emoji: "👑", earn: { type: "winstreak", n: 5 }, how: "Win 5 games in a row" },
  { id: "headphones", name: "Headphones", emoji: "🎧", earn: { type: "songs", n: 100 }, how: "Play 100 songs" },
  { id: "scarf", name: "Scarf", emoji: "🧣", earn: { type: "winter" }, how: "Visit in winter (December to February)" },
  { id: "hat-pongal", name: "Pongal pot hat", emoji: "🌾", earn: { type: "festival", id: "pongal" }, how: "Be here on Pongal" },
  { id: "hat-puthandu", name: "Mango-leaf crown", emoji: "🥭", earn: { type: "festival", id: "puthandu" }, how: "Be here on Tamil New Year" },
  { id: "hat-deepavali", name: "Diya crown", emoji: "🪔", earn: { type: "festival", id: "deepavali" }, how: "Be here on Deepavali" },
  { id: "hat-karthigai", name: "Lamp hat", emoji: "🏮", earn: { type: "festival", id: "karthigai" }, how: "Be here on Karthigai Deepam" },
  { id: "hat-christmas", name: "Santa hat", emoji: "🎅", earn: { type: "festival", id: "christmas" }, how: "Be here on Christmas" },
  { id: "hat-newyear", name: "Party hat", emoji: "🥳", earn: { type: "festival", id: "newyear" }, how: "Be here on New Year" },
  { id: "hat-india", name: "Tricolour band", emoji: "🇮🇳", earn: { type: "festival", id: "india" }, how: "Be here on Independence or Republic Day" },
] as const satisfies readonly { id: string; name: string; emoji: string; earn: Earn; how: string }[];
export type AccessoryId = (typeof ACCESSORIES)[number]["id"];
export const ACCESSORY_IDS = ACCESSORIES.map((a) => a.id) as AccessoryId[];

/** What the pet's owner has done so far (everything an accessory can ask for). */
export type EarnFacts = { stage: number; bestStreak: number; winStreak: number; songs: number; winter: boolean; festivals: string[] };

/** The accessories these facts have earned. */
export function earnedAccessories(f: EarnFacts): AccessoryId[] {
  return ACCESSORIES.filter((a) => {
    const e: Earn = a.earn;
    switch (e.type) {
      case "stage":
        return f.stage >= e.at;
      case "streak":
        return f.bestStreak >= e.days;
      case "winstreak":
        return f.winStreak >= e.n;
      case "songs":
        return f.songs >= e.n;
      case "winter":
        return f.winter;
      case "festival":
        return f.festivals.includes(e.id);
    }
  }).map((a) => a.id);
}

/** Just the ones growth alone unlocks. */
export const unlocked = (stage: number) => earnedAccessories({ stage, bestStreak: 0, winStreak: 0, songs: 0, winter: false, festivals: [] });

/** December to February count as winter (a "YYYY-MM-DD" date). */
export const isWinter = (date: string) => ["12", "01", "02"].includes(date.slice(5, 7));

/** The most wins in a row, oldest result first: a loss starts again, a draw doesn't break it. */
export function bestWinStreak(outcomes: string[]) {
  let run = 0;
  let best = 0;
  for (const o of outcomes) {
    if (o === "win") best = Math.max(best, ++run);
    else if (o === "loss") run = 0;
  }
  return best;
}

/** Which accessory a request means ("wear the garland", "sunglasses", "remove it" = none). */
export function accessoryFor(said: string): AccessoryId | "none" | null {
  const t = said.toLowerCase();
  if (/\b(none|nothing|remove|take (it )?off|no accessor)/.test(t)) return "none";
  if (/bow|ribbon/.test(t)) return "bow";
  if (/garland|malli|flower|poo\b|maalai/.test(t)) return "garland";
  if (/shade|sunglass|glasses|cooling/.test(t)) return "shades";
  if (/\bcrown\b|\bking\b|\braja\b/.test(t) && !/mango|diya|leaf/.test(t)) return "crown";
  if (/headphone|earphone|headset/.test(t)) return "headphones";
  if (/scarf|muffler/.test(t)) return "scarf";
  if (/\bcap\b|topi/.test(t)) return "cap";
  if (/santa/.test(t)) return "hat-christmas";
  if (/party hat/.test(t)) return "hat-newyear";
  if (/mango|leaf crown|thoran/.test(t)) return "hat-puthandu";
  if (/diya crown|diya hat/.test(t)) return "hat-deepavali";
  if (/lamp hat/.test(t)) return "hat-karthigai";
  if (/pongal (pot )?hat|pot hat/.test(t)) return "hat-pongal";
  if (/tricolou?r|\bband\b|flag hat/.test(t)) return "hat-india";
  return null;
}
