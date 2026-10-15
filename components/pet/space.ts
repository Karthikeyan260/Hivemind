"use client";

import { between, pick, reserve, SIZE, type Pos, type Spot } from "./shared";

/** Finding room on the page: places to hide (hide and seek) and spots that don't cover a control. */
// How a peek is clipped: only the part sticking out from behind the thing it hides behind shows.
export const PEEK_CLIP: Record<Spot["peek"], string> = { top: "inset(0 0 40% 0)", left: "inset(0 50% 0 0)", right: "inset(0 0 0 50%)" };

/** What a page element is called, for guesses like "near the weather card". */
function labelOf(el: Element) {
  const own = el.getAttribute("aria-label") || el.getAttribute("title") || el.querySelector("h1, h2, h3, h4, [class*='uppercase']")?.textContent || (el as HTMLElement).innerText || "";
  return own.replace(/\s+/g, " ").trim().slice(0, 40);
}

/** Somewhere on screen to hide: next to a real card, button or heading, peeking out from its edge. */
export function hidingSpot(self: Element | null): Spot | null {
  const W = window.innerWidth;
  const H = window.innerHeight - reserve();
  const options = [...document.querySelectorAll("section, aside, header, nav, article, form, button, img, h1, h2, h3, [role=region]")]
    .filter((el) => !self?.contains(el) && !el.closest("[data-pet]") && !floating(el))
    .map((el) => ({ el, r: el.getBoundingClientRect(), name: labelOf(el) }))
    .filter(({ r, name }) => name.length >= 3 && r.width >= 70 && r.height >= 28 && r.top > 40 && r.bottom < H && r.left >= 0 && r.right <= W);
  // Try a few: a spot under a floating panel (a toast, the voice dock) could never be found.
  for (let attempt = 0; attempt < 12 && options.length; attempt++) {
    const spot = spotBy(pick(options));
    if (spot && inTheOpen(spot, self)) return spot;
  }
  return null;
}

/** Would the pet, standing here, cover something clickable or typeable? (Checks its middle and corners.) */
export function coversControl(p: Pos, self: Element | null) {
  const points = [
    [0.5, 0.5],
    [0.2, 0.25],
    [0.8, 0.25],
    [0.2, 0.85],
    [0.8, 0.85],
  ];
  return points.some(([fx, fy]) => {
    const hit = document.elementsFromPoint(p.x + SIZE * fx, p.y + SIZE * fy).find((el) => !self?.contains(el) && !el.closest("[data-pet]"));
    return !!hit?.closest("button, a, input, textarea, select, [role=button], [contenteditable=true]");
  });
}

/** Inside something that floats over the page (a toast, the voice dock): it can come and go. */
function floating(hit: Element) {
  const screen = window.innerWidth * window.innerHeight;
  for (let el: Element | null = hit; el; el = el.parentElement) {
    if (getComputedStyle(el).position !== "fixed") continue;
    // A full-screen fixed layout (the home page is one) is the page itself, not something floating over it.
    const r = el.getBoundingClientRect();
    if (r.width * r.height < screen * 0.5) return true;
  }
  return false;
}

/** The part of it that peeks out must not be covered by anything floating (fixed) on the page. */
function inTheOpen(s: Spot, self: Element | null) {
  const vx = s.peek === "left" ? s.x + SIZE * 0.25 : s.peek === "right" ? s.x + SIZE * 0.75 : s.x + SIZE / 2;
  const vy = s.peek === "top" ? s.y + SIZE * 0.3 : s.y + SIZE / 2;
  if (vx < 0 || vy < 0 || vx > window.innerWidth || vy > window.innerHeight) return false;
  return document.elementsFromPoint(vx, vy).filter((el) => !self?.contains(el) && !el.closest("[data-pet]")).slice(0, 1).every((hit) => !floating(hit));
}

function spotBy({ r, name }: { r: DOMRect; name: string }): Spot | null {
  const W = window.innerWidth;
  const H = window.innerHeight - reserve();
  const peek = pick<Spot["peek"]>(["top", "top", "left", "right"]);
  const at =
    peek === "top"
      ? { x: between(r.left, Math.max(r.left, r.right - SIZE)), y: r.top - SIZE * 0.6 }
      : peek === "left"
        ? { x: r.left - SIZE * 0.5, y: between(r.top, Math.max(r.top, r.bottom - SIZE)) }
        : { x: r.right - SIZE * 0.5, y: between(r.top, Math.max(r.top, r.bottom - SIZE)) };
  // Keep the part that peeks out on screen (on a phone a right-edge peek would otherwise end up off it).
  const p = { x: Math.min(W - SIZE - 4, Math.max(4, at.x)), y: Math.min(H - SIZE, Math.max(4, at.y)) };
  const cx = (p.x + SIZE / 2) / W;
  const cy = (p.y + SIZE / 2) / H;
  return { ...p, name, peek, col: cx < 0.36 ? "left" : cx > 0.64 ? "right" : "center", row: cy < 0.36 ? "top" : cy > 0.64 ? "bottom" : "middle" };
}

