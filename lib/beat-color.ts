/**
 * The colour of the music lights: a named colour, any hex colour, "rainbow" (cycles through every
 * colour) or "auto" (the colour of the song's cover). Pure: shared by the lights, the chat tool and tests.
 */
export type BeatColor = string; // "gold" | "blue" | … | "#ff00aa" | "rainbow" | "auto"

export const DEFAULT_COLOR = "gold";

/** Named colours (English and Tamil words) → RGB. */
export const PALETTE: Record<string, [number, number, number]> = {
  gold: [255, 180, 70],
  orange: [255, 130, 40],
  red: [255, 70, 80],
  pink: [255, 105, 190],
  purple: [170, 110, 255],
  blue: [80, 150, 255],
  cyan: [60, 220, 240],
  green: [70, 230, 120],
  yellow: [255, 225, 70],
  white: [235, 240, 255],
};
/** The swatches shown in the picker, in order. */
export const SWATCHES = ["gold", "orange", "red", "pink", "purple", "blue", "cyan", "green", "white", "rainbow", "auto"];

const WORDS: [RegExp, string][] = [
  [/rainbow|multi ?colou?r|all colou?rs|vaanavil/i, "rainbow"],
  [/\bauto\b|album|cover|song'?s colou?r|default/i, "auto"],
  [/gold|golden|thangam|amber/i, "gold"],
  [/orange|kamala|saffron/i, "orange"],
  [/\bred\b|sivappu|chivappu|crimson/i, "red"],
  [/pink|rose|magenta/i, "pink"],
  [/purple|violet|lavender|oodha/i, "purple"],
  [/blue|neelam|neela|navy/i, "blue"],
  [/cyan|teal|aqua|turquoise/i, "cyan"],
  [/green|pachai|pacha|mint/i, "green"],
  [/yellow|manjal/i, "yellow"],
  [/white|vellai|silver/i, "white"],
];

/** "make the music lights blue" → "blue"; "#ff00aa" → "#ff00aa"; nothing recognisable → null. */
export function colorFromWords(said: string): BeatColor | null {
  const hex = said.match(/#([0-9a-f]{6}|[0-9a-f]{3})\b/i);
  if (hex) return normalizeHex(hex[0]);
  return WORDS.find(([re]) => re.test(said))?.[1] ?? null;
}

function normalizeHex(h: string) {
  const x = h.replace("#", "").toLowerCase();
  return "#" + (x.length === 3 ? [...x].map((c) => c + c).join("") : x);
}

/** RGB for a colour setting (rainbow and auto are resolved by the lights themselves; gold for unknowns). */
export function rgbOf(c: BeatColor): [number, number, number] {
  if (PALETTE[c]) return PALETTE[c];
  const m = /^#([0-9a-f]{6})$/i.exec(c);
  if (m) {
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  return PALETTE.gold;
}

/** A hue (0-360, saturated) as RGB, for the rainbow. */
export function hueRgb(h: number): [number, number, number] {
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return Math.round(255 * (0.55 + 0.45 * -Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return [f(0), f(8), f(4)];
}

/**
 * The cover's most colourful tone: average of the vivid pixels (dull greys and near-black/white
 * ignored), brightened so it glows. Input: RGBA pixel data of a small thumbnail.
 */
export function vividOf(px: Uint8ClampedArray): [number, number, number] | null {
  let r = 0, g = 0, b = 0, w = 0;
  for (let i = 0; i < px.length; i += 4) {
    const [R, G, B] = [px[i], px[i + 1], px[i + 2]];
    const max = Math.max(R, G, B), min = Math.min(R, G, B);
    const sat = max ? (max - min) / max : 0;
    if (max < 50 || sat < 0.35) continue;
    const weight = sat * sat * max;
    r += R * weight;
    g += G * weight;
    b += B * weight;
    w += weight;
  }
  if (!w) return null;
  const c = [r / w, g / w, b / w];
  const top = Math.max(...c);
  const k = top ? 255 / top : 1;
  return c.map((v) => Math.round(Math.min(255, v * k))) as [number, number, number];
}
