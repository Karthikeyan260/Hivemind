import type { Body } from "@/lib/astro";

/**
 * What you see "through the telescope": a round field of stars with the chosen Moon or planet in the middle, drawn with
 * its real phase (how much of it is lit, and on which side) and, for Saturn, its real ring tilt. An artist's
 * impression, not a photograph: the markings on the Moon and Jupiter are drawn by hand.
 */
const TAU = Math.PI * 2;

const rng = (seed: number) => {
  let a = seed | 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/**
 * Darkens the unlit part of a disc of radius R at (0,0): `lit` is the lit fraction (0 to 1), and `waxing` puts the lit
 * side on the right (a growing moon, in the northern sky). The terminator is half an ellipse.
 */
function shade(ctx: CanvasRenderingContext2D, R: number, lit: number, waxing: boolean, alpha: number) {
  if (lit >= 0.995) return;
  const side = waxing ? 1 : -1;
  const xT = side * R * (1 - 2 * lit); // where the terminator crosses the middle: +R at new, 0 at quarter, -R at full (lit side's sign)
  ctx.save();
  ctx.fillStyle = `rgba(3,5,14,${alpha})`;
  ctx.beginPath();
  // The dark limb: a half circle on the side away from the light.
  if (side > 0) ctx.arc(0, 0, R, -Math.PI / 2, Math.PI / 2, true);
  else ctx.arc(0, 0, R, -Math.PI / 2, Math.PI / 2, false);
  // Back along the terminator (half an ellipse as wide as |xT|).
  const w = Math.max(0.0001, Math.abs(xT) / R);
  ctx.save();
  ctx.scale(w, 1);
  const towardsRight = xT > 0;
  ctx.arc(0, 0, R, Math.PI / 2, -Math.PI / 2, towardsRight);
  ctx.restore();
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function moon(ctx: CanvasRenderingContext2D, R: number, b: Body) {
  const g = ctx.createRadialGradient(-R * 0.25, -R * 0.25, R * 0.1, 0, 0, R);
  g.addColorStop(0, "#f1eee2");
  g.addColorStop(0.7, "#d9d4c4");
  g.addColorStop(1, "#a9a392");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, R, 0, TAU);
  ctx.fill();
  ctx.save();
  ctx.clip();
  // The dark seas, roughly where they are on the near side.
  ctx.fillStyle = "rgba(92,94,104,0.42)";
  const seas: [number, number, number, number][] = [
    [-0.28, -0.3, 0.24, 0.2], // Imbrium
    [0.12, -0.3, 0.14, 0.12], // Serenitatis
    [0.3, -0.08, 0.16, 0.13], // Tranquillitatis
    [0.58, -0.2, 0.08, 0.06], // Crisium
    [-0.2, 0.38, 0.15, 0.12], // Nubium
    [-0.58, 0.02, 0.2, 0.3], // Oceanus Procellarum
    [0.2, 0.15, 0.1, 0.08], // Fecunditatis
  ];
  for (const [x, y, rx, ry] of seas) {
    ctx.beginPath();
    ctx.ellipse(x * R, y * R, rx * R, ry * R, 0.3, 0, TAU);
    ctx.fill();
  }
  // Craters with bright rims.
  const r = rng(7);
  for (let i = 0; i < 26; i++) {
    const a = r() * TAU;
    const d = Math.sqrt(r()) * 0.92 * R;
    const cr = (0.012 + r() * 0.04) * R;
    ctx.strokeStyle = "rgba(255,255,255,0.28)";
    ctx.lineWidth = Math.max(0.6, R * 0.006);
    ctx.fillStyle = "rgba(70,70,78,0.28)";
    ctx.beginPath();
    ctx.arc(Math.cos(a) * d, Math.sin(a) * d, cr, 0, TAU);
    ctx.fill();
    ctx.stroke();
  }
  // Tycho's bright rays near the south.
  ctx.strokeStyle = "rgba(255,255,255,0.12)";
  ctx.lineWidth = R * 0.01;
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * TAU;
    ctx.beginPath();
    ctx.moveTo(-0.15 * R, 0.62 * R);
    ctx.lineTo(-0.15 * R + Math.cos(a) * 0.4 * R, 0.62 * R + Math.sin(a) * 0.4 * R);
    ctx.stroke();
  }
  // Limb darkening.
  const lg = ctx.createRadialGradient(0, 0, R * 0.7, 0, 0, R);
  lg.addColorStop(0, "rgba(0,0,0,0)");
  lg.addColorStop(1, "rgba(0,0,0,0.35)");
  ctx.fillStyle = lg;
  ctx.fillRect(-R, -R, R * 2, R * 2);
  shade(ctx, R, b.illum, b.waxing, 0.93);
  ctx.restore();
}

