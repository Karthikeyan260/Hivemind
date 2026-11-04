import * as THREE from "three";
import { bodyAt, HOME_LATLON, julianDay, lstDeg, sunAltAz, type Body, type BodyId } from "@/lib/astro";
import { MEEUS_EPOCH, moonsOf, type MoonDef } from "./eyepiece";

/**
 * A real night sky over Chennai, rendered in WebGL: the ~5,000 naked-eye stars of the Yale Bright Star catalogue
 * (data via d3-celestial, BSD), the constellation figures, a Milky Way laid along the true galactic plane, and the Moon
 * and planets at the places the astronomy engine puts them. The sky turns with the real sidereal time, so scrubbing
 * time takes you from sunset through the night to dawn. Drag to look round, wheel or pinch to zoom, tap a planet to fly to it.
 */
const RAD = Math.PI / 180;
const R_SKY = 90;
const R_BODY = 80;
const LAT = HOME_LATLON.lat;

// Equatorial (RA, Dec in degrees) to a unit vector with x towards RA 0, z to the celestial pole.
const eq = (ra: number, dec: number, r = 1) => {
  const a = ra * RAD;
  const d = dec * RAD;
  return new THREE.Vector3(Math.cos(d) * Math.cos(a) * r, Math.cos(d) * Math.sin(a) * r, Math.sin(d) * r);
};
/** Direction in the local scene: x east, y up, -z north. */
const hor = (az: number, alt: number, r = 1) => {
  const a = az * RAD;
  const h = alt * RAD;
  return new THREE.Vector3(Math.sin(a) * Math.cos(h) * r, Math.sin(h) * r, -Math.cos(a) * Math.cos(h) * r);
};

const BODY_COLOUR: Record<BodyId, string> = { moon: "#fff6e0", mercury: "#d8d0c4", venus: "#fffaf0", mars: "#ff9a6a", jupiter: "#ffeccb", saturn: "#f3dca4" };
const BODY_LABEL: Record<BodyId, string> = { moon: "Moon", mercury: "Mercury", venus: "Venus", mars: "Mars", jupiter: "Jupiter", saturn: "Saturn" };
const IDS: BodyId[] = ["moon", "mercury", "venus", "mars", "jupiter", "saturn"];

const rng = (seed: number) => {
  let a = seed | 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
const gauss = (r: () => number) => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());

