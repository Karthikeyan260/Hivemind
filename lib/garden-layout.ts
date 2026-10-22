/**
 * Nova's garden: what grows on the island (pure, shared by the server and the page) and where each
 * thing stands. Positions come from each item's own key, so the garden looks the same every visit
 * and only grows: nothing jumps around when something new is planted.
 */
export type GardenItem =
  | { kind: "flower"; id: string; date: string; label: string; hue: number }
  | { kind: "tree"; id: string; size: number; label: string }
  | { kind: "lamp"; id: string; date: string; label: string }
  | { kind: "gem"; id: string; date: string; label: string; hue: number }
  /** A habit growing: a seed, a sprout, a sapling, and (after 21 days in a row) a tree that stays. */
  | { kind: "plant"; id: string; label: string; hue: number; stage: PlantStage; streak: number };

/** 0 seed, 1 sprout (a week in a row), 2 sapling (two weeks), 3 tree (21 days in a row, kept for good). */
export type PlantStage = 0 | 1 | 2 | 3;
export const SPROUT_AT = 7;
export const SAPLING_AT = 14;
export const TREE_AT = 21;
/** How far a habit has grown, from its running streak and its best streak ever: a tree once it has had 21 days in a row, whatever happened since. */
export function plantStage(streak: number, best: number): PlantStage {
  if (best >= TREE_AT) return 3;
  return streak >= SAPLING_AT ? 2 : streak >= SPROUT_AT ? 1 : 0;
}
/** What tapping a plant says. */
export function plantLabel(name: string, emoji: string, stage: PlantStage, streak: number, best: number): string {
  const e = emoji || "🌱";
  if (stage === 3) return `🌳 ${e} ${name} grew into a tree: ${best} days in a row${streak > 0 && streak < best ? ` (running: ${streak})` : ""}`;
  const names = ["a seed", "a sprout", "a sapling"] as const;
  const next = stage === 0 ? SPROUT_AT : stage === 1 ? SAPLING_AT : TREE_AT;
  const left = next - streak;
  return `🌱 ${e} ${name} is ${names[stage]}: ${streak} day${streak === 1 ? "" : "s"} in a row, ${left} more to ${stage === 2 ? "become a tree" : stage === 1 ? "a sapling" : "sprout"}`;
}

export type Garden = {
  items: GardenItem[];
  butterflies: number;
  /** The best current habit streak, in days (0 = none running): the more days, the bigger the swarm of fireflies. */
  streak: number;
  /** How the last night check-in went (1 rough to 5 great), if it was last night or tonight; null otherwise. Tints the island's light. */
  mood: 1 | 2 | 3 | 4 | 5 | null;
  /** Rare visitors earned by milestones: an owl for a long streak, a deer for many game wins. */
  visitors: Visitor[];
  counts: { flowers: number; trees: number; lamps: number; gems: number; butterflies: number; music?: number; /** Habits still growing (seed, sprout, sapling) and habits that became trees. */ seeds?: number; grown?: number };
  /** Name of the pet living there. */
  pet: string;
  stage: number;
};

/** A rare visitor to the island, earned by a milestone (tap it to see why it came). */
export type Visitor = { kind: "owl" | "deer"; label: string };
/** Days of streak that bring the owl, and game wins that bring the deer. */
export const OWL_STREAK = 7;
export const DEER_WINS = 10;
/** The visitors a streak and a count of wins have earned. */
export function visitorsFor(streak: number, wins: number): Visitor[] {
  const out: Visitor[] = [];
  if (streak >= OWL_STREAK) out.push({ kind: "owl", label: `🦉 A night owl came to roost: you kept a ${streak}-day streak` });
  if (wins >= DEER_WINS) out.push({ kind: "deer", label: `🦌 A deer wandered in: ${wins} games won` });
  return out;
}