function jupiter(ctx: CanvasRenderingContext2D, R: number, b: Body) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(0, 0, R, 0, TAU);
  ctx.clip();
  const bands = ["#e9d9b8", "#c79a6c", "#efe2c4", "#b57f52", "#e6cfa6", "#a86f48", "#e8d6b2", "#c9a074", "#eadcc0"];
  const h = (R * 2) / bands.length;
  bands.forEach((c, i) => {
    ctx.fillStyle = c;
    ctx.fillRect(-R, -R + i * h, R * 2, h + 1);
    // Soft wavy edges.
    ctx.fillStyle = "rgba(255,255,255,0.07)";
    ctx.fillRect(-R, -R + i * h + h * 0.4, R * 2, h * 0.2);
  });
  // The Great Red Spot.
  ctx.fillStyle = "rgba(176,82,52,0.8)";
  ctx.beginPath();
  ctx.ellipse(R * 0.28, R * 0.3, R * 0.17, R * 0.095, 0, 0, TAU);
  ctx.fill();
  const lg = ctx.createRadialGradient(-R * 0.2, -R * 0.2, R * 0.2, 0, 0, R);
  lg.addColorStop(0, "rgba(255,255,255,0.1)");
  lg.addColorStop(1, "rgba(0,0,0,0.55)");
  ctx.fillStyle = lg;
  ctx.fillRect(-R, -R, R * 2, R * 2);
  shade(ctx, R, b.illum, b.waxing, 0.8);
  ctx.restore();
  // Squashed a little at the poles, as it really is: drawn as an outline.
  ctx.strokeStyle = "rgba(255,240,210,0.15)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(0, 0, R, 0, TAU);
  ctx.stroke();
}

function saturn(ctx: CanvasRenderingContext2D, R: number, b: Body) {
  const tilt = (b.ringTilt ?? 8) * (Math.PI / 180);
  const open = Math.max(0.045, Math.abs(Math.sin(tilt)));
  const outer = R * 2.25;
  const inner = R * 1.35;
  const ring = (front: boolean) => {
    ctx.save();
    ctx.rotate(-0.38);
    // The rings are drawn in halves: the far half behind the planet, the near half in front.
    ctx.beginPath();
    ctx.rect(-outer * 1.2, front ? 0 : -outer * 1.2, outer * 2.4, outer * 1.2);
    ctx.clip();
    for (const [rad, col, w] of [
      [outer, "rgba(190,170,130,0.55)", 0.1],
      [outer * 0.93, "rgba(226,206,160,0.8)", 0.14],
      [outer * 0.8, "rgba(235,218,176,0.9)", 0.16],
      [inner * 1.05, "rgba(150,132,100,0.35)", 0.06],
    ] as [number, string, number][]) {
      ctx.strokeStyle = col;
      ctx.lineWidth = outer * w;
      ctx.beginPath();
      ctx.ellipse(0, 0, rad - (outer * w) / 2, (rad - (outer * w) / 2) * open, 0, 0, TAU);
      ctx.stroke();
    }
    ctx.restore();
  };
  ring(false);
  ctx.save();
  ctx.beginPath();
  ctx.arc(0, 0, R, 0, TAU);
  ctx.clip();
  const g = ctx.createLinearGradient(0, -R, 0, R);
  g.addColorStop(0, "#dccaa0");
  g.addColorStop(0.35, "#e8d8b0");
  g.addColorStop(0.55, "#cdb58a");
  g.addColorStop(1, "#b49c74");
  ctx.fillStyle = g;
  ctx.fillRect(-R, -R, R * 2, R * 2);
  const lg = ctx.createRadialGradient(-R * 0.25, -R * 0.25, R * 0.2, 0, 0, R);
  lg.addColorStop(0, "rgba(255,255,255,0.12)");
  lg.addColorStop(1, "rgba(0,0,0,0.5)");
  ctx.fillStyle = lg;
  ctx.fillRect(-R, -R, R * 2, R * 2);
  ctx.restore();
  ring(true);
}