function textSprite(text: string, px: number, colour: string, bold = false, spacing = 0) {
  const cv = document.createElement("canvas");
  cv.width = 256;
  cv.height = 64;
  const c = cv.getContext("2d");
  if (c) {
    c.font = `${bold ? 700 : 500} ${px}px system-ui, "Segoe UI", sans-serif`;
    c.textAlign = "center";
    c.textBaseline = "middle";
    if (spacing) (c as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${spacing}px`;
    c.shadowColor = "rgba(0,0,0,0.9)";
    c.shadowBlur = 6;
    c.fillStyle = colour;
    c.fillText(text, 128, 33);
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthTest: false, depthWrite: false }));
  s.renderOrder = 8;
  return s;
}

function glowTexture() {
  const cv = document.createElement("canvas");
  cv.width = cv.height = 128;
  const c = cv.getContext("2d")!;
  const g = c.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.07, "rgba(255,255,255,0.95)");
  g.addColorStop(0.16, "rgba(255,255,255,0.35)");
  g.addColorStop(0.4, "rgba(255,255,255,0.09)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  c.fillStyle = g;
  c.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const DOME_VERT = `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`;

const SKY_FRAG = `
varying vec3 vP; uniform vec3 uSun; uniform float uSunAlt; uniform float uCity; uniform vec3 uMoon; uniform float uMoonGlow;
void main(){
  vec3 d = normalize(vP); float y = d.y;
  float t = smoothstep(-16.0, 5.0, uSunAlt);
  vec3 zen = mix(vec3(0.003,0.006,0.02), vec3(0.16,0.34,0.70), t);
  vec3 hz = mix(vec3(0.016,0.024,0.05), vec3(0.62,0.74,0.90), t);
  vec3 col = mix(hz, zen, pow(clamp(y,0.0,1.0), 0.45));
  float twi = smoothstep(-15.0, -1.0, uSunAlt) * (1.0 - smoothstep(1.0, 12.0, uSunAlt));
  float toward = pow(max(dot(d, normalize(vec3(uSun.x, 0.0, uSun.z))), 0.0), 4.0);
  col += vec3(1.0,0.42,0.12) * toward * twi * exp(-abs(y) * 3.2) * 0.85;
  col += vec3(0.30,0.12,0.36) * twi * exp(-max(y,0.0) * 3.0) * 0.22;
  col += vec3(0.30,0.14,0.05) * exp(-max(y,0.0) * 10.0) * (1.0 - t) * (0.22 + 0.9 * uCity);
  col += vec3(0.13,0.075,0.05) * uCity * (1.0 - t) * exp(-max(y,0.0) * 2.0) * 0.55;
  float mc = max(dot(d, uMoon), 0.0);
  col += vec3(0.22,0.25,0.34) * uMoonGlow * (pow(mc, 60.0) * 0.8 + pow(mc, 6.0) * 0.14 + 0.03 * (1.0 - t));
  gl_FragColor = vec4(col, 1.0);
}`;

const GROUND_FRAG = `
varying vec3 vP; uniform float uSunAlt;
float hash(float x){ return fract(sin(x*127.1)*43758.5453); }
void main(){
  vec3 d = normalize(vP); float az = atan(d.x, -d.z);
  float h = 0.007 + 0.005*abs(sin(az*3.0+1.0));
  float blk = floor(az*38.0); float bh = hash(blk);
  h += (0.014 + 0.030*hash(blk+3.0)) * step(0.84, bh);
  float tr = floor(az*190.0);
  h += 0.010 * hash(tr) * step(0.35, hash(floor(az*11.0)+9.0));
  if (d.y > h) discard;
  float t = smoothstep(-16.0, 5.0, uSunAlt);
  vec3 col = mix(vec3(0.003,0.004,0.007), vec3(0.03,0.04,0.05), t);
  col += vec3(0.07,0.035,0.012) * smoothstep(h-0.05, h, d.y) * (1.0 - t);
  gl_FragColor = vec4(col, 1.0);
}`;

const STAR_VERT = `
attribute float aMag; attribute vec3 aCol; attribute float aPh;
uniform float uTime; uniform float uPx; uniform float uDay; uniform float uLimit;
varying vec3 vCol; varying float vB; varying float vSp;
void main(){
  vec4 w = modelMatrix * vec4(position, 1.0);
  float y = normalize(w.xyz).y;
  float low = exp(-max(y,0.0) * 8.0);
  float tw = 1.0 + (0.12 + 0.5 * low) * sin(uTime * (5.0 + aPh * 6.0) + aPh * 40.0) * 0.6;
  float ext = 1.0 - 0.72 * exp(-max(y,0.0) * 11.0);
  float seen = 1.0 - smoothstep(uLimit - 0.6, uLimit + 0.5, aMag);
  vB = clamp(0.40 + (6.4 - aMag) * 0.19, 0.05, 1.7) * seen * tw * ext * (1.0 - uDay) * smoothstep(-0.03, 0.0, y);
  vCol = aCol * (1.0 + low * 0.35 * vec3(sin(uTime * 7.0 + aPh * 50.0), sin(uTime * 9.0 + aPh * 90.0 + 1.0), sin(uTime * 11.0 + aPh * 130.0 + 2.0)));
  vSp = (1.0 - smoothstep(-0.5, 2.5, aMag)) * seen;
  gl_PointSize = max(1.15, 1.4 + (6.4 - aMag) * 0.85) * uPx * (1.0 + 4.2 * vSp);
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const STAR_FRAG = `
varying vec3 vCol; varying float vB; varying float vSp;
void main(){
  vec2 q = gl_PointCoord - 0.5;
  float r = length(q) * 2.0 * (1.0 + 4.2 * vSp);
  float a = exp(-r*r*5.0) + exp(-r*r*1.6)*0.22;
  float sp = (exp(-abs(q.x)*70.0) * exp(-abs(q.y)*4.0) + exp(-abs(q.y)*70.0) * exp(-abs(q.x)*4.0)) * vSp * 0.9;
  a += sp;
  if (a < 0.004) discard;
  gl_FragColor = vec4(vCol * a * vB, 1.0);
}`;

const MW_VERT = `
attribute float aS; attribute float aA; uniform float uPx; uniform float uDay; uniform float uMw; varying float vA;
void main(){
  vec4 w = modelMatrix * vec4(position, 1.0);
  float y = normalize(w.xyz).y;
  vA = aA * uMw * (1.0 - uDay) * smoothstep(-0.02, 0.1, y) * (0.35 + 0.65 * smoothstep(0.0, 0.5, y));
  gl_PointSize = aS * uPx;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const MW_FRAG = `
varying float vA; uniform vec3 uTint;
void main(){
  float r = length(gl_PointCoord - 0.5) * 2.0;
  if (r > 1.0) discard;
  float a = exp(-r*r*3.0);
  gl_FragColor = vec4(uTint * a * vA, 1.0);
}`;

/** Distances (light years) of some well-known stars, for "how old is the light you are seeing". */
const STAR_DIST: Record<string, number> = {
  Sirius: 8.6, Canopus: 310, Arcturus: 37, Vega: 25, Capella: 43, Rigel: 860, Procyon: 11.5, Betelgeuse: 550, Altair: 17, Aldebaran: 65, Antares: 550, Spica: 250,
  Pollux: 34, Fomalhaut: 25, Deneb: 2600, Regulus: 79, Achernar: 139, Acrux: 320, Polaris: 430, Shaula: 570, Mimosa: 280, Hadar: 390, "Rigil Kentaurus": 4.4,
  Bellatrix: 250, Alnitak: 1260, Alnilam: 1340, Mintaka: 1200, Saiph: 650, Alpheratz: 97, Mirfak: 590, Dubhe: 123, Alioth: 83, Mizar: 83, Alkaid: 104, Merak: 79,
  Algol: 90, Castor: 51, Elnath: 131, Alhena: 105, Denebola: 36, Alphard: 177, Kochab: 131, Schedar: 228, Caph: 54, Enif: 670, Markab: 133, Scheat: 196, Sadr: 1800,
  Albireo: 430, Rasalhague: 49, Nunki: 228, "Kaus Australis": 143, Sabik: 88, Eltanin: 154, Vindemiatrix: 110, Thuban: 300, Algieba: 130, Mira: 300, Menkar: 250,
  Hamal: 66, Diphda: 96, Navi: 600, Ruchbah: 99, Mirach: 197, Almach: 355, Alnair: 101, Peacock: 179, Atria: 415, Gacrux: 88, Miaplacidus: 113, Avior: 630,
};

export type SkyObject = {
  kind: "star" | "dso";
  name: string;
  /** One line about what it is. */
  sub: string;
  con: string;
  mag: number | null;
  /** Light years, when known. */
  dist: number | null;
  az: number;
  alt: number;
  /** B-V colour index (stars). */
  bv?: number;
};
type SkyInfo = {
  con: Record<string, string>;
  conLabels: Array<[string, number, number]>;
  info: Array<[number, string, string, string, string]>;
  dsos: Array<{ id: string; name: string; type: string; kind: string; ra: number; dec: number; mag: number | null; dim: number; dist: number | null }>;
};

/** Colour word and surface temperature from the B-V colour index. */
const bvWord = (bv: number) => (bv < -0.1 ? "blue-white" : bv < 0.2 ? "white" : bv < 0.5 ? "yellow-white" : bv < 0.8 ? "yellow" : bv < 1.2 ? "orange" : "red");
const bvKelvin = (bv: number) => Math.round(((4600 * (1 / (0.92 * bv + 1.7) + 1 / (0.92 * bv + 0.62))) / 100)) * 100;

const dsoCache = new Map<string, THREE.Texture>();

/** Smooth value noise summed over octaves (0..1): the clumps and filaments of a gas cloud. */
function noiseField(size: number, seed: number, scale: number, octaves = 4) {
  const r = rng(seed);
  const G = 64;
  const grid = new Float32Array(G * G);
  for (let i = 0; i < grid.length; i++) grid[i] = r();
  const at = (x: number, y: number) => grid[(((y % G) + G) % G) * G + (((x % G) + G) % G)];
  const val = (x: number, y: number) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const fx = x - xi;
    const fy = y - yi;
    const u = fx * fx * (3 - 2 * fx);
    const v = fy * fy * (3 - 2 * fy);
    return (at(xi, yi) * (1 - u) + at(xi + 1, yi) * u) * (1 - v) + (at(xi, yi + 1) * (1 - u) + at(xi + 1, yi + 1) * u) * v;
  };
  const out = new Float32Array(size * size);
  let norm = 0;
  for (let o = 0, amp = 0.5; o < octaves; o++, amp *= 0.5) norm += amp;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let a = 0;
      let amp = 0.5;
      let f = scale;
      for (let o = 0; o < octaves; o++) {
        a += amp * val((x / size) * f, (y / size) * f);
        amp *= 0.5;
        f *= 2;
      }
      out[y * size + x] = a / norm;
    }
  }
  return out;
}

/** A picture of a nebula, a spiral galaxy, or the unresolved haze of a cluster, for the sprite that marks it. */
function dsoTexture(type: string) {
  const key = type === "s" ? "g" : type === "oc" ? "c" : type === "gc" ? "gc" : "n";
  const hit = dsoCache.get(key);
  if (hit) return hit;
  const S = key === "g" ? 192 : 128;
  const cv = document.createElement("canvas");
  cv.width = cv.height = S;
  const c = cv.getContext("2d")!;
  const img = c.createImageData(S, S);
  const put = (i: number, rr: number, gg: number, bb: number, a: number) => {
    img.data[i * 4] = Math.max(0, Math.min(255, rr));
    img.data[i * 4 + 1] = Math.max(0, Math.min(255, gg));
    img.data[i * 4 + 2] = Math.max(0, Math.min(255, bb));
    img.data[i * 4 + 3] = Math.max(0, Math.min(255, a * 255));
  };
  const h = S / 2;
  if (key === "n") {
    // Gas lit by young stars: pink-red hydrogen glow, bluer where it is thinner, with bright filaments and a hot core.
    const n1 = noiseField(S, 11, 4, 5);
    const n2 = noiseField(S, 23, 3, 3);
    const n3 = noiseField(S, 37, 8, 4);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const i = y * S + x;
        const d = Math.hypot((x - h) / h, (y - h) / h);
        let mask = Math.max(0, Math.min(1, 1.05 - d + (n1[i] - 0.5) * 1.25));
        mask *= mask;
        const fil = Math.pow(n3[i], 2.4) * 1.7;
        const core = Math.pow(Math.max(0, 1 - d * 1.7), 2.2);
        const a = mask * (0.3 + fil * 0.85) + core * 0.9;
        const t = n2[i];
        put(i, 255 * (0.98 - 0.4 * t) + core * 40, 85 + 90 * t + core * 150, 125 + 120 * t + core * 110, a);
      }
    }
  } else if (key === "g") {
    // A spiral galaxy seen at a slant: bright warm core, blue-white arms, a dark dust lane, grain of unresolved stars.
    const grain = noiseField(S, 5, 18, 3);
    const clump = noiseField(S, 9, 7, 3);
    const ang = -0.62;
    const tilt = 0.36;
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const i = y * S + x;
        const u = (x - h) / h;
        const v = (y - h) / h;
        const xr = u * Math.cos(ang) + v * Math.sin(ang);
        const yr = -u * Math.sin(ang) + v * Math.cos(ang);
        const xf = xr;
        const yf = yr / tilt;
        const R = Math.hypot(xf, yf);
        if (R >= 1) {
          put(i, 0, 0, 0, 0);
          continue;
        }
        const th = Math.atan2(yf, xf);
        const arms = 0.5 + 0.5 * Math.cos(2 * th - 3.6 * Math.log(R + 0.06));
        const core = Math.exp(-R * R * 70);
        const disk = Math.exp(-R * 3.4) * (0.3 + 0.7 * Math.pow(arms, 1.6)) * (0.75 + 0.5 * clump[i]);
        const dust = Math.exp(-Math.pow(yr * 11, 2)) * Math.min(1, Math.max(0, (R - 0.08) * 4)) * 0.55;
        let a = (core * 1.3 + disk) * (1 - dust) * (0.88 + 0.24 * grain[i]) * Math.pow(1 - R, 0.5);
        a = Math.max(0, a);
        const m = Math.min(1, R * 2.4);
        put(i, 255 - 70 * m, 238 - 30 * m, 205 + 50 * m, a);
      }
    }
  } else if (key === "gc") {
    // A ball of old stars, too crowded to pick apart at this size: a warm, grainy glow, brightest in the middle.
    const grain = noiseField(S, 3, 22, 2);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const i = y * S + x;
        const d = Math.hypot((x - h) / h, (y - h) / h);
        const a = (Math.exp(-d * d * 14) * 0.95 + Math.exp(-d * 3.2) * 0.22) * (0.8 + 0.4 * grain[i]) * Math.max(0, 1 - d);
        put(i, 255, 238 - 20 * d, 205 - 25 * d, a);
      }
    }
  } else {
    // An open cluster: only a faint blue haze. Its real stars are already in the catalogue, so they show as themselves, and sharpen as you zoom in.
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const d = Math.hypot((x - h) / h, (y - h) / h);
        put(y * S + x, 175, 200, 255, Math.pow(Math.max(0, 1 - d), 1.6) * 0.07);
      }
    }
  }
  c.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  dsoCache.set(key, t);
  return t;
}

const MWP_VERT = `
varying vec3 vP; varying vec3 vW;
void main(){ vP = position; vW = (modelMatrix * vec4(position, 1.0)).xyz; gl_Position = projectionMatrix * viewMatrix * vec4(vW, 1.0); }`;
// The sky map is laid out in galactic longitude (left to right, 0 in the middle) and latitude; the sphere is in equatorial coordinates.
const MWP_FRAG = `
varying vec3 vP; varying vec3 vW;
uniform sampler2D uMap; uniform mat3 uGal; uniform float uMw; uniform float uDay;
void main(){
  vec3 g = uGal * normalize(vP);
  float l = atan(g.y, g.x);
  float b = asin(clamp(g.z, -1.0, 1.0));
  float u1 = 0.5 - l / 6.2831853;
  float u2 = fract(u1 + 0.5);
  float v = 0.5 - b / 3.14159265;
  float k = 5.0;
  vec2 gx = abs(dFdx(u1)) > 0.5 ? vec2(dFdx(u2), dFdx(v)) : vec2(dFdx(u1), dFdx(v));
  vec2 gy = abs(dFdy(u1)) > 0.5 ? vec2(dFdy(u2), dFdy(v)) : vec2(dFdy(u1), dFdy(v));
  // Never sharper than about a third of a degree, so the stars baked into the map vanish and only the glow of the Milky Way is left, however far you zoom in.
  vec2 mn = vec2(0.0034, 0.0017);
  gx = sign(gx) * max(abs(gx * k), mn);
  gy = sign(gy) * max(abs(gy * k), mn);
  vec3 c = textureGrad(uMap, vec2(u1, v), gx, gy).rgb;
  float y = normalize(vW).y;
  float f = smoothstep(-0.02, 0.12, y) * (0.5 + 0.5 * smoothstep(0.0, 0.45, y));
  c = pow(c, vec3(0.8)) * 2.9 * uMw * (1.0 - uDay) * f;
  gl_FragColor = vec4(c, 1.0);
}`;

/** Real angular radius of each body (degrees), and how big its disc is drawn as a fraction of the field of view: far too small to see at true size, so it is enlarged, and enlarged more as you zoom in. */
const REAL_ANG: Record<BodyId, number> = { moon: 0.26, mercury: 0.0012, venus: 0.006, mars: 0.002, jupiter: 0.0058, saturn: 0.0048 };
const DISC_K: Record<BodyId, number> = { moon: 0.0105, mercury: 0.006, venus: 0.013, mars: 0.009, jupiter: 0.016, saturn: 0.012 };
/** Hours for one turn. The Moon always shows us the same face. */
const DAY_H: Record<BodyId, number> = { moon: 0, mercury: 1407.6, venus: 5832, mars: 24.62, jupiter: 9.925, saturn: 10.66 };
const FLAT_Y: Record<BodyId, number> = { moon: 1, mercury: 1, venus: 1, mars: 0.99, jupiter: 0.935, saturn: 0.902 };
const PLANET_MAP: Record<BodyId, string> = { moon: "/sky/moon.jpg", mercury: "/sky/mercury.jpg", venus: "/sky/venus_atmosphere.jpg", mars: "/sky/mars.jpg", jupiter: "/sky/jupiter.jpg", saturn: "/sky/saturn.jpg" };
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// Saturn's rings: the strip picture wrapped round, lit by the Sun, with the planet's shadow falling across them.
const RING_VERT = `
varying vec2 vUv; varying vec3 vWorld;
void main(){ vUv = uv; vWorld = (modelMatrix * vec4(position, 1.0)).xyz; gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0); }`;
const RING_FRAG = `
varying vec2 vUv; varying vec3 vWorld;
uniform sampler2D uMap; uniform vec3 uSun; uniform vec3 uCenter; uniform float uR;
void main(){
  vec4 tex = texture2D(uMap, vUv);
  vec3 rd = normalize(uSun);
  vec3 oc = vWorld - uCenter;
  float b = dot(oc, rd);
  float h = b * b - (dot(oc, oc) - uR * uR);
  float shadow = (b < 0.0) ? smoothstep(0.0, uR * uR * 0.05, h) : 0.0;
  vec3 col = tex.rgb * vec3(0.97, 0.92, 0.82) * (1.0 - 0.88 * shadow);
  if (tex.a < 0.02) discard;
  gl_FragColor = vec4(col, tex.a);
}`;
// A thin glowing rim of air (Venus's haze, Mars's dusty edge), brightest on the sunlit side.
const ATMO_VERT = `
varying vec3 vN; varying vec3 vV;
void main(){ vN = normalize(normalMatrix * normal); vec4 mv = modelViewMatrix * vec4(position, 1.0); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`;
const ATMO_FRAG = `
varying vec3 vN; varying vec3 vV;
uniform vec3 uColor; uniform vec3 uSunV; uniform float uK;
void main(){
  float rim = pow(1.0 - max(dot(vN, vV), 0.0), 3.2);
  float lit = smoothstep(-0.25, 0.55, dot(vN, normalize(uSunV)));
  gl_FragColor = vec4(uColor * rim * lit * uK, 1.0);
}`;

const PLANET_VERT = `
varying vec2 vUv; varying vec3 vN;
void main(){ vUv = uv; vN = mat3(modelMatrix) * normal; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const PLANET_FRAG = `
varying vec2 vUv; varying vec3 vN;
uniform sampler2D uMap; uniform vec3 uL; uniform float uAmb; uniform vec3 uTint; uniform float uOpaque;
void main(){
  vec3 tex = texture2D(uMap, vUv).rgb;
  float d = dot(normalize(vN), normalize(uL));
  float lit = smoothstep(-0.05, 0.2, d);
  float shade = lit * (0.3 + 0.7 * pow(max(d, 0.0), 0.55));
  vec3 col = tex * (uAmb * uTint + shade * 1.12);
  // A planet's unlit side is not seen against the sky; the Moon's is (earthshine).
  float a = mix(smoothstep(0.0, 0.07, shade), 1.0, uOpaque);
  gl_FragColor = vec4(col, a);
}`;

type Solid = {
  group: THREE.Group;
  ball: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  pu: { uMap: { value: THREE.Texture }; uL: { value: THREE.Vector3 }; uAmb: { value: number }; uTint: { value: THREE.Vector3 }; uOpaque: { value: number } };
  shellU: { uColor: { value: THREE.Color }; uSunV: { value: THREE.Vector3 }; uK: { value: number } } | null;
  rings: THREE.Mesh | null;
  ringU: { uMap: { value: THREE.Texture | null }; uSun: { value: THREE.Vector3 }; uCenter: { value: THREE.Vector3 }; uR: { value: number } } | null;
  sats: Array<{ def: MoonDef; dot: THREE.Mesh; halo: THREE.Mesh; label: THREE.Sprite }>;
  /** How big its disc is drawn right now, in degrees. */
  radiusDeg: number;
};

/** Something the tour can point at. */
export type TourSpec = { kind: "body"; id: BodyId } | { kind: "star"; name: string } | { kind: "dso"; id: string } | { kind: "eq"; ra: number; dec: number };

export type NightHooks = {
  /** About 4 times a second: where the view points, how wide it is, and the simulated time. */
  onTick?: (v: { az: number; alt: number; fov: number; time: number; sunAlt: number; map: SkyMap }) => void;
  /** The opening time-lapse reached its end. */
  onIntroDone?: () => void;
  /** A planet or the Moon was tapped. */
  onPick?: (id: BodyId) => void;
  /** A star, nebula, cluster or galaxy was tapped. */
  onPickObject?: (o: SkyObject) => void;
};

/** What the little all-sky map needs: bright stars as [az, alt, mag] triples, and the bodies. */
export type SkyMap = { stars: number[]; bodies: Array<{ id: BodyId; az: number; alt: number }> };

type Glide = { az: number; alt: number; fov: number } | null;

export class NightSky {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(70, 1, 0.1, 400);
  private skyGroup = new THREE.Group();
  private uniforms = {
    uTime: { value: 0 },
    uPx: { value: 1 },
    uDay: { value: 0 },
    uLimit: { value: 8.3 },
    uMw: { value: 1 },
  };
  private skyU = { uSun: { value: new THREE.Vector3(0, -1, 0) }, uSunAlt: { value: -30 }, uCity: { value: 0 }, uMoon: { value: new THREE.Vector3(0, -1, 0) }, uMoonGlow: { value: 0 } };
  private lines: THREE.LineSegments | null = null;
  private starLabels: Array<{ s: THREE.Sprite; v: THREE.Vector3; mag: number; named: boolean }> = [];
  private conLabels: Array<{ s: THREE.Sprite; v: THREE.Vector3 }> = [];
  private starInfo: Array<{ v: THREE.Vector3; name: string; bayer: string; flam: string; con: string; mag: number; bv: number }> = [];
  private dsos: Array<{ def: SkyInfo["dsos"][number]; sprite: THREE.Sprite; label: THREE.Sprite; v: THREE.Vector3 }> = [];
  private guides = new THREE.Group();
  private cityT = 0;
  private cityTo = 0;
  private bright: Array<{ v: THREE.Vector3; mag: number }> = [];
  private mwPoints: THREE.Points | null = null;
  private moonG = 0;
  /** The planet being inspected: dragging turns it instead of the sky. */
  private inspectId: BodyId | null = null;
  private userYaw = 0;
  private userPitch = 0;
  private yawVel = 0;
  private fullLight = false;
  private dt = 0.016;
  private introTo: number | null = null;
  private introSpeed = 0;
  private bodies = new Map<BodyId, { sprite: THREE.Sprite; label: THREE.Sprite; body: ReturnType<typeof bodyAt>; dir: THREE.Vector3 }>();
  private solids = new Map<BodyId, Solid>();
  private sunCore!: THREE.Sprite;
  private sunGlow!: THREE.Sprite;
  private moonLight = new THREE.DirectionalLight(0xfff4e0, 3.2);
  private compass: Array<{ s: THREE.Sprite; v: THREE.Vector3 }> = [];
  private meteor: { line: THREE.Line; t: number; dur: number; from: THREE.Vector3; to: THREE.Vector3; next: number };
  private az = 150;
  private alt = 38;
  private fov = 72;
  private glide: Glide = null;
  private sim: number;
  private playing = false;
  private speed = 900;
  private raf = 0;
  private last = 0;
  private lastTick = 0;
  private lastBodies = -1;
  private disposed = false;
  private showLines = true;
  private showNames = true;
  private pointers = new Map<number, { x: number; y: number }>();
  private moved = 0;
  private pinch = 0;
  private cleanup: Array<() => void> = [];
  private rand = rng(20261103);
  private w = 1;
  private h = 1;

  constructor(private canvas: HTMLCanvasElement, startTime: number, private hooks: NightHooks = {}) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setClearColor(0x000000, 1);
    this.sim = startTime;

    // The background: sky colour that follows the Sun (sunset glow, deep night, dawn), and a skyline in front of everything.
    const sky = new THREE.Mesh(new THREE.SphereGeometry(R_SKY, 48, 24), new THREE.ShaderMaterial({ vertexShader: DOME_VERT, fragmentShader: SKY_FRAG, uniforms: this.skyU, side: THREE.BackSide, depthWrite: false, depthTest: false }));
    sky.renderOrder = 0;
    const ground = new THREE.Mesh(new THREE.SphereGeometry(R_SKY - 5, 96, 24), new THREE.ShaderMaterial({ vertexShader: DOME_VERT, fragmentShader: GROUND_FRAG, uniforms: this.skyU, side: THREE.BackSide, transparent: true, depthWrite: false, depthTest: false }));
    ground.renderOrder = 6;
    this.scene.add(sky, this.skyGroup, ground);

    this.buildMilkyWay();
    this.loadMilkyWayPhoto();
    this.buildGuides();
    void this.loadStars();

    this.scene.add(this.moonLight, new THREE.AmbientLight(0x5a6c94, 0.05));
    this.buildSolids();

    const glow = glowTexture();
    for (const id of IDS) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: BODY_COLOUR[id], transparent: true, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false }));
      sprite.renderOrder = 3;
      const label = textSprite(BODY_LABEL[id], 30, "#f4ead2", true);
      this.scene.add(sprite, label);
      this.bodies.set(id, { sprite, label, body: bodyAt(id, new Date(startTime)), dir: new THREE.Vector3() });
    }

    // Compass marks on the horizon.
    const marks: Array<[string, number, boolean]> = [["N", 0, true], ["NE", 45, false], ["E", 90, true], ["SE", 135, false], ["S", 180, true], ["SW", 225, false], ["W", 270, true], ["NW", 315, false]];
    for (const [t, az, major] of marks) {
      const s = textSprite(t, major ? 40 : 28, major ? "#ffd9a0" : "rgba(255,225,185,0.65)", major);
      this.scene.add(s);
      this.compass.push({ s, v: hor(az, 3.2, R_BODY) });
    }

    // One shooting star at a time, now and then.
    const lg = new THREE.BufferGeometry();
    lg.setAttribute("position", new THREE.BufferAttribute(new Float32Array(6), 3));
    lg.setAttribute("color", new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1, 1, 1]), 3));
    const ml = new THREE.Line(lg, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false }));
    ml.visible = false;
    ml.frustumCulled = false;
    ml.renderOrder = 5;
    this.scene.add(ml);
    this.meteor = { line: ml, t: 0, dur: 0.7, from: new THREE.Vector3(), to: new THREE.Vector3(), next: 4 };

    this.bindInput();
    const ro = new ResizeObserver(() => this.resize());
    ro.observe(canvas);
    this.cleanup.push(() => ro.disconnect());
    this.resize();
    this.refresh(startTime);
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  // ---------- data ----------

  private async loadStars() {
    try {
      const [bin, info, lines] = await Promise.all([
        fetch("/sky/stars.bin").then((r) => r.arrayBuffer()),
        fetch("/sky/sky-info.json").then((r) => r.json() as Promise<SkyInfo>),
        fetch("/sky/lines.json").then((r) => r.json() as Promise<number[][][]>),
      ]);
      if (this.disposed) return;
      const a = new Int16Array(bin);
      const n = a.length / 4;
      const RR = R_BODY + 8;
      const pos = new Float32Array(n * 3);
      const mag = new Float32Array(n);
      const col = new Float32Array(n * 3);
      const ph = new Float32Array(n);
      const r = rng(7);
      for (let i = 0; i < n; i++) {
        const ra = ((a[i * 4] + 18000) / 100) * RAD;
        const dec = (a[i * 4 + 1] / 100) * RAD;
        pos[i * 3] = Math.cos(dec) * Math.cos(ra) * RR;
        pos[i * 3 + 1] = Math.cos(dec) * Math.sin(ra) * RR;
        pos[i * 3 + 2] = Math.sin(dec) * RR;
        mag[i] = a[i * 4 + 2] / 100;
        ph[i] = r();
        // Colour from B-V: blue-white (hot) through white and yellow to orange (cool).
        const k = Math.max(-0.3, Math.min(1.8, a[i * 4 + 3] / 100));
        col[i * 3] = k < 0.6 ? 0.62 + (k + 0.3) * 0.42 : 1.0;
        col[i * 3 + 1] = k < 0.6 ? 0.72 + (k + 0.3) * 0.27 : 0.96 - (k - 0.6) * 0.23;
        col[i * 3 + 2] = k < 0.6 ? 1.0 - (k + 0.3) * 0.12 : 0.9 - (k - 0.6) * 0.38;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      g.setAttribute("aMag", new THREE.BufferAttribute(mag, 1));
      g.setAttribute("aCol", new THREE.BufferAttribute(col, 3));
      g.setAttribute("aPh", new THREE.BufferAttribute(ph, 1));
      const pts = new THREE.Points(g, new THREE.ShaderMaterial({ vertexShader: STAR_VERT, fragmentShader: STAR_FRAG, uniforms: this.uniforms, transparent: true, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false }));
      pts.frustumCulled = false;
      pts.renderOrder = 2;
      this.skyGroup.add(pts);
      for (let i = 0; i < n; i++) if (mag[i] < 4.3) this.bright.push({ v: new THREE.Vector3(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]), mag: mag[i] });

      // Constellation figures.
      const seg: number[] = [];
      for (const strip of lines) for (let i = 0; i + 1 < strip.length; i++) {
        const p = eq(strip[i][0], strip[i][1], R_BODY + 7);
        const q = eq(strip[i + 1][0], strip[i + 1][1], R_BODY + 7);
        seg.push(p.x, p.y, p.z, q.x, q.y, q.z);
      }
      const lg = new THREE.BufferGeometry();
      lg.setAttribute("position", new THREE.BufferAttribute(new Float32Array(seg), 3));
      this.lines = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0x7f9cff, transparent: true, opacity: 0.2, depthTest: false, depthWrite: false }));
      this.lines.frustumCulled = false;
      this.lines.renderOrder = 2;
      this.lines.visible = this.showLines;
      this.skyGroup.add(this.lines);

      // Constellation names, spread across the sky at low brightness.
      for (const [name, ra, dec] of info.conLabels) {
        const s = textSprite(name.toUpperCase(), 22, "rgba(150,175,235,0.9)", false, 5);
        s.visible = false;
        this.scene.add(s);
        this.conLabels.push({ s, v: eq(ra, dec, R_BODY + 7) });
      }

      // Stars with names or Greek letters: they can be tapped, and the brighter ones are labelled.
      for (const [i, name, bayer, flam, con] of info.info) {
        const m = mag[i];
        const bv = a[i * 4 + 3] / 100;
        const v = new THREE.Vector3(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
        const conName = info.con[con] ?? con;
        this.starInfo.push({ v, name, bayer, flam, con: conName, mag: m, bv });
        const text = name || (bayer && m <= 3.4 ? `${bayer} ${con}` : "");
        if (!text || (name ? m > 4.7 : false)) continue;
        const s = textSprite(text, 26, "rgba(205,220,255,0.85)");
        s.visible = false;
        this.scene.add(s);
        this.starLabels.push({ s, v, mag: m, named: !!name });
      }

      // Nebulae, clusters and galaxies.
      for (const def of info.dsos) {
        const tex = dsoTexture(def.type);
        const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false, opacity: 0 });
        const sprite = new THREE.Sprite(mat);
        sprite.renderOrder = 2;
        sprite.visible = false;
        const label = textSprite(def.name, 24, "rgba(255,214,160,0.9)");
        label.visible = false;
        this.scene.add(sprite, label);
        this.dsos.push({ def, sprite, label, v: eq(def.ra, def.dec, R_BODY + 6) });
      }
    } catch {
      /* the sky still works without the catalogue: planets, Moon and horizon */
    }
  }

  /** The celestial equator and the ecliptic (the road the Sun, Moon and planets follow). */
  private buildGuides() {
    const line = (pts: THREE.Vector3[], colour: number, opacity: number) => {
      const l = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: colour, transparent: true, opacity, depthTest: false, depthWrite: false }));
      l.frustumCulled = false;
      l.renderOrder = 2;
      return l;
    };
    const eps = 23.4393 * RAD;
    const equator: THREE.Vector3[] = [];
    const ecliptic: THREE.Vector3[] = [];
    for (let i = 0; i < 360; i += 1) {
      const a = i * RAD;
      equator.push(new THREE.Vector3(Math.cos(a), Math.sin(a), 0).multiplyScalar(R_BODY + 5));
      ecliptic.push(new THREE.Vector3(Math.cos(a), Math.sin(a) * Math.cos(eps), Math.sin(a) * Math.sin(eps)).multiplyScalar(R_BODY + 5));
    }
    this.guides.add(line(equator, 0x6ee7d8, 0.32), line(ecliptic, 0xffd27a, 0.5));
    this.guides.visible = false;
    this.skyGroup.add(this.guides);
  }

  private buildMilkyWay() {
    // Galactic -> equatorial (transpose of the IAU matrix).
    const M = new THREE.Matrix3().set(-0.0548755604, -0.8734370902, -0.4838350155, 0.4941094279, -0.44482963, 0.7469822445, -0.867666149, -0.1980763734, 0.4559837762);
    const T = M.clone().transpose();
    const r = rng(99);
    const N = 26000;
    const pos = new Float32Array(N * 3);
    const size = new Float32Array(N);
    const alpha = new Float32Array(N);
    let i = 0;
    while (i < N) {
      const l = r() * 360;
      const dl = ((l + 180) % 360) - 180;
      // Brighter and thicker towards the centre (Sagittarius), with patchy dark lanes.
      const dens = 0.3 + 0.7 * Math.exp(-(dl * dl) / (2 * 70 * 70));
      if (r() > dens) continue;
      const wide = r() < 0.3;
      const b = gauss(r) * (wide ? 15 : 5.5) * (0.7 + 0.5 * Math.exp(-(dl * dl) / 4000));
      const lane = 0.55 + 0.45 * Math.sin(l * 0.21 + 1.3) * Math.sin(l * 0.07 + b * 0.4);
      if (r() > Math.max(0.15, lane)) continue;
      const lr = l * RAD;
      const br = b * RAD;
      const v = new THREE.Vector3(Math.cos(br) * Math.cos(lr), Math.cos(br) * Math.sin(lr), Math.sin(br)).applyMatrix3(T).multiplyScalar(R_BODY + 9);
      pos.set([v.x, v.y, v.z], i * 3);
      size[i] = wide ? 14 + r() * 22 : 3 + r() * 7;
      alpha[i] = (wide ? 0.012 : 0.03 + r() * 0.04) * (0.5 + 0.9 * Math.exp(-(dl * dl) / (2 * 60 * 60)));
      i++;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("aS", new THREE.BufferAttribute(size, 1));
    g.setAttribute("aA", new THREE.BufferAttribute(alpha, 1));
    const pts = new THREE.Points(g, new THREE.ShaderMaterial({ vertexShader: MW_VERT, fragmentShader: MW_FRAG, uniforms: { ...this.uniforms, uTint: { value: new THREE.Color(0.72, 0.8, 1.0) } }, transparent: true, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false }));
    pts.frustumCulled = false;
    pts.renderOrder = 1;
    this.skyGroup.add(pts);
    this.mwPoints = pts;
  }

  /** The real Milky Way: a NASA star map of the whole sky, blurred so the stars baked into it don't double the catalogue's. */
  private loadMilkyWayPhoto() {
    // The photo is blurred in the shader, so a modest size looks the same: 4096 wide, or 2048 on phones and weak graphics (a bigger texture can crash a phone's tab).
    const small = this.renderer.capabilities.maxTextureSize < 4096 || matchMedia("(pointer: coarse)").matches || Math.min(screen.width, screen.height) < 700;
    new THREE.TextureLoader().load(small ? "/sky/milkyway-2k.jpg" : "/sky/milkyway-4k.jpg", (t) => {
      if (this.disposed) {
        t.dispose();
        return;
      }
      t.wrapS = THREE.RepeatWrapping;
      t.anisotropy = 4;
      // Equatorial -> galactic (IAU).
      const A = new THREE.Matrix3().set(-0.0548755604, -0.8734370902, -0.4838350155, 0.4941094279, -0.44482963, 0.7469822445, -0.867666149, -0.1980763734, 0.4559837762);
      const mat = new THREE.ShaderMaterial({
        vertexShader: MWP_VERT,
        fragmentShader: MWP_FRAG,
        uniforms: { uMap: { value: t }, uGal: { value: A }, uMw: this.uniforms.uMw, uDay: this.uniforms.uDay },
        side: THREE.BackSide,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthTest: false,
        depthWrite: false,
      });
      const m = new THREE.Mesh(new THREE.SphereGeometry(R_BODY + 11, 64, 32), mat);
      m.renderOrder = 1;
      m.frustumCulled = false;
      this.skyGroup.add(m);
      if (this.mwPoints) this.mwPoints.visible = false;
    });
  }

  // ---------- controls ----------

  /** The simulated time (ms since the epoch). */
  get time() {
    return this.sim;
  }
  setTime(ms: number) {
    this.sim = ms;
    this.refresh(ms);
  }
  setPlaying(on: boolean) {
    this.playing = on;
    // Taking control ends the opening time-lapse.
    this.introTo = null;
    this.introSpeed = 0;
  }
  /** A time-lapse from here to a moment, then stop (the opening sunset-to-night). */
  playTo(ms: number, speed: number) {
    this.introTo = ms;
    this.introSpeed = speed;
    this.playing = true;
  }

  /** Positions for the little sky map. */
  private snapshot(): SkyMap {
    const m = this.skyGroup.matrix;
    const v = new THREE.Vector3();
    const stars: number[] = [];
    for (const b of this.bright) {
      v.copy(b.v).applyMatrix4(m);
      const alt = Math.asin(Math.max(-1, Math.min(1, v.y / v.length()))) / RAD;
      if (alt < 0) continue;
      stars.push((Math.atan2(v.x, -v.z) / RAD + 360) % 360, alt, b.mag);
    }
    return { stars, bodies: [...this.bodies].map(([id, e]) => ({ id, az: e.body.az, alt: e.body.alt })) };
  }
  setLines(on: boolean) {
    this.showLines = on;
    if (this.lines) this.lines.visible = on;
  }
  setGuides(on: boolean) {
    this.guides.visible = on;
  }
  /** Look at the sky as it is from the city (few stars) or from a dark site (all of them). */
  setCity(on: boolean) {
    this.cityTo = on ? 1 : 0;
  }
  /** The faintest star magnitude you can see right now. */
  get limitMag() {
    return this.uniforms.uLimit.value - 0.3;
  }
  setNames(on: boolean) {
    this.showNames = on;
    for (const l of this.starLabels) l.s.visible = on;
  }

  /** Fly the view to a body (and close in on it). */
  focus(id: BodyId) {
    const b = this.bodies.get(id)?.body;
    if (!b) return;
    this.glide = { az: b.az, alt: Math.max(6, b.alt), fov: 9 };
    this.inspectId = id;
    this.userYaw = 0;
    this.userPitch = 0;
    this.yawVel = 0;
  }
  private matrixAt(ms: number) {
    const th = lstDeg(new Date(ms)) * RAD;
    const ph = LAT * RAD;
    const ct = Math.cos(th);
    const st = Math.sin(th);
    const cp = Math.cos(ph);
    const sp = Math.sin(ph);
    return new THREE.Matrix4().set(-st, ct, 0, 0, cp * ct, cp * st, sp, 0, sp * ct, sp * st, -cp, 0, 0, 0, 0, 1);
  }
  /** Where something is in the sky at a moment (default: the time on screen), or null if it is not in the catalogue. */
  locate(spec: TourSpec, ms = this.sim): { az: number; alt: number } | null {
    if (spec.kind === "body") {
      const b = bodyAt(spec.id, new Date(ms));
      return { az: b.az, alt: b.alt };
    }
    const v = spec.kind === "star" ? this.starInfo.find((x) => x.name === spec.name)?.v : spec.kind === "dso" ? this.dsos.find((d) => d.def.id === spec.id)?.v : eq(spec.ra, spec.dec, R_BODY);
    if (!v) return null;
    const d = v.clone().applyMatrix4(this.matrixAt(ms)).normalize();
    return { az: (Math.atan2(d.x, -d.z) / RAD + 360) % 360, alt: Math.asin(Math.max(-1, Math.min(1, d.y))) / RAD };
  }
  /** Fly to something. */
  flyToSpec(spec: TourSpec, fov: number) {
    const p = this.locate(spec);
    if (p) this.glide = { az: p.az, alt: Math.max(4, p.alt), fov };
  }
  /** Fly the view to any direction. */
  flyTo(az: number, alt: number, fov = 72) {
    this.glide = { az, alt, fov };
  }
  /** Light the inspected planet fully, whatever its real phase. */
  setFullLight(on: boolean) {
    this.fullLight = on;
  }
  /** Back to the planet's usual face. */
  resetSpin() {
    this.userYaw = 0;
    this.userPitch = 0;
    this.yawVel = 0;
  }
  /** Fly back out to the whole sky. */
  release() {
    this.glide = { az: this.az, alt: Math.max(25, this.alt), fov: 72 };
    this.inspectId = null;
  }
  bodyNow(id: BodyId): Body | null {
    return (this.bodies.get(id)?.body as Body | undefined) ?? null;
  }

  private bindInput() {
    const cv = this.canvas;
    cv.style.touchAction = "none";
    cv.style.cursor = "grab";
    const down = (e: PointerEvent) => {
      cv.setPointerCapture?.(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.moved = 0;
      this.pinch = this.span();
      cv.style.cursor = "grabbing";
    };
    const move = (e: PointerEvent) => {
      const p = this.pointers.get(e.pointerId);
      if (!p) return;
      const dx = e.clientX - p.x;
      const dy = e.clientY - p.y;
      p.x = e.clientX;
      p.y = e.clientY;
      this.moved += Math.abs(dx) + Math.abs(dy);
      if (this.pointers.size >= 2) {
        const s = this.span();
        if (this.pinch > 0 && s > 0) this.fov = Math.min(95, Math.max(1.2, (this.fov * this.pinch) / s));
        this.pinch = s;
        this.glide = null;
        return;
      }
      // Looking at a planet: the drag turns the planet itself, and it keeps drifting a little when you let go.
      if (this.inspectId) {
        this.userYaw += dx * 0.009;
        this.userPitch = Math.max(-1.45, Math.min(1.45, this.userPitch + dy * 0.009));
        this.yawVel = dx * 0.54;
        return;
      }
      if (this.moved > 4) this.glide = null;
      const k = this.fov / this.h;
      this.az = (this.az - dx * k * 1.0 + 360) % 360;
      this.alt = Math.max(-6, Math.min(89, this.alt + dy * k));
    };
    const up = (e: PointerEvent) => {
      const wasTap = this.moved < 6 && this.pointers.size === 1;
      this.pointers.delete(e.pointerId);
      this.pinch = this.span();
      if (this.pointers.size === 0) cv.style.cursor = "grab";
      if (wasTap) {
        const r = cv.getBoundingClientRect();
        const hit = this.pickAt(e.clientX - r.left, e.clientY - r.top);
        if (hit.body) this.hooks.onPick?.(hit.body);
        else if (hit.obj) {
          this.hooks.onPickObject?.(hit.obj);
          this.glide = { az: hit.obj.az, alt: Math.max(4, hit.obj.alt), fov: Math.min(this.fov, hit.obj.kind === "dso" ? 22 : 14) };
        }
      }
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      this.glide = null;
      this.fov = Math.min(95, Math.max(1.2, this.fov * Math.exp(e.deltaY * 0.0012)));
    };
    cv.addEventListener("pointerdown", down);
    cv.addEventListener("pointermove", move);
    cv.addEventListener("pointerup", up);
    cv.addEventListener("pointercancel", up);
    cv.addEventListener("wheel", wheel, { passive: false });
    this.cleanup.push(() => {
      cv.removeEventListener("pointerdown", down);
      cv.removeEventListener("pointermove", move);
      cv.removeEventListener("pointerup", up);
      cv.removeEventListener("pointercancel", up);
      cv.removeEventListener("wheel", wheel);
    });
  }

  private span() {
    const v = [...this.pointers.values()];
    return v.length >= 2 ? Math.hypot(v[0].x - v[1].x, v[0].y - v[1].y) : 0;
  }

  private toScreen(dir: THREE.Vector3) {
    const p = dir.clone().multiplyScalar(R_BODY).project(this.camera);
    if (p.z > 1) return null;
    return { x: (p.x * 0.5 + 0.5) * this.w, y: (-p.y * 0.5 + 0.5) * this.h };
  }

  /** Where a point fixed on the sky is right now, as a unit direction in the local scene. */
  private worldDir(v: THREE.Vector3) {
    return v.clone().applyMatrix4(this.skyGroup.matrix).normalize();
  }

  /** The planet, Moon, nebula, cluster, galaxy or named star nearest a point on screen (within a thumb's width), if any. */
  private pickAt(x: number, y: number): { body?: BodyId; obj?: SkyObject } {
    let best: BodyId | null = null;
    let bd = 34;
    for (const [id, b] of this.bodies) {
      if (b.body.alt < -1) continue;
      const s = this.toScreen(b.dir);
      if (!s) continue;
      const d = Math.hypot(s.x - x, s.y - y);
      if (d < bd) {
        bd = d;
        best = id;
      }
    }
    if (best) return { body: best };

    const look = (dir: THREE.Vector3, kind: SkyObject["kind"], name: string, sub: string, con: string, mag: number | null, dist: number | null): SkyObject => ({
      kind,
      name,
      sub,
      con,
      mag,
      dist,
      az: (Math.atan2(dir.x, -dir.z) / RAD + 360) % 360,
      alt: Math.asin(Math.max(-1, Math.min(1, dir.y))) / RAD,
    });
    let pick: { score: number; make: () => SkyObject } | null = null;
    for (const d of this.dsos) {
      const dir = this.worldDir(d.v);
      if (dir.y < -0.01) continue;
      const s = this.toScreen(dir);
      if (!s) continue;
      const dist = Math.hypot(s.x - x, s.y - y);
      const reach = Math.max(28, ((d.def.dim / 60) / this.fov) * this.h * 0.5);
      if (dist < reach && (!pick || dist - 10 < pick.score)) pick = { score: dist - 10, make: () => look(dir, "dso", d.def.name, d.def.kind, "", d.def.mag, d.def.dist) };
    }
    for (const st of this.starInfo) {
      if (st.mag > 5.2 && this.fov > 12) continue;
      const dir = this.worldDir(st.v);
      if (dir.y < -0.01) continue;
      const s = this.toScreen(dir);
      if (!s) continue;
      const dist = Math.hypot(s.x - x, s.y - y);
      const score = dist - (6.2 - st.mag) * 2.2;
      if (dist < 24 && (!pick || score < pick.score)) {
        pick = {
          score,
          make: () => {
            const nm = st.name || (st.bayer ? `${st.bayer} ${st.con}` : `${st.flam} ${st.con}`);
            const sub = `${bvWord(st.bv).replace(/^./, (c) => c.toUpperCase())} star, surface about ${bvKelvin(st.bv).toLocaleString("en-US")} K`;
            return { ...look(dir, "star", nm, sub, st.con, st.mag, STAR_DIST[st.name] ?? null), bv: st.bv };
          },
        };
      }
    }
    return pick ? { obj: pick.make() } : {};
  }

  private resize() {
    const w = this.canvas.clientWidth || 1;
    const h = this.canvas.clientHeight || 1;
    this.w = w;
    this.h = h;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ---------- time and frame ----------

  /** Re-place the Sun, Moon and planets for a simulated time. */
  private refresh(ms: number) {
    const when = new Date(ms);
    const sun = sunAltAz(when);
    this.skyU.uSunAlt.value = sun.alt;
    this.skyU.uSun.value.copy(hor(sun.az, sun.alt));
    this.uniforms.uDay.value = Math.min(1, Math.max(0, (sun.alt + 12) / 14));
    for (const id of IDS) {
      const e = this.bodies.get(id)!;
      e.body = bodyAt(id, when);
      e.dir = hor(e.body.az, e.body.alt);
    }
    this.lastBodies = performance.now();
    // Moon: put the sphere where the Moon is, turn its near side to us, and light it from the Sun.
    const m = this.bodies.get("moon")!;
    this.moonLight.position.copy(this.skyU.uSun.value).multiplyScalar(60);
    // Moonlight washes out the sky and the faint stars.
    const g = m.body.illum * Math.min(1, Math.max(0, m.body.alt / 18));
    this.moonG = g;
    this.skyU.uMoon.value.copy(m.dir);
    this.skyU.uMoonGlow.value = g * (1 - this.uniforms.uDay.value);
  }

  private frame = (now: number) => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.frame);
    if (document.hidden) {
      this.last = now;
      return;
    }
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.dt = dt;
    const t = now / 1000;
    this.uniforms.uTime.value = t;

    if (this.playing) {
      this.sim += dt * (this.introSpeed || this.speed) * 1000;
      if (this.introTo != null && this.sim >= this.introTo) {
        this.sim = this.introTo;
        this.introTo = null;
        this.introSpeed = 0;
        this.playing = false;
        this.refresh(this.sim);
        this.hooks.onIntroDone?.();
      }
      if (now - this.lastBodies > 120) this.refresh(this.sim);
    }

    // Fly towards a target.
    if (this.glide) {
      const g = this.glide;
      const k = 1 - Math.pow(0.0009, dt);
      let da = ((g.az - this.az + 540) % 360) - 180;
      this.az = (this.az + da * k + 360) % 360;
      this.alt += (g.alt - this.alt) * k;
      this.fov += (g.fov - this.fov) * k;
      da = Math.abs(da);
      if (da < 0.05 && Math.abs(g.alt - this.alt) < 0.05 && Math.abs(g.fov - this.fov) < 0.05) this.glide = null;
    }
    // While locked on a planet as time runs, keep it centred.
    this.camera.fov = this.fov;
    this.camera.rotation.set(this.alt * RAD, -this.az * RAD, 0, "YXZ");
    this.camera.updateProjectionMatrix();
    this.uniforms.uPx.value = this.renderer.getPixelRatio() * (1 + 0.2 * Math.min(2, Math.max(0, 72 / this.fov - 1)));

    // The star sphere turns with the sidereal time.
    const th = lstDeg(new Date(this.sim)) * RAD;
    const ph = LAT * RAD;
    const ct = Math.cos(th);
    const st = Math.sin(th);
    const cp = Math.cos(ph);
    const sp = Math.sin(ph);
    // rows: east, up, -north (scene x, y, z)
    this.skyGroup.matrixAutoUpdate = false;
    this.skyGroup.matrix.set(-st, ct, 0, 0, cp * ct, cp * st, sp, 0, sp * ct, sp * st, -cp, 0, 0, 0, 0, 1);
    this.skyGroup.matrixWorldNeedsUpdate = true;
    if (this.lines) (this.lines.material as THREE.LineBasicMaterial).opacity = 0.2 * (1 - this.uniforms.uDay.value);

    this.cityT += (this.cityTo - this.cityT) * (1 - Math.pow(0.02, dt));
    if (Math.abs(this.cityTo - this.cityT) < 0.002) this.cityT = this.cityTo;
    this.uniforms.uLimit.value = 8.3 - 4.6 * this.cityT - 2.8 * this.moonG;
    this.uniforms.uMw.value = (1 - 0.93 * this.cityT) * (1 - 0.7 * this.moonG);
    this.skyU.uCity.value = this.cityT;
    this.placeSolids(2 * R_BODY * Math.tan((this.fov * RAD) / 2) * 0.028);
    this.placeThings(t);
    this.updateMeteor(dt, t);
    this.renderer.render(this.scene, this.camera);

    if (now - this.lastTick > 250) {
      this.lastTick = now;
      this.hooks.onTick?.({ az: this.az, alt: this.alt, fov: this.fov, time: this.sim, sunAlt: this.skyU.uSunAlt.value, map: this.snapshot() });
    }
  };

  private placeThings(t: number) {
    const fovK = Math.min(1, Math.max(0.3, this.fov / 60));
    const labelH = 2 * R_BODY * Math.tan((this.fov * RAD) / 2) * 0.028;
    const day = this.uniforms.uDay.value;
    for (const [id, e] of this.bodies) {
      const up = e.body.alt > -0.5;
      const p = e.dir.clone().multiplyScalar(R_BODY);
      const isMoon = id === "moon";
      e.sprite.visible = up;
      e.label.visible = up;
      // Glow sized by brightness (the Moon's is handled by its sphere plus a halo).
      const deg = isMoon ? 3.2 + e.body.illum * 3.5 : Math.max(0.7, Math.min(3.4, 1.5 + -e.body.mag * 0.55));
      const s = 2 * R_BODY * Math.tan((deg * RAD) / 2) * fovK * (1 - day * 0.8);
      e.sprite.position.copy(p);
      e.sprite.scale.setScalar(s * (isMoon ? 1 : 1.9 + 0.12 * Math.sin(t * 3 + id.length)) * (1 - 0.9 * smooth(40, 12, this.fov)));
      e.sprite.material.opacity = isMoon ? 0.25 * (0.3 + e.body.illum) : 1;
      e.label.position.copy(e.dir.clone().add(new THREE.Vector3(0, -(Math.tan(((this.solids.get(id)?.radiusDeg ?? 0.5) * (id === "saturn" ? 2.2 : 1.25) + 0.15) * RAD) + 0.012 * Math.max(0.35, this.fov / 60)), 0)).normalize().multiplyScalar(R_BODY - 0.5));
      e.label.scale.set(labelH * 4, labelH, 1);
    }
    // Labels follow what is in view; the closer in we are, the more stars are named.
    const look = new THREE.Vector3(0, 0, -1).applyEuler(this.camera.rotation);
    const cone = Math.cos(this.fov * 0.62 * RAD);
    const nameMag = this.fov > 60 ? 2.1 : this.fov > 34 ? 3.0 : this.fov > 16 ? 3.9 : 4.8;
    const dir = new THREE.Vector3();
    const drop = new THREE.Vector3();
    const city = this.cityT;
    for (const l of this.starLabels) {
      dir.copy(l.v).applyMatrix4(this.skyGroup.matrix).normalize();
      const on = this.showNames && l.mag <= nameMag - (l.named ? 0 : 0.9) && l.mag < 6.4 - city * 3.2 && dir.y > 0.03 && day < 0.6 && dir.dot(look) > cone;
      l.s.visible = on;
      if (on) {
        l.s.position.copy(dir).add(drop.set(0, -0.026 * Math.max(0.3, this.fov / 60), 0)).normalize().multiplyScalar(R_BODY - 0.5);
        l.s.scale.set(labelH * 3.2, labelH * 0.8, 1);
        l.s.material.opacity = Math.max(0.3, Math.min(1, 1.05 - l.mag * 0.12)) * (1 - day);
      }
    }
    // The constellations' names fade in as the view widens.
    const conK = Math.min(1, Math.max(0, (this.fov - 24) / 24));
    for (const l of this.conLabels) {
      dir.copy(l.v).applyMatrix4(this.skyGroup.matrix).normalize();
      const on = this.showLines && conK > 0 && dir.y > 0.07 && day < 0.6 && dir.dot(look) > cone;
      l.s.visible = on;
      if (on) {
        l.s.position.copy(dir).multiplyScalar(R_BODY - 0.5);
        l.s.scale.set(labelH * 5.6, labelH * 1.4, 1);
        l.s.material.opacity = 0.62 * conK * (1 - day);
      }
    }
    // Nebulae, clusters and galaxies: a soft glow the size of the real thing, with a name.
    for (const d of this.dsos) {
      dir.copy(d.v).applyMatrix4(this.skyGroup.matrix).normalize();
      const up = dir.y > -0.02 && day < 0.7;
      const deg = Math.max(0.9, d.def.dim / 60) * (d.def.type === "oc" || d.def.type === "gc" ? 0.95 : 1.45);
      // From the city only the brightest survive.
      const faint = (d.def.mag ?? 6) - 3.5;
      const seen = (1 - day) * (1 - city * Math.min(1, Math.max(0.55, faint * 0.5)));
      d.sprite.visible = up && seen > 0.02;
      if (d.sprite.visible) {
        d.sprite.position.copy(dir).multiplyScalar(R_BODY - 1);
        d.sprite.scale.setScalar(2 * R_BODY * Math.tan((deg * RAD) / 2));
        d.sprite.material.opacity = 0.9 * seen;
      }
      const near = dir.dot(look) > cone;
      d.label.visible = this.showNames && up && near && this.fov < 80 && seen > 0.3 && (this.fov < 35 || !/^M\d+/.test(d.def.name));
      if (d.label.visible) {
        d.label.position.copy(dir).add(drop.set(0, -Math.sin((deg * 0.5 + 0.9) * RAD) - 0.01, 0)).normalize().multiplyScalar(R_BODY - 0.5);
        d.label.scale.set(labelH * 4.2, labelH * 1.05, 1);
        d.label.material.opacity = 0.9 * seen;
      }
    }
    for (const c of this.compass) {
      c.s.position.copy(c.v);
      c.s.scale.set(labelH * 3.2 * 1.2, labelH * 0.8 * 1.2, 1);
    }
  }

  /** Put the view somewhere at once (no flight). */
  setView(az: number, alt: number, fov: number) {
    this.az = az;
    this.alt = alt;
    this.fov = fov;
    this.glide = null;
  }

  /** The Sun, and every planet as a real lit, textured, turning sphere (Saturn with rings, the gas giants with their moons). */
  private buildSolids() {
    const loader = new THREE.TextureLoader();
    const glow = glowTexture();
    const mk = (r: number, g: number, b: number) => new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: new THREE.Color(r, g, b), transparent: true, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false }));
    this.sunGlow = mk(1, 0.8, 0.5);
    this.sunCore = mk(1.5, 1.4, 1.15);
    this.sunGlow.renderOrder = 3;
    this.sunCore.renderOrder = 3;
    this.sunGlow.visible = this.sunCore.visible = false;
    this.scene.add(this.sunGlow, this.sunCore);

    const ATMO: Partial<Record<BodyId, { colour: number; k: number }>> = { venus: { colour: 0xffe2a0, k: 1.5 }, mars: { colour: 0xffa878, k: 0.6 } };
    for (const id of IDS) {
      const group = new THREE.Group();
      const grey = new THREE.DataTexture(new Uint8Array([140, 136, 128, 255]), 1, 1);
      grey.needsUpdate = true;
      const pu: Solid["pu"] = { uMap: { value: grey }, uL: { value: new THREE.Vector3(0, 0, 1) }, uAmb: { value: 0.02 }, uTint: { value: id === "moon" ? new THREE.Vector3(0.62, 0.72, 0.95) : new THREE.Vector3(1, 1, 1) }, uOpaque: { value: id === "moon" ? 1 : 0 } };
      const ball = new THREE.Mesh(new THREE.SphereGeometry(1, 72, 54), new THREE.ShaderMaterial({ vertexShader: PLANET_VERT, fragmentShader: PLANET_FRAG, uniforms: pu, transparent: true }));
      ball.scale.y = FLAT_Y[id];
      ball.renderOrder = 4;
      group.add(ball);
      loader.load(PLANET_MAP[id], (t) => {
        if (this.disposed) return;
        t.anisotropy = 8;
        pu.uMap.value = t;
      });

      let shellU: Solid["shellU"] = null;
      const a = ATMO[id];
      if (a) {
        shellU = { uColor: { value: new THREE.Color(a.colour) }, uSunV: { value: new THREE.Vector3(0, 0, 1) }, uK: { value: a.k } };
        const shell = new THREE.Mesh(new THREE.SphereGeometry(1.07, 48, 36), new THREE.ShaderMaterial({ vertexShader: ATMO_VERT, fragmentShader: ATMO_FRAG, uniforms: shellU, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
        shell.renderOrder = 5;
        group.add(shell);
      }

      let rings: THREE.Mesh | null = null;
      let ringU: Solid["ringU"] = null;
      if (id === "saturn") {
        const inner = 1.24;
        const outer = 2.3;
        const rg = new THREE.RingGeometry(inner, outer, 160, 1);
        const pos = rg.attributes.position;
        const uv = rg.attributes.uv;
        for (let i = 0; i < pos.count; i++) uv.setXY(i, (Math.hypot(pos.getX(i), pos.getY(i)) - inner) / (outer - inner), 0.5);
        ringU = { uMap: { value: null }, uSun: { value: new THREE.Vector3() }, uCenter: { value: new THREE.Vector3() }, uR: { value: 1 } };
        rings = new THREE.Mesh(rg, new THREE.ShaderMaterial({ vertexShader: RING_VERT, fragmentShader: RING_FRAG, uniforms: ringU, transparent: true, side: THREE.DoubleSide, depthWrite: false }));
        rings.renderOrder = 5;
        rings.visible = false;
        group.add(rings);
        const ru = ringU;
        const rm = rings;
        loader.load("/sky/saturn_ring_alpha.png", (t) => {
          if (this.disposed) return;
          ru.uMap.value = t;
          rm.visible = true;
        });
      }

      const sats = moonsOf(id).map((def) => {
        const dot = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), new THREE.MeshBasicMaterial({ color: def.colour }));
        const halo = new THREE.Mesh(new THREE.SphereGeometry(2.2, 14, 10), new THREE.MeshBasicMaterial({ color: def.colour, transparent: true, opacity: 0.2, depthWrite: false, blending: THREE.AdditiveBlending }));
        dot.renderOrder = halo.renderOrder = 5;
        group.add(dot, halo);
        const label = textSprite(def.name, 24, "rgba(236,226,200,0.92)");
        label.visible = false;
        this.scene.add(label);
        return { def, dot, halo, label };
      });
      this.scene.add(group);
      this.solids.set(id, { group, ball, pu, shellU, rings, ringU, sats, radiusDeg: 0.5 });
    }
  }

  /** Where each planet is drawn, how it is turned and lit, and where its moons are, for the time on screen. */
  private placeSolids(labelH: number) {
    const fov = this.fov;
    const boost = 1 + 7 * smooth(40, 9, fov);
    const sunV = this.skyU.uSun.value;
    // The Sun: a hard bright core in a wide glow that reddens as it sinks.
    const salt = this.skyU.uSunAlt.value;
    const showSun = salt > -3.5;
    this.sunCore.visible = showSun;
    this.sunGlow.visible = showSun;
    if (showSun) {
      const low = 1 - smooth(0, 25, salt);
      const p = sunV.clone().multiplyScalar(R_BODY - 1);
      this.sunCore.position.copy(p);
      this.sunGlow.position.copy(p);
      this.sunCore.scale.setScalar(2 * R_BODY * Math.tan(1.1 * RAD) * Math.max(0.55, Math.min(1.4, fov / 60)));
      this.sunGlow.scale.setScalar(2 * R_BODY * Math.tan((9 + 14 * low) * RAD) * Math.max(0.4, Math.min(1.3, fov / 55)));
      const gm = this.sunGlow.material as THREE.SpriteMaterial;
      gm.color.setRGB(1, 0.78 - 0.28 * low, 0.52 - 0.34 * low);
      gm.opacity = Math.min(1, (salt + 3.5) / 8);
    }

    this.camera.updateMatrixWorld();
    const inv = this.camera.matrixWorldInverse.copy(this.camera.matrixWorld).invert();
    const jd = julianDay(new Date(this.sim)) - MEEUS_EPOCH;
    if (this.inspectId && this.pointers.size === 0 && Math.abs(this.yawVel) > 0.01) {
      this.userYaw += this.yawVel * this.dt;
      this.yawVel *= Math.pow(0.05, this.dt);
    }
    const Y = new THREE.Vector3(0, 1, 0);
    const Zr = new THREE.Vector3(0, 0, 1);

    for (const [id, e] of this.bodies) {
      const s = this.solids.get(id);
      if (!s) continue;
      const up = e.body.alt > -2;
      s.group.visible = up;
      if (!up) {
        for (const m of s.sats) m.label.visible = false;
        continue;
      }
      const ang = Math.max(REAL_ANG[id], fov * DISC_K[id] * boost);
      s.radiusDeg = ang;
      const R = R_BODY * Math.tan(ang * RAD);
      const p = e.dir.clone().multiplyScalar(R_BODY);
      s.group.position.copy(p);
      s.group.scale.setScalar(R);

      // The planet's frame as we see it: its axis points up the screen (Saturn's tipped by the real ring angle) and its near face looks at us.
      const v = e.dir.clone().negate();
      const w = Y.clone().addScaledVector(v, -v.y);
      if (w.lengthSq() < 1e-4) w.set(1, 0, 0);
      w.normalize();
      const B = id === "saturn" ? (e.body.ringTilt ?? 8) * RAD : 0;
      const n = v.clone().multiplyScalar(Math.sin(B)).addScaledVector(w, Math.cos(B)).normalize();
      const zc = v.clone().addScaledVector(n, -v.dot(n)).normalize();
      const xc = new THREE.Vector3().crossVectors(n, zc);
      const mine = id === this.inspectId;
      if (mine && this.userPitch) {
        // Tipped by the viewer: the axis, the rings and the moons all go with it.
        const qp = new THREE.Quaternion().setFromAxisAngle(xc, this.userPitch);
        n.applyQuaternion(qp);
        zc.applyQuaternion(qp);
      }
      const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(xc, n, zc));
      const hrs = DAY_H[id];
      const spin = hrs ? ((this.sim / 3600_000 / hrs) % 1) * Math.PI * 2 : 0;
      s.ball.quaternion.copy(q).multiply(new THREE.Quaternion().setFromAxisAngle(Y, -Math.PI / 2 + spin + (mine ? this.userYaw : 0)));

      // Which way the Sun's light falls on it: along the line of sight when it is full, from the side of the Sun when it is a crescent.
      const sp = sunV.clone().addScaledVector(v, -sunV.dot(v));
      if (sp.lengthSq() < 1e-6) sp.copy(w);
      sp.normalize();
      const phi = Math.acos(Math.max(-1, Math.min(1, 2 * e.body.illum - 1)));
      const L = v.clone().multiplyScalar(Math.cos(phi)).addScaledVector(sp, Math.sin(phi)).normalize();
      // "Lit all round": light it from where we stand, so every side turned towards us is bright.
      if (mine && this.fullLight) L.copy(v);
      s.pu.uL.value.copy(L);
      // Earthshine: the Moon's dark side glows a little, most when it is a thin crescent.
      s.pu.uAmb.value = id === "moon" ? 0.05 + 0.3 * (1 - e.body.illum) : 0.012;
      if (s.shellU) s.shellU.uSunV.value.copy(L.clone().transformDirection(inv));
      if (s.rings && s.ringU) {
        s.rings.quaternion.setFromUnitVectors(Zr, n);
        s.ringU.uSun.value.copy(L);
        s.ringU.uCenter.value.copy(p);
        s.ringU.uR.value = R;
      }

      // Moons on their orbits, in the planet's equatorial plane.
      for (const m of s.sats) {
        const u = ((m.def.u0 + m.def.rate * jd) * Math.PI) / 180;
        const local = xc.clone().multiplyScalar(m.def.r * Math.sin(u)).addScaledVector(zc, -m.def.r * Math.cos(u));
        m.dot.position.copy(local);
        m.halo.position.copy(local);
        const k = (labelH * 0.2) / R;
        m.dot.scale.setScalar(k);
        m.halo.scale.setScalar(k);
        const near = fov < 30;
        m.dot.visible = m.halo.visible = near;
        m.label.visible = near;
        if (near) {
          m.label.position.copy(p).addScaledVector(local, R).addScaledVector(w, labelH * 1.2);
          m.label.scale.set(labelH * 3.6, labelH * 0.9, 1);
        }
      }
    }
  }

  private updateMeteor(dt: number, t: number) {
    const m = this.meteor;
    if (this.uniforms.uDay.value > 0.5) {
      m.line.visible = false;
      return;
    }
    if (!m.line.visible) {
      m.next -= dt;
      if (m.next > 0) return;
      // A streak somewhere in the part of the sky we are looking at.
      const az = this.az + (this.rand() - 0.5) * this.fov * 0.8;
      const alt = Math.max(15, Math.min(80, this.alt + (this.rand() - 0.2) * this.fov * 0.5));
      const len = (6 + this.rand() * 9) * Math.max(0.3, this.fov / 70);
      const ang = this.rand() * Math.PI * 2;
      m.from = hor(az, alt, R_BODY - 2);
      m.to = hor(az + Math.cos(ang) * len, alt + Math.sin(ang) * len, R_BODY - 2);
      m.t = 0;
      m.dur = 0.45 + this.rand() * 0.4;
      m.line.visible = true;
      void t;
      return;
    }
    m.t += dt;
    const p = m.t / m.dur;
    if (p >= 1) {
      m.line.visible = false;
      m.next = 9 + this.rand() * 18;
      return;
    }
    const head = m.from.clone().lerp(m.to, p);
    const tail = m.from.clone().lerp(m.to, Math.max(0, p - 0.35));
    const a = m.line.geometry.getAttribute("position") as THREE.BufferAttribute;
    a.setXYZ(0, tail.x, tail.y, tail.z);
    a.setXYZ(1, head.x, head.y, head.z);
    a.needsUpdate = true;
    const f = Math.sin(Math.PI * p);
    const c = m.line.geometry.getAttribute("color") as THREE.BufferAttribute;
    c.setXYZ(1, f, f, f * 0.95);
    c.needsUpdate = true;
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    for (const c of this.cleanup) c();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      for (const x of Array.isArray(mat) ? mat : mat ? [mat] : []) {
        (x as THREE.SpriteMaterial).map?.dispose();
        x.dispose();
      }
    });
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}
