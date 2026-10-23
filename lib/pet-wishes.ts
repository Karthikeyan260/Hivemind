import { hash01 } from "@/lib/garden-layout";

/**
 * Nova's wish of the day: each day it asks for one small thing, picked from what is possible that day
 * and the same all day. Doing it makes Nova glow and gives a little growth. Pure (the pet fills in
 * what the owner did today), so it can be tested.
 */
export type WishFacts = {
  habitsDue: number;
  habitsDone: number;
  songs: number;
  wins: number;
  walks: number;
  checkin: boolean;
  fireflies: boolean;
};
export type Wish = { id: WishId; icon: string; text: string; done: boolean };
export type WishId = "habits" | "song" | "win" | "walk" | "checkin" | "fireflies";

const WISHES: { id: WishId; icon: string; text: string; possible: (f: WishFacts) => boolean; done: (f: WishFacts) => boolean }[] = [
  { id: "habits", icon: "🍚", text: "Innaiku ellaa habits-um mudikkanum!", possible: (f) => f.habitsDue > 0, done: (f) => f.habitsDue > 0 && f.habitsDone >= f.habitsDue },
  { id: "song", icon: "🎵", text: "Enakku oru paattu podunga!", possible: () => true, done: (f) => f.songs >= 1 },
  { id: "win", icon: "🏆", text: "Oru game jeyichu kaattunga!", possible: () => true, done: (f) => f.wins >= 1 },
  { id: "walk", icon: "🏮", text: "Enna lantern walk kootitu ponga!", possible: () => true, done: (f) => f.walks >= 1 },
  { id: "checkin", icon: "🌙", text: "Raathiri check-in pannunga, naan kaathirukken!", possible: () => true, done: (f) => f.checkin },
  { id: "fireflies", icon: "✨", text: "Konjam fireflies pidichu tharunga!", possible: () => true, done: (f) => f.fireflies },
];

/** Growth points for a day's wish done. */
export const WISH_XP = 8;

/**
 * Today's wish (the same all day for the same date) and whether it is done. A wish that can't be done
 * today (habits with none due) is never picked.
 */
export function wishFor(date: string, f: WishFacts): Wish {
  const open = WISHES.filter((w) => w.possible(f));
  const w = open.reduce((best, x) => (hash01(`${date}${x.id}`) < hash01(`${date}${best.id}`) ? x : best));
  return { id: w.id, icon: w.icon, text: w.text, done: w.done(f) };
}