/** A plain world with a phase: Venus (creamy cloud), Mars (rusty, a pale cap), Mercury (grey). */
function rock(ctx: CanvasRenderingContext2D, R: number, b: Body) {
  const tint = b.id === "venus" ? ["#fff6da", "#e9d9a8", "#b9a574"] : b.id === "mars" ? ["#f0a574", "#c4633a", "#7e3a22"] : ["#d8d4cc", "#a29d94", "#6b665f"];
  const g = ctx.createRadialGradient(-R * 0.3, -R * 0.3, R * 0.1, 0, 0, R);
  g.addColorStop(0, tint[0]);
  g.addColorStop(0.65, tint[1]);
  g.addColorStop(1, tint[2]);
  ctx.save();
  ctx.beginPath();
  ctx.arc(0, 0, R, 0, TAU);
  ctx.clip();
  ctx.fillStyle = g;
  ctx.fillRect(-R, -R, R * 2, R * 2);
  if (b.id === "mars") {
    ctx.fillStyle = "rgba(90,40,30,0.4)";
    ctx.beginPath();
    ctx.ellipse(-R * 0.1, R * 0.1, R * 0.4, R * 0.22, 0.3, 0, TAU);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.8)";
    ctx.beginPath();
    ctx.ellipse(0, -R * 0.92, R * 0.3, R * 0.16, 0, 0, TAU);
    ctx.fill();
  }
  if (b.id === "venus") {
    ctx.strokeStyle = "rgba(255,255,255,0.25)";
    ctx.lineWidth = R * 0.05;
    for (let i = 0; i < 4; i++) {
      ctx.beginPath();
      ctx.arc(0, -R * 0.4 + i * R * 0.3, R * 0.9, 0.4, 2.7);
      ctx.stroke();
    }
  }
  shade(ctx, R, b.illum, b.waxing, 0.92);
  ctx.restore();
}

/** Draws the eyepiece view into a square canvas context of `size` pixels. */
export function drawEyepiece(ctx: CanvasRenderingContext2D, size: number, b: Body) {
  const c = size / 2;
  ctx.save();
  ctx.clearRect(0, 0, size, size);
  // The round field of view.
  ctx.beginPath();
  ctx.arc(c, c, c - 4, 0, TAU);
  ctx.clip();
  const bg = ctx.createRadialGradient(c, c, c * 0.1, c, c, c);
  bg.addColorStop(0, "#0a1024");
  bg.addColorStop(1, "#020309");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, size, size);
  // Stars (the same ones for the same body).
  const r = rng(b.id.length * 977 + b.id.charCodeAt(0));
  for (let i = 0; i < 110; i++) {
    const x = r() * size;
    const y = r() * size;
    const m = r();
    ctx.fillStyle = `rgba(255,255,255,${0.25 + m * 0.7})`;
    ctx.beginPath();
    ctx.arc(x, y, 0.4 + m * m * 1.5, 0, TAU);
    ctx.fill();
  }
  // The body, drawn in the middle, at a size that suits it.
  const R = size * (b.id === "moon" ? 0.37 : b.id === "jupiter" ? 0.26 : b.id === "saturn" ? 0.15 : b.id === "venus" ? 0.22 : b.id === "mars" ? 0.13 : 0.1);
  // A soft glow round it.
  const glow = ctx.createRadialGradient(c, c, R * 0.9, c, c, R * 2.2);
  glow.addColorStop(0, b.id === "moon" ? "rgba(255,250,230,0.16)" : "rgba(255,240,210,0.1)");
  glow.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, size, size);
  ctx.save();
  ctx.translate(c, c);
  if (b.id === "moon") moon(ctx, R, b);
  else if (b.id === "jupiter") jupiter(ctx, R, b);
  else if (b.id === "saturn") saturn(ctx, R, b);
  else rock(ctx, R, b);
  ctx.restore();
  // The edge of the lens: a dark vignette and a fine cross-hair tick marks.
  const v = ctx.createRadialGradient(c, c, c * 0.72, c, c, c);
  v.addColorStop(0, "rgba(0,0,0,0)");
  v.addColorStop(1, "rgba(0,0,0,0.75)");
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, size, size);
  ctx.restore();
  ctx.strokeStyle = "rgba(199,154,69,0.9)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(c, c, c - 3, 0, TAU);
  ctx.stroke();
}