/** The island's season: it changes the grass, the leaves and what drifts through the air. */
export type Season = "spring" | "summer" | "autumn" | "winter";
export const SEASONS: Season[] = ["spring", "summer", "autumn", "winter"];
/** The season for a month (0 = January): spring March to May, summer June to August, autumn September to November, winter December to February. */
export const seasonOf = (month: number): Season => (month >= 2 && month <= 4 ? "spring" : month >= 5 && month <= 7 ? "summer" : month >= 8 && month <= 10 ? "autumn" : "winter");
/** The season a "YYYY-MM" month falls in. */
export const seasonOfMonth = (month: string): Season => seasonOf(Number(month.slice(5, 7)) - 1);
/** How each season looks in the garden, for the Wrapped garden card. */
export const SEASON_LOOK: Record<Season, { icon: string; name: string; line: string; fall: string }> = {
  spring: { icon: "🌸", name: "Spring", line: "Blossom time on the island", fall: "🌸" },
  summer: { icon: "☀️", name: "Summer", line: "Long warm days in the garden", fall: "✨" },
  autumn: { icon: "🍂", name: "Autumn", line: "Leaves drifting over the grass", fall: "🍂" },
  winter: { icon: "❄️", name: "Winter", line: "A frosty glow on the island", fall: "❄️" },
};
/** What a month grew in the garden, from the month's own numbers: a flower per habit day, a tree for the night check-ins, a gem per game won, and the songs that brought the butterflies. */
export function gardenGrew(m: { habits: { done: number }[]; moods: { count: number }; games: { won: number }; music: { plays: number } }) {
  return { flowers: m.habits.reduce((n, h) => n + h.done, 0), trees: m.moods.count, gems: m.games.won, songs: m.music.plays };
}
/** How many streak fireflies a streak earns (4 a day, up to 48). */
export const fireflyCount = (streak: number) => Math.max(0, Math.min(48, Math.round(streak * 4)));

