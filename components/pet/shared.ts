"use client";

/** What the pet modules share: its looks, size and the screen room it may use. */
export type Look = "happy" | "hungry" | "sulking" | "missed" | "sleepy" | "dancing";
export type Pos = { x: number; y: number };
export type Spot = Pos & { name: string; row: "top" | "middle" | "bottom"; col: "left" | "center" | "right"; peek: "top" | "left" | "right" };

export const GLOW: Record<Look, string> = {
  happy: "#ffd166",
  hungry: "#ffa94d",
  sulking: "#8a96a3",
  missed: "#ff8fab",
  sleepy: "#74c0fc",
  dancing: "#c3fae8",
};
export const SIZE = 88;

export const store = {
  get(k: string) {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k: string, v: string | null) {
    try {
      if (v === null) localStorage.removeItem(k);
      else localStorage.setItem(k, v);
    } catch {}
  },
};

export const hourNow = () => new Date().getHours();
/** Today's local date ("2026-11-07"). */
export const dayNow = () => new Date().toLocaleDateString("en-CA");
export const pick = <T,>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)];
export const between = (a: number, b: number) => a + Math.random() * (b - a);
/** Room left at the bottom for the tab bar and the music bar. */
export const reserve = () => (window.innerWidth < 768 ? 150 : 90);
export const clamp = (p: Pos): Pos => ({
  x: Math.min(window.innerWidth - SIZE - 8, Math.max(8, p.x)),
  y: Math.min(window.innerHeight - SIZE - reserve(), Math.max(8, p.y)),
});
export const home = (): Pos => clamp({ x: window.innerWidth - SIZE - 16, y: window.innerHeight - SIZE - reserve() - 60 });