/** A stable number 0..1 from a string (FNV-1a). */
export function hash01(s: string, salt = 0) {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

/** A habit's own flower colour, the same every time. */
export const hueOf = (key: string) => Math.round(hash01(key, 7) * 360);

/** The island's size: it widens as more grows on it (viewBox units, centre x 500). */
export function islandSize(n: number) {
  const rx = Math.min(430, 190 + Math.sqrt(n) * 22);
  // A bigger island floats a little higher, so its rocky underside still fits in the 640-high frame.
  const cy = 400 - Math.max(0, rx - 250) * 0.5;
  return { cx: 500, cy, rx, ry: rx * 0.3, depth: Math.min(rx * 0.78, 630 - cy) };
}

export type Placed = GardenItem & { x: number; y: number };

/** The pet's cottage (its door), at the back of the island's middle. */
export function homeSpot(n: number) {
  const { cx, cy, ry } = islandSize(n);
  return { x: cx, y: Math.round(cy - ry * 0.42) };
}

/** The stepping-stone path from the cottage door down to the island's front edge: x at a given y. */
export function pathX(n: number, y: number) {
  const { cx } = islandSize(n);
  const home = homeSpot(n);
  return cx + Math.sin((y - home.y) / 38) * 14;
}

/** Direction (radians, on the island's top) of the pond and the waterfall that spills from it. */
export const POND_ANGLE = 0.5;

/** The little pond near the right front edge; its stream runs out to the rim and over as the waterfall. */
export function pondSpot(n: number) {
  const { cx, cy, rx, ry } = islandSize(n);
  return { x: cx + Math.cos(POND_ANGLE) * 0.66 * rx, y: cy + Math.sin(POND_ANGLE) * 0.66 * ry, rx: 0.14 * rx, ry: 0.14 * ry };
}

/** Spots kept free: the cottage, its path, the pond and its stream, and the pet's yard in the middle. */
function blocked(n: number, x: number, y: number) {
  const { cx, cy, rx, ry } = islandSize(n);
  const home = homeSpot(n);
  if (((x - home.x) / 78) ** 2 + ((y - home.y + 8) / 30) ** 2 < 1) return true;
  if (y > home.y && Math.abs(x - pathX(n, y)) < 17) return true;
  const pond = pondSpot(n);
  if (((x - pond.x) / (pond.rx * 1.25)) ** 2 + ((y - pond.y) / (pond.ry * 1.25)) ** 2 < 1) return true;
  const u = (x - cx) / rx;
  const v = (y - cy) / ry;
  if (Math.hypot(u, v) > 0.7 && Math.abs(Math.atan2(v, u) - POND_ANGLE) < 0.08) return true;
  return Math.hypot((x - cx) / rx, (y - cy) / ry) < 0.22;
}

/**
 * Where each item stands on the island's top. Each habit's flowers grow together in their own bed
 * around the island; lantern-walk lamps line the path to the pet's cottage; trees stand towards the
 * back; gems lie about wherever there's room. The cottage, path and the middle stay free.
 */
export function layout(items: GardenItem[]): Placed[] {
  const n = items.length;
  const { cx, cy, rx, ry } = islandSize(n);
  const home = homeSpot(n);
  const placed: Placed[] = [];
  const inside = (x: number, y: number) => Math.hypot((x - cx) / rx, (y - cy) / ry) <= 0.94;
  // Flower beds: one per habit, spread evenly round the island (skipping the cottage at the back).
  const habit = (it: GardenItem) => it.id.split(":")[1] ?? "";
  const habits = [...new Set(items.filter((i) => i.kind === "flower" || i.kind === "plant").map(habit))].sort();
  const perHabit = new Map(habits.map((h) => [h, items.filter((i) => i.kind === "flower" && habit(i) === h).length]));
  const bed = new Map(
    habits.map((h, i) => {
      const a = -Math.PI / 2 + 0.75 + ((i + 0.5) / habits.length) * (Math.PI * 2 - 1.5);
      const r = habits.length === 1 ? 0.55 : 0.6;
      return [h, { x: cx + Math.cos(a) * r * rx, y: cy + Math.sin(a) * r * ry, r: 34 + Math.sqrt(perHabit.get(h) ?? 1) * 10 }];
    }),
  );
  // Trees first (they need the most room), then lamps, gems, flowers.
  const order = { tree: 0, plant: 1, lamp: 2, gem: 3, flower: 4 } as const;
  const sorted = [...items].sort((a, b) => order[a.kind] - order[b.kind] || a.id.localeCompare(b.id));
  let lampNo = 0;
  const pathLen = cy + ry * 0.9 - (home.y + 26);
  // Each flower's place in its bed: the oldest first, so a new flower never moves an old one.
  const rank = new Map<string, number>();
  for (const h of habits) items.filter((i) => i.kind === "flower" && habit(i) === h).map((i) => i.id).sort().forEach((id, k) => rank.set(id, k));
  const gemRank = new Map<string, number>();
  items.filter((i) => i.kind === "gem").map((i) => i.id).sort().forEach((id, k) => gemRank.set(id, k));
  for (const it of sorted) {
    // Gems lie in even rings near the rim (36 to a ring), the oldest first, so the next one never moves an old one.
    if (it.kind === "gem") {
      const k = gemRank.get(it.id) ?? 0;
      const ring = Math.floor(k / 36);
      const a = -Math.PI / 2 + 0.2 + ((k % 36) / 36) * (Math.PI * 2 - 0.4) + ring * 0.09;
      const r = 0.9 - ring * 0.1;
      const x = Math.round(cx + Math.cos(a) * r * rx);
      const y = Math.round(cy + Math.sin(a) * r * ry);
      if (inside(x, y) && !blocked(n, x, y)) {
        placed.push({ ...it, x, y });
        continue;
      }
    }
    if (it.kind === "lamp") {
      // The first lamps light the cottage path, in pairs down to the edge.
      if (lampNo < 10) {
        const i = lampNo++;
        const y = Math.round(home.y + 26 + ((Math.floor(i / 2) + 0.5) / 5) * pathLen);
        placed.push({ ...it, x: Math.round(pathX(n, y) + (i % 2 ? 26 : -26)), y });
        continue;
      }
      // The next ones stand evenly spaced round the rim (14 more at most), not scattered everywhere.
      const e = lampNo++ - 10;
      if (e >= 14) continue;
      const a = -Math.PI / 2 + 0.3 + (e / 14) * (Math.PI * 2 - 0.6);
      for (const r of [0.84, 0.76, 0.68]) {
        const x = Math.round(cx + Math.cos(a) * r * rx);
        const y = Math.round(cy + Math.sin(a) * r * ry);
        if (inside(x, y) && !blocked(n, x, y)) {
          placed.push({ ...it, x, y });
          break;
        }
      }
      continue;
    }
    // A habit's plant stands just inside its bed, towards the middle of the island, clear of the flowers.
    if (it.kind === "plant") {
      const pb = bed.get(habit(it));
      if (pb) {
        const x = Math.round(pb.x + (cx - pb.x) * 0.3);
        const y = Math.round(pb.y + (cy - pb.y) * 0.3);
        if (inside(x, y) && !blocked(n, x, y) && placed.every((p) => Math.hypot(p.x - x, (p.y - y) * 2.2) > 24)) {
          placed.push({ ...it, x, y });
          continue;
        }
      }
    }
    const gap = it.kind === "tree" ? 70 : it.kind === "plant" ? 40 : it.kind === "gem" ? 26 : 13;
    let best: { x: number; y: number; d: number } | null = null;
    const b = it.kind === "flower" ? bed.get(habit(it)) : undefined;
    // 16 tries where it belongs; if those all miss (a crowded bed), anywhere free on the island.
    // Flowers grow in a neat spiral from the middle of their bed (a sunflower's pattern), evenly spaced.
    if (it.kind === "flower" && b) {
      const k = rank.get(it.id) ?? 0;
      const a = k * 2.399963;
      const r = 8 * Math.sqrt(k + 0.5);
      const x = Math.round(b.x + Math.cos(a) * r);
      const y = Math.round(b.y + Math.sin(a) * r * 0.42);
      if (inside(x, y) && !blocked(n, x, y)) {
        placed.push({ ...it, x, y });
        continue;
      }
    }
    for (let t = 0; t < 60 && !(best && t >= 16); t++) {
      let x: number;
      let y: number;
      if (b && t < 16) {
        // Somewhere in its habit's bed.
        const a = hash01(it.id, t * 31 + 1) * Math.PI * 2;
        const r = Math.sqrt(hash01(it.id, t * 31 + 2)) * b.r;
        x = b.x + Math.cos(a) * r;
        y = b.y + Math.sin(a) * r * 0.42;
      } else {
        // Angle and distance from the item's key; trees prefer the back half (smaller y).
        const a = hash01(it.id, t * 31 + 1) * Math.PI * 2;
        const r = 0.3 + 0.62 * Math.sqrt(hash01(it.id, t * 31 + 2));
        x = cx + Math.cos(a) * r * rx * 0.94;
        y = cy + Math.sin(a) * r * ry * 0.86;
        if (it.kind === "tree") y = cy - Math.abs(y - cy);
      }
      if (!inside(x, y) || blocked(n, x, y)) continue;
      x = Math.round(x);
      y = Math.round(y);
      const d = Math.min(Infinity, ...placed.map((p) => Math.hypot(p.x - x, (p.y - y) * 2.2)));
      if (!best || d > best.d) best = { x, y, d };
      if (d >= gap) break;
    }
    if (best) placed.push({ ...it, x: best.x, y: best.y });
  }
  // Drawn back to front.
  return placed.sort((a, b) => a.y - b.y);
}
