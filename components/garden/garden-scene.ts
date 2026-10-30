import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { Sky } from "three/addons/objects/Sky.js";
import { mergeGeometries, mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";
import { BlendFunction, BloomEffect, Effect, EffectAttribute, EffectComposer, EffectPass, KernelSize, RenderPass, SMAAEffect, SMAAPreset, VignetteEffect } from "postprocessing";

/** Tilt-shift: the top and bottom of the frame go softly out of focus, like a photo of a model. */
class TiltShiftEffect extends Effect {
  constructor() {
    super(
      "GardenTiltShift",
      /* glsl */ `
      uniform float focus;
      uniform float spread;
      void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
        float d = smoothstep(spread, spread + 0.25, abs(uv.y - focus)) * 0.85;
        if (d < 0.01) { outputColor = inputColor; return; }
        vec2 px = texelSize * (1.0 + d * 5.0);
        vec4 c = inputColor * 0.2;
        c += texture2D(inputBuffer, uv + vec2( px.x, 0.0)) * 0.1;
        c += texture2D(inputBuffer, uv + vec2(-px.x, 0.0)) * 0.1;
        c += texture2D(inputBuffer, uv + vec2(0.0,  px.y)) * 0.1;
        c += texture2D(inputBuffer, uv + vec2(0.0, -px.y)) * 0.1;
        c += texture2D(inputBuffer, uv + px * 1.6) * 0.1;
        c += texture2D(inputBuffer, uv - px * 1.6) * 0.1;
        c += texture2D(inputBuffer, uv + vec2(px.x, -px.y) * 1.6) * 0.1;
        c += texture2D(inputBuffer, uv + vec2(-px.x, px.y) * 1.6) * 0.1;
        outputColor = mix(inputColor, c, d);
      }`,
      { attributes: EffectAttribute.CONVOLUTION, uniforms: new Map([["focus", new THREE.Uniform(0.5)], ["spread", new THREE.Uniform(0.34)]]) },
    );
  }
}

/** Exposure, then filmic tone mapping, with a touch of warmth in the highlights. */
class GradeEffect extends Effect {
  constructor() {
    super(
      "GardenGrade",
      /* glsl */ `
      uniform float exposure;
      vec3 aces(vec3 x) { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
      void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
        vec3 c = aces(inputColor.rgb * exposure);
        float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
        c += vec3(-0.01, 0.0, 0.018) * (1.0 - smoothstep(0.0, 0.35, l));
        c += vec3(0.02, 0.008, -0.012) * smoothstep(0.45, 1.0, l);
        c = mix(vec3(l), c, 1.14);
        c = mix(c, c * c * (3.0 - 2.0 * c), 0.25);
        outputColor = vec4(c, inputColor.a);
      }`,
      { blendFunction: BlendFunction.NORMAL, uniforms: new Map([["exposure", new THREE.Uniform(1)]]) },
    );
  }
}
import { type Phase } from "./phase";
import { windStrength } from "@/lib/sky";
import { fireflyCount, hash01, homeSpot, islandSize, pathX, POND_ANGLE, pondSpot, type Placed, type Season } from "@/lib/garden-layout";

/**
 * Nova's garden in 3D: a floating island lit by the real sky of the hour. Thousands of grass blades
 * bend in rolling gusts (and part around the pet), flowers and trees sway with the same wind, a pond
 * spills over the edge as a waterfall, a sea of clouds drifts far below, and at night the lamps,
 * cottage windows, fireflies and crystals glow. Drag to look around; tap anything to visit it.
 *
 * The pet itself is drawn by the page (the same creature as everywhere else), placed over the
 * canvas each frame from where it stands in the scene.
 */

export type FrameInfo = {
  pet: { x: number; y: number; size: number; facing: number; hidden: boolean } | null;
  tip: { x: number; y: number } | null;
};
export type GardenCallbacks = { onPick: (id: string) => void; onFrame: (f: FrameInfo) => void };
/** `mini`: the small live view in a corner while a song plays (low quality, no fly-in, no touching). */
type Opts = { n: number; phase: Phase; wet: boolean; butterflies: number; lit: boolean; mini?: boolean; /** Rare visitors earned by milestones: an owl on the tallest tree, a deer by the grass. */ visitors?: ("owl" | "deer")[]; /** How the last night check-in went (1 rough to 5 great), or null: tints the light. */ mood?: number | null; /** Days of habit streak: the swarm of golden fireflies. */ streak?: number; /** Spring, summer, autumn or winter: grass, leaves and what drifts through the air. */ season?: Season };

/** Each season's grass (the blade's foot and its tip, in full daylight; the tip dims at dusk and night). */
const SEASON_GRASS: Record<Season, { base: string; tip: string }> = {
  spring: { base: "#2a5426", tip: "#b9ea72" },
  summer: { base: "#244a1c", tip: "#a6d65a" },
  autumn: { base: "#4a4a1c", tip: "#dfa543" },
  winter: { base: "#2a4a3c", tip: "#b3d5c7" },
};
/** Each season's leaves: [dark, light] for pines, blossom trees and ordinary broadleaf trees. */
const SEASON_LEAF: Record<Season, { pine: [string, string]; blossom: [string, string]; leaf: [string, string] }> = {
  spring: { pine: ["#1f4a2a", "#3d7a45"], blossom: ["#d9659a", "#ffd0e6"], leaf: ["#3a7a30", "#a4dc62"] },
  summer: { pine: ["#1f4a2a", "#3d7a45"], blossom: ["#c96b93", "#ffc4dc"], leaf: ["#2f6b2c", "#7fbf4a"] },
  autumn: { pine: ["#27452a", "#4b7a3f"], blossom: ["#b0482a", "#f0a070"], leaf: ["#8a3a14", "#f2b13e"] },
  winter: { pine: ["#2b4a3a", "#8fb3a0"], blossom: ["#8f7686", "#e8dcea"], leaf: ["#4a6652", "#a8c8b8"] },
};
/** What drifts through the air: petals in spring, leaves in autumn, frost sparkles in winter (summer has its pollen already). */
const SEASON_FALL: Partial<Record<Season, { count: number; size: number; speed: number; shape: 0 | 1 | 2; colors: [string, string, string] }>> = {
  spring: { count: 110, size: 11, speed: 0.4, shape: 0, colors: ["#ffb7d1", "#ffe3ef", "#ff95bb"] },
  autumn: { count: 120, size: 9, speed: 0.6, shape: 1, colors: ["#e8742a", "#c0392b", "#f0b83a"] },
  winter: { count: 130, size: 4.5, speed: 0.28, shape: 2, colors: ["#ffffff", "#d6ecff", "#eef6ff"] },
};


/* ── tiny noise (value noise + fbm), enough for rocks and colour variation ── */
function hash3(x: number, y: number, z: number) {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return s - Math.floor(s);
}
function noise3(x: number, y: number, z: number) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const xf = x - xi;
  const yf = y - yi;
  const zf = z - zi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const w = zf * zf * (3 - 2 * zf);
  const l = (a: number, b: number, t: number) => a + (b - a) * t;
  const c = (dx: number, dy: number, dz: number) => hash3(xi + dx, yi + dy, zi + dz);
  return l(l(l(c(0, 0, 0), c(1, 0, 0), u), l(c(0, 1, 0), c(1, 1, 0), u), v), l(l(c(0, 0, 1), c(1, 0, 1), u), l(c(0, 1, 1), c(1, 1, 1), u), v), w);
}
function fbm(x: number, y: number, z: number, oct = 4) {
  let a = 0.5;
  let f = 1;
  let s = 0;
  for (let i = 0; i < oct; i++) {
    s += a * noise3(x * f, y * f, z * f);
    f *= 2.03;
    a *= 0.5;
  }
  return s;
}

/** The wind, shared by grass, flowers and trees (GLSL): a steady sway plus gusts rolling across. */
const WIND_GLSL = /* glsl */ `
  uniform float uBeat;
  uniform float uWind;
  float windAt(vec3 p, float t) {
    float gust = pow(sin(p.x * 0.22 + p.z * 0.08 - t * 1.25) * 0.5 + 0.5, 3.0) * 1.3;
    float sway = sin(t * 1.9 + p.x * 0.7 + p.z * 0.45) * 0.28 + sin(t * 1.1 + p.z * 0.33) * 0.18;
    // While a song plays, the sway grows gently with how loud it is (smoothed: no jolts).
    return (sway + gust) * (1.0 + uBeat * 0.45) * uWind;
  }
`;
const WIND_DIR = "vec2(0.94, 0.34)";

/** Sky and light for each part of the day. Sun direction points from the island towards the sun. */
const LOOK: Record<Phase, { sun: [number, number, number]; sunCol: string; sunI: number; sky: string; ground: string; hemiI: number; fog: string; turb: number; ray: number; exp: number; cloud: string }> = {
  dawn: { sun: [-0.85, 0.12, -0.35], sunCol: "#ffb98f", sunI: 2.2, sky: "#ffcfb8", ground: "#4a3c3c", hemiI: 0.75, fog: "#e7b8a6", turb: 6, ray: 2.6, exp: 0.62, cloud: "#ffd4c4" },
  day: { sun: [0.45, 0.82, 0.35], sunCol: "#fff4e2", sunI: 3.1, sky: "#b8dcff", ground: "#4f6a3c", hemiI: 0.85, fog: "#8fbfe6", turb: 1.6, ray: 2.2, exp: 0.48, cloud: "#ffffff" },
  golden: { sun: [0.82, 0.2, -0.53], sunCol: "#ffc27a", sunI: 2.9, sky: "#ffd9a8", ground: "#5a4a2e", hemiI: 0.7, fog: "#f0c896", turb: 4.5, ray: 2.0, exp: 0.55, cloud: "#ffe0b8" },
  dusk: { sun: [-0.72, 0.05, -0.69], sunCol: "#ff8f5e", sunI: 1.7, sky: "#b48fb6", ground: "#3a2c3a", hemiI: 0.65, fog: "#c58c8c", turb: 7, ray: 3, exp: 0.6, cloud: "#f0b0a8" },
  night: { sun: [0.4, 0.75, -0.5], sunCol: "#9fb6ff", sunI: 0.7, sky: "#33467c", ground: "#0d1326", hemiI: 0.7, fog: "#0b1430", turb: 1, ray: 0.1, exp: 0.5, cloud: "#2c3962" },
};

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** Geometry with one vertex per triangle corner (some shapes already are; converting again only warns). */
const unindexed = (g: THREE.BufferGeometry) => (g.index ? g.toNonIndexed() : g);

/** A soft round puff, drawn once into a canvas (clouds, mist, smoke, glows). */
/** A music note (white with a dark rim, so it reads on a sunny sky too); the sprite tints it. */
function noteTexture(glyph: string) {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  g.font = "bold 100px 'Segoe UI Symbol', 'Noto Music', 'Apple Symbols', serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.lineWidth = 10;
  g.strokeStyle = "rgba(20,10,30,0.55)";
  g.strokeText(glyph, 64, 70);
  g.fillStyle = "#ffffff";
  g.fillText(glyph, 64, 70);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function puffTexture(kind: "cloud" | "glow") {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  if (kind === "glow") {
    const r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    r.addColorStop(0, "rgba(255,255,255,1)");
    r.addColorStop(0.25, "rgba(255,255,255,0.55)");
    r.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = r;
    g.fillRect(0, 0, 128, 128);
  } else {
    for (let i = 0; i < 26; i++) {
      const x = 30 + hash01(`cx${i}`) * 68;
      const y = 40 + hash01(`cy${i}`) * 50;
      const rad = 14 + hash01(`cr${i}`) * 26;
      const r = g.createRadialGradient(x, y, 0, x, y, rad);
      r.addColorStop(0, "rgba(255,255,255,0.5)");
      r.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = r;
      g.fillRect(0, 0, 128, 128);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** A cluster of leaves (light greys, tinted by the material), for the foliage cards on trees. */
function leafTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  for (let i = 0; i < 16; i++) {
    const x = 22 + hash01(`lx${i}`) * 84;
    const y = 22 + hash01(`ly${i}`) * 84;
    const v = Math.round(150 + hash01(`lv${i}`) * 105);
    g.save();
    g.translate(x, y);
    g.rotate(hash01(`la${i}`) * Math.PI * 2);
    g.fillStyle = `rgb(${v},${v},${v})`;
    g.beginPath();
    g.ellipse(0, 0, 15, 7, 0, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = `rgba(0,0,0,0.25)`;
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(-13, 0);
    g.lineTo(13, 0);
    g.stroke();
    g.restore();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * A kolam drawn into a canvas: a dot grid looped with white rice-flour lines (Pongal), or a round
 * rangoli in festival colours (Deepavali).
 */
/** The Indian flag: saffron, white and green bands with the navy chakra. */
function flagTexture() {
  const c = document.createElement("canvas");
  c.width = 384;
  c.height = 256;
  const g = c.getContext("2d")!;
  const band = c.height / 3;
  g.fillStyle = "#ff9933";
  g.fillRect(0, 0, c.width, band);
  g.fillStyle = "#f8f8f4";
  g.fillRect(0, band, c.width, band);
  g.fillStyle = "#138808";
  g.fillRect(0, band * 2, c.width, band);
  g.translate(c.width / 2, c.height / 2);
  g.strokeStyle = "#000080";
  g.lineWidth = 3;
  g.beginPath();
  g.arc(0, 0, 34, 0, Math.PI * 2);
  g.stroke();
  g.lineWidth = 1.6;
  for (let k = 0; k < 24; k++) {
    const a = (k / 24) * Math.PI * 2;
    g.beginPath();
    g.moveTo(Math.cos(a) * 6, Math.sin(a) * 6);
    g.lineTo(Math.cos(a) * 34, Math.sin(a) * 34);
    g.stroke();
  }
  g.fillStyle = "#000080";
  g.beginPath();
  g.arc(0, 0, 5, 0, Math.PI * 2);
  g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function kolamTexture(kind: "pulli" | "rangoli") {
  const c = document.createElement("canvas");
  c.width = c.height = 512;
  const g = c.getContext("2d")!;
  g.lineCap = "round";
  // Swept, washed earth under it (the traditional ground for a kolam).
  const wash = g.createRadialGradient(256, 256, 120, 256, 256, 256);
  wash.addColorStop(0, kind === "pulli" ? "rgba(122,78,44,0.95)" : "rgba(96,58,36,0.9)");
  wash.addColorStop(1, "rgba(122,78,44,0)");
  g.fillStyle = wash;
  g.fillRect(0, 0, 512, 512);
  if (kind === "pulli") {
    const n = 5;
    const step = 80;
    const o = 256 - ((n - 1) * step) / 2;
    g.strokeStyle = "rgba(255,255,255,0.97)";
    g.lineWidth = 14;
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) {
        const x = o + i * step;
        const y = o + j * step;
        // Loops around every dot, petals between neighbours.
        g.beginPath();
        g.arc(x, y, 26, 0, Math.PI * 2);
        g.stroke();
        if (i < n - 1 && j < n - 1) {
          g.beginPath();
          g.ellipse(x + step / 2, y + step / 2, 30, 12, Math.PI / 4, 0, Math.PI * 2);
          g.stroke();
          g.beginPath();
          g.ellipse(x + step / 2, y + step / 2, 30, 12, -Math.PI / 4, 0, Math.PI * 2);
          g.stroke();
        }
      }
    g.fillStyle = "#fff";
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) g.fillRect(o + i * step - 7, o + j * step - 7, 14, 14);
    g.strokeStyle = "rgba(255,90,90,0.9)";
    g.lineWidth = 12;
    g.strokeRect(20, 20, 472, 472);
  } else {
    const cols = ["#ff3d6e", "#ffb000", "#00c2a8", "#7c4dff", "#ff7a00", "#2ecc71"];
    for (let ring = 6; ring >= 1; ring--) {
      const r = ring * 38;
      const petals = 6 + ring * 2;
      g.fillStyle = cols[ring % cols.length];
      for (let k = 0; k < petals; k++) {
        const a = (k / petals) * Math.PI * 2;
        g.save();
        g.translate(256 + Math.cos(a) * r * 0.75, 256 + Math.sin(a) * r * 0.75);
        g.rotate(a);
        g.beginPath();
        g.ellipse(0, 0, r * 0.32, r * 0.14, 0, 0, Math.PI * 2);
        g.fill();
        g.restore();
      }
    }
    g.fillStyle = "#fff6d0";
    g.beginPath();
    g.arc(256, 256, 30, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** A butterfly wing / letter drawn into a canvas. */
function shapeTexture(kind: "wing" | "z") {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  g.fillStyle = "#fff";
  if (kind === "wing") {
    g.beginPath();
    g.ellipse(34, 24, 26, 18, -0.3, 0, Math.PI * 2);
    g.fill();
    g.beginPath();
    g.ellipse(28, 46, 16, 12, 0.4, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "rgba(0,0,0,0.35)";
    g.beginPath();
    g.arc(40, 22, 5, 0, Math.PI * 2);
    g.fill();
  } else {
    g.font = "bold 52px sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText("z", 32, 34);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** The little of WebXR that AR needs (kept local: the DOM typings don't include it). */
type XRFrameLike = { getHitTestResults(src: unknown): { getPose(space: unknown): { transform: { matrix: ArrayLike<number> } } | null }[] };
type XRSessionLike = {
  addEventListener(type: "end" | "select", fn: () => void): void;
  end(): Promise<void>;
  requestReferenceSpace(kind: string): Promise<unknown>;
  requestHitTestSource(opts: { space: unknown }): Promise<unknown>;
};
type XRSystemLike = { isSessionSupported(mode: string): Promise<boolean>; requestSession(mode: string, init: Record<string, unknown>): Promise<XRSessionLike> };
/** What AR changed, so leaving puts everything back. */
type ArState = {
  session: XRSessionLike;
  holder: THREE.Group;
  root: THREE.Group;
  reticle: THREE.Mesh;
  sprite: THREE.Sprite;
  hitSource: unknown;
  placed: boolean;
  scale: number;
  saved: { background: THREE.Scene["background"]; fog: THREE.Scene["fog"]; near: number; shadow: boolean; vis: Map<THREE.Object3D, boolean> };
  onEnd: () => void;
  onState: (s: "find" | "placed") => void;
};
/** How wide the island is on the table, in metres. */
const AR_WIDTH_M = 0.55;

export class GardenScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(36, 1, 0.1, 6000);
  private controls: OrbitControls;
  private composer: EffectComposer | null = null;
  private bloom: BloomEffect | null = null;
  private grade: GradeEffect | null = null;
  private clock = new THREE.Clock();
  private raf = 0;
  private disposed = false;
  /** Set while the garden is shown on a real table through the camera (see enterAR). */
  private xr: ArState | null = null;
  private farIslands: THREE.Object3D[] = [];
  private mobile: boolean;
  private reduced: boolean;
  private quality: "high" | "low";
  private fps = { frames: 0, time: 0, slow: 0 };

  /* world */
  private R: number;
  private D: number;
  private isl: ReturnType<typeof islandSize>;
  private uTime = { value: 0 };
  private uPet = { value: new THREE.Vector3(0, 0, 999) };
  /* music: a beat (decays fast), a drop flash, and the music lights' colour while a song plays */
  private uBeat = { value: 0 };
  /** The real wind: 1 is the usual breeze (see windStrength). */
  private uWind = { value: 1 };
  /** Light rings on the grass: start time and strength of the last four. */
  private uRip = { value: [new THREE.Vector2(-99, 0), new THREE.Vector2(-99, 0), new THREE.Vector2(-99, 0), new THREE.Vector2(-99, 0)] };
  private ripNext = 0;
  private lastRip = -99;
  private uMusicCol = { value: new THREE.Color(1, 0.7, 0.3) };
  /** The song's loudness right now (0..1), set by the page from the music lights. */
  private musicLevel = 0;
  private dropFlash = 0;
  private musicRgb: THREE.Color | null = null;
  /** Daylight (1) or dark (0): by day the music's light is painted on, since added light vanishes in the sun. */
  private uMusicDay = { value: 1 };
  /** Eases to 1 while a song plays: the daytime confetti fades in and out with it. */
  private uMusicOn = { value: 0 };
  private confetti: THREE.Points | null = null;
  /** Each beat's kick (jumps up on the beat, falls away fast): what flowers, trees and lamps bounce to. */
  private uKick = { value: 0 };
  /** Eases to 1 while a song plays (day or night): colours and the stage lights fade in and out with it. */
  private uMusicMix = { value: 0 };
  private trees: { g: THREE.Group; base: THREE.Vector3; ph: number }[] = [];
  private beams: { g: THREE.Group; ph: number; mat: THREE.ShaderMaterial }[] = [];
  /** Butterflies' own clock, which runs faster while a song plays (a plain multiplier on time would jump). */
  private flyT = 0;
  private flapT = 0;
  private musicWas = false;
  private haloMats: THREE.SpriteMaterial[] = [];
  /** The disco ball over the island, and how far its light spots have turned. */
  private ball: THREE.Group | null = null;
  private uBallRot = { value: 0 };
  /** Music notes floating up from the flowers and the cottage. */
  private notes: { sp: THREE.Sprite; t0: number; from: THREE.Vector3; ph: number }[] = [];
  private noteFrom: THREE.Vector3[] = [];
  private lastNote = -99;
  private sun = new THREE.DirectionalLight();
  private hemi = new THREE.HemisphereLight();
  private skyMesh: Sky | null = null;
  private nightSky = new THREE.Group();
  private nightOnly: THREE.Object3D[] = [];
  private dayOnly: THREE.Object3D[] = [];
  private grass: THREE.InstancedMesh | null = null;
  private grassCount = 0;
  private grassOrig: Float32Array | null = null;
  /** Bare earth round each habit plant, so a small seed is not lost in the grass. */
  private plantClear: { x: number; z: number; r: number }[] = [];
  private grassXZ: Float32Array | null = null;
  private decorClear: { x: number; z: number; r: number }[] = [];
  private grassMat: THREE.ShaderMaterial | null = null;
  private ground: THREE.Mesh | null = null;
  private island = new THREE.Group();
  private pickables: THREE.Object3D[] = [];
  private flowerHeads: { mesh: THREE.InstancedMesh; ids: string[] }[] = [];
  private itemsById = new Map<string, Placed>();
  private bobbers: { o: THREE.Object3D; y: number; sp: number; ph: number; spin?: number }[] = [];
  private lampMats: THREE.MeshStandardMaterial[] = [];
  private lampLights: THREE.PointLight[] = [];
  private windowMats: THREE.MeshStandardMaterial[] = [];
  private crystalMats: THREE.MeshStandardMaterial[] = [];
  private gemMats: THREE.MeshStandardMaterial[] = [];
  private smoke: THREE.Sprite[] = [];
  private zzz: THREE.Sprite[] = [];
  private chimneyTop = new THREE.Vector3();
  private cottage: THREE.Group | null = null;
  private butterflies: { g: THREE.Group; l: THREE.Mesh; r: THREE.Mesh; ph: number; sp: number; rad: number; h: number }[] = [];
  private clouds = new THREE.Group();
  private cloudMats: THREE.SpriteMaterial[] = [];
  private rain: THREE.LineSegments | null = null;
  private animatedMats: THREE.ShaderMaterial[] = [];
  private pmrem: THREE.PMREMGenerator;
  private envRT: THREE.WebGLRenderTarget | null = null;

  /* pet, tip, intro */
  private pet = { from: new THREE.Vector3(), to: new THREE.Vector3(), t0: 0, dur: 0, pos: new THREE.Vector3(), facing: 0 };
  private tip: THREE.Vector3 | null = null;
  private intro = { t0: -1, dur: 3.4, from: new THREE.Spherical(), to: new THREE.Spherical() };
  private idleSince = 0;
  private sleeping = false;
  private lit = false;
  private phase: Phase;
  private wet: boolean;
  private ray = new THREE.Raycaster();
  private down = { x: 0, y: 0, t: 0 };
  private occlusionTick = 0;
  private petHidden = false;

  constructor(
    private canvas: HTMLCanvasElement,
    items: Placed[],
    private opts: Opts,
    private cb: GardenCallbacks,
  ) {
    this.reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.mobile = matchMedia("(pointer: coarse)").matches || Math.min(screen.width, screen.height) < 700;
    this.quality = this.mobile || opts.mini ? "low" : "high";
    this.phase = opts.phase;
    this.wet = opts.wet;
    this.lit = opts.lit;
    this.isl = islandSize(opts.n);
    this.R = this.isl.rx / 45;
    this.D = this.R * 0.95;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: this.quality === "low", powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, opts.mini ? 1.25 : this.mobile ? 1.5 : 1.75));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    // The scene barely moves: shadows are drawn once (and again when something changes).
    this.renderer.shadowMap.autoUpdate = false;
    this.pmrem = new THREE.PMREMGenerator(this.renderer);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.06;
    this.controls.enablePan = false;
    this.controls.rotateSpeed = 0.55;
    this.controls.zoomSpeed = 0.7;
    this.controls.minDistance = this.R * 1.4;
    this.controls.maxDistance = this.R * 5;
    this.controls.minPolarAngle = 0.5;
    this.controls.maxPolarAngle = 1.62;
    this.controls.target.set(0, -this.D * 0.2, 0);
    this.controls.autoRotateSpeed = 0.35;
    this.controls.enabled = false;

    this.buildSky();
    this.buildLights();
    this.buildIsland();
    this.buildGrass();
    this.buildCottage();
    this.buildPond();
    this.buildItems(items);
    this.buildVisitors(opts.visitors ?? []);
    this.buildButterflies(opts.butterflies);
    this.buildParticles();
    this.buildStreak(opts.streak ?? 0);
    this.buildSeason(opts.season ?? "summer");
    this.buildClouds();
    this.buildFarIslands();
    this.buildRain();
    this.scene.add(this.island);
    this.applyLook();

    const door = this.toWorld(homeSpot(opts.n).x, homeSpot(opts.n).y + 5);
    this.pet.pos.copy(door);
    this.pet.from.copy(door);
    this.pet.to.copy(door);

    // The opening: the camera glides in from far out and low, round to its resting place.
    const r0 = this.restRadius();
    this.controls.maxDistance = Math.max(this.R * 5, r0 * 1.35);
    this.intro.to.set(r0, 1.2, 0.32);
    this.intro.from.set(r0 * 2.3, 1.42, -1.1);
    this.placeCamera(this.reduced || opts.mini ? this.intro.to : this.intro.from);
    if (this.reduced || opts.mini) this.finishIntro();
    // The mini view turns slowly on its own and can't be dragged (a tap opens the full garden).
    if (opts.mini) {
      this.controls.enabled = false;
      this.controls.autoRotate = !this.reduced;
    }

    if (this.quality === "high") this.enableHigh();
    this.bind();
    this.renderer.shadowMap.needsUpdate = true;
    this.loop();
  }

  /* ── coordinates ── */

  /** Island-top height at a world point: a gentle dome with soft lumps, rounding off at the rim. */
  private heightAt(x: number, z: number) {
    const r = Math.hypot(x, z) / this.R;
    let h = 0.42 * (1 - r * r) + (fbm(x * 0.35, 0, z * 0.35, 3) - 0.5) * 0.35 * (1 - r);
    if (r > 0.9) h -= Math.pow((r - 0.9) / 0.1, 2) * 0.12;
    return h;
  }
  /** From the page's layout units (the flat garden's picture) to the island in metres. */
  toWorld(x: number, y: number) {
    const wx = ((x - this.isl.cx) / this.isl.rx) * this.R;
    const wz = ((y - this.isl.cy) / this.isl.ry) * this.R;
    return new THREE.Vector3(wx, this.heightAt(wx, wz), wz);
  }
  private restRadius() {
    const a = this.canvas.clientWidth / Math.max(1, this.canvas.clientHeight);
    // Far enough that the island's full width fits, however narrow the screen.
    const halfW = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * a;
    return this.R * Math.max(2.65, 1.06 / halfW);
  }
  private placeCamera(s: THREE.Spherical) {
    const v = new THREE.Vector3().setFromSpherical(s);
    this.camera.position.copy(this.controls.target).add(v);
    this.camera.lookAt(this.controls.target);
  }
  /* ── the moon ── */

  private moon: THREE.Mesh | null = null;
  private moonHalo: THREE.Sprite | null = null;
  /** Where the moon hangs: in the sky the resting camera actually sees (upper right of the picture, however wide the screen is). */
  private placeMoon() {
    if (!this.moon || !this.moonHalo) return;
    const off = new THREE.Vector3().setFromSpherical(new THREE.Spherical(1, 1.2, 0.32));
    const f = off.clone().negate().normalize();
    const right = new THREE.Vector3().crossVectors(f, new THREE.Vector3(0, 1, 0)).normalize();
    const up = new THREE.Vector3().crossVectors(right, f).normalize();
    const halfV = THREE.MathUtils.degToRad(this.camera.fov / 2);
    const halfH = Math.atan(Math.tan(halfV) * (this.camera.aspect || 1.6));
    const dir = f.add(right.multiplyScalar(Math.tan(halfH * -0.6))).add(up.multiplyScalar(Math.tan(halfV * 0.44))).normalize();
    this.moon.position.copy(dir).multiplyScalar(2600);
    this.moon.lookAt(0, 0, 0);
    this.moonHalo.position.copy(this.moon.position);
    // Smaller on a tall, narrow screen, so it doesn't crowd the title.
    const k = Math.min(1, 0.45 + (this.camera.aspect || 1.6) * 0.45);
    this.moon.scale.setScalar(k);
    this.moonHalo.scale.setScalar(520 * k);
  }

  /* ── rare visitors: an owl for a long streak, a deer for many wins ── */

  private visitors = new Map<string, { g: THREE.Group; kind: "owl" | "deer"; ph: number; head: THREE.Object3D; eyes: THREE.Object3D; home: THREE.Vector3; legs: THREE.Object3D[]; state: "graze" | "look" | "walk"; until: number; target: THREE.Vector3; yaw: number; graze: number; sleep: number }>();
  /** (development only, from the test hook) Put the camera close in front of a visitor, to look at it. */
  debugFocus(id: string, dist = 2.2, view: "front" | "side" = "front") {
    const v = this.visitors.get(id);
    if (!v) return;
    this.skipIntro();
    this.controls.minDistance = 0.3;
    const p = v.g.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, v.kind === "owl" ? 0.35 : 0.8, 0));
    this.controls.target.copy(p);
    const yaw = (this.visitors.get(id)?.yaw ?? 0) + (view === "side" ? Math.PI / 2 : 0.4);
    this.camera.position.copy(p).add(new THREE.Vector3(Math.sin(yaw) * dist, v.kind === "owl" ? 0.2 : dist * 0.28, Math.cos(yaw) * dist));
    this.camera.lookAt(p);
    this.controls.autoRotate = false;
  }
  private tipFollow: THREE.Object3D | null = null;
  private tipLift = 1;

  private visitorMesh(g: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    g.add(m);
    return m;
  }
  private blob(r: number, sx: number, sy: number, sz: number) {
    const geo = new THREE.SphereGeometry(r, 14, 10);
    geo.scale(sx, sy, sz);
    return geo;
  }

  /**
   * An owl, perched: a smooth egg-shaped body with a streaked belly, barred folded wings, a fanned tail, a round head with
   * a pale face disc, soft brows, tufted ears, big golden eyes with a gleam (and eyelids that close), a hooked beak and gripping claws.
   */
  private makeOwl() {
    const g = new THREE.Group();
    const std = (color: string, rough = 0.9) => new THREE.MeshStandardMaterial({ color, roughness: rough });
    const back = std("#7a5a3c");
    const backLight = std("#a07e58");
    const dark = std("#4a3322");
    const streak = std("#6a4a30");
    const cream = std("#ecdcbc", 0.95);
    const rim = std("#b08a5e");
    const white = std("#fbf6ea", 0.4);
    const iris = new THREE.MeshStandardMaterial({ color: "#f5b82a", emissive: "#e89a10", emissiveIntensity: 0.45, roughness: 0.35 });
    const black = std("#0f0b08", 0.25);
    const beakMat = std("#d98a2b", 0.55);
    const claw = std("#3a2c22", 0.5);
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = g) => this.visitorMesh(parent, geo, mat, x, y, z);
    // Body: one smooth lathe, wide at the belly and narrowing to the neck.
    const profile = [[0.0, 0.0], [0.07, 0.01], [0.122, 0.07], [0.146, 0.16], [0.138, 0.25], [0.108, 0.32], [0.075, 0.36], [0.0, 0.375]].map(([x, y]) => new THREE.Vector2(x, y));
    const body = add(new THREE.LatheGeometry(profile, 24), back, 0, 0.04, 0);
    body.scale.set(1, 1, 0.92);
    // A pale belly on the front, with neat rows of little dark streaks down it.
    add(this.blob(0.112, 0.92, 1.45, 0.55), cream, 0, 0.2, 0.082);
    for (let row = 0; row < 5; row++) {
      const y = 0.115 + row * 0.044;
      const per = row % 2 ? 4 : 3;
      for (let k = 0; k < per; k++) {
        const x = (k - (per - 1) / 2) * 0.05;
        const ex = x / 0.103;
        const ey = (y - 0.2) / 0.162;
        const inside = 1 - ex * ex - ey * ey;
        if (inside <= 0.05) continue;
        const m = add(this.blob(0.0105, 0.75, 2.4, 0.35), streak, x, y, 0.082 + 0.0616 * Math.sqrt(inside) + 0.004);
        m.rotation.x = -ey * 0.5;
        m.rotation.z = -x * 2.5;
      }
    }
    // Wings folded down the sides: three overlapping layers, darker at the tips.
    for (const s of [-1, 1]) {
      for (let k = 0; k < 3; k++) {
        const w = add(this.blob(0.062 - k * 0.006, 0.4, 1.5 + k * 0.28, 0.85), k === 0 ? back : k === 1 ? backLight : dark, s * (0.128 - k * 0.003), 0.22 - k * 0.05, -0.02 - k * 0.004);
        w.rotation.z = -s * (0.08 + k * 0.03);
        w.rotation.x = 0.05;
      }
    }
    // Tail: a fan of feathers hanging down behind.
    for (let k = -2; k <= 2; k++) {
      const t = add(this.blob(0.034, 0.6, 2.7, 0.3), k % 2 ? dark : back, k * 0.026, 0.05, -0.128 - Math.abs(k) * 0.004);
      t.rotation.x = -0.55;
      t.rotation.z = -k * 0.09;
    }
    // Feet: three toes forward, with dark claws, gripping the perch.
    for (const s of [-1, 1]) {
      add(new THREE.CylinderGeometry(0.014, 0.017, 0.06, 7), beakMat, s * 0.05, 0.035, 0.035);
      for (let k = -1; k <= 1; k++) {
        const toe = add(new THREE.CylinderGeometry(0.008, 0.01, 0.055, 6), beakMat, s * 0.05 + k * 0.016, 0.006, 0.065);
        toe.rotation.x = Math.PI / 2;
        toe.rotation.z = k * 0.2;
        const c = add(new THREE.ConeGeometry(0.008, 0.026, 5), claw, s * 0.05 + k * 0.02, 0.0, 0.1);
        c.rotation.x = Math.PI / 2 + 0.5;
      }
    }
    // The head turns on its own pivot.
    const head = new THREE.Group();
    head.position.set(0, 0.405, 0.012);
    g.add(head);
    add(this.blob(0.122, 1.12, 0.96, 1.0), back, 0, 0, 0, head);
    add(this.blob(0.1, 1.0, 0.7, 0.9), backLight, 0, 0.045, -0.01, head);
    // The face: two pale discs with a soft rim, and a light brow above each eye.
    for (const s of [-1, 1]) {
      const ring = add(new THREE.TorusGeometry(0.066, 0.006, 6, 24), rim, s * 0.06, 0.008, 0.092, head);
      ring.scale.y = 1.05;
      add(this.blob(0.068, 1, 1.02, 0.42), cream, s * 0.06, 0.008, 0.094, head);
      const brow = add(this.blob(0.026, 1.6, 0.4, 0.55), backLight, s * 0.066, 0.058, 0.111, head);
      brow.rotation.z = -s * 0.28;
      const tuft = add(new THREE.ConeGeometry(0.03, 0.095, 5), back, s * 0.082, 0.112, -0.012, head);
      tuft.rotation.z = -s * 0.32;
      const tuftTip = add(new THREE.ConeGeometry(0.017, 0.045, 5), dark, s * 0.092, 0.152, -0.012, head);
      tuftTip.rotation.z = -s * 0.32;
    }
    for (const s of [-1, 1]) {
      add(this.blob(0.046, 1, 1, 0.7), white, s * 0.06, 0.008, 0.118, head);
      add(this.blob(0.038, 1, 1, 0.5), iris, s * 0.06, 0.008, 0.134, head);
      add(this.blob(0.022, 1, 1, 0.5), black, s * 0.06, 0.008, 0.146, head);
      add(this.blob(0.008, 1, 1, 0.6), white, s * 0.052, 0.018, 0.152, head);
    }
    // Eyelids (feather-coloured), open at rest and closed over the eyes when it sleeps or blinks.
    const lids = new THREE.Group();
    head.add(lids);
    for (const s of [-1, 1]) {
      add(this.blob(0.05, 1, 1, 0.8), back, s * 0.06, 0.008, 0.135, lids);
      add(this.blob(0.034, 1, 0.1, 0.3), dark, s * 0.06, -0.012, 0.172, lids);
    }
    lids.scale.y = 0.02;
    // A hooked beak between the eyes.
    const beak = add(new THREE.ConeGeometry(0.02, 0.055, 6), beakMat, 0, -0.018, 0.148, head);
    beak.rotation.x = Math.PI / 2 + 0.55;
    const hook = add(new THREE.ConeGeometry(0.011, 0.024, 5), beakMat, 0, -0.04, 0.164, head);
    hook.rotation.x = Math.PI / 2 + 1.3;
    return { g, head, eyes: lids };
  }

  /**
   * A deer, stylised to match the island: a deep-chested body shaded brown on the back to cream underneath, a cream rump patch and
   * short tail, sturdy tapered legs with knees, a hock on the back ones and dark hooves, a thick neck with a pale throat, a long
   * head with a dark muzzle, big leaf ears, dark eyes with a gleam, and a pair of branching antlers.
   */
  private makeDeer() {
    const g = new THREE.Group();
    const std = (color: string, rough = 0.88) => new THREE.MeshStandardMaterial({ color, roughness: rough });
    const shaded = new THREE.MeshStandardMaterial({ color: "#ffffff", vertexColors: true, roughness: 0.86 });
    const backC = new THREE.Color("#8f5a31");
    const furC = new THREE.Color("#b07a44");
    const creamC = new THREE.Color("#ecd7b2");
    const fur = std("#b07a44");
    const furDark = std("#7a4a28");
    const cream = std("#ecd7b2", 0.92);
    const hoof = std("#2b1f18", 0.5);
    const muzzle = std("#3a2a20", 0.7);
    const black = new THREE.MeshStandardMaterial({ color: "#100b08", roughness: 0.15 });
    const white = std("#ffffff", 0.3);
    const horn = std("#cfb98f", 0.7);
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = g) => this.visitorMesh(parent, geo, mat, x, y, z);
    /** Colours a geometry from each vertex's own direction: `tone(nx, ny, nz)` is 0 = back brown .. 0.5 = flank .. 1 = cream. */
    const shade = (geo: THREE.BufferGeometry, tone: (nx: number, ny: number, nz: number) => number) => {
      const p = geo.attributes.position as THREE.BufferAttribute;
      const cols = new Float32Array(p.count * 3);
      const c = new THREE.Color();
      for (let i = 0; i < p.count; i++) {
        const n = new THREE.Vector3(p.getX(i), p.getY(i), p.getZ(i)).normalize();
        const t = THREE.MathUtils.clamp(tone(n.x, n.y, n.z), 0, 1);
        if (t < 0.5) c.copy(backC).lerp(furC, t * 2);
        else c.copy(furC).lerp(creamC, (t - 0.5) * 2);
        cols.set([c.r, c.g, c.b], i * 3);
      }
      geo.setAttribute("color", new THREE.BufferAttribute(cols, 3));
      return geo;
    };
    // The body: one long egg, the chest deeper than the waist, shaded brown on top, tan on the flanks, cream beneath.
    const RX = 0.17;
    const RY = 0.185;
    const RZ = 0.4;
    const BY = 0.5;
    const bodyGeo = new THREE.SphereGeometry(1, 36, 24);
    const bp = bodyGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < bp.count; i++) {
      const nx = bp.getX(i);
      const ny = bp.getY(i);
      const nz = bp.getZ(i);
      const chest = nz > 0 ? 1 + 0.12 * nz * Math.max(0, -ny + 0.4) : 1;
      const waist = nz < 0.2 && ny < 0 ? 1 - 0.16 * -ny * (1 - Math.abs(nz)) : 1;
      const rump = nz < 0 ? 1 + 0.06 * -nz : 1;
      bp.setXYZ(i, nx * RX * rump, ny * RY * chest * waist, nz * RZ);
    }
    shade(bodyGeo, (_x, y) => (y > 0.25 ? 0.05 : y > -0.2 ? 0.4 + (0.25 - y) * 0.4 : 0.75 + (-y - 0.2) * 1.2));
    bodyGeo.computeVertexNormals();
    add(bodyGeo, shaded, 0, BY, 0);
    // A cream rump patch and a short tail that flicks up.
    const rumpPatch = add(this.blob(0.075, 1.05, 1.15, 0.5), cream, 0, BY + 0.03, -RZ + 0.015);
    rumpPatch.rotation.x = 0.1;
    const tail = add(this.blob(0.04, 0.7, 1.35, 0.9), cream, 0, BY + 0.11, -RZ - 0.02);
    tail.rotation.x = -0.7;
    // Legs: sturdy and tapered, swinging from the shoulder or hip, with a knee and a hoof. The back legs bend at the hock.
    const legs: THREE.Object3D[] = [];
    for (const [x, z, hind] of [[0.085, 0.22, 0], [-0.085, 0.22, 0], [0.085, -0.23, 1], [-0.085, -0.23, 1]] as const) {
      const leg = new THREE.Group();
      leg.position.set(x, BY - 0.07, z);
      const upper = add(new THREE.CylinderGeometry(hind ? 0.05 : 0.04, 0.026, 0.25, 10), fur, 0, -0.115, 0, leg);
      upper.rotation.x = hind ? 0.32 : -0.03;
      upper.position.z = hind ? -0.03 : 0;
      const knee = new THREE.Group();
      knee.position.set(0, -0.235, hind ? -0.06 : -0.005);
      knee.rotation.x = hind ? -0.5 : 0.05;
      leg.add(knee);
      add(new THREE.CylinderGeometry(0.026, 0.0155, 0.27, 8), furDark, 0, -0.13, 0, knee);
      add(new THREE.CylinderGeometry(0.0165, 0.021, 0.05, 8), hoof, 0, -0.275, 0.004, knee);
      add(this.blob(0.024, 1, 0.9, 1), furDark, 0, 0.0, 0, knee);
      g.add(leg);
      legs.push(leg);
    }
    // The neck: a thick tapered tube leaning forward from the shoulder, on a pivot that dips to graze, with a pale throat.
    const neck = new THREE.Group();
    neck.position.set(0, BY + 0.07, 0.29);
    g.add(neck);
    const NL = 0.36;
    const LEAN = 0.72;
    const stemGeo = new THREE.CylinderGeometry(0.05, 0.088, NL, 18, 5);
    stemGeo.translate(0, NL / 2, 0);
    shade(stemGeo, (_x, y, z) => (z > 0.6 ? 0.7 + (z - 0.6) * 0.7 : y > 0.3 ? 0.2 : 0.35));
    const stem = add(stemGeo, shaded, 0, 0, 0, neck);
    stem.rotation.x = LEAN;
    const head = new THREE.Group();
    head.position.set(0, NL * Math.cos(LEAN) + 0.01, NL * Math.sin(LEAN) + 0.02);
    head.rotation.x = 0.85;
    neck.add(head);
    // Skull, a long muzzle, a dark nose, a pale chin.
    add(this.blob(0.064, 0.92, 0.98, 1.2), fur, 0, 0, 0, head);
    add(this.blob(0.042, 0.82, 0.78, 1.75), fur, 0, -0.022, 0.085, head);
    add(this.blob(0.034, 0.8, 0.62, 1.35), cream, 0, -0.046, 0.07, head);
    add(this.blob(0.022, 1.15, 0.9, 0.95), muzzle, 0, -0.016, 0.152, head);
    add(this.blob(0.0065, 1, 0.8, 0.8), white, 0.008, -0.009, 0.163, head);
    for (const s of [-1, 1]) {
      // Eyes on the sides, with a gleam.
      add(this.blob(0.015, 1, 1.15, 0.75), black, s * 0.054, 0.018, 0.05, head);
      add(this.blob(0.0045, 1, 1, 0.6), white, s * 0.052, 0.024, 0.062, head);
      // Big leaf ears, lined with cream.
      const ear = add(this.blob(0.058, 0.26, 1.45, 0.85), fur, s * 0.082, 0.062, -0.03, head);
      ear.rotation.z = -s * 0.95;
      ear.rotation.x = -0.12;
      const inner = add(this.blob(0.042, 0.18, 1.2, 0.65), cream, s * 0.0835, 0.06, -0.022, head);
      inner.rotation.z = -s * 0.95;
      inner.rotation.x = -0.12;
      // Antlers: a main beam sweeping back and up, with tines.
      const antler = new THREE.Group();
      antler.position.set(s * 0.036, 0.062, -0.012);
      antler.rotation.set(-0.35, 0, -s * 0.32);
      head.add(antler);
      const beam = add(new THREE.CylinderGeometry(0.0085, 0.0125, 0.27, 7), horn, 0, 0.135, 0, antler);
      beam.rotation.x = -0.28;
      for (const [y, len, ang] of [[0.07, 0.11, 0.5], [0.14, 0.13, 0.42], [0.21, 0.1, 0.36]] as const) {
        const tine = add(new THREE.CylinderGeometry(0.005, 0.009, len, 6), horn, 0, 0, 0, antler);
        tine.position.set(s * 0.004, y, -y * 0.28);
        tine.rotation.set(0.2, 0, -s * ang);
        tine.translateY(len / 2);
      }
    }
    // The neck pivot is returned as "head": it dips (rotation.x towards 1.1) to graze.
    return { g, head: neck, legs };
  }

  private buildVisitors(kinds: ("owl" | "deer")[]) {
    this.visitors.clear();
    if (kinds.includes("owl") && this.cottage) {
      // Perched on the ridge of the cottage roof, facing the front.
      const { g, head, eyes } = this.makeOwl();
      g.position.set(0, 2.3, 0.4);
      g.scale.setScalar(1.15);
      g.userData.id = "visitor:owl";
      this.pickables.push(g);
      this.cottage.add(g);
      this.visitors.set("visitor:owl", { g, kind: "owl", ph: 1.7, head, eyes, home: new THREE.Vector3(), legs: [], state: "look", until: 0, target: new THREE.Vector3(), yaw: 0, graze: 0, sleep: 0 });
    }
    if (kinds.includes("deer")) {
      const spot = this.freeSpots(10, "deer", 1.2, 0.62).sort((a, b) => b.z - Math.abs(b.x) * 0.3 - (a.z - Math.abs(a.x) * 0.3))[0];
      if (spot) {
        const { g, head, legs } = this.makeDeer();
        g.position.copy(spot);
        g.scale.setScalar(1.9);
        g.userData.id = "visitor:deer";
        this.pickables.push(g);
        this.island.add(g);
        this.visitors.set("visitor:deer", { g, kind: "deer", ph: 0.4, head, eyes: head, home: spot.clone(), legs, state: "graze", until: 3, target: spot.clone(), yaw: 0, graze: 1, sleep: 0 });
      }
    }
  }

  /** The visitors' little lives: the owl sleeps by day and turns its head and blinks at night; the deer grazes, looks up, and wanders a few steps now and then. */
  private updateVisitors(dt: number, t: number) {
    const night = this.phase === "night";
    for (const v of this.visitors.values()) {
      if (v.kind === "owl") {
        const asleep = !night;
        const swivel = Math.sin(t * 0.32 + v.ph) * 0.85 + Math.sin(t * 0.9 + v.ph * 2) * 0.25;
        const blink = ((t / 4.4 + v.ph) % 1) < 0.045;
        const closed = asleep || blink;
        v.head.rotation.y = THREE.MathUtils.lerp(v.head.rotation.y, asleep ? 0.15 : swivel, 0.06);
        v.head.rotation.x = THREE.MathUtils.lerp(v.head.rotation.x, asleep ? 0.28 : 0, 0.05);
        v.eyes.scale.y = THREE.MathUtils.lerp(v.eyes.scale.y, closed ? 1 : 0.02, 0.35);
        const breath = 1 + Math.sin(t * (asleep ? 1.1 : 1.6) + v.ph) * 0.012;
        v.g.scale.setScalar(1.15 * breath);
        continue;
      }
      // The deer.
      v.sleep = THREE.MathUtils.lerp(v.sleep, night ? 1 : 0, 0.03);
      if (night && v.state === "walk") v.state = "graze";
      v.graze = THREE.MathUtils.lerp(v.graze, night || v.state === "graze" ? 1 : v.state === "walk" ? 0.1 : 0, 0.05);
      v.head.rotation.x = v.graze * 1.1 + Math.sin(t * 1.4 + v.ph) * 0.02 * (1 - v.graze);
      if (!night && t > v.until) {
        if (v.state === "graze") {
          v.state = "look";
          v.until = t + 1.5 + Math.random() * 1.5;
        } else if (v.state === "look") {
          if (Math.random() < 0.5) {
            // A few steps somewhere near home, on the island.
            const a = Math.random() * Math.PI * 2;
            const r = 0.4 + Math.random() * 0.9;
            const x = v.home.x + Math.cos(a) * r;
            const z = v.home.z + Math.sin(a) * r;
            if (Math.hypot(x, z) < this.R * 0.82) {
              v.target.set(x, this.heightAt(x, z), z);
              v.state = "walk";
              v.until = t + 12;
            } else {
              v.state = "graze";
              v.until = t + 3 + Math.random() * 3;
            }
          } else {
            v.state = "graze";
            v.until = t + 3 + Math.random() * 3;
          }
        }
      }
      let moving = false;
      if (v.state === "walk") {
        const dx = v.target.x - v.g.position.x;
        const dz = v.target.z - v.g.position.z;
        const d = Math.hypot(dx, dz);
        if (d < 0.05) {
          v.state = "graze";
          v.until = t + 3 + Math.random() * 3;
        } else {
          const want = Math.atan2(dx, dz);
          const turn = Math.atan2(Math.sin(want - v.yaw), Math.cos(want - v.yaw));
          v.yaw += turn * Math.min(1, dt * 3);
          const step = Math.min(d, 0.22 * dt);
          v.g.position.x += (dx / d) * step;
          v.g.position.z += (dz / d) * step;
          v.g.position.y = this.heightAt(v.g.position.x, v.g.position.z);
          moving = true;
        }
      }
      v.g.rotation.y = v.yaw;
      v.g.position.y = this.heightAt(v.g.position.x, v.g.position.z) - v.sleep * 0.88;
      v.legs.forEach((leg, i) => {
        const swing = moving ? Math.sin(t * 5.5 + (i === 0 || i === 3 ? 0 : Math.PI)) * 0.45 : 0;
        leg.rotation.x = THREE.MathUtils.lerp(leg.rotation.x, swing, 0.25);
        leg.scale.y = 1 - v.sleep * 0.82;
      });
    }
  }

  private finishIntro() {
    this.intro.t0 = -2;
    this.controls.enabled = true;
    this.controls.autoRotate = !this.reduced;
    this.idleSince = this.clock.elapsedTime;
  }

  /* ── sky and light ── */

  private buildSky() {
    const sky = new Sky();
    sky.scale.setScalar(4500);
    // A gain on the sky alone, so it can be a deeper blue without darkening the island.
    sky.material.uniforms.skyGain = { value: 1 };
    sky.material.fragmentShader = sky.material.fragmentShader.replace("gl_FragColor = vec4( texColor, 1.0 );", "gl_FragColor = vec4( texColor * skyGain, 1.0 );").replace("void main() {", `uniform float skyGain;
void main() {`);
    this.skyMesh = sky;
    this.scene.add(sky);

    // Night: a deep gradient dome, stars, the moon and (on clear nights) northern lights.
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(4000, 32, 16),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        uniforms: { top: { value: new THREE.Color("#020510") }, mid: { value: new THREE.Color("#0b1530") }, low: { value: new THREE.Color("#1c2a52") } },
        vertexShader: `varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }`,
        fragmentShader: `uniform vec3 top; uniform vec3 mid; uniform vec3 low; varying vec3 vP;
          void main(){ float h = vP.y; vec3 c = h > 0.15 ? mix(mid, top, smoothstep(0.15, 0.8, h)) : mix(low, mid, smoothstep(-0.2, 0.15, h)); gl_FragColor = vec4(c, 1.); }`,
      }),
    );
    this.nightSky.add(dome);
    const n = 4200;
    const pos = new Float32Array(n * 3);
    const seed = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const u = hash01(`st${i}`);
      const v = hash01(`sv${i}`) * 1.45 - 0.45;
      const th = u * Math.PI * 2;
      const y = v;
      const rr = Math.sqrt(1 - y * y);
      pos.set([Math.cos(th) * rr * 3000, y * 3000, Math.sin(th) * rr * 3000], i * 3);
      // Brightness like the real sky: a great many faint stars, a few bright ones.
      seed[i] = Math.pow(hash01(`ss${i}`), 1.7);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    sg.setAttribute("seed", new THREE.BufferAttribute(seed, 1));
    // Most stars white, some warm orange, some icy blue (a touch richer than before).
    const tint = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const k = hash01(`sk${i}`);
      const c = k < 0.14 ? [1, 0.7, 0.45] : k < 0.3 ? [0.62, 0.78, 1] : k < 0.36 ? [1, 0.88, 0.7] : [1, 0.97, 0.92];
      tint.set(c, i * 3);
    }
    sg.setAttribute("tint", new THREE.BufferAttribute(tint, 3));
    const starMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uTime: this.uTime, uDpr: { value: Math.min(devicePixelRatio, 2) } },
      vertexShader: `attribute float seed; attribute vec3 tint; uniform float uTime; uniform float uDpr; varying float vA; varying vec3 vT; varying float vS;
        void main(){
          vT = tint; vS = seed;
          // Each star twinkles at its own pace and depth (faint ones barely, bright ones more).
          float tw = 0.5 + 0.5 * sin(uTime * (0.7 + seed * 2.6) + seed * 57.0);
          vA = mix(0.75, 0.3 + 0.7 * tw * tw, 0.35 + seed * 0.65);
          vec4 mv = modelViewMatrix * vec4(position,1.);
          gl_PointSize = (1.0 + pow(seed, 3.0) * 4.0 + step(0.97, seed) * (4.0 + (seed - 0.97) * 160.0)) * uDpr;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `varying float vA; varying vec3 vT; varying float vS;
        void main(){
          vec2 p = gl_PointCoord - 0.5;
          float d = length(p);
          // A tight bright core, a soft halo round it...
          float core = exp(-d * d * 90.0);
          float halo = pow(smoothstep(0.5, 0.0, d), 3.0) * 0.55;
          // ...and, on the brightest, four fine diffraction spikes.
          float big = smoothstep(0.97, 0.995, vS);
          float spike = (exp(-abs(p.x) * 70.0) * smoothstep(0.5, 0.0, abs(p.y)) + exp(-abs(p.y) * 70.0) * smoothstep(0.5, 0.0, abs(p.x))) * big * 0.8;
          float a = (core + halo + spike);
          gl_FragColor = vec4(mix(vT, vec3(1.0), core * 0.6) * (1.1 + core * 1.6), vA * a);
        }`,
    });
    this.animatedMats.push(starMat);
    this.nightSky.add(new THREE.Points(sg, starMat));
    // The Milky Way: a soft, mottled band across the sky.
    const milky = new THREE.Mesh(
      new THREE.SphereGeometry(3400, 48, 24),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        vertexShader: `varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }`,
        fragmentShader: `varying vec3 vP;
          float h(vec3 p){ return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
          float n(vec3 p){ vec3 i = floor(p); vec3 f = fract(p); f = f * f * (3.0 - 2.0 * f);
            return mix(mix(mix(h(i), h(i + vec3(1,0,0)), f.x), mix(h(i + vec3(0,1,0)), h(i + vec3(1,1,0)), f.x), f.y),
                       mix(mix(h(i + vec3(0,0,1)), h(i + vec3(1,0,1)), f.x), mix(h(i + vec3(0,1,1)), h(i + vec3(1,1,1)), f.x), f.y), f.z); }
          float fbm(vec3 p){ float s = 0.0; float a = 0.5; for (int i = 0; i < 5; i++) { s += a * n(p); p *= 2.1; a *= 0.5; } return s; }
          void main(){
            vec3 axis = normalize(vec3(0.35, 0.4, 0.85));
            float d = dot(vP, axis);
            float band = exp(-d * d * 22.0);
            float dust = fbm(vP * 6.0);
            float lanes = smoothstep(0.35, 0.75, fbm(vP * 11.0 + 3.0));
            float a = band * (0.35 + dust * 0.9) * (1.0 - lanes * 0.6) * smoothstep(-0.05, 0.25, vP.y);
            vec3 c = mix(vec3(0.45, 0.4, 0.75), vec3(0.95, 0.85, 0.8), dust);
            gl_FragColor = vec4(c * 0.4, a * 0.28 * smoothstep(0.05, 0.4, vP.y));
          }`,
      }),
    );
    this.nightSky.add(milky);
    // A shooting star now and then: a short bright streak with a fading tail.
    const sgeo = new THREE.BufferGeometry();
    sgeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(6), 3));
    sgeo.setAttribute("color", new THREE.BufferAttribute(new Float32Array([3, 3, 3.2, 1, 0.6, 0.8, 1, 0]), 4));
    this.shoot = new THREE.Line(sgeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, fog: false }));
    this.shoot.frustumCulled = false;
    this.shoot.visible = false;
    this.nightSky.add(this.shoot);
    // The moon: a ball with pale highlands, dark seas and craters (bright-rimmed, shadowed on one side), in today's real phase, with a soft glow.
    // It hangs where the camera looks (see placeMoon).
    const syn = 29.530588853;
    const julian = Date.now() / 86400000 + 2440587.5;
    const phase = (((julian - 2451550.1) / syn) % 1 + 1) % 1;
    const lit = (1 - Math.cos(phase * Math.PI * 2)) / 2;
    const moon = new THREE.Mesh(
      new THREE.PlaneGeometry(210, 210),
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        fog: false,
        uniforms: { uPhase: { value: phase } },
        vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: `uniform float uPhase; varying vec2 vUv;
          float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
          vec2 h2(vec2 p){ return vec2(h(p), h(p + 17.31)); }
          float n(vec2 p){ vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
          float fbm(vec2 p){ float s = 0.0; float a = 0.5; for (int i = 0; i < 5; i++) { s += a * n(p); p *= 2.03; a *= 0.5; } return s; }
          // Craters: one per cell, a dark bowl with a bright rim; returns (bowl, rim).
          vec2 craters(vec2 p, float scale, float density){
            vec2 g = p * scale; vec2 id = floor(g); vec2 f = fract(g);
            float bowl = 0.0; float rim = 0.0;
            for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
              vec2 o = vec2(float(i), float(j)); vec2 cid = id + o; vec2 r = h2(cid);
              if (r.x > density) continue;
              vec2 c = o + 0.2 + 0.6 * h2(cid + 5.7) - f;
              float rad = 0.16 + 0.22 * r.y;
              float d = length(c) / rad;
              bowl = max(bowl, smoothstep(1.0, 0.55, d) * 0.9);
              rim = max(rim, smoothstep(0.78, 1.0, d) * smoothstep(1.35, 1.0, d));
            }
            return vec2(bowl, rim);
          }
          void main(){
            vec2 p = vUv * 2.0 - 1.0;
            float r = length(p);
            if (r > 1.0) discard;
            vec3 nrm = vec3(p, sqrt(max(0.0, 1.0 - r * r)));
            // Highlands and the great dark seas.
            float sea = smoothstep(0.5, 0.66, fbm(p * 1.6 + 3.1) + 0.12 * fbm(p * 5.0));
            float grain = fbm(p * 14.0) * 0.08;
            vec2 big = craters(p, 4.5, 0.55);
            vec2 small = craters(p + 3.0, 11.0, 0.6);
            float shade = 1.0 - big.x * 0.32 - small.x * 0.2 + big.y * 0.16 + small.y * 0.1;
            vec3 land = vec3(0.86, 0.84, 0.77);
            vec3 seaCol = vec3(0.44, 0.47, 0.54);
            vec3 albedo = mix(land, seaCol, sea * 0.82) * shade + grain;
            // The phase: sunlight from the side; a crescent or half is lit, the rest in faint earthshine.
            float ang = uPhase * 6.2831853;
            vec3 L = normalize(vec3(sin(ang), 0.0, -cos(ang)));
            float lit = smoothstep(-0.04, 0.16, dot(nrm, L));
            float limb = mix(0.7, 1.0, pow(nrm.z, 0.3));
            vec3 col = albedo * (lit * 0.95 + 0.04) * limb;
            gl_FragColor = vec4(col, smoothstep(1.0, 0.975, r));
          }`,
      }),
    );
    // A soft glow round it, brighter when it's fuller.
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: puffTexture("glow"), color: "#b9c8ff", transparent: true, opacity: 0.06 + 0.2 * lit, depthWrite: false, fog: false }));
    halo.scale.setScalar(520);
    this.moon = moon;
    this.moonHalo = halo;
    this.nightSky.add(moon, halo);
    this.placeMoon();
    // Northern lights: a tall curtain far away, its rays wandering.
    const aur = new THREE.Mesh(
      new THREE.CylinderGeometry(1800, 1800, 900, 96, 1, true, Math.PI * 0.85, Math.PI * 0.9),
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        uniforms: { uTime: this.uTime, uMusicCol: this.uMusicCol, uMix: this.uMusicMix, uBeat: this.uBeat, uKick: this.uKick },
        vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }`,
        fragmentShader: `uniform float uTime; uniform vec3 uMusicCol; uniform float uMix; uniform float uBeat; uniform float uKick; varying vec2 vUv;
          void main(){
            float x = vUv.x * 18.0;
            float wave = sin(x * 0.7 + uTime * 0.25) * 0.08 + sin(x * 1.9 - uTime * 0.4) * 0.04;
            float band = smoothstep(0.0, 0.25, vUv.y - 0.35 + wave) * smoothstep(1.0, 0.45, vUv.y + wave);
            float rays = 0.55 + 0.45 * sin(x * 9.0 + sin(uTime * 0.3 + x) * 2.0);
            vec3 c = mix(vec3(0.25, 1.0, 0.6), vec3(0.6, 0.35, 1.0), smoothstep(0.55, 1.0, vUv.y));
            // While a song plays, the lights take its colour and pulse with it.
            c = mix(c, uMusicCol * 1.2, uMix * 0.75);
            float pulse = 1.0 + uMix * (uBeat * 0.9 + uKick * 0.9);
            gl_FragColor = vec4(c * 0.55, band * rays * 0.55 * pulse);
          }`,
      }),
    );
    aur.position.y = 650;
    this.animatedMats.push(aur.material as THREE.ShaderMaterial);
    this.nightSky.add(aur);
    this.nightSky.userData.aurora = aur;
    this.scene.add(this.nightSky);
  }

  private buildLights() {
    this.sun.castShadow = true;
    const m = this.quality === "high" ? 2048 : 1024;
    this.sun.shadow.mapSize.set(m, m);
    const s = this.R * 1.35;
    Object.assign(this.sun.shadow.camera, { left: -s, right: s, top: s, bottom: -s, near: 1, far: this.R * 8 });
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.03;
    this.sun.shadow.radius = 3;
    this.sun.shadow.camera.updateProjectionMatrix();
    this.scene.add(this.sun, this.sun.target, this.hemi);
  }

  /** Sky, light, fog and glows for the hour and the weather. */
  private applyLook() {
    const L = LOOK[this.phase];
    const night = this.phase === "night";
    const wet = this.wet;
    const dir = new THREE.Vector3(...L.sun).normalize();
    this.sun.position.copy(dir).multiplyScalar(this.R * 4);
    this.sun.color.set(L.sunCol);
    this.sun.intensity = L.sunI * (wet ? 0.35 : 1);
    this.hemi.color.set(wet ? "#9aa8b8" : L.sky);
    this.hemi.groundColor.set(L.ground);
    this.hemi.intensity = L.hemiI * (wet ? 1.1 : 1);
    // How the last night check-in went tints the light: warm and golden after a good day, soft and cool after a rough one.
    let moodExp = 1;
    const mood = this.opts.mood ?? null;
    if (mood !== null && mood >= 4) {
      const k = mood === 5 ? 1 : 0.65;
      this.sun.color.lerp(new THREE.Color("#ffc977"), 0.5 * k);
      this.hemi.color.lerp(new THREE.Color("#ffe3b8"), 0.35 * k);
      this.sun.intensity *= 1 + 0.12 * k;
      moodExp = 1 + 0.07 * k;
    } else if (mood !== null && mood <= 2) {
      const k = mood === 1 ? 1 : 0.65;
      this.sun.color.lerp(new THREE.Color("#a9bbd8"), 0.5 * k);
      this.hemi.color.lerp(new THREE.Color("#8fa3c4"), 0.45 * k);
      this.sun.intensity *= 1 - 0.22 * k;
      moodExp = 1 - 0.06 * k;
    }
    const fog = new THREE.Color(wet ? (night ? "#0c1220" : "#7d8a99") : L.fog);
    this.scene.fog = new THREE.Fog(fog, this.R * 6, this.R * 26);

    if (this.skyMesh) {
      this.skyMesh.visible = !night;
      const u = this.skyMesh.material.uniforms;
      u.turbidity.value = wet ? 12 : L.turb;
      u.rayleigh.value = wet ? 0.6 : L.ray;
      u.mieCoefficient.value = wet ? 0.02 : 0.005;
      u.mieDirectionalG.value = 0.82;
      u.sunPosition.value.copy(dir).multiplyScalar(1000);
      u.skyGain.value = wet ? 0.8 : this.phase === "day" ? 0.55 : 0.8;
      // A few high wisps, not a white sheet.
      if (u.cloudCoverage) u.cloudCoverage.value = wet ? 0.85 : 0.18;
      if (u.cloudDensity) u.cloudDensity.value = wet ? 0.7 : 0.25;
    }
    this.nightSky.visible = night;
    const aur = this.nightSky.userData.aurora as THREE.Object3D;
    aur.visible = night && !wet;
    for (const o of this.nightOnly) o.visible = night;
    for (const o of this.dayOnly) o.visible = !night && !wet;
    this.uMusicDay.value = night ? 0 : 1;
    for (const m of this.cloudMats) {
      m.color.set(wet ? (night ? "#1c2436" : "#aab4c0") : L.cloud).multiplyScalar(night ? 1 : 1.8);
    }
    if (this.rain) this.rain.visible = wet;
    const exposure = (L.exp + (night ? 0.25 : 0)) * (wet ? 1.15 : 1) * moodExp;
    this.renderer.toneMappingExposure = exposure;
    const u = this.grade?.uniforms.get("exposure");
    if (u) u.value = exposure;

    // Glows: lamps, windows, crystals and gems light up after dark.
    for (const m of this.lampMats) m.emissiveIntensity = m.userData.base0 = night ? 3 : wet ? 1.2 : 0.7;
    // (Off in AR: a lamp's reach is measured in real metres, and shrunk to table size it would flood the island.)
    for (const l of this.lampLights) l.visible = (night || wet) && !this.xr;
    for (const m of this.crystalMats) m.emissiveIntensity = m.userData.base0 = night ? 2.6 : 0.35;
    // The stage lights: added light glows at night; by day they're drawn as a soft coloured haze instead.
    for (const b of this.beams) {
      b.mat.blending = night ? THREE.AdditiveBlending : THREE.NormalBlending;
      b.mat.needsUpdate = true;
    }
    for (const m of this.gemMats) m.emissiveIntensity = night ? 0.9 : 0.15;
    this.setLit(this.lit);

    // Reflections come from the sky itself.
    const env = new THREE.Scene();
    const disc = this.skyMesh?.material.uniforms.showSunDisc;
    if (night) env.add(this.nightSky.clone());
    else if (this.skyMesh) env.add(this.skyMesh.clone());
    if (disc) disc.value = 0;
    this.envRT?.dispose();
    this.envRT = this.pmrem.fromScene(env, 0.06);
    if (disc) disc.value = 1;
    this.scene.environment = this.envRT.texture;
    // The raw sky is far brighter than what's shown: reflections only need a hint of it.
    this.scene.environmentIntensity = night ? 0.25 : wet ? 0.12 : 0.18;
    if (this.bloom) {
      // Only real light sources glow: lamps, windows, fireflies, the sun.
      this.bloom.intensity = night ? 1.3 : 0.35;
      this.bloom.luminanceMaterial.threshold = night ? 0.9 : 12;
    }
    this.renderer.shadowMap.needsUpdate = true;
  }

  /* ── the island ── */

  private buildIsland() {
    const R = this.R;
    const D = this.D;
    const home = this.toWorld(homeSpot(this.opts.n).x, homeSpot(this.opts.n).y);
    const pathW = (z: number) => ((pathX(this.opts.n, z * (this.isl.ry / R) + this.isl.cy) - this.isl.cx) / this.isl.rx) * R;

    // Top: a polar grid draped over the dome, coloured grass with a worn path.
    const rings = 56;
    const segs = 180;
    const pos: number[] = [];
    const col: number[] = [];
    const idx: number[] = [];
    const c = new THREE.Color();
    const g1 = new THREE.Color("#4f8f37");
    const g2 = new THREE.Color("#7bb245");
    const g3 = new THREE.Color("#3c7432");
    const dirt = new THREE.Color("#8a7350");
    pos.push(0, this.heightAt(0, 0), 0);
    col.push(g2.r, g2.g, g2.b);
    for (let i = 1; i <= rings; i++) {
      const r = (i / rings) * R;
      for (let j = 0; j < segs; j++) {
        const a = (j / segs) * Math.PI * 2;
        const x = Math.cos(a) * r;
        const z = Math.sin(a) * r;
        pos.push(x, this.heightAt(x, z), z);
        const n = fbm(x * 0.5, 3, z * 0.5, 3);
        c.copy(g1).lerp(g2, THREE.MathUtils.smoothstep(n, 0.35, 0.7)).lerp(g3, THREE.MathUtils.smoothstep(r / R, 0.75, 1) * 0.6);
        if (z > home.z && Math.abs(x - pathW(z)) < 0.32 && r < R * 0.95) c.lerp(dirt, 0.55);
        // The rim curls over into a band of soil under the turf.
        if (r > R * 0.965) c.lerp(new THREE.Color("#4a3322"), THREE.MathUtils.smoothstep(r / R, 0.965, 0.995));
        col.push(c.r, c.g, c.b);
      }
    }
    for (let j = 0; j < segs; j++) idx.push(0, 1 + ((j + 1) % segs), 1 + j);
    for (let i = 1; i < rings; i++) {
      for (let j = 0; j < segs; j++) {
        const a = 1 + (i - 1) * segs + j;
        const b = 1 + (i - 1) * segs + ((j + 1) % segs);
        const d = 1 + i * segs + j;
        const e = 1 + i * segs + ((j + 1) % segs);
        idx.push(a, b, d, b, e, d);
      }
    }
    const top = new THREE.BufferGeometry();
    top.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    top.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    top.setIndex(idx);
    top.computeVertexNormals();
    this.ground = new THREE.Mesh(top, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }));
    this.ground.receiveShadow = true;
    this.island.add(this.ground);

    // Underside: rock tapering to a point, rough and layered, roots at the top.
    this.island.add(this.rockMass(R, D, 220, 64, 1));

    // Roots and vines hanging off the rim.
    const rootMat = new THREE.MeshStandardMaterial({ color: "#5a4030", roughness: 1 });
    const vineMat = new THREE.MeshStandardMaterial({ color: "#3f7d34", roughness: 0.9 });
    for (let i = 0; i < 14; i++) {
      const a = hash01(`ra${i}`) * Math.PI * 2;
      const t = 0.04 + hash01(`rt${i}`) * 0.18;
      const r0 = R * (1 - t * 0.35);
      const p0 = new THREE.Vector3(Math.cos(a) * r0, -t * D, Math.sin(a) * r0);
      const len = 0.3 + hash01(`rl${i}`) * 0.8;
      const sw = (hash01(`rw${i}`) - 0.5) * 0.4;
      const curve = new THREE.CatmullRomCurve3([
        p0.clone().add(new THREE.Vector3(-Math.cos(a) * 0.1, 0.05, -Math.sin(a) * 0.1)),
        p0.clone().add(new THREE.Vector3(Math.cos(a) * 0.12 + sw * 0.3, -len * 0.35, Math.sin(a) * 0.12)),
        p0.clone().add(new THREE.Vector3(Math.cos(a) * 0.08 - sw, -len * 0.7, Math.sin(a) * 0.08 + sw * 0.5)),
        p0.clone().add(new THREE.Vector3(Math.cos(a) * 0.02 + sw * 0.6, -len, Math.sin(a) * 0.02)),
      ]);
      const vine = i % 3 === 0;
      const m = new THREE.Mesh(new THREE.TubeGeometry(curve, 16, vine ? 0.016 : 0.024, 5), vine ? vineMat : rootMat);
      m.castShadow = true;
      this.island.add(m);
    }

    // Crystals in the rock: glow at night.
    for (let i = 0; i < 4; i++) {
      const a = -0.6 + i * 1.3 + hash01(`ka${i}`);
      // On the rock face (its profile runs from radius 0.95 R at 0.7 m down to 0.74 R at 1.7 m, scaled).
      const t = 0.2 + hash01(`kt${i}`) * 0.2;
      const rr = R * (0.95 - (t - 0.18) * 0.875) * 0.93;
      const hue = [0.52, 0.78, 0.45, 0.6][i];
      const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL(hue, 0.7, 0.6), emissive: new THREE.Color().setHSL(hue, 0.9, 0.55), roughness: 0.15, metalness: 0.1 });
      this.crystalMats.push(mat);
      const g = new THREE.Group();
      for (let k = 0; k < 4; k++) {
        const cr = new THREE.Mesh(new THREE.OctahedronGeometry(0.12, 0), mat);
        cr.scale.set(0.6, 2 + hash01(`kk${i}${k}`) * 1.2, 0.6);
        cr.position.set((k - 1.5) * 0.09, 0, (hash01(`kz${i}${k}`) - 0.5) * 0.1);
        cr.rotation.z = (k - 1.5) * 0.35;
        g.add(cr);
      }
      g.position.set(Math.cos(a) * rr, -((0.7 + (t - 0.18) * 4.17) / 4.4) * D, Math.sin(a) * rr);
      g.lookAt(g.position.x * 3, g.position.y - 2, g.position.z * 3);
      this.island.add(g);
    }
  }

  /** A rocky mass: shared by the island and the far-off islands. */
  private rockMass(R: number, D: number, segs: number, rows: number, detail: number) {
    const prof: [number, number, number][] = [
      [0, 1, 0],
      [0.05, 1.015, -0.18],
      [0.18, 0.95, -0.7],
      [0.42, 0.74, -1.7],
      [0.66, 0.48, -2.8],
      [0.85, 0.25, -3.7],
      [1, 0.03, -4.4],
    ];
    const at = (t: number) => {
      for (let i = 1; i < prof.length; i++)
        if (t <= prof[i][0]) {
          const [t0, r0, y0] = prof[i - 1];
          const [t1, r1, y1] = prof[i];
          const k = (t - t0) / (t1 - t0);
          return [r0 + (r1 - r0) * k, y0 + (y1 - y0) * k];
        }
      return [prof[prof.length - 1][1], prof[prof.length - 1][2]];
    };
    const pos: number[] = [];
    const col: number[] = [];
    const idx: number[] = [];
    const soil = new THREE.Color("#4a3322");
    const rocks = [new THREE.Color("#6e5d4d"), new THREE.Color("#8a7a66"), new THREE.Color("#5b4b3d"), new THREE.Color("#7a6a58")];
    const deep = new THREE.Color("#2c241e");
    const c = new THREE.Color();
    const yScale = D / 4.4;
    for (let i = 0; i <= rows; i++) {
      const t = i / rows;
      const [rf, yf] = at(t);
      for (let j = 0; j < segs; j++) {
        const a = (j / segs) * Math.PI * 2;
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        let rr = rf * R;
        let y = yf * yScale;
        if (i === 0) y = this.heightAt(ca * R, sa * R) * (detail ? 1 : 0);
        else {
          const nz = fbm(ca * 2.2 + 7, y * 0.9, sa * 2.2, 4);
          rr += (nz - 0.5) * R * 0.34 * Math.min(1, t * 3) * (1 - t * 0.35) + (fbm(ca * 9, y * 3, sa * 9, 2) - 0.5) * R * 0.05 * Math.min(1, t * 5);
          // Ledges: the rock steps in layers.
          y += Math.round(fbm(ca * 1.3, 2, sa * 1.3, 2) * 4) * 0.06 * Math.min(1, t * 4);
        }
        pos.push(ca * rr, y, sa * rr);
        const band = fbm(ca * 0.8, y * 2.4, sa * 0.8, 3);
        c.copy(rocks[Math.floor(band * 4) % 4]).lerp(rocks[(Math.floor(band * 4) + 1) % 4], (band * 4) % 1);
        if (t < 0.06) c.copy(soil);
        c.lerp(deep, Math.min(1, t * 1.1) * 0.55);
        c.multiplyScalar(0.8 + fbm(ca * 12, y * 6, sa * 12, 2) * 0.45);
        col.push(c.r, c.g, c.b);
      }
    }
    for (let i = 0; i < rows; i++)
      for (let j = 0; j < segs; j++) {
        const a = i * segs + j;
        const b = i * segs + ((j + 1) % segs);
        const d = (i + 1) * segs + j;
        const e = (i + 1) * segs + ((j + 1) % segs);
        idx.push(a, d, b, b, d, e);
      }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true }));
    m.castShadow = true;
    return m;
  }

  /* ── grass ── */

  private buildGrass() {
    const R = this.R;
    const n = this.opts.n;
    const home = this.toWorld(homeSpot(n).x, homeSpot(n).y);
    const pond = pondSpot(n);
    const pw = this.toWorld(pond.x, pond.y);
    const prw = (pond.rx / this.isl.rx) * R;
    const pathW = (z: number) => ((pathX(n, z * (this.isl.ry / R) + this.isl.cy) - this.isl.cx) / this.isl.rx) * R;
    const want = Math.round((this.quality === "high" ? 26000 : 9000) * Math.min(1.4, (R / 6.5) ** 2));

    // One blade: a tapered strip, bending more towards its tip.
    const bp: number[] = [];
    const segs = 4;
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const w = 0.5 * (1 - t) * (1 - t * 0.2);
      if (i < segs) bp.push(-w, t, 0, w, t, 0);
      else bp.push(0, 1, 0);
    }
    const bi: number[] = [];
    for (let i = 0; i < segs - 1; i++) bi.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    bi.push((segs - 1) * 2, (segs - 1) * 2 + 1, segs * 2);
    const blade = new THREE.BufferGeometry();
    blade.setAttribute("position", new THREE.Float32BufferAttribute(bp, 3));
    blade.setIndex(bi);

    this.grassMat = new THREE.ShaderMaterial({
      side: THREE.DoubleSide,
      fog: true,
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        {
          uSunDir: { value: new THREE.Vector3() },
          uSunCol: { value: new THREE.Color() },
          uSky: { value: new THREE.Color() },
          uGround: { value: new THREE.Color() },
          uBase: { value: new THREE.Color(SEASON_GRASS[this.opts.season ?? "summer"].base) },
          uTip: { value: new THREE.Color(SEASON_GRASS[this.opts.season ?? "summer"].tip) },
        },
      ]),
      vertexShader: /* glsl */ `
        uniform float uTime;
        uniform vec3 uPet;
        varying float vH;
        varying vec3 vTint;
        varying vec3 vN;
        varying vec3 vWorld;
        #include <fog_pars_vertex>
        ${WIND_GLSL}
        void main() {
          vec3 root = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
          vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
          float h = position.y;
          float len = length((instanceMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
          float w = windAt(root, uTime);
          vec2 dir = ${WIND_DIR};
          float bend = w * h * h * len * 0.55;
          wp.xz += dir * bend;
          wp.y -= abs(bend) * h * 0.35;
          // Pushed aside where the pet walks.
          vec2 d = wp.xz - uPet.xz;
          float pd = length(d);
          wp.xz += (d / max(pd, 0.001)) * smoothstep(0.7, 0.0, pd) * h * len * 0.9;
          wp.y -= smoothstep(0.6, 0.0, pd) * h * len * 0.45;
          vH = h;
          #ifdef USE_INSTANCING_COLOR
            vTint = instanceColor;
          #else
            vTint = vec3(1.0);
          #endif
          vN = normalize(vec3(dir.x * 0.4, 1.0, dir.y * 0.4));
          vWorld = wp.xyz;
          vec4 mvPosition = viewMatrix * wp;
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uSunDir;
        uniform vec3 uSunCol;
        uniform vec3 uSky;
        uniform vec3 uGround;
        uniform vec3 uBase;
        uniform vec3 uTip;
        uniform float uTime;
        uniform vec2 uRip[4];
        uniform vec3 uMusicCol;
        uniform float uMusicDay;
        uniform float uMusicMix;
        uniform float uBallRot;
        varying float vH;
        varying vec3 vTint;
        varying vec3 vN;
        varying vec3 vWorld;
        #include <fog_pars_fragment>
        void main() {
          vec3 albedo = mix(uBase, uTip * vTint, smoothstep(0.0, 1.0, vH));
          float diff = max(dot(vN, uSunDir), 0.0) * 0.8 + 0.2;
          vec3 light = mix(uGround, uSky, 0.5 + 0.5 * vN.y) * 0.9 + uSunCol * diff;
          // Light shining through the tips when the sun is low and behind.
          vec3 view = normalize(cameraPosition - vWorld);
          float back = pow(max(dot(-view, uSunDir), 0.0), 4.0) * vH * vH;
          vec3 col = albedo * light * mix(0.55, 1.0, vH) + uSunCol * albedo * back * 1.6;
          // Music: each beat's ring of light travels outward and fades.
          float d = length(vWorld.xz);
          float ring = 0.0;
          for (int i = 0; i < 4; i++) {
            float age = uTime - uRip[i].x;
            if (age > 0.0 && age < 1.8) {
              float r = age * 5.0;
              float fade = 1.0 - age / 1.8;
              ring += uRip[i].y * exp(-pow((d - r) / 0.35, 2.0)) * fade * fade;
            }
          }
          // Only the tips catch the light: a shimmer running through the grass, not a painted floor.
          col += uMusicCol * ring * vH * vH * 0.55;
          // By day added light is lost in the sunshine: paint the ring in the music's colour instead.
          col = mix(col, uMusicCol * 1.1, clamp(ring * vH * uMusicDay * 0.8, 0.0, 0.8));
          // The disco ball's light spots, turning slowly across the island.
          if (uMusicMix > 0.01) {
            float ca = cos(uBallRot), sa = sin(uBallRot);
            vec2 q = mat2(ca, -sa, sa, ca) * vWorld.xz * 1.15;
            vec2 cell = floor(q);
            float on = step(0.55, fract(sin(dot(cell, vec2(12.9898, 78.233))) * 43758.5453));
            float spot = on * smoothstep(0.26, 0.1, length(fract(q) - 0.5));
            vec3 sc = mix(uMusicCol, vec3(1.0), fract(cell.x * 0.37 + cell.y * 0.61) * 0.35);
            col = mix(col, sc * mix(0.8, 1.15, uMusicDay), spot * uMusicMix * (0.3 + 0.3 * vH));
          }
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <fog_fragment>
        }`,
    });
    this.grassMat.uniforms.uTime = this.uTime;
    this.grassMat.uniforms.uBeat = this.uBeat;
    this.grassMat.uniforms.uWind = this.uWind;
    this.grassMat.uniforms.uRip = this.uRip;
    this.grassMat.uniforms.uMusicCol = this.uMusicCol;
    this.grassMat.uniforms.uMusicDay = this.uMusicDay;
    this.grassMat.uniforms.uMusicMix = this.uMusicMix;
    this.grassMat.uniforms.uBallRot = this.uBallRot;
    this.grassMat.uniforms.uPet = this.uPet;

    const mesh = new THREE.InstancedMesh(blade, this.grassMat, want);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const tint = new THREE.Color();
    let k = 0;
    for (let i = 0; i < want * 3 && k < want; i++) {
      const r = Math.sqrt(hash3(i, 1.3, 7.1)) * R * 0.99;
      const a = hash3(i, 5.7, 2.2) * Math.PI * 2;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      // Not inside the cottage, the pond, or on the path's stones.
      if (((x - home.x) / 1.25) ** 2 + ((z - home.z + 0.05) / 0.95) ** 2 < 1) continue;
      if (Math.hypot(x - pw.x, (z - pw.z) * (prw / ((pond.ry / this.isl.ry) * R))) < prw * 1.02) continue;
      if (z > home.z && Math.abs(x - pathW(z)) < 0.2 && r < R * 0.95) continue;
      const tall = 0.16 + hash3(i, 9.1, 3.3) * 0.22 + fbm(x * 0.3, 1, z * 0.3, 2) * 0.12;
      p.set(x, this.heightAt(x, z) - 0.01, z);
      q.setFromAxisAngle(up, hash3(i, 2.9, 8.8) * Math.PI);
      s.set(0.05 + hash3(i, 4.4, 1.1) * 0.03, tall, 1);
      m.compose(p, q, s);
      mesh.setMatrixAt(k, m);
      const v = fbm(x * 0.6, 9, z * 0.6, 2);
      tint.setRGB(0.85 + v * 0.3, 0.9 + v * 0.2, 0.75 + (1 - v) * 0.2);
      mesh.setColorAt(k, tint);
      k++;
    }
    mesh.count = k;
    this.grassCount = k;
    this.grassOrig = (mesh.instanceMatrix.array as Float32Array).slice();
    this.grassXZ = new Float32Array(k * 2);
    for (let i = 0; i < k; i++) this.grassXZ.set([this.grassOrig[i * 16 + 12], this.grassOrig[i * 16 + 14]], i * 2);
    mesh.frustumCulled = false;
    this.grass = mesh;
    this.island.add(mesh);
  }

  /** Grass, flowers and trees sway in the same wind: patch a standard material to bend with it. */
  private windy<T extends THREE.Material>(mat: T, amount: number, dance = 0) {
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = this.uTime;
      sh.uniforms.uBeat = this.uBeat;
      sh.uniforms.uWind = this.uWind;
      sh.uniforms.uKick = this.uKick;
      sh.vertexShader =
        `uniform float uTime;\nuniform float uKick;\n${WIND_GLSL}\n` +
        sh.vertexShader.replace(
          "#include <begin_vertex>",
          `#include <begin_vertex>
          #ifdef USE_INSTANCING
            vec3 rootW = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
          #else
            vec3 rootW = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
          #endif
          float hh = max(position.y, 0.0);
          float ww = windAt(rootW, uTime) * ${amount.toFixed(3)};
          transformed.xz += ${WIND_DIR} * ww * hh * hh;
          // Music: each flower dances in its own rhythm, and hops up a little on every beat.
          float dz = ${dance.toFixed(2)};
          transformed.x += sin(uTime * 5.0 + rootW.x * 3.1 + rootW.z * 1.7) * uBeat * 0.7 * dz * hh * hh;
          transformed.z += cos(uTime * 4.3 + rootW.z * 2.3) * uBeat * 0.4 * dz * hh * hh;
          transformed.y += uKick * 0.22 * dz * hh;`,
        );
    };
    // Each strength compiles its own program (the default cache key would merge them).
    mat.customProgramCacheKey = () => `garden-wind-${amount}-${dance}`;
    return mat;
  }

  /* ── the cottage ── */

  private buildCottage() {
    const n = this.opts.n;
    const at = this.toWorld(homeSpot(n).x, homeSpot(n).y);
    const g = new THREE.Group();
    this.cottage = g;
    const S = THREE.MathUtils.clamp(this.isl.rx / 300, 0.95, 1.25);
    const plaster = new THREE.MeshStandardMaterial({ color: "#efe2c8", roughness: 0.92 });
    const timber = new THREE.MeshStandardMaterial({ color: "#5a3a24", roughness: 0.85 });
    const roof = new THREE.MeshStandardMaterial({ color: "#b5452f", roughness: 0.75 });
    const stone = new THREE.MeshStandardMaterial({ color: "#8f877c", roughness: 1 });
    const brick = new THREE.MeshStandardMaterial({ color: "#8a4b36", roughness: 0.95 });
    const box = (w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      m.receiveShadow = true;
      g.add(m);
      return m;
    };
    const W = 1.8;
    const Dp = 1.4;
    const H = 1.15;
    box(W + 0.2, 0.22, Dp + 0.2, stone, 0, 0.11, 0);
    box(W, H, Dp, plaster, 0, 0.22 + H / 2, 0);
    // Timber frame.
    for (const x of [-W / 2, W / 2]) for (const z of [-Dp / 2, Dp / 2]) box(0.07, H, 0.07, timber, x, 0.22 + H / 2, z);
    box(W + 0.04, 0.07, 0.07, timber, 0, 0.22 + H, Dp / 2);
    box(W + 0.04, 0.06, 0.06, timber, 0, 0.22 + H * 0.5, Dp / 2 + 0.005);
    // Gables and a steep tiled roof.
    const gable = new THREE.Shape([new THREE.Vector2(-W / 2, 0), new THREE.Vector2(W / 2, 0), new THREE.Vector2(0, 0.85)]);
    for (const z of [Dp / 2, -Dp / 2]) {
      const m = new THREE.Mesh(new THREE.ShapeGeometry(gable), plaster);
      m.position.set(0, 0.22 + H, z);
      if (z < 0) m.rotation.y = Math.PI;
      m.castShadow = true;
      g.add(m);
    }
    const slope = Math.atan2(0.85, W / 2);
    const len = Math.hypot(W / 2, 0.85) + 0.22;
    for (const side of [-1, 1]) {
      const m = box(len, 0.09, Dp + 0.45, roof, side * (W / 4 + 0.05), 0.22 + H + 0.43, 0);
      m.rotation.z = -side * slope;
      // Rows of tiles.
      for (let r = 0; r < 4; r++) {
        const t = box(0.03, 0.05, Dp + 0.46, timber, 0, 0, 0);
        t.material = roof.clone();
        (t.material as THREE.MeshStandardMaterial).color.set("#9c3a27");
        t.position.set(side * (W / 4 + 0.05) + side * (-len / 2 + 0.2 + r * 0.32) * Math.cos(slope), 0.22 + H + 0.43 + (len / 2 - 0.2 - r * 0.32) * Math.sin(slope) + 0.05, 0);
        t.rotation.z = -side * slope;
      }
    }
    box(0.12, 0.1, Dp + 0.5, timber, 0, 0.22 + H + 0.88, 0);
    // Chimney.
    box(0.24, 0.75, 0.24, brick, 0.48, 0.22 + H + 0.75, -0.25);
    box(0.3, 0.07, 0.3, stone, 0.48, 0.22 + H + 1.14, -0.25);
    this.chimneyTop.set(0.48, 0.22 + H + 1.2, -0.25);
    // Door with a round top, and a lantern beside it.
    const door = new THREE.MeshStandardMaterial({ color: "#6b3f22", roughness: 0.7 });
    box(0.4, 0.62, 0.05, door, 0, 0.22 + 0.31, Dp / 2 + 0.02);
    const arch = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.05, 20, 1, false, -Math.PI / 2, Math.PI), door);
    arch.rotation.x = Math.PI / 2;
    arch.rotation.z = 0;
    arch.position.set(0, 0.22 + 0.62, Dp / 2 + 0.02);
    g.add(arch);
    box(0.06, 0.06, 0.03, new THREE.MeshStandardMaterial({ color: "#d9b25a", metalness: 0.8, roughness: 0.3 }), 0.12, 0.22 + 0.32, Dp / 2 + 0.05);
    // Windows: warm glass that glows when someone's home or it's dark out.
    const glass = new THREE.MeshStandardMaterial({ color: "#2a3346", emissive: "#ffb85c", emissiveIntensity: 0, roughness: 0.2, metalness: 0.1 });
    this.windowMats.push(glass);
    const win = (x: number, z: number, ry: number) => {
      const w = new THREE.Group();
      const pane = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.32), glass);
      w.add(pane);
      for (const [bw, bh, bx, by] of [
        [0.4, 0.04, 0, 0.18],
        [0.4, 0.04, 0, -0.18],
        [0.04, 0.36, 0.18, 0],
        [0.04, 0.36, -0.18, 0],
        [0.025, 0.32, 0, 0],
        [0.34, 0.025, 0, 0],
      ]) {
        const b = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, 0.03), timber);
        b.position.set(bx, by, 0.01);
        w.add(b);
      }
      // A box of flowers under it.
      const fb = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.08, 0.1), timber);
      fb.position.set(0, -0.23, 0.05);
      w.add(fb);
      for (let i = 0; i < 6; i++) {
        const f = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), new THREE.MeshStandardMaterial({ color: ["#ff7aa2", "#ffd166", "#f4f1ff", "#ff9e5e"][i % 4], roughness: 0.6 }));
        f.position.set(-0.17 + i * 0.068, -0.17, 0.06);
        w.add(f);
      }
      w.position.set(x, 0.22 + H * 0.58, z);
      w.rotation.y = ry;
      g.add(w);
    };
    win(-0.5, Dp / 2 + 0.012, 0);
    win(0.5, Dp / 2 + 0.012, 0);
    win(W / 2 + 0.012, 0, Math.PI / 2);
    win(-W / 2 - 0.012, 0, -Math.PI / 2);
    const lanternMat = new THREE.MeshStandardMaterial({ color: "#ffcf7a", emissive: "#ffb347", emissiveIntensity: 1 });
    this.lampMats.push(lanternMat);
    box(0.09, 0.13, 0.09, lanternMat, 0.32, 0.22 + 0.72, Dp / 2 + 0.07);

    g.scale.setScalar(S);
    g.position.copy(at);
    g.position.y -= 0.04;
    g.userData.id = "home";
    this.pickables.push(g);
    this.island.add(g);

    // Stepping stones down to the edge.
    const stoneMat = new THREE.MeshStandardMaterial({ color: "#a39a88", roughness: 0.95 });
    const R = this.R;
    for (let z = at.z + 0.95; z < R * 0.92; z += 0.42) {
      const zi = Math.round(z * 10);
      const x = ((pathX(n, z * (this.isl.ry / R) + this.isl.cy) - this.isl.cx) / this.isl.rx) * R + (hash01(`ps${zi}`) - 0.5) * 0.12;
      const st = new THREE.Mesh(new THREE.CylinderGeometry(0.17 + hash01(`pr${zi}`) * 0.06, 0.19, 0.05, 9), stoneMat);
      st.position.set(x, this.heightAt(x, z) + 0.01, z);
      st.rotation.y = hash01(`py${zi}`) * 3;
      st.scale.z = 0.8;
      st.receiveShadow = true;
      this.island.add(st);
    }

    // Chimney smoke and (while it sleeps) Zzz.
    const puff = puffTexture("cloud");
    for (let i = 0; i < 10; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: puff, color: "#e8eef5", transparent: true, opacity: 0, depthWrite: false }));
      sp.userData.ph = i / 10;
      sp.raycast = () => {};
      this.smoke.push(sp);
      g.add(sp);
    }
    const zt = shapeTexture("z");
    for (let i = 0; i < 3; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: zt, color: "#dfe8ff", transparent: true, opacity: 0, depthWrite: false }));
      sp.userData.ph = i / 3;
      sp.raycast = () => {};
      this.zzz.push(sp);
      g.add(sp);
    }
  }

  /* ── pond, stream and waterfall ── */

  private buildPond() {
    const n = this.opts.n;
    const R = this.R;
    const pond = pondSpot(n);
    const c = this.toWorld(pond.x, pond.y);
    const pr = (pond.rx / this.isl.rx) * R;
    const sy = pond.ry / this.isl.ry / (pond.rx / this.isl.rx);
    const water = new THREE.ShaderMaterial({
      transparent: true,
      fog: true,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uSky: { value: new THREE.Color() }, uSunDir: { value: new THREE.Vector3() }, uSunCol: { value: new THREE.Color() } }]),
      vertexShader: `varying vec3 vW; #include <fog_pars_vertex>
        void main(){ vec4 wp = modelMatrix * vec4(position,1.); vW = wp.xyz; vec4 mvPosition = viewMatrix * wp; gl_Position = projectionMatrix * mvPosition; #include <fog_vertex>
 }`.replace(/ #/g, "\n#"),
      fragmentShader: `uniform float uTime; uniform vec3 uSky; uniform vec3 uSunDir; uniform vec3 uSunCol; uniform vec3 uMusicCol; uniform float uMusicMix; uniform float uKick; uniform vec2 uPondC; uniform vec2 uPondRad; varying vec3 vW; #include <fog_pars_fragment>
        void main(){
          vec2 q = vW.xz * 4.0;
          float t = uTime;
          // How far from the middle of the pond (1 = the bank). The stream and puddles use this water too: they count as deep.
          float rr = length((vW.xz - uPondC) / uPondRad);
          float inPond = 1.0 - smoothstep(1.1, 1.3, rr);
          float depth = mix(0.75, smoothstep(1.0, 0.3, rr), inPond);
          // With a song: rings run out from the middle on every beat.
          float pd = length(vW.xz - uPondC);
          float wave = sin(pd * 22.0 - uTime * 7.0) * uMusicMix * (0.04 + uKick * 0.12);
          // Ripples from several directions and sizes, so the surface never looks like one repeating wave.
          vec2 g = vec2(cos(q.x * 1.7 + q.y * 0.9 + t * 1.2), sin(q.y * 2.1 - q.x * 0.7 + t * 0.9)) * 0.045;
          g += vec2(cos(q.x * 3.9 - q.y * 2.2 - t * 1.7), sin(q.x * 2.6 + q.y * 3.4 + t * 1.5)) * 0.025;
          g += vec2(cos(q.x * 8.3 + q.y * 5.1 + t * 2.6), sin(q.x * 6.7 - q.y * 8.9 - t * 2.3)) * 0.012;
          vec3 nrm = normalize(vec3(g.x + wave, 1.0, g.y + wave));
          vec3 v = normalize(cameraPosition - vW);
          float fres = pow(1.0 - max(dot(v, nrm), 0.0), 3.0);
          // Shallow water near the bank is a clear turquoise over the earth; the middle is deep and dark.
          vec3 shallow = vec3(0.1, 0.34, 0.34);
          vec3 deep = vec3(0.008, 0.05, 0.075);
          vec3 body = mix(shallow, deep, depth) * (0.22 + 0.78 * clamp(length(uSky) * 1.5, 0.0, 1.0));
          vec3 refl = mix(uSky, vec3(0.3, 0.5, 0.7) * length(uSky), 0.5);
          vec3 col = mix(body, refl, 0.16 + fres * 0.72);
          // Sunlight in net-like lines on the shallows.
          float caus = pow(abs(sin(q.x * 3.0 + t) * sin(q.y * 3.0 - t * 1.2) + sin((q.x + q.y) * 2.0 + t * 0.8) * 0.5), 6.0);
          col += uSunCol * caus * (1.0 - depth) * 0.22 * inPond;
          // Glints of the sun: a sharp one and a wider, softer one.
          vec3 h = normalize(v + uSunDir);
          float nh = max(dot(nrm, h), 0.0);
          col += uSunCol * (pow(nh, 260.0) * 4.5 + pow(nh, 60.0) * 0.5);
          // ...and the water glows in the song's colour, brighter on the beat.
          col = mix(col, uMusicCol * 1.2, uMusicMix * (0.18 + uKick * 0.35) * (0.6 + 0.4 * sin(pd * 22.0 - uTime * 7.0)));
          // A soft shoreline: the water thins out where it meets the bank.
          float a = mix(0.93, 0.5, smoothstep(0.86, 1.02, rr) * inPond);
          gl_FragColor = vec4(col, a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <fog_fragment>
        }`.replace(/ #/g, "\n#"),
    });
    water.uniforms.uTime = this.uTime;
    water.uniforms.uMusicCol = this.uMusicCol;
    water.uniforms.uMusicMix = this.uMusicMix;
    water.uniforms.uKick = this.uKick;
    water.uniforms.uPondC = { value: new THREE.Vector2(c.x, c.z) };
    water.uniforms.uPondRad = { value: new THREE.Vector2(pr, pr * sy) };
    this.animatedMats.push(water);
    this.waterMats.push(water);
    // The pond sits in a small hollow, ringed by stones, with lily pads and reeds.
    const disc = new THREE.Mesh(new THREE.CircleGeometry(pr, 40), water);
    disc.rotation.x = -Math.PI / 2;
    disc.scale.y = sy;
    disc.position.set(c.x, c.y + 0.03, c.z);
    this.island.add(disc);
    // The wet bank: darker earth round the water, then a ring of stones of different sizes and shades.
    const bank = new THREE.Mesh(new THREE.CircleGeometry(pr * 1.26, 48), new THREE.MeshStandardMaterial({ color: "#4a3a2b", roughness: 0.95 }));
    bank.rotation.x = -Math.PI / 2;
    bank.scale.y = sy;
    bank.position.set(c.x, c.y + 0.016, c.z);
    bank.receiveShadow = true;
    bank.raycast = () => {};
    this.island.add(bank);
    const rocks: { x: number; z: number; s: number; r: number; l: number }[] = [];
    for (let i = 0; i < 32; i++) {
      const a = (i / 32) * Math.PI * 2 + hash01(`pk${i}`) * 0.16;
      if (Math.abs(((a - POND_ANGLE + Math.PI * 3) % (Math.PI * 2)) - Math.PI) < 0.3) continue;
      const rr = 1.06 + hash01(`pq${i}`) * 0.14;
      rocks.push({ x: c.x + Math.cos(a) * pr * rr, z: c.z + Math.sin(a) * pr * sy * rr, s: 0.05 + hash01(`pz${i}`) * 0.085, r: hash01(`pr${i}`) * 6, l: 0.36 + hash01(`pl${i}`) * 0.26 });
    }
    const rockMesh = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 1), new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.92 }), rocks.length);
    const rm = new THREE.Matrix4();
    const rq = new THREE.Quaternion();
    rocks.forEach((rk, i) => {
      rq.setFromEuler(new THREE.Euler(0, rk.r, 0));
      rm.compose(new THREE.Vector3(rk.x, this.heightAt(rk.x, rk.z) + rk.s * 0.2, rk.z), rq, new THREE.Vector3(rk.s * 1.25, rk.s * 0.62, rk.s));
      rockMesh.setMatrixAt(i, rm);
      rockMesh.setColorAt(i, new THREE.Color().setHSL(0.09, 0.07, rk.l));
    });
    rockMesh.castShadow = true;
    rockMesh.receiveShadow = true;
    rockMesh.raycast = () => {};
    this.island.add(rockMesh);
    // Lily pads in three greens, and a lotus flower on a few of them.
    const pads = ["#3f8a3a", "#4b9a43", "#336f33"].map((col) => new THREE.MeshStandardMaterial({ color: col, roughness: 0.6, side: THREE.DoubleSide }));
    const lotusMat = new THREE.MeshStandardMaterial({ color: "#ffc7dc", roughness: 0.5, side: THREE.DoubleSide });
    const lotusHeart = new THREE.MeshStandardMaterial({ color: "#ffd23f", roughness: 0.6 });
    const lotusPetal = (len: number, lift: number, ang: number) => {
      const p = new THREE.SphereGeometry(0.03, 8, 6);
      p.scale(len, 0.18, 0.55);
      p.translate(0.03 * len, 0, 0);
      p.rotateZ(lift);
      p.rotateY(ang);
      return p;
    };
    const lotusGeo = mergeGeometries([...Array.from({ length: 8 }, (_, k) => lotusPetal(1.6, 0.35, (k / 8) * Math.PI * 2)), ...Array.from({ length: 6 }, (_, k) => lotusPetal(1.2, 0.85, ((k + 0.5) / 6) * Math.PI * 2))]);
    for (let i = 0; i < 9; i++) {
      const a = hash01(`ly${i}`) * Math.PI * 2;
      const rr = pr * (0.2 + hash01(`lr${i}`) * 0.55);
      const px = c.x + Math.cos(a) * rr;
      const pz = c.z + Math.sin(a) * rr * sy;
      const m = new THREE.Mesh(new THREE.CircleGeometry(0.075 + hash01(`ls${i}`) * 0.07, 18, 0.35, Math.PI * 2 - 0.35), pads[i % 3]);
      m.rotation.x = -Math.PI / 2;
      m.rotation.z = hash01(`lz${i}`) * 6;
      m.position.set(px, c.y + 0.045, pz);
      this.island.add(m);
      if (i % 3 === 0) {
        const lotus = new THREE.Mesh(lotusGeo, lotusMat);
        lotus.position.set(px, c.y + 0.06, pz);
        this.island.add(lotus);
        const heart = new THREE.Mesh(new THREE.SphereGeometry(0.018, 8, 6), lotusHeart);
        heart.position.set(px, c.y + 0.075, pz);
        this.island.add(heart);
      }
    }
    // Reeds: tapering blades in two greens, leaning a little, with cattails among them.
    const reeds = [this.windy(new THREE.MeshStandardMaterial({ color: "#5b8f3a", roughness: 0.8 }), 0.25), this.windy(new THREE.MeshStandardMaterial({ color: "#6fa043", roughness: 0.8 }), 0.25)];
    const cattail = new THREE.MeshStandardMaterial({ color: "#6a4128", roughness: 0.9 });
    for (let i = 0; i < 30; i++) {
      const a = Math.PI + hash01(`rd${i}`) * 1.7;
      const rr = 0.97 + hash01(`re${i}`) * 0.22;
      const x = c.x + Math.cos(a) * pr * rr;
      const z = c.z + Math.sin(a) * pr * sy * rr;
      const hgt = 0.38 + hash01(`rh${i}`) * 0.34;
      const geo = new THREE.ConeGeometry(0.012, hgt, 4);
      geo.translate(0, hgt / 2, 0);
      const m = new THREE.Mesh(geo, reeds[i % 2]);
      m.position.set(x, this.heightAt(x, z), z);
      m.rotation.set((hash01(`rx${i}`) - 0.5) * 0.3, 0, (hash01(`rz${i}`) - 0.5) * 0.3);
      this.island.add(m);
      if (i % 3 === 0) {
        const cat = new THREE.Mesh(new THREE.CapsuleGeometry(0.02, 0.085, 3, 8), cattail);
        cat.position.set(x, this.heightAt(x, z) + hgt * 0.82, z);
        this.island.add(cat);
      }
    }

    // The stream from the pond to the rim.
    const a = POND_ANGLE;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const pts: THREE.Vector3[] = [];
    const r0 = Math.hypot(c.x, c.z) + pr * 0.8;
    for (let r = r0; r <= R * 1.0; r += 0.1) {
      const x = ca * r + Math.sin(r * 3) * 0.05;
      const z = sa * r;
      pts.push(new THREE.Vector3(x, this.heightAt(x, z) + 0.025, z));
    }
    const sp: number[] = [];
    const si: number[] = [];
    const side = new THREE.Vector3(-sa, 0, ca);
    pts.forEach((p, i) => {
      const w = 0.16 - (i / pts.length) * 0.04;
      sp.push(p.x + side.x * w, p.y, p.z + side.z * w, p.x - side.x * w, p.y, p.z - side.z * w);
      if (i) si.push((i - 1) * 2, i * 2, (i - 1) * 2 + 1, (i - 1) * 2 + 1, i * 2, i * 2 + 1);
    });
    const sg = new THREE.BufferGeometry();
    sg.setAttribute("position", new THREE.Float32BufferAttribute(sp, 3));
    sg.setIndex(si);
    this.island.add(new THREE.Mesh(sg, water));

    // The waterfall: a ribbon of falling water from the rim, flowing streaks, foam at the lip, fading into mist.
    const lip = pts[pts.length - 1];
    const fallH = this.D * 1.9 + 4;
    const fall = new THREE.PlaneGeometry(0.34, fallH, 1, 60);
    const fp = fall.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < fp.count; i++) {
      const v = THREE.MathUtils.clamp((fallH / 2 - fp.getY(i)) / fallH, 0, 1); // 0 at the top
      const out = Math.sqrt(v) * 1.1 + v * 0.4;
      fp.setXYZ(i, fp.getX(i) * (1 + v * 1.6), -v * fallH, out);
    }
    fall.computeVertexNormals();
    const fallMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: true,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTint: { value: new THREE.Color("#dff3ff") } }]),
      vertexShader: `varying vec2 vUv; #include <fog_pars_vertex>
        void main(){ vUv = uv; vec4 mvPosition = modelViewMatrix * vec4(position,1.); gl_Position = projectionMatrix * mvPosition; #include <fog_vertex>
 }`.replace(/ #/g, "\n#"),
      fragmentShader: `uniform float uTime; uniform vec3 uTint; varying vec2 vUv; #include <fog_pars_fragment>
        float h(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5); }
        void main(){
          float y = 1.0 - vUv.y;
          float x = vUv.x;
          float cols = floor(x * 14.0);
          float speed = 0.7 + h(vec2(cols, 1.0)) * 0.6;
          float streak = smoothstep(0.55, 1.0, fract(y * 3.0 - uTime * speed + h(vec2(cols, 2.0))));
          float edge = smoothstep(0.0, 0.18, x) * smoothstep(1.0, 0.82, x);
          float a = (0.35 + streak * 0.55) * edge * (1.0 - smoothstep(0.55, 1.0, y));
          float foam = smoothstep(0.08, 0.0, y);
          vec3 col = uTint * (1.1 + streak * 0.6 + foam);
          gl_FragColor = vec4(col, min(1.0, a + foam * edge));
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <fog_fragment>
        }`.replace(/ #/g, "\n#"),
    });
    fallMat.uniforms.uTime = this.uTime;
    this.animatedMats.push(fallMat);
    const fm = new THREE.Mesh(fall, fallMat);
    fm.position.copy(lip);
    fm.rotation.y = -a + Math.PI / 2;
    this.island.add(fm);
    // Mist at the lip and far below.
    const glow = puffTexture("glow");
    for (let i = 0; i < 9; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: "#ffffff", transparent: true, opacity: i < 3 ? 0.35 : 0.12, depthWrite: false }));
      const v = i < 3 ? 0.02 : 0.25 + (i / 9) * 0.6;
      s.position.copy(lip).add(new THREE.Vector3(ca * (0.2 + v * 1.4), -v * fallH, sa * (0.2 + v * 1.4)));
      s.scale.setScalar(i < 3 ? 0.5 : 1.2 + v * 3);
      s.userData = { base: s.position.y, ph: hash01(`ms${i}`) * 6 };
      s.raycast = () => {};
      this.mist.push(s);
      this.island.add(s);
    }
  }
  private waterMats: THREE.ShaderMaterial[] = [];
  private particleMats: { mat: THREE.ShaderMaterial; color: THREE.Color }[] = [];
  private leafTex: THREE.Texture | null = null;
  /* seasons and festivals */
  private decor = new THREE.Group();
  private decorKey = "";
  private flames: THREE.Sprite[] = [];
  private frogs: { o: THREE.Group; home: THREE.Vector3; t0: number; from: THREE.Vector3; to: THREE.Vector3; next: number }[] = [];
  private bursts: { pts: THREE.Points; vel: Float32Array; origin: THREE.Vector3; t0: number; on: boolean }[] = [];
  private nextBurst = 0;
  private fireworks = false;
  private glowTex: THREE.Texture | null = null;
  private shoot: THREE.Line | null = null;
  private shootAt = { t0: -99, next: 4, from: new THREE.Vector3(), dir: new THREE.Vector3() };
  private mist: THREE.Sprite[] = [];

  /* ── flowers, trees, lamps, gems ── */

  private buildItems(items: Placed[]) {
    for (const it of items) this.itemsById.set(it.id, it);
    const flowers = items.filter((i) => i.kind === "flower");
    const kindOf = (id: string) => Math.floor(hash01(id.split(":")[1] ?? "", 11) * 4);

    // Stems (all flowers): a slim tapered stem with two pointed leaves. Heads by kind (each its habit's colour).
    const stemGeo = (() => {
      const st = new THREE.CylinderGeometry(0.006, 0.011, 0.3, 6, 4);
      st.translate(0, 0.15, 0);
      const leaf = (y: number, side: number, len: number) => {
        const l = new THREE.SphereGeometry(0.03, 8, 6);
        l.scale(len, 0.1, 0.4);
        l.rotateZ(side * 0.5);
        l.translate(side * 0.05 * (len / 1.8), y, 0);
        return unindexed(l);
      };
      return mergeGeometries([unindexed(st), leaf(0.08, 1, 2), leaf(0.17, -1, 1.7)]);
    })();
    /** A petal: a thin flattened ellipsoid lying along +x, raised by `lift`, turned round the stem by `a`, `y` up the stem. */
    const petal = (len: number, wid: number, r: number, lift: number, a: number, y: number) => {
      const p = new THREE.SphereGeometry(0.03, 8, 6);
      p.scale(len, 0.16, wid);
      p.translate(r + 0.03 * len, 0, 0);
      p.rotateZ(lift);
      p.rotateY(a);
      p.translate(0, y, 0);
      return unindexed(p);
    };
    const ring = (count: number, len: number, wid: number, r: number, lift: number, y: number, offset = 0) => Array.from({ length: count }, (_, i) => petal(len, wid, r, lift, ((i + offset) / count) * Math.PI * 2, y));
    const heads: THREE.BufferGeometry[] = [
      // Daisy: two rings of long petals, the inner ring shorter and standing up.
      mergeGeometries([...ring(12, 1.4, 0.62, 0.014, 0.16, 0.3), ...ring(10, 1.0, 0.78, 0.01, 0.42, 0.306, 0.5)]),
      // Tulip: a smooth cup with three soft ridges, pinched towards the top.
      (() => {
        const prof = [[0, 0], [0.022, 0.004], [0.04, 0.025], [0.048, 0.055], [0.045, 0.085], [0.035, 0.112], [0.025, 0.128], [0.019, 0.14]].map(([x, y]) => new THREE.Vector2(x, y));
        const l = new THREE.LatheGeometry(prof, 15);
        const lp = l.attributes.position as THREE.BufferAttribute;
        for (let i = 0; i < lp.count; i++) {
          const x = lp.getX(i);
          const z = lp.getZ(i);
          const k = 1 + 0.1 * Math.cos(3 * Math.atan2(z, x)) * (lp.getY(i) / 0.14);
          lp.setX(i, x * k);
          lp.setZ(i, z * k);
        }
        l.translate(0, 0.285, 0);
        return unindexed(l);
      })(),
      // Pompom: a round, slightly fluffy head.
      (() => {
        const s = new THREE.IcosahedronGeometry(0.055, 2);
        const sp = s.attributes.position as THREE.BufferAttribute;
        for (let i = 0; i < sp.count; i++) {
          const k = 1 + (hash01(`pp${Math.round(sp.getX(i) * 900)}${Math.round(sp.getY(i) * 900)}${Math.round(sp.getZ(i) * 900)}`) - 0.5) * 0.22;
          sp.setXYZ(i, sp.getX(i) * k, sp.getY(i) * k, sp.getZ(i) * k);
        }
        s.translate(0, 0.33, 0);
        return unindexed(s);
      })(),
      // Sunflower: two rings of long thin petals round a big dark middle.
      mergeGeometries([...ring(18, 1.9, 0.5, 0.03, 0.1, 0.34), ...ring(14, 1.6, 0.55, 0.024, 0.3, 0.345, 0.5)]),
    ];
    const centreGeo = new THREE.SphereGeometry(0.024, 10, 8);
    centreGeo.scale(1, 0.65, 1);
    centreGeo.translate(0, 0.307, 0);
    const sunCentreGeo = new THREE.SphereGeometry(0.05, 12, 8);
    sunCentreGeo.scale(1, 0.4, 1);
    sunCentreGeo.translate(0, 0.348, 0);

    const stems = new THREE.InstancedMesh(stemGeo, this.windy(new THREE.MeshStandardMaterial({ color: "#3f7f30", roughness: 0.8 }), 0.9, 1), Math.max(1, flowers.length));
    const centres = new THREE.InstancedMesh(centreGeo, this.windy(new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.7 }), 0.9, 1), Math.max(1, flowers.length));
    const sunCentres = new THREE.InstancedMesh(sunCentreGeo, this.windy(new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.85 }), 0.9, 1), Math.max(1, flowers.length));
    const byKind = [0, 1, 2, 3].map((k) => flowers.filter((f) => kindOf(f.id) === k));
    const headMeshes = byKind.map((list, k) => {
      const mesh = new THREE.InstancedMesh(heads[k], this.windy(new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.55, side: THREE.DoubleSide }), 0.9, 1), Math.max(1, list.length));
      mesh.count = list.length;
      this.flowerHeads.push({ mesh, ids: list.map((f) => f.id) });
      return mesh;
    });
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const sv = new THREE.Vector3();
    const col = new THREE.Color();
    const kCount = [0, 0, 0, 0];
    let ci = 0;
    let si = 0;
    flowers.forEach((f, i) => {
      if (f.kind !== "flower") return;
      const p = this.toWorld(f.x, f.y);
      if (this.noteFrom.length < 40) this.noteFrom.push(p.clone().add(new THREE.Vector3(0, 0.7, 0)));
      const s = (0.95 + hash01(f.id, 3) * 0.12) * 1.9;
      q.setFromEuler(new THREE.Euler((hash01(f.id, 5) - 0.5) * 0.08, hash01(f.id, 6) * Math.PI * 2, (hash01(f.id, 7) - 0.5) * 0.08));
      sv.setScalar(s);
      m.compose(p, q, sv);
      stems.setMatrixAt(i, m);
      const k = kindOf(f.id);
      headMeshes[k].setMatrixAt(kCount[k], m);
      col.setHSL(f.hue / 360, 0.85, k === 2 ? 0.5 : 0.55);
      headMeshes[k].setColorAt(kCount[k], col);
      kCount[k]++;
      if (k === 0) {
        centres.setMatrixAt(ci, m);
        centres.setColorAt(ci, col.set("#ffd23f"));
        ci++;
      } else if (k === 3) {
        sunCentres.setMatrixAt(si, m);
        sunCentres.setColorAt(si, col.set("#4a2a14"));
        si++;
      }
    });
    stems.count = flowers.length;
    centres.count = ci;
    sunCentres.count = si;
    for (const o of [stems, centres, sunCentres, ...headMeshes]) {
      o.castShadow = false;
      o.frustumCulled = false;
      this.island.add(o);
    }

    // Trees, lamps and gems: few enough to be their own objects.
    const bark = new THREE.MeshStandardMaterial({ color: "#ffffff", vertexColors: true, roughness: 0.95 });
    for (const it of items) {
      if (it.kind === "tree") this.island.add(this.tree(it, bark));
      if (it.kind === "plant") this.island.add(this.plant(it));
      if (it.kind === "lamp") this.island.add(this.lamp(it));
      if (it.kind === "gem") this.island.add(this.gem(it));
    }
    this.clearGrass();
  }

  private tree(it: Placed & { kind: "tree" }, bark: THREE.Material) {
    const g = new THREE.Group();
    const kind = hash01(it.id, 9);
    const s = (0.55 + it.size * 0.65) * 1.35;
    const trunkH = kind > 0.45 && kind <= 0.75 ? 0.5 : 1.0;
    const pineTree = kind > 0.45 && kind <= 0.75;
    const sd = hash01(it.id, 41) * 6;
    // The trunk: tapered, knotted, flaring into roots at the foot and leaning a little; broadleaf trees also send out branches.
    const trunk = new THREE.CylinderGeometry(0.05, 0.1, trunkH, 10, 8);
    trunk.translate(0, trunkH / 2, 0);
    const tp = trunk.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < tp.count; i++) {
      const x = tp.getX(i);
      const y = tp.getY(i);
      const z = tp.getZ(i);
      const a = Math.atan2(z, x);
      let k = 1 + (fbm(a * 2 + sd, y * 4, sd, 2) - 0.5) * 0.28;
      if (y < 0.16) k *= 1 + ((0.16 - y) / 0.16) * 0.7 * (0.65 + 0.35 * Math.cos(3 * a + sd));
      tp.setXYZ(i, x * k + Math.sin(y * 2.4 + sd) * 0.03 * y, y, z * k);
    }
    const trunkParts: THREE.BufferGeometry[] = [trunk];
    if (!pineTree) {
      for (const [ang, y0, len] of [[0.6, 0.78, 0.5], [2.7, 0.9, 0.46], [4.5, 0.7, 0.42]] as const) {
        const b = new THREE.CylinderGeometry(0.014, 0.03, len, 6);
        b.translate(0, len / 2, 0);
        b.rotateZ(-0.9);
        b.rotateY(ang + sd * 0.3);
        b.translate(Math.sin(y0 * 2.4 + sd) * 0.03 * y0, y0, 0);
        trunkParts.push(b);
      }
    }
    let trunkGeo = mergeGeometries(trunkParts);
    trunkGeo.deleteAttribute("normal");
    trunkGeo.deleteAttribute("uv");
    trunkGeo = mergeVertices(trunkGeo, 1e-4);
    // Bark: dark at the foot and in the grooves, lighter in vertical streaks.
    const tcol = new Float32Array(trunkGeo.attributes.position.count * 3);
    const barkLo = new THREE.Color("#3a2617");
    const barkHi = new THREE.Color("#80593a");
    const bc = new THREE.Color();
    for (let i = 0; i < trunkGeo.attributes.position.count; i++) {
      const x = trunkGeo.attributes.position.getX(i);
      const y = trunkGeo.attributes.position.getY(i);
      const z = trunkGeo.attributes.position.getZ(i);
      const streak = fbm(Math.atan2(z, x) * 3 + sd, y * 1.6, 1.3, 2);
      bc.copy(barkLo).lerp(barkHi, Math.min(1, 0.22 + streak * 0.65 + Math.min(0.2, y * 0.15)));
      tcol.set([bc.r, bc.g, bc.b], i * 3);
    }
    trunkGeo.setAttribute("color", new THREE.BufferAttribute(tcol, 3));
    trunkGeo.computeVertexNormals();
    const tm = new THREE.Mesh(trunkGeo, bark);
    tm.castShadow = true;
    g.add(tm);
    const blob = (r: number, x: number, y: number, z: number, seed: number) => {
      const geo = new THREE.IcosahedronGeometry(r, 3);
      const p = geo.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < p.count; i++) {
        const v = new THREE.Vector3().fromBufferAttribute(p, i);
        const d = 1 + (fbm(v.x * 3 + seed, v.y * 3, v.z * 3, 3) - 0.5) * 0.45;
        p.setXYZ(i, v.x * d + x, v.y * d * 0.9 + y, v.z * d + z);
      }
      return unindexed(geo);
    };
    let canopy: THREE.BufferGeometry;
    let leafCol: [string, string];
    if (kind > 0.45 && kind <= 0.75) {
      // A pine: stacked, ragged cones.
      canopy = mergeGeometries(
        [0, 1, 2, 3, 4].map((k) => {
          const c = new THREE.ConeGeometry(0.68 - k * 0.1, 0.68, 14, 4);
          const p = c.attributes.position as THREE.BufferAttribute;
          for (let i = 0; i < p.count; i++) {
            const v = new THREE.Vector3().fromBufferAttribute(p, i);
            const d = 1 + (fbm(v.x * 5 + k, v.y * 5, v.z * 5, 2) - 0.5) * 0.3;
            // Boughs: the skirt of each tier scallops, most at its lower edge.
            const scallop = 1 + 0.1 * Math.sin(Math.atan2(v.z, v.x) * 8 + k * 1.7) * (1 - (v.y + 0.34) / 0.68);
            p.setXYZ(i, v.x * d * scallop, v.y, v.z * d * scallop);
          }
          c.translate(0, 0.7 + k * 0.36, 0);
          return unindexed(c);
        }),
      );
      leafCol = SEASON_LEAF[this.opts.season ?? "summer"].pine;
    } else {
      const blossom = kind > 0.75;
      canopy = mergeGeometries([blob(0.62, 0, 1.45, 0, 1), blob(0.45, -0.42, 1.2, 0.12, 2), blob(0.45, 0.4, 1.22, -0.1, 3), blob(0.4, 0.05, 1.85, 0.05, 4), blob(0.38, 0.1, 1.25, 0.42, 5), blob(0.36, -0.2, 1.6, -0.35, 6), blob(0.4, -0.05, 1.35, -0.45, 7), blob(0.34, 0.5, 1.6, 0.25, 8), blob(0.32, -0.5, 1.6, -0.1, 9)]);
      // Weld the vertices so the leaves shade smoothly (not as facets).
      canopy.deleteAttribute("normal");
      canopy.deleteAttribute("uv");
      canopy = mergeVertices(canopy, 1e-4);
      leafCol = blossom ? SEASON_LEAF[this.opts.season ?? "summer"].blossom : SEASON_LEAF[this.opts.season ?? "summer"].leaf;
    }
    // Colour: darker inside and below, lighter on top.
    const p = canopy.attributes.position as THREE.BufferAttribute;
    const cols = new Float32Array(p.count * 3);
    const c0 = new THREE.Color(leafCol[0]);
    const c1 = new THREE.Color(leafCol[1]);
    const c = new THREE.Color();
    let ymin = Infinity;
    let ymax = -Infinity;
    for (let i = 0; i < p.count; i++) {
      ymin = Math.min(ymin, p.getY(i));
      ymax = Math.max(ymax, p.getY(i));
    }
    for (let i = 0; i < p.count; i++) {
      const t = (p.getY(i) - ymin) / (ymax - ymin);
      c.copy(c0).lerp(c1, t * 0.85 + fbm(p.getX(i) * 4, p.getY(i) * 4, p.getZ(i) * 4, 2) * 0.3);
      cols.set([c.r, c.g, c.b], i * 3);
    }
    canopy.setAttribute("color", new THREE.BufferAttribute(cols, 3));
    canopy.computeVertexNormals();
    const leaves = new THREE.Mesh(canopy, this.windy(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 }), 0.035));
    leaves.castShadow = true;
    leaves.receiveShadow = true;
    g.add(leaves);
    // Leafy cards over the round crowns: soft, ragged edges instead of smooth balls.
    if (!(kind > 0.45 && kind <= 0.75)) {
      leaves.material.color.setScalar(0.72);
      this.leafTex ??= leafTexture();
      const cp = canopy.attributes.position as THREE.BufferAttribute;
      const centre = new THREE.Vector3(0, 1.45, 0);
      const cards: THREE.BufferGeometry[] = [];
      const count = this.quality === "high" ? 190 : 110;
      for (let i = 0; i < count; i++) {
        const v = new THREE.Vector3().fromBufferAttribute(cp, Math.floor(hash01(`${it.id}c${i}`) * cp.count));
        const out = v.clone().sub(centre).normalize();
        const q = new THREE.PlaneGeometry(0.42, 0.42);
        q.rotateX(hash01(`${it.id}x${i}`) * Math.PI);
        q.rotateY(hash01(`${it.id}y${i}`) * Math.PI);
        q.rotateZ(hash01(`${it.id}z${i}`) * Math.PI);
        q.translate(v.x + out.x * 0.06, v.y + out.y * 0.06, v.z + out.z * 0.06);
        // Each leaf cluster its own shade: lighter towards the top and the sun side, with a little random.
        const lt = THREE.MathUtils.clamp((v.y - 0.9) / 1.3 + (hash01(`${it.id}s${i}`) - 0.5) * 0.5 + out.y * 0.15, 0, 1);
        const shade = new THREE.Color(leafCol[0]).lerp(new THREE.Color(leafCol[1]), 0.15 + lt * 0.85);
        q.setAttribute("color", new THREE.BufferAttribute(new Float32Array([shade.r, shade.g, shade.b, shade.r, shade.g, shade.b, shade.r, shade.g, shade.b, shade.r, shade.g, shade.b]), 3));
        cards.push(q);
      }
      const cardGeo = mergeGeometries(cards);
      const cardMat = this.windy(new THREE.MeshStandardMaterial({ map: this.leafTex, alphaTest: 0.45, side: THREE.DoubleSide, vertexColors: true, roughness: 0.8 }), 0.035);
      const cm = new THREE.Mesh(cardGeo, cardMat);
      cm.receiveShadow = true;
      g.add(cm);
    }
    g.scale.setScalar(s);
    g.position.copy(this.toWorld(it.x, it.y));
    g.rotation.y = hash01(it.id, 4) * Math.PI * 2;
    g.userData.id = it.id;
    this.pickables.push(g);
    this.trees.push({ g, base: g.scale.clone(), ph: hash01(it.id, 21) * 6 });
    return g;
  }

  /** A habit's plant: a seed in a mound, a sprout, a sapling, and (21 days in a row) a full tree hung with its habit's colour. */
  private plant(it: Placed & { kind: "plant" }) {
    if (it.stage === 3) {
      // A grown tree, with glowing fruit in the habit's own colour.
      const g = this.tree({ ...it, kind: "tree", size: 0.3 } as unknown as Placed & { kind: "tree" }, new THREE.MeshStandardMaterial({ color: "#ffffff", vertexColors: true, roughness: 0.95 }));
      const fruit = new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL(it.hue / 360, 0.85, 0.62), emissive: new THREE.Color().setHSL(it.hue / 360, 0.9, 0.5), emissiveIntensity: 1.4, roughness: 0.35 });
      for (let k = 0; k < 9; k++) {
        const a = hash01(it.id, 50 + k) * Math.PI * 2;
        const r = 0.45 + hash01(it.id, 70 + k) * 0.3;
        const m = new THREE.Mesh(new THREE.SphereGeometry(0.055, 10, 8), fruit);
        m.position.set(Math.cos(a) * r, 1.35 + hash01(it.id, 90 + k) * 0.55, Math.sin(a) * r);
        m.raycast = () => {};
        g.add(m);
      }
      this.plantClear.push({ x: g.position.x, z: g.position.z, r: 0.5 });
      return g;
    }
    const g = new THREE.Group();
    const soil = new THREE.MeshStandardMaterial({ color: "#6a4a30", roughness: 1 });
    const green = new THREE.MeshStandardMaterial({ color: "#5fae42", roughness: 0.7 });
    const hueCol = new THREE.Color().setHSL(it.hue / 360, 0.85, 0.6);
    const mound = new THREE.Mesh(new THREE.SphereGeometry(it.stage === 0 ? 0.17 : 0.13, 14, 8), soil);
    mound.scale.set(1, 0.42, 1);
    mound.castShadow = true;
    mound.receiveShadow = true;
    g.add(mound);
    if (it.stage === 0) {
      // The seed itself, pale on the soil, and a soft glow in the habit's colour so it can be found.
      const seed = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), new THREE.MeshStandardMaterial({ color: "#d3b27a", roughness: 0.6 }));
      seed.scale.set(1, 0.7, 1.3);
      seed.position.set(0.02, 0.07, 0.01);
      g.add(seed);
    } else if (it.stage === 1) {
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.02, 0.3, 8), green);
      stem.position.y = 0.17;
      g.add(stem);
      for (const s of [-1, 1]) {
        const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 6), green);
        leaf.scale.set(1.3, 0.22, 0.6);
        leaf.position.set(s * 0.09, 0.3, 0);
        leaf.rotation.z = -s * 0.5;
        leaf.castShadow = true;
        g.add(leaf);
      }
    } else {
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.045, 0.75, 8), new THREE.MeshStandardMaterial({ color: "#6b4a2f", roughness: 0.9 }));
      trunk.position.y = 0.4;
      trunk.rotation.z = 0.06;
      trunk.castShadow = true;
      g.add(trunk);
      const leaves = this.windy(new THREE.MeshStandardMaterial({ color: "#4f9a3a", roughness: 0.75 }), 0.05);
      for (const [x, y, z, r] of [[0, 0.88, 0, 0.22], [0.14, 0.76, 0.05, 0.16], [-0.12, 0.74, -0.06, 0.15]] as const) {
        const b = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 2), leaves);
        b.position.set(x, y, z);
        b.castShadow = true;
        g.add(b);
      }
      const bud = new THREE.Mesh(new THREE.SphereGeometry(0.04, 10, 8), new THREE.MeshStandardMaterial({ color: hueCol, emissive: hueCol, emissiveIntensity: 1.2, roughness: 0.4 }));
      bud.position.set(0.04, 1.1, 0);
      g.add(bud);
    }
    // A soft glow in the habit's colour, so every plant can be found among the grass.
    this.glowTex ??= puffTexture("glow");
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, color: hueCol.clone().multiplyScalar(1.6), transparent: true, opacity: 0.45, depthWrite: false, blending: THREE.AdditiveBlending }));
    glow.position.y = it.stage === 0 ? 0.12 : 0.35;
    glow.scale.setScalar(it.stage === 0 ? 0.42 : 0.6);
    glow.raycast = () => {};
    g.add(glow);
    // An invisible bigger target, so a small plant is easy to tap.
    const hit = new THREE.Mesh(new THREE.SphereGeometry(0.4, 8, 6), new THREE.MeshBasicMaterial({ visible: false }));
    hit.position.y = 0.3;
    g.add(hit);
    g.position.copy(this.toWorld(it.x, it.y));
    this.plantClear.push({ x: g.position.x, z: g.position.z, r: 0.55 });
    g.scale.setScalar(1.8);
    g.rotation.y = hash01(it.id, 4) * Math.PI * 2;
    g.userData.id = it.id;
    this.pickables.push(g);
    return g;
  }

  private lamp(it: Placed) {
    const g = new THREE.Group();
    const iron = new THREE.MeshStandardMaterial({ color: "#26231f", roughness: 0.45, metalness: 0.75 });
    const brass = new THREE.MeshStandardMaterial({ color: "#b0813a", roughness: 0.32, metalness: 0.85 });
    const stone = new THREE.MeshStandardMaterial({ color: "#8b8478", roughness: 0.95 });
    const part = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z = 0) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      g.add(m);
      return m;
    };
    // A stone footing, a flared iron foot, a slim tapered post with brass collars.
    part(new THREE.CylinderGeometry(0.075, 0.095, 0.05, 12), stone, 0, 0.025);
    part(new THREE.CylinderGeometry(0.034, 0.07, 0.1, 12), iron, 0, 0.1);
    part(new THREE.CylinderGeometry(0.017, 0.03, 0.62, 10), iron, 0, 0.46);
    for (const y of [0.2, 0.72]) part(new THREE.TorusGeometry(0.027, 0.008, 6, 14), brass, 0, y).rotation.x = Math.PI / 2;
    // The lantern: a brass plate, four corner posts round a glass body, a flame inside, a pyramid roof, a finial and a ring.
    part(new THREE.CylinderGeometry(0.068, 0.052, 0.03, 4), brass, 0, 0.785).rotation.y = Math.PI / 4;
    const glow = new THREE.MeshStandardMaterial({ color: "#ffe2a6", emissive: "#ffb347", emissiveIntensity: 1, roughness: 0.2 });
    glow.userData.ph = hash01(it.id, 31) * 6.28;
    this.lampMats.push(glow);
    part(new THREE.CylinderGeometry(0.06, 0.052, 0.14, 4), glow, 0, 0.875).rotation.y = Math.PI / 4;
    for (const [x, z] of [[0.042, 0.042], [-0.042, 0.042], [0.042, -0.042], [-0.042, -0.042]]) part(new THREE.BoxGeometry(0.009, 0.15, 0.009), iron, x, 0.875, z);
    const flame = new THREE.Mesh(new THREE.SphereGeometry(0.028, 12, 10), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 1.8, 0.9), toneMapped: false }));
    flame.scale.y = 1.5;
    flame.position.y = 0.875;
    g.add(flame);
    part(new THREE.ConeGeometry(0.098, 0.08, 4), iron, 0, 0.99).rotation.y = Math.PI / 4;
    part(new THREE.TorusGeometry(0.075, 0.006, 5, 4), brass, 0, 0.955).rotation.set(Math.PI / 2, 0, Math.PI / 4);
    part(new THREE.SphereGeometry(0.013, 8, 6), brass, 0, 1.04);
    part(new THREE.TorusGeometry(0.016, 0.004, 5, 10), brass, 0, 1.062);
    // A soft halo, so lamps glow at night even where the bloom pass is off (phones).
    this.glowTex ??= puffTexture("glow");
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, color: "#ffb860", transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending }));
    halo.position.y = 0.875;
    halo.scale.setScalar(0.85);
    halo.raycast = () => {};
    this.haloMats.push(halo.material);
    this.nightOnly.push(halo);
    g.add(halo);
    if (this.lampLights.length < 6) {
      const l = new THREE.PointLight("#ffb860", 1.4, 3.2, 1.6);
      l.position.y = 0.9;
      this.lampLights.push(l);
      g.add(l);
    }
    g.position.copy(this.toWorld(it.x, it.y));
    g.scale.setScalar(1.35);
    g.userData.id = it.id;
    this.pickables.push(g);
    return g;
  }

  private gem(it: Placed & { kind: "gem" }) {
    const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL(it.hue / 360, 0.8, 0.6), emissive: new THREE.Color().setHSL(it.hue / 360, 0.9, 0.5), emissiveIntensity: 0.2, roughness: 0.05, metalness: 0.2 });
    this.gemMats.push(mat);
    const m = new THREE.Mesh(new THREE.OctahedronGeometry(0.09, 0), mat);
    m.scale.y = 1.45;
    m.castShadow = true;
    const g = new THREE.Group();
    g.add(m);
    const p = this.toWorld(it.x, it.y);
    g.position.copy(p);
    m.position.y = 0.22;
    this.bobbers.push({ o: m, y: 0.22, sp: 1.6 + hash01(it.id, 2), ph: hash01(it.id, 3) * 6, spin: 0.8 });
    g.userData.id = it.id;
    this.pickables.push(g);
    return g;
  }

  /* ── life in the air ── */

  private buildButterflies(count: number) {
    const tex = shapeTexture("wing");
    for (let i = 0; i < Math.min(12, count); i++) {
      const hue = ((i * 47 + 300) % 360) / 360;
      const mat = new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.5, color: new THREE.Color().setHSL(hue, 0.85, 0.65), side: THREE.DoubleSide, roughness: 0.6 });
      const wg = new THREE.PlaneGeometry(0.14, 0.14);
      wg.translate(0.07, 0, 0);
      wg.rotateX(-Math.PI / 2);
      const l = new THREE.Mesh(wg, mat);
      const r = new THREE.Mesh(wg, mat);
      r.scale.x = -1;
      const g = new THREE.Group();
      g.add(l, r);
      this.butterflies.push({ g, l, r, ph: hash01(`b${i}`) * 10, sp: 0.18 + hash01(`bs${i}`) * 0.12, rad: this.R * (0.35 + hash01(`br${i}`) * 0.5), h: 0.5 + hash01(`bh${i}`) * 0.9 });
      this.dayOnly.push(g);
      this.island.add(g);
    }
  }

  private uSeasonLight = { value: 1 };

  /**
   * A swarm of golden fireflies for the habit streak: none without one, four more for every day, up to 48.
   * They drift lazily over the whole island by day and by night, so the streak is always in sight.
   */
  private buildStreak(streak: number) {
    const n = fireflyCount(streak);
    if (!n) return;
    const R = this.R;
    const pos = new Float32Array(n * 3);
    const seed = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const a = hash3(i, 31, 32) * Math.PI * 2;
      const r = Math.sqrt(hash3(i, 33, 34)) * R * 0.95;
      pos.set([Math.cos(a) * r, 0.4 + hash3(i, 35, 36) * 2.0, Math.sin(a) * r], i * 3);
      seed[i] = hash3(i, 37, 38);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("seed", new THREE.BufferAttribute(seed, 1));
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { uTime: this.uTime, uBeat: this.uBeat, uSize: { value: 17 * (1 + Math.min(streak, 14) / 28) * this.renderer.getPixelRatio() } },
      vertexShader: `attribute float seed; uniform float uTime; uniform float uSize; uniform float uBeat; varying float vA;
        void main(){
          vec3 p = position;
          float t = uTime * 0.32 + seed * 40.0;
          // A slow loop and a bob, each firefly on its own path.
          p += vec3(sin(t * 0.9) * 1.5 + sin(t * 0.37) * 0.8, sin(t * 1.3 + 1.1) * 0.35, cos(t * 0.7) * 1.5 + cos(t * 0.29) * 0.8);
          vA = (0.55 + 0.45 * sin(uTime * (1.1 + seed * 1.6) + seed * 50.0)) * (1.0 + uBeat * 0.5);
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_PointSize = uSize * (0.7 + seed * 0.6) * (10.0 / -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `varying float vA;
        void main(){
          float d = length(gl_PointCoord - 0.5);
          // A bright warm heart and a soft glow round it, opaque enough to show against a sunny sky.
          float core = smoothstep(0.17, 0.0, d);
          float glow = smoothstep(0.5, 0.05, d);
          vec3 col = mix(vec3(1.0, 0.72, 0.22), vec3(1.0, 0.97, 0.78), core) * (1.5 + core * 1.5);
          gl_FragColor = vec4(col, (glow * glow * 0.75 + core) * vA);
        }`,
    });
    this.animatedMats.push(mat);
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    pts.raycast = () => {};
    this.island.add(pts);
  }

  /** The season's weather in the air: pink petals, falling leaves or frost sparkles drifting down across the island. */
  private buildSeason(season: Season) {
    const cfg = SEASON_FALL[season];
    if (!cfg) return;
    const R = this.R;
    const n = Math.round(cfg.count * (this.quality === "high" ? 1 : 0.55));
    const pos = new Float32Array(n * 3);
    const seed = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const a = hash3(i, 41, 42) * Math.PI * 2;
      const r = Math.sqrt(hash3(i, 43, 44)) * R * 1.15;
      pos.set([Math.cos(a) * r, 0, Math.sin(a) * r], i * 3);
      seed[i] = hash3(i, 45, 46);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("seed", new THREE.BufferAttribute(seed, 1));
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        uTime: this.uTime,
        uSize: { value: cfg.size * this.renderer.getPixelRatio() },
        uSpeed: { value: cfg.speed },
        uShape: { value: cfg.shape },
        uLight: this.uSeasonLight,
        uA: { value: new THREE.Color(cfg.colors[0]) },
        uB: { value: new THREE.Color(cfg.colors[1]) },
        uC: { value: new THREE.Color(cfg.colors[2]) },
      },
      vertexShader: `attribute float seed; uniform float uTime; uniform float uSize; uniform float uSpeed; uniform float uLight; uniform vec3 uA; uniform vec3 uB; uniform vec3 uC;
        varying float vA; varying vec3 vC; varying float vAng;
        void main(){
          float H = 6.0;
          // Each piece falls from the top to the grass, then starts again, swaying as it goes.
          float cyc = fract(seed * 7.13 + uTime * uSpeed * (0.6 + seed * 0.8) / H);
          vec3 p = position;
          p.y = 0.1 + H * (1.0 - cyc);
          float sw = uTime * (0.5 + seed * 0.8) + seed * 40.0;
          p.x += sin(sw) * 0.7 + sin(sw * 0.37) * 0.5;
          p.z += cos(sw * 0.9) * 0.7;
          vA = smoothstep(0.0, 0.07, cyc) * smoothstep(1.0, 0.92, cyc);
          vAng = uTime * (0.5 + seed * 1.2) + seed * 30.0;
          float k = fract(seed * 13.7);
          vC = (k < 0.34 ? uA : k < 0.67 ? uB : uC) * uLight;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_PointSize = uSize * (0.55 + seed * 0.8) * (10.0 / -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `uniform float uShape; varying float vA; varying vec3 vC; varying float vAng;
        void main(){
          vec2 pc = gl_PointCoord - 0.5;
          float c = cos(vAng); float s = sin(vAng);
          vec2 q = vec2(c * pc.x - s * pc.y, s * pc.x + c * pc.y);
          float a;
          float tone = 1.0;
          if (uShape < 0.5) { a = smoothstep(0.5, 0.26, length(vec2(q.x, q.y * 2.4))); tone = 0.88 + 0.25 * smoothstep(0.12, 0.0, abs(q.y)); }
          else if (uShape < 1.5) { a = smoothstep(0.5, 0.33, abs(q.x) * 2.3 + abs(q.y) * 0.95); tone = 0.82 + 0.3 * smoothstep(0.06, 0.0, abs(q.y)); }
          else { float d = length(pc); a = smoothstep(0.5, 0.0, d); a *= a; tone = 1.6; }
          gl_FragColor = vec4(vC * tone, a * vA);
        }`,
    });
    this.animatedMats.push(mat);
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    pts.raycast = () => {};
    this.island.add(pts);
  }

  private buildParticles() {
    const R = this.R;
    // Fireflies at night, sun-lit pollen by day: points that drift in the shader.
    const make = (n: number, color: string, size: number, spread: number, height: number, speed: number, pulse: number) => {
      const pos = new Float32Array(n * 3);
      const seed = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const a = hash3(i, 1, 2) * Math.PI * 2;
        const r = Math.sqrt(hash3(i, 3, 4)) * R * spread;
        pos.set([Math.cos(a) * r, 0.2 + hash3(i, 5, 6) * height, Math.sin(a) * r], i * 3);
        seed[i] = hash3(i, 7, 8);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      geo.setAttribute("seed", new THREE.BufferAttribute(seed, 1));
      const mat = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: { uTime: this.uTime, uBeat: this.uBeat, uColor: { value: new THREE.Color(color) }, uSize: { value: size * this.renderer.getPixelRatio() } },
        vertexShader: `attribute float seed; uniform float uTime; uniform float uSize; uniform float uBeat; varying float vA;
          void main(){
            vec3 p = position;
            float t = uTime * ${speed.toFixed(2)} * (1.0 + uBeat * 0.6) + seed * 30.0;
            p += vec3(sin(t * 0.7) * 0.6, sin(t * 0.9 + 1.3) * 0.25, cos(t * 0.6) * 0.6);
            vA = mix(1.0, 0.5 + 0.5 * sin(uTime * 2.2 + seed * 20.0), ${pulse.toFixed(2)}) * (1.0 + uBeat * 0.7);
            vec4 mv = modelViewMatrix * vec4(p, 1.0);
            gl_PointSize = uSize * (0.6 + seed) * (10.0 / -mv.z) * (1.0 + uBeat * 0.25);
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: `uniform vec3 uColor; varying float vA;
          void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.0, d); gl_FragColor = vec4(uColor * 2.5, a * a * vA); }`,
      });
      this.animatedMats.push(mat);
      this.particleMats.push({ mat, color: new THREE.Color(color) });
      const pts = new THREE.Points(geo, mat);
      pts.frustumCulled = false;
      this.island.add(pts);
      return pts;
    };
    this.nightOnly.push(make(this.quality === "high" ? 140 : 70, "#d9ff8a", 9, 1.0, 1.6, 0.5, 1));
    this.dayOnly.push(make(this.quality === "high" ? 160 : 70, "#fff2c8", 3.5, 1.25, 3, 0.25, 0.3));

    // Daytime music: bright petals in the music lights' colours float up and bounce with the beat.
    // Plain (not added) colour, so they show against the sunny sky; fireflies do this job at night.
    const n = this.quality === "high" ? 220 : 110;
    const pos = new Float32Array(n * 3);
    const seed = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const a = hash3(i, 11, 12) * Math.PI * 2;
      const r = Math.sqrt(hash3(i, 13, 14)) * R * 1.05;
      pos.set([Math.cos(a) * r, hash3(i, 15, 16), Math.sin(a) * r], i * 3);
      seed[i] = hash3(i, 17, 18);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("seed", new THREE.BufferAttribute(seed, 1));
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { uTime: this.uTime, uBeat: this.uBeat, uKick: this.uKick, uOn: this.uMusicOn, uColor: this.uMusicCol, uSize: { value: 9 * this.renderer.getPixelRatio() } },
      vertexShader: `attribute float seed; uniform float uTime; uniform float uSize; uniform float uBeat; uniform float uKick; varying float vS;
        void main(){
          vec3 p = position;
          float t = uTime * (0.35 + seed * 0.25) + seed * 40.0;
          // Rise from the grass to about 3.5 high, then start again at the bottom.
          p.y = 0.15 + fract(position.y + uTime * (0.05 + seed * 0.04)) * 3.5;
          p.x += sin(t) * 0.5;
          p.z += cos(t * 0.8) * 0.5;
          vS = seed;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_PointSize = uSize * (0.6 + seed * 0.8) * (10.0 / -mv.z) * (1.0 + uBeat * 0.8 + uKick * 0.7);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `uniform vec3 uColor; uniform float uOn; uniform float uTime; varying float vS;
        void main(){
          // A small spinning petal: an ellipse that turns over time.
          vec2 q = gl_PointCoord - 0.5;
          float a = uTime * (1.0 + vS * 2.0) + vS * 20.0;
          q = mat2(cos(a), -sin(a), sin(a), cos(a)) * q;
          float d = length(q * vec2(1.0, 1.9));
          if (d > 0.5) discard;
          // Shades around the music colour (some lighter, some deeper), with a soft rim so each petal reads.
          vec3 c = mix(uColor * 0.75, mix(uColor, vec3(1.0), 0.45), fract(vS * 7.0));
          c *= mix(1.0, 0.8, smoothstep(0.3, 0.5, d));
          gl_FragColor = vec4(c, uOn * 0.95);
          #include <colorspace_fragment>
        }`,
    });
    this.animatedMats.push(mat);
    this.confetti = new THREE.Points(geo, mat);
    this.confetti.frustumCulled = false;
    this.confetti.visible = false;
    this.island.add(this.confetti);
  }

  private buildClouds() {
    const tex = puffTexture("cloud");
    const R = this.R;
    // A sea of clouds far below, and a few drifting at the island's height further out.
    const add = (n: number, rMin: number, rMax: number, y0: number, y1: number, smin: number, smax: number, op: number) => {
      for (let i = 0; i < n; i++) {
        const mat = new THREE.SpriteMaterial({ map: tex, color: "#ffffff", transparent: true, opacity: op, depthWrite: false });
        this.cloudMats.push(mat);
        const s = new THREE.Sprite(mat);
        const a = hash3(i, y0, 1) * Math.PI * 2;
        const r = R * (rMin + hash3(i, y0, 2) * (rMax - rMin));
        s.position.set(Math.cos(a) * r, R * (y0 + hash3(i, y0, 3) * (y1 - y0)), Math.sin(a) * r);
        s.scale.set(R * (smin + hash3(i, y0, 4) * (smax - smin)), R * (smin + hash3(i, y0, 4) * (smax - smin)) * 0.55, 1);
        this.clouds.add(s);
      }
    };
    add(this.quality === "high" ? 70 : 36, 0.4, 7, -2.6, -1.9, 2.2, 4.2, 0.95);
    add(10, 3.2, 6.5, -0.4, 1.2, 1.2, 2.4, 0.7);
    this.scene.add(this.clouds);
  }

  private buildFarIslands() {
    const leaf = new THREE.MeshStandardMaterial({ color: "#3d7a3a", roughness: 0.9, flatShading: true });
    const top = new THREE.MeshStandardMaterial({ color: "#5c9a42", roughness: 1 });
    [
      [-4.6, 0.6, -3.2, 0.32],
      [4.2, -0.3, -4.4, 0.24],
      [1.4, 1.6, -7.5, 0.4],
      [-6.5, -0.9, 1.2, 0.18],
    ].forEach(([x, y, z, s], i) => {
      const g = new THREE.Group();
      const r = this.R * s;
      g.add(this.rockMass(r, r * 0.7, 40, 14, 0));
      const t = new THREE.Mesh(new THREE.CircleGeometry(r, 40), top);
      t.rotation.x = -Math.PI / 2;
      t.position.y = 0.01;
      g.add(t);
      for (let k = 0; k < 3 + i; k++) {
        const c = new THREE.Mesh(new THREE.IcosahedronGeometry(r * 0.22, 0), leaf);
        const a = hash01(`fi${i}${k}`) * 6.28;
        c.position.set(Math.cos(a) * r * 0.5, r * 0.25, Math.sin(a) * r * 0.5);
        g.add(c);
      }
      g.position.set(x * this.R, y * this.R, z * this.R);
      this.bobbers.push({ o: g, y: g.position.y, sp: 0.3 + i * 0.05, ph: i * 2, spin: 0.02 });
      this.farIslands.push(g);
      this.scene.add(g);
    });
  }

  private buildRain() {
    const n = this.quality === "high" ? 2200 : 900;
    const R = this.R;
    const pos = new Float32Array(n * 6);
    for (let i = 0; i < n; i++) {
      const x = (hash3(i, 1, 9) - 0.5) * R * 5;
      const z = (hash3(i, 2, 9) - 0.5) * R * 5;
      const y = hash3(i, 3, 9) * R * 4;
      pos.set([x, y, z, x - 0.04, y + 0.45, z - 0.015], i * 6);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { uTime: this.uTime, uH: { value: R * 4 } },
      vertexShader: `uniform float uTime; uniform float uH; varying float vA;
        void main(){ vec3 p = position; p.y = mod(p.y - uTime * 14.0, uH) - uH * 0.45; vA = 0.35; gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.); }`,
      fragmentShader: `varying float vA; void main(){ gl_FragColor = vec4(0.75, 0.85, 1.0, vA); }`,
    });
    this.animatedMats.push(mat);
    this.rain = new THREE.LineSegments(geo, mat);
    this.rain.frustumCulled = false;
    this.scene.add(this.rain);
  }

  /* ── seasons and festivals ── */

  /** Spots on the grass away from everything planted, the cottage, the path and the pond. */
  private freeSpots(count: number, seed: string, clear = 0.5, rMax = 0.88) {
    const n = this.opts.n;
    const home = this.toWorld(homeSpot(n).x, homeSpot(n).y);
    const pond = pondSpot(n);
    const pw = this.toWorld(pond.x, pond.y);
    const prw = (pond.rx / this.isl.rx) * this.R;
    const taken = [...this.itemsById.values()].map((it) => this.toWorld(it.x, it.y));
    const out: THREE.Vector3[] = [];
    for (let i = 0; out.length < count && i < count * 60; i++) {
      const a = hash01(`${seed}a${i}`) * Math.PI * 2;
      const r = Math.sqrt(hash01(`${seed}r${i}`)) * this.R * rMax;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      if (Math.hypot(x - home.x, z - home.z) < 1.6 || Math.hypot(x - pw.x, z - pw.z) < prw + 0.5) continue;
      if (z > home.z && Math.abs(x - this.pathWorld(z)) < 0.55) continue;
      if (taken.some((p) => Math.hypot(p.x - x, p.z - z) < clear) || out.some((p) => Math.hypot(p.x - x, p.z - z) < clear * 2)) continue;
      out.push(new THREE.Vector3(x, this.heightAt(x, z), z));
    }
    return out;
  }
  private pathWorld(z: number) {
    const R = this.R;
    return ((pathX(this.opts.n, z * (this.isl.ry / R) + this.isl.cy) - this.isl.cx) / this.isl.rx) * R;
  }

  /** Monsoon: rain puddles that ripple, and a few frogs that hop about. */
  private buildMonsoon() {
    const water = this.waterMats[0];
    for (const p of this.freeSpots(7, "pd", 0.45)) {
      const geo = new THREE.CircleGeometry(0.28 + hash01(`pz${p.x}`) * 0.22, 24);
      const pos = geo.attributes.position as THREE.BufferAttribute;
      for (let i = 1; i < pos.count; i++) {
        const k = 0.8 + fbm(pos.getX(i) * 6, 1, pos.getY(i) * 6, 2) * 0.45;
        pos.setXY(i, pos.getX(i) * k, pos.getY(i) * k * 0.75);
      }
      const m = new THREE.Mesh(geo, water);
      m.rotation.x = -Math.PI / 2;
      m.rotation.z = hash01(`pr${p.z}`) * 6;
      m.position.copy(p).y += 0.025;
      this.decor.add(m);
      this.decorClear.push({ x: p.x, z: p.z, r: 0.55 });
    }
    const skin = new THREE.MeshStandardMaterial({ color: "#4e9a3a", roughness: 0.5 });
    const belly = new THREE.MeshStandardMaterial({ color: "#c9d97a", roughness: 0.6 });
    const eye = new THREE.MeshStandardMaterial({ color: "#111", roughness: 0.2 });
    for (const p of this.freeSpots(3, "fg", 0.6, 0.75)) {
      const f = new THREE.Group();
      const body = new THREE.Mesh(new THREE.SphereGeometry(0.07, 14, 10), skin);
      body.scale.set(1, 0.7, 1.25);
      body.position.y = 0.05;
      const b2 = new THREE.Mesh(new THREE.SphereGeometry(0.055, 10, 8), belly);
      b2.scale.set(1, 0.5, 1.1);
      b2.position.set(0, 0.035, 0.02);
      f.add(body, b2);
      for (const sx of [-1, 1]) {
        const e = new THREE.Mesh(new THREE.SphereGeometry(0.022, 8, 6), skin);
        e.position.set(sx * 0.035, 0.1, 0.05);
        const pu = new THREE.Mesh(new THREE.SphereGeometry(0.011, 6, 5), eye);
        pu.position.set(sx * 0.038, 0.106, 0.068);
        const leg = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), skin);
        leg.scale.set(0.6, 0.45, 1.3);
        leg.position.set(sx * 0.065, 0.02, -0.03);
        f.add(e, pu, leg);
      }
      f.scale.setScalar(2.4);
      this.decorClear.push({ x: p.x, z: p.z, r: 0.3 });
      f.position.copy(p);
      f.rotation.y = hash01(`fr${p.x}`) * 6;
      f.traverse((o) => ((o as THREE.Mesh).castShadow = true));
      this.frogs.push({ o: f, home: p.clone(), t0: -9, from: p.clone(), to: p.clone(), next: 2 + hash01(`fn${p.z}`) * 5 });
      this.decor.add(f);
    }
  }

  /** Pongal: a kolam at the door, sugarcane leaning by it, and a pot boiling over on a little fire. */
  private buildPongal() {
    this.buildKolam("pulli");
    const n = this.opts.n;
    const home = this.toWorld(homeSpot(n).x, homeSpot(n).y);
    const S = THREE.MathUtils.clamp(this.isl.rx / 300, 0.95, 1.25);
    const cane = new THREE.MeshStandardMaterial({ color: "#6a2f4a", roughness: 0.55 });
    const node = new THREE.MeshStandardMaterial({ color: "#c9b27a", roughness: 0.7 });
    const leaf = this.windy(new THREE.MeshStandardMaterial({ color: "#5f9a3a", roughness: 0.7, side: THREE.DoubleSide }), 0.08);
    for (const side of [-1, 1]) {
      const g = new THREE.Group();
      for (let k = 0; k < 7; k++) {
        const seg = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.038, 0.3, 8), cane);
        seg.position.y = 0.15 + k * 0.3;
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.037, 0.008, 5, 10), node);
        ring.rotation.x = Math.PI / 2;
        ring.position.y = k * 0.3 + 0.3;
        g.add(seg, ring);
      }
      for (let k = 0; k < 5; k++) {
        const l = new THREE.Mesh(new THREE.PlaneGeometry(0.06, 0.8), leaf);
        l.geometry.translate(0, 0.4, 0);
        l.position.y = 2.05;
        l.rotation.set(0.6 + k * 0.08, (k / 5) * Math.PI * 2, 0.3);
        g.add(l);
      }
      g.position.set(home.x + side * 0.42 * S, home.y, home.z + 0.95 * S);
      g.scale.setScalar(1.3);
      g.rotation.z = -side * 0.12;
      g.traverse((o) => ((o as THREE.Mesh).castShadow = true));
      this.decor.add(g);
    }
    // The pongal pot: clay, a turmeric-leaf collar, rice foaming over, on three stones and a fire.
    const pot = new THREE.Group();
    const clay = new THREE.MeshStandardMaterial({ color: "#a4532e", roughness: 0.8 });
    const body = new THREE.Mesh(new THREE.LatheGeometry([new THREE.Vector2(0.0, 0), new THREE.Vector2(0.14, 0.02), new THREE.Vector2(0.2, 0.12), new THREE.Vector2(0.17, 0.25), new THREE.Vector2(0.12, 0.3), new THREE.Vector2(0.14, 0.33)], 24), clay);
    body.position.y = 0.14;
    const foam = new THREE.Mesh(new THREE.SphereGeometry(0.14, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: "#fffaf0", roughness: 0.9 }));
    foam.scale.y = 0.7;
    foam.position.y = 0.47;
    const collar = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.02, 6, 20), new THREE.MeshStandardMaterial({ color: "#3e8a2c" }));
    collar.rotation.x = Math.PI / 2;
    collar.position.y = 0.4;
    const stone = new THREE.MeshStandardMaterial({ color: "#7b746a", roughness: 1 });
    for (let k = 0; k < 3; k++) {
      const st = new THREE.Mesh(new THREE.DodecahedronGeometry(0.08, 0), stone);
      const a = (k / 3) * Math.PI * 2;
      st.position.set(Math.cos(a) * 0.17, 0.06, Math.sin(a) * 0.17);
      pot.add(st);
    }
    pot.add(body, foam, collar);
    this.glowTex ??= puffTexture("glow");
    const fire = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, color: new THREE.Color("#ff8a2a").multiplyScalar(3), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    fire.position.y = 0.08;
    fire.scale.setScalar(0.35);
    fire.raycast = () => {};
    this.flames.push(fire);
    pot.add(fire);
    const px = home.x - 1.25 * S;
    const pz = home.z + 0.75 * S;
    pot.position.set(px, this.heightAt(px, pz), pz);
    pot.scale.setScalar(1.7);
    this.decorClear.push({ x: px, z: pz, r: 0.6 });
    pot.traverse((o) => ((o as THREE.Mesh).castShadow = true));
    this.decor.add(pot);
  }

  /** Christmas: a lit fir tree with a star and a few gifts beside the cottage. */
  private buildChristmas() {
    const n = this.opts.n;
    const home = this.toWorld(homeSpot(n).x, homeSpot(n).y);
    const S = THREE.MathUtils.clamp(this.isl.rx / 300, 0.95, 1.25);
    const x = home.x + 1.45 * S;
    const z = home.z + 0.55 * S;
    const base = this.heightAt(x, z);
    const tree = new THREE.Group();
    const fir = this.windy(new THREE.MeshStandardMaterial({ color: "#1f5a35", roughness: 0.85 }), 0.04);
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.3, 8), new THREE.MeshStandardMaterial({ color: "#5a3a22", roughness: 0.9 }));
    trunk.position.y = 0.15;
    tree.add(trunk);
    // Three tiers, each a little narrower and higher.
    const tiers: [number, number, number][] = [[0.62, 0.78, 0.5], [0.5, 0.7, 0.98], [0.36, 0.62, 1.4]];
    for (const [r, h, y] of tiers) {
      const cone = new THREE.Mesh(new THREE.ConeGeometry(r, h, 16), fir);
      cone.position.y = y;
      cone.castShadow = true;
      tree.add(cone);
    }
    // The star on top.
    const star = new THREE.Mesh(new THREE.OctahedronGeometry(0.1, 0), new THREE.MeshStandardMaterial({ color: "#ffd84a", emissive: "#ffcf33", emissiveIntensity: 2.2, roughness: 0.4 }));
    star.position.y = 1.86;
    star.scale.set(1, 1.3, 0.5);
    tree.add(star);
    // Fairy lights winding round it: tiny glowing bulbs that flicker a little.
    this.glowTex ??= puffTexture("glow");
    const colors = ["#ff5d5d", "#ffd84a", "#6ec1ff", "#7dff9a", "#ff9bf0"];
    const bulbs = 26;
    for (let k = 0; k < bulbs; k++) {
      const t = k / bulbs;
      const y = 0.38 + t * 1.38;
      const r = (0.6 - t * 0.5) * 0.92;
      const a = t * Math.PI * 7;
      const bulb = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, color: new THREE.Color(colors[k % colors.length]).multiplyScalar(2.6), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      bulb.position.set(Math.cos(a) * r, y, Math.sin(a) * r);
      bulb.scale.setScalar(0.11);
      bulb.userData.ph = k * 1.7;
      bulb.raycast = () => {};
      this.flames.push(bulb);
      tree.add(bulb);
    }
    tree.position.set(x, base, z);
    tree.scale.setScalar(1.25);
    this.decorClear.push({ x, z, r: 0.8 });
    this.decor.add(tree);
    // Gifts at its foot.
    const wraps = ["#d63b3b", "#2f7fe8", "#f5b400"];
    const ribbon = new THREE.MeshStandardMaterial({ color: "#f4f1e8", roughness: 0.5 });
    [[0.62, 0.16, 0.2], [0.42, 0.62, 0.15], [0.78, 0.5, 0.13]].forEach(([dx, dz, s], i) => {
      const gx = x + dx * S;
      const gz = z + dz * S;
      const box = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(s * 1.5, s * 1.1, s * 1.5), new THREE.MeshStandardMaterial({ color: wraps[i % 3], roughness: 0.6 }));
      body.position.y = s * 0.55;
      const band = new THREE.Mesh(new THREE.BoxGeometry(s * 1.56, s * 1.14, s * 0.28), ribbon);
      band.position.y = s * 0.55;
      const band2 = new THREE.Mesh(new THREE.BoxGeometry(s * 0.28, s * 1.14, s * 1.56), ribbon);
      band2.position.y = s * 0.55;
      box.add(body, band, band2);
      box.position.set(gx, this.heightAt(gx, gz), gz);
      box.rotation.y = i * 0.7;
      box.traverse((o) => ((o as THREE.Mesh).castShadow = true));
      this.decorClear.push({ x: gx, z: gz, r: 0.18 });
      this.decor.add(box);
    });
  }

  /** Tamil New Year (Puthandu): a kolam, a mango-leaf toran over the door, and a plate of mangoes. */
  private buildPuthandu() {
    this.buildKolam("pulli");
    const n = this.opts.n;
    const home = this.toWorld(homeSpot(n).x, homeSpot(n).y);
    const S = THREE.MathUtils.clamp(this.isl.rx / 300, 0.95, 1.25);
    const leaf = this.windy(new THREE.MeshStandardMaterial({ color: "#4f8f2e", roughness: 0.65, side: THREE.DoubleSide }), 0.12);
    const flower = new THREE.MeshStandardMaterial({ color: "#ffb02e", emissive: "#ff9a00", emissiveIntensity: 0.25, roughness: 0.6 });
    // The toran: mango leaves hanging in a sagging row across the doorway, with marigolds between.
    const halfW = 0.46 * S;
    const doorY = 1.3;
    const zz = home.z + 0.98 * S;
    const strand = new THREE.Group();
    const count = 15;
    for (let k = 0; k <= count; k++) {
      const t = k / count;
      const px = home.x + (t - 0.5) * 2 * halfW;
      const py = doorY - Math.sin(t * Math.PI) * 0.1;
      const l = new THREE.Mesh(new THREE.PlaneGeometry(0.075, 0.2), leaf);
      l.geometry.translate(0, -0.1, 0);
      l.position.set(px, py, zz);
      l.rotation.z = (t - 0.5) * 0.5;
      strand.add(l);
      if (k % 3 === 1) {
        const m = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), flower);
        m.position.set(px + 0.02, py - 0.015, zz + 0.01);
        strand.add(m);
      }
    }
    strand.position.y = this.heightAt(home.x, zz);
    this.decor.add(strand);
    // A plate of mangoes, left of the kolam.
    const px = home.x - 1.05 * S;
    const pz = home.z + 1.25 * S;
    const plate = new THREE.Group();
    const dish = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.16, 0.03, 18), new THREE.MeshStandardMaterial({ color: "#b8863a", roughness: 0.4, metalness: 0.5 }));
    dish.position.y = 0.015;
    plate.add(dish);
    const skin = new THREE.MeshStandardMaterial({ color: "#f2b53a", roughness: 0.55 });
    const blush = new THREE.MeshStandardMaterial({ color: "#e0602c", roughness: 0.55 });
    [[0, 0, 0], [0.09, 0.05, 1], [-0.07, 0.07, 0], [0.01, -0.09, 1]].forEach(([dx, dz, b], i) => {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.075, 12, 10), b ? blush : skin);
      m.scale.set(1, 0.85, 1.25);
      m.position.set(dx, 0.1 + (i === 3 ? 0.03 : 0), dz);
      m.rotation.y = i;
      plate.add(m);
    });
    plate.position.set(px, this.heightAt(px, pz), pz);
    plate.scale.setScalar(1.5);
    plate.traverse((o) => ((o as THREE.Mesh).castShadow = true));
    this.decorClear.push({ x: px, z: pz, r: 0.4 });
    this.decor.add(plate);
  }

  /** India (15 August, 26 January): the tricolour on a pole beside the cottage, waving in the garden's wind. */
  private buildIndia() {
    const n = this.opts.n;
    const home = this.toWorld(homeSpot(n).x, homeSpot(n).y);
    const S = THREE.MathUtils.clamp(this.isl.rx / 300, 0.95, 1.25);
    const x = home.x + 1.5 * S;
    const z = home.z + 0.7 * S;
    const base = this.heightAt(x, z);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.025, 2.1, 8), new THREE.MeshStandardMaterial({ color: "#d9d4c7", roughness: 0.35, metalness: 0.6 }));
    pole.position.set(x, base + 1.05, z);
    pole.castShadow = true;
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.04, 10, 8), new THREE.MeshStandardMaterial({ color: "#f5c542", roughness: 0.3, metalness: 0.7 }));
    knob.position.set(x, base + 2.12, z);
    this.decor.add(pole, knob);
    const tex = flagTexture();
    const flagMat = this.windy(new THREE.MeshStandardMaterial({ map: tex, side: THREE.DoubleSide, roughness: 0.8 }), 0.35);
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.78, 0.52, 14, 8), flagMat);
    flag.geometry.translate(0.39, 0, 0);
    flag.position.set(x + 0.02, base + 1.82, z);
    flag.castShadow = true;
    this.decor.add(flag);
    this.decorClear.push({ x, z, r: 0.3 });
  }

  /** A kolam (or rangoli) on the ground in front of the cottage door. */
  private buildKolam(kind: "pulli" | "rangoli") {
    const n = this.opts.n;
    const home = this.toWorld(homeSpot(n).x, homeSpot(n).y);
    const S = THREE.MathUtils.clamp(this.isl.rx / 300, 0.95, 1.25);
    const z = home.z + 1.35 * S;
    const x = this.pathWorld(z);
    this.decorClear.push({ x, z, r: 1.05 });
    const tex = kolamTexture(kind);
    // A soft glow of its own, so it still shows at night.
    const mat = new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: "#ffffff", emissiveIntensity: this.phase === "night" ? 0.5 : 0.12, transparent: true, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -2, depthWrite: false });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 1.9), mat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, this.heightAt(x, z) + 0.09, z);
    m.receiveShadow = true;
    this.decor.add(m);
  }

  /** Clay oil lamps (agal vilakku) lining both sides of the path, and round the pond. */
  private buildLamps(density: number) {
    const n = this.opts.n;
    const home = this.toWorld(homeSpot(n).x, homeSpot(n).y);
    const clay = new THREE.MeshStandardMaterial({ color: "#b4562f", roughness: 0.75 });
    const bowl = new THREE.LatheGeometry([new THREE.Vector2(0, 0), new THREE.Vector2(0.05, 0.005), new THREE.Vector2(0.075, 0.03), new THREE.Vector2(0.07, 0.04)], 14);
    this.glowTex ??= puffTexture("glow");
    const place = (x: number, z: number, i: number) => {
      const g = new THREE.Group();
      const b = new THREE.Mesh(bowl, clay);
      b.castShadow = true;
      const f = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, color: new THREE.Color("#ffb347").multiplyScalar(3.2), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      f.position.y = 0.085;
      f.scale.set(0.1, 0.16, 1);
      f.userData.ph = hash01(`lp${i}`) * 9;
      f.raycast = () => {};
      this.flames.push(f);
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, color: "#ff9a3c", transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending }));
      halo.position.y = 0.08;
      halo.scale.setScalar(0.55);
      halo.raycast = () => {};
      g.add(b, f, halo);
      g.position.set(x, this.heightAt(x, z) + 0.005, z);
      this.decor.add(g);
    };
    let i = 0;
    const step = 0.38 / density;
    for (let z = home.z + 0.95; z < this.R * 0.9; z += step) {
      const x = this.pathWorld(z);
      place(x - 0.34, z, i++);
      place(x + 0.34, z + step / 2, i++);
    }
    // Round the pond, and a row along the cottage's front.
    const pond = pondSpot(n);
    const pw = this.toWorld(pond.x, pond.y);
    const prw = (pond.rx / this.isl.rx) * this.R;
    const around = Math.round(12 * density);
    for (let k = 0; k < around; k++) {
      const a = (k / around) * Math.PI * 2;
      if (Math.abs(((a - POND_ANGLE + Math.PI * 3) % (Math.PI * 2)) - Math.PI) < 0.4) continue;
      place(pw.x + Math.cos(a) * (prw + 0.28), pw.z + Math.sin(a) * (prw + 0.28), i++);
    }
    const S = THREE.MathUtils.clamp(this.isl.rx / 300, 0.95, 1.25);
    for (let k = -3; k <= 3; k++) if (k) place(home.x + k * 0.28 * S, home.z + 0.85 * S, i++);
  }

  /** Deepavali: bursts of colour over the island. */
  private buildFireworks(auto = true) {
    this.fireworks = auto;
    if (this.bursts.length) return;
    const N = 160;
    for (let b = 0; b < 4; b++) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(N * 3), 3));
      const mat = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: { uColor: { value: new THREE.Color() }, uAlpha: { value: 0 }, uSize: { value: 26 * this.renderer.getPixelRatio() } },
        vertexShader: `uniform float uSize; void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = uSize * (6.0 / -mv.z); gl_Position = projectionMatrix * mv; }`,
        fragmentShader: `uniform vec3 uColor; uniform float uAlpha; void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.0, d); gl_FragColor = vec4(uColor * 3.0, a * a * uAlpha); }`,
      });
      const pts = new THREE.Points(geo, mat);
      pts.frustumCulled = false;
      pts.visible = false;
      this.scene.add(pts);
      const vel = new Float32Array(N * 3);
      this.bursts.push({ pts, vel, origin: new THREE.Vector3(), t0: 0, on: false });
    }
  }

  private updateDecor(t: number, dt: number) {
    for (const f of this.flames) {
      const k = 0.85 + Math.sin(t * 13 + (f.userData.ph ?? 0)) * 0.08 + Math.sin(t * 29 + (f.userData.ph ?? 0) * 2) * 0.06;
      f.material.opacity = k;
    }
    for (const fr of this.frogs) {
      if (t > fr.next) {
        const a = Math.random() * Math.PI * 2;
        const d = 0.25 + Math.random() * 0.35;
        const x = fr.home.x + Math.cos(a) * d;
        const z = fr.home.z + Math.sin(a) * d;
        fr.from.copy(fr.o.position);
        fr.to.set(x, this.heightAt(x, z), z);
        fr.t0 = t;
        fr.next = t + 3 + Math.random() * 6;
        fr.o.rotation.y = Math.atan2(x - fr.from.x, z - fr.from.z);
      }
      const k = (t - fr.t0) / 0.45;
      if (k >= 0 && k <= 1) {
        fr.o.position.lerpVectors(fr.from, fr.to, k);
        fr.o.position.y += Math.sin(k * Math.PI) * 0.22;
        fr.o.scale.set(2.4, 2.4 * (1 + Math.sin(k * Math.PI) * 0.25), 2.4);
      }
    }
    if (this.fireworks && t > this.nextBurst) {
      this.launchBurst(t);
      this.nextBurst = t + 0.9 + Math.random() * 1.8;
    }
    for (const b of this.bursts) {
      if (!b.on) continue;
      const k = t - b.t0;
      const pos = b.pts.geometry.attributes.position as THREE.BufferAttribute;
      const drag = (1 - Math.exp(-k * 2.2)) / 2.2;
      for (let i = 0; i < pos.count; i++) {
        pos.setXYZ(i, b.origin.x + b.vel[i * 3] * drag, b.origin.y + b.vel[i * 3 + 1] * drag - 0.9 * k * k, b.origin.z + b.vel[i * 3 + 2] * drag);
      }
      pos.needsUpdate = true;
      (b.pts.material as THREE.ShaderMaterial).uniforms.uAlpha.value = Math.max(0, 1 - k / 2.2) * Math.min(1, k * 8);
      if (k > 2.2) {
        b.on = false;
        b.pts.visible = false;
      }
    }
    void dt;
  }

  /** One burst of sparks over the island: a random colour, or the one given (a song's drop). */
  private launchBurst(t: number, color?: THREE.Color) {
    const b = this.bursts.find((x) => !x.on);
    if (!b) return;
    const a = Math.random() * Math.PI * 2;
    b.origin.set(Math.cos(a) * this.R * (0.3 + Math.random() * 0.6), this.R * (0.35 + Math.random() * 0.4), Math.sin(a) * this.R * (0.3 + Math.random() * 0.5) - this.R * 0.35);
    const speed = this.R * (0.35 + Math.random() * 0.2);
    for (let i = 0; i < b.vel.length / 3; i++) {
      const u = Math.random() * 2 - 1;
      const th = Math.random() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      const s = speed * (0.75 + Math.random() * 0.25);
      b.vel.set([Math.cos(th) * r * s, u * s, Math.sin(th) * r * s], i * 3);
    }
    const c = (b.pts.material as THREE.ShaderMaterial).uniforms.uColor.value as THREE.Color;
    if (color) c.copy(color);
    else c.setHSL(Math.random(), 0.95, 0.6);
    b.t0 = t;
    b.on = true;
    b.pts.visible = true;
  }

  /** The stage lights for a song: four coloured beams from the island's edge, sweeping the sky. */
  private buildBeams() {
    if (this.beams.length) return;
    const H = this.R * 2.6;
    const geo = new THREE.CylinderGeometry(this.R * 0.28, 0.05, H, 24, 1, true);
    geo.translate(0, H / 2, 0);
    for (let i = 0; i < 4; i++) {
      const a = Math.PI * 0.25 + (i / 4) * Math.PI * 2;
      const x = Math.cos(a) * this.R * 0.8;
      const z = Math.sin(a) * this.R * 0.8;
      const mat = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: this.phase === "night" ? THREE.AdditiveBlending : THREE.NormalBlending,
        uniforms: { uColor: { value: new THREE.Color() }, uA: { value: 0 } },
        vertexShader: `varying float vY; varying float vEdge;
          void main(){
            vY = uv.y;
            vec4 w = modelMatrix * vec4(position, 1.0);
            vec3 n = normalize(mat3(modelMatrix) * normal);
            vEdge = abs(dot(n, normalize(cameraPosition - w.xyz)));
            gl_Position = projectionMatrix * viewMatrix * w;
          }`,
        fragmentShader: `uniform vec3 uColor; uniform float uA; varying float vY; varying float vEdge;
          void main(){
            // Brightest at the lamp, fading up into the sky; soft at the sides of the beam.
            float a = pow(1.0 - vY, 1.6) * smoothstep(0.0, 0.7, vEdge) * uA;
            gl_FragColor = vec4(uColor, a);
          }`,
      });
      const cone = new THREE.Mesh(geo, mat);
      cone.raycast = () => {};
      cone.frustumCulled = false;
      const g = new THREE.Group();
      g.position.set(x, this.heightAt(x, z) + 0.05, z);
      g.add(cone);
      g.visible = false;
      this.island.add(g);
      this.beams.push({ g, ph: i * 1.7, mat });
    }
  }

  /** A mirror ball hanging over the island while a song plays. */
  private buildBall() {
    if (this.ball) return;
    const g = new THREE.Group();
    const mirror = new THREE.MeshStandardMaterial({ color: "#d9dde6", metalness: 1, roughness: 0.12, flatShading: true, emissive: "#ffffff", emissiveIntensity: 0.05 });
    const ball = new THREE.Mesh(new THREE.IcosahedronGeometry(0.34, 2), mirror);
    ball.userData.mirror = mirror;
    const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 3, 4), new THREE.MeshBasicMaterial({ color: "#2b2b33" }));
    cord.position.y = 1.5 + 0.34;
    this.glowTex ??= puffTexture("glow");
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, color: "#ffffff", transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending }));
    glow.scale.setScalar(1.6);
    glow.raycast = () => {};
    g.add(ball, cord, glow);
    g.userData = { ball, glow, mirror };
    const x = 0;
    const z = this.R * 0.12;
    g.position.set(x, this.heightAt(x, z) + 3.3, z);
    g.visible = false;
    this.island.add(g);
    this.ball = g;
  }

  /** A note floats up from a flower or the cottage. */
  private spawnNote(t: number) {
    if (t - this.lastNote < 0.22 || this.reduced) return;
    this.lastNote = t;
    if (!this.notes.length) {
      const tex = ["♪", "♫", "♩", "♬"].map(noteTexture);
      for (let i = 0; i < 16; i++) {
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex[i % tex.length], color: "#ffffff", transparent: true, opacity: 0, depthWrite: false }));
        sp.visible = false;
        sp.raycast = () => {};
        this.island.add(sp);
        this.notes.push({ sp, t0: -99, from: new THREE.Vector3(), ph: i * 1.3 });
      }
    }
    const n = this.notes.find((x) => t - x.t0 > 3.2);
    if (!n) return;
    const from = this.noteFrom.length && Math.random() < 0.75 ? this.noteFrom[Math.floor(Math.random() * this.noteFrom.length)] : this.toWorld(homeSpot(this.opts.n).x, homeSpot(this.opts.n).y).add(new THREE.Vector3((Math.random() - 0.5) * 1.2, 1.6, (Math.random() - 0.5) * 0.6));
    n.from.copy(from);
    n.t0 = t;
    n.sp.visible = true;
    // A shade around the music colour.
    const hsl = { h: 0, s: 0, l: 0 };
    this.uMusicCol.value.getHSL(hsl);
    (n.sp.material as THREE.SpriteMaterial).color.setHSL((hsl.h + (Math.random() - 0.5) * 0.12 + 1) % 1, Math.max(0.7, hsl.s), this.phase === "night" ? 0.7 : 0.55);
  }

  /** Each frame while a song plays (and as it fades out): the garden moves and glows with the music. */
  private updateMusic(t: number) {
    const night = this.phase === "night";
    const mix = this.uMusicMix.value;
    const kick = this.uKick.value;
    const beat = this.uBeat.value;
    const col = this.uMusicCol.value;
    // Trees bop: a stretch up on each beat and a slow sway.
    for (const tr of this.trees) {
      const k = this.reduced ? 0 : kick * mix;
      tr.g.scale.set(tr.base.x * (1 - k * 0.03), tr.base.y * (1 + k * 0.07), tr.base.z * (1 - k * 0.03));
      tr.g.rotation.z = this.reduced ? 0 : Math.sin(t * 2.4 + tr.ph) * beat * mix * 0.05;
    }
    // Lamps and crystals: the song's colour, flashing on the beat (and big on the drop).
    const f = this.dropFlash;
    for (const m of this.lampMats) {
      if (!m.userData.orig) m.userData.orig = m.emissive.clone();
      m.emissive.copy(m.userData.orig).lerp(col, mix * 0.85);
      m.emissiveIntensity = (m.userData.base0 ?? 1) + f * 2.5 + kick * mix * (night ? 3 : 2.2);
    }
    for (const m of this.crystalMats) m.emissiveIntensity = (m.userData.base0 ?? 0.35) + f * 1.8 + kick * mix * 1.2;
    for (const m of this.haloMats) {
      if (!m.userData.orig) m.userData.orig = m.color.clone();
      m.color.copy(m.userData.orig).lerp(col, mix * 0.85);
      m.opacity = 0.4 + kick * mix * 0.3;
    }
    for (const l of this.lampLights) {
      if (!l.userData.orig) l.userData.orig = l.color.clone();
      l.color.copy(l.userData.orig).lerp(col, mix * 0.85);
      l.intensity = 1.3 + Math.sin(t * 7 + l.id) * 0.08 + kick * mix * 2.5;
    }
    // The cottage windows pulse in the song's colour.
    for (const m of this.windowMats) {
      if (!m.userData.orig) m.userData.orig = m.emissive.clone();
      m.emissive.copy(m.userData.orig).lerp(col, mix * 0.6);
      m.emissiveIntensity = (this.lit ? (night ? 3.2 : 1.6) : 0) + mix * (0.4 + kick * (night ? 2 : 1.4));
    }
    // The stage lights sweep the sky.
    if (mix > 0.01 && !this.beams.length) this.buildBeams();
    const hsl = { h: 0, s: 0, l: 0 };
    col.getHSL(hsl);
    for (const b of this.beams) {
      b.g.visible = mix > 0.01;
      if (!b.g.visible) continue;
      const sw = this.reduced ? 0 : 1;
      // Leaning outwards, swinging slowly.
      const out = Math.atan2(b.g.position.z, b.g.position.x);
      b.g.rotation.set(Math.sin(out) * 0.3 + Math.sin(t * 0.6 + b.ph) * 0.45 * sw, 0, -Math.cos(out) * 0.3 + Math.cos(t * 0.45 + b.ph * 1.3) * 0.45 * sw);
      // Each beam a little apart in hue around the music colour.
      b.mat.uniforms.uColor.value.setHSL((hsl.h + (b.ph / 1.7 - 1.5) * 0.06 + 1) % 1, Math.max(0.6, hsl.s), night ? 0.6 : 0.5);
      b.mat.uniforms.uA.value = mix * (night ? 0.32 : 0.38) * (0.55 + beat * 0.3 + kick * 0.5);
    }
    // The disco ball drops in from above, spins, and throws its spots across the grass.
    if (mix > 0.01 && !this.ball) this.buildBall();
    if (this.ball) {
      const b = this.ball;
      b.visible = mix > 0.01;
      const u = b.userData as { ball: THREE.Mesh; glow: THREE.Sprite; mirror: THREE.MeshStandardMaterial };
      const z = this.R * 0.12;
      b.position.y = this.heightAt(0, z) + 3.3 + (1 - mix) * 4;
      if (!this.reduced) u.ball.rotation.y = t * 0.9;
      this.uBallRot.value = this.reduced ? 0 : t * 0.35;
      u.mirror.emissive.copy(col).lerp(new THREE.Color(1, 1, 1), 0.5);
      u.mirror.emissiveIntensity = (night ? 0.08 : 0.15) + kick * mix * (night ? 0.5 : 0.8);
      const gm = u.glow.material as THREE.SpriteMaterial;
      gm.color.copy(col);
      gm.opacity = mix * (night ? 0.28 : 0.2) * (0.7 + kick * 0.6);
    }
    // Notes rise and sway, fading in and out.
    if (mix > 0.2 && Math.random() < 0.02) this.spawnNote(t);
    for (const n of this.notes) {
      const k = (t - n.t0) / 3.2;
      if (k > 1 || k < 0) {
        n.sp.visible = false;
        continue;
      }
      n.sp.position.set(n.from.x + Math.sin(k * 6 + n.ph) * 0.25, n.from.y + k * 1.8, n.from.z + Math.cos(k * 5 + n.ph) * 0.15);
      n.sp.scale.setScalar(0.45 * (1 + kick * 0.35));
      (n.sp.material as THREE.SpriteMaterial).opacity = Math.min(1, k * 6) * Math.min(1, (1 - k) * 3) * mix;
    }
    // A faster turn round the island while it plays.
    this.controls.autoRotateSpeed = 0.35 * (1 + mix * (this.reduced ? 0 : 1.2));
  }

  /* ── quality ── */

  private enableHigh() {
    // Same choices as the memory palace: no MSAA (breaks on Intel/ANGLE), kernel bloom, SMAA edges.
    this.composer = new EffectComposer(this.renderer, { frameBufferType: THREE.HalfFloatType, multisampling: 0 });
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new BloomEffect({ mipmapBlur: false, kernelSize: KernelSize.LARGE, luminanceThreshold: 2, luminanceSmoothing: 0.4, intensity: 0.8 });
    this.grade = new GradeEffect();
    const vig = new VignetteEffect({ darkness: 0.45, offset: 0.3 });
    this.composer.addPass(new EffectPass(this.camera, this.bloom, this.grade, vig));
    this.applyLook();
    // The miniature blur runs after SMAA (blurring before it would undo the edge smoothing).
    this.composer.addPass(new EffectPass(this.camera, new SMAAEffect({ preset: SMAAPreset.HIGH })));
    this.composer.addPass(new EffectPass(this.camera, new TiltShiftEffect()));
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.resize(this.canvas.clientWidth, this.canvas.clientHeight);
  }

  private downgrade() {
    if (this.quality === "low") return;
    this.quality = "low";
    this.composer?.dispose();
    this.composer = null;
    this.bloom = null;
    this.grade = null;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.25));
    if (this.grass) this.grass.count = Math.floor(this.grassCount * 0.6);
    this.resize(this.canvas.clientWidth, this.canvas.clientHeight);
  }

  /* ── input ── */

  private bind() {
    const c = this.canvas;
    c.addEventListener("pointerdown", this.onDown);
    c.addEventListener("pointerup", this.onUp);
    c.addEventListener("pointermove", this.onMove);
    this.controls.addEventListener("start", this.onInteract);
    document.addEventListener("visibilitychange", this.onVisibility);
  }
  private onInteract = () => {
    this.controls.autoRotate = false;
    this.idleSince = this.clock.elapsedTime;
  };
  private onVisibility = () => {
    if (!document.hidden) this.clock.getDelta();
  };
  private onDown = (e: PointerEvent) => {
    this.down = { x: e.clientX, y: e.clientY, t: performance.now() };
    if (this.intro.t0 >= 0 || this.intro.t0 === -1) this.skipIntro();
  };
  private onUp = (e: PointerEvent) => {
    if (Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y) > 8 || performance.now() - this.down.t > 600) return;
    const id = this.pickAt(e.clientX, e.clientY);
    if (id) this.cb.onPick(id);
  };
  private moveTick = 0;
  private onMove = (e: PointerEvent) => {
    if (e.pointerType !== "mouse" || ++this.moveTick % 3) return;
    this.canvas.style.cursor = this.pickAt(e.clientX, e.clientY) ? "pointer" : "grab";
  };
  private skipIntro() {
    if (this.intro.t0 === -2) return;
    this.finishIntro();
  }

  /** What's under a screen point: a tree / lamp / gem / the cottage, a flower head, or the nearest thing to where the ground was hit. */
  private pickAt(cx: number, cy: number): string | null {
    const r = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(ndc, this.camera);
    const hits = this.ray.intersectObjects([...this.pickables, ...this.flowerHeads.map((f) => f.mesh), ...(this.ground ? [this.ground] : [])], true);
    for (const h of hits) {
      const fh = this.flowerHeads.find((f) => f.mesh === h.object);
      if (fh && h.instanceId != null) return fh.ids[h.instanceId] ?? null;
      let o: THREE.Object3D | null = h.object;
      while (o && !o.userData.id) o = o.parent;
      if (o?.userData.id) return o.userData.id as string;
      if (h.object === this.ground) break;
    }
    // Nothing hit dead-on (flowers are tiny on a phone): the nearest thing on screen, within reach of a finger.
    const reach = this.mobile ? 34 : 20;
    let best: string | null = null;
    let bd = reach;
    const sx = cx - r.left;
    const sy = cy - r.top;
    for (const it of this.itemsById.values()) {
      const q = this.toWorld(it.x, it.y).add(new THREE.Vector3(0, it.kind === "tree" ? 1.2 : it.kind === "plant" ? (it.stage === 3 ? 1.2 : 0.5) : 0.3, 0)).project(this.camera);
      if (q.z > 1) continue;
      const d = Math.hypot((q.x * 0.5 + 0.5) * r.width - sx, (-q.y * 0.5 + 0.5) * r.height - sy);
      if (d < bd) {
        bd = d;
        best = it.id;
      }
    }
    return best;
  }

  /* ── public API ── */

  resize(w: number, h: number) {
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.composer?.setSize(w, h, false);
    const before = this.camera.aspect;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.placeMoon();
    // The frame changed shape (a phone turned, a window resized): pull the camera to the distance
    // that fits the island again, keeping the direction it looks from.
    if (this.intro.t0 === -2 && Math.abs(before - this.camera.aspect) / before > 0.15) {
      const r0 = this.restRadius();
      this.controls.maxDistance = Math.max(this.R * 5, r0 * 1.35);
      const off = this.camera.position.clone().sub(this.controls.target);
      this.camera.position.copy(this.controls.target).add(off.setLength(r0));
    }
  }

  /** Walk the pet to a spot (layout units); returns how long it takes, in ms. */
  walkPet(x: number, y: number) {
    const to = this.toWorld(x, y);
    const d = to.distanceTo(this.pet.pos);
    this.pet.from.copy(this.pet.pos);
    this.pet.to.copy(to);
    this.pet.t0 = this.clock.elapsedTime;
    this.pet.dur = THREE.MathUtils.clamp(d / 1.5, 0.9, 3.6);
    return this.pet.dur * 1000;
  }
  /** Point the label at an item (or the cottage), or clear it. */
  setTip(id: string | null) {
    this.tipFollow = null;
    if (!id) {
      this.tip = null;
      return;
    }
    const visitor = this.visitors.get(id);
    if (visitor) {
      this.tipFollow = visitor.g;
      this.tipLift = visitor.kind === "owl" ? 0.8 : 1.45;
      this.tip = visitor.g.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, this.tipLift, 0));
      return;
    }
    if (id === "home") {
      const h = homeSpot(this.opts.n);
      this.tip = this.toWorld(h.x, h.y).add(new THREE.Vector3(0, 2.4, 0));
      return;
    }
    const it = this.itemsById.get(id);
    if (!it) return;
    this.tip = this.toWorld(it.x, it.y).add(new THREE.Vector3(0, it.kind === "tree" ? 2.6 : it.kind === "plant" ? (it.stage === 3 ? 2.6 : 0.5 + it.stage * 0.35) : it.kind === "lamp" ? 1.25 : 0.55, 0));
  }
  /**
   * Dress the island for the season or a festival: monsoon puddles and frogs, a kolam with sugarcane
   * and a pongal pot at Pongal, clay lamps along the path at Karthigai Deepam, rangoli, lamps and
   * fireworks at Deepavali.
   */
  setDecor(festival: string | null, monsoon: boolean) {
    const key = `${festival ?? ""}|${monsoon}`;
    if (key === this.decorKey) return;
    this.decorKey = key;
    this.island.remove(this.decor);
    this.decor.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
      for (const mat of mats) mat.dispose();
    });
    this.decor = new THREE.Group();
    this.flames = [];
    this.frogs = [];
    for (const b of this.bursts) this.scene.remove(b.pts);
    this.bursts = [];
    this.fireworks = false;
    this.decorClear = [];
    if (monsoon) this.buildMonsoon();
    if (festival === "pongal") this.buildPongal();
    if (festival === "puthandu") this.buildPuthandu();
    if (festival === "christmas") this.buildChristmas();
    if (festival === "india") this.buildIndia();
    if (festival === "karthigai") this.buildLamps(1);
    if (festival === "deepavali") {
      this.buildLamps(0.6);
      this.buildKolam("rangoli");
      this.buildFireworks();
    }
    this.island.add(this.decor);
    this.clearGrass();
    this.renderer.shadowMap.needsUpdate = true;
  }

  /** Grass back where it was, then pressed flat under the decorations (kolam, puddles, the pot). */
  private clearGrass() {
    if (!this.grass || !this.grassOrig || !this.grassXZ) return;
    const arr = this.grass.instanceMatrix.array as Float32Array;
    arr.set(this.grassOrig);
    for (let i = 0; i < this.grassCount; i++) {
      const x = this.grassXZ[i * 2];
      const z = this.grassXZ[i * 2 + 1];
      if (this.decorClear.some((c) => Math.hypot(x - c.x, z - c.z) < c.r) || this.plantClear.some((c) => Math.hypot(x - c.x, z - c.z) < c.r)) {
        // Squash the blade to nothing: scale its columns down.
        for (let j = 0; j < 12; j++) arr[i * 16 + j] *= 0.02;
      }
    }
    this.grass.instanceMatrix.needsUpdate = true;
  }

  /** A beat of the song playing: a soft ring of light ripples out across the grass. */
  musicBeat(strength = 1) {
    const t = this.clock.elapsedTime;
    // Not more than about three rings a second, or they blur into one glow.
    if (strength <= 1 && t - this.lastRip < 0.32) return;
    this.lastRip = t;
    if (!this.reduced) this.uKick.value = Math.max(this.uKick.value, Math.min(1, strength));
    if (this.musicRgb) this.spawnNote(t);
    this.uRip.value[this.ripNext].set(t, strength);
    this.ripNext = (this.ripNext + 1) % this.uRip.value.length;
  }
  /** The song's drop: a big bright ring, and the lamps and crystals glow up. */
  musicDrop() {
    this.dropFlash = 1;
    this.musicBeat(1.7);
    // Sparks over the island in the song's colours.
    if (!this.musicRgb || this.reduced) return;
    this.buildFireworks(this.fireworks);
    const t = this.clock.elapsedTime;
    const hsl = { h: 0, s: 0, l: 0 };
    this.musicRgb.getHSL(hsl);
    this.launchBurst(t, new THREE.Color().setHSL(hsl.h, 0.95, 0.62));
    this.launchBurst(t, new THREE.Color().setHSL((hsl.h + 0.12) % 1, 0.95, 0.62));
  }
  /** How loud the song is right now (0..1): the sway and the fireflies follow it, smoothly. */
  setMusicLevel(v: number) {
    this.musicLevel = v;
  }
  /** A song is playing (fireflies and pollen take the music lights' colour), or not (null). */
  setMusic(rgb: [number, number, number] | null) {
    this.musicRgb = rgb ? new THREE.Color(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255) : null;
    if (this.musicRgb) this.uMusicCol.value.copy(this.musicRgb);
    if (!rgb) this.musicLevel = 0;
    for (const p of this.particleMats) p.mat.uniforms.uColor.value.copy(this.musicRgb ?? p.color);
  }

  /** The scene as it looks right now, as a PNG data URL (the frame is drawn again first, so it is read straight away). */
  snapshot(): string | null {
    if (this.disposed) return null;
    if (this.composer) this.composer.render(0);
    else this.renderer.render(this.scene, this.camera);
    try {
      return this.renderer.domElement.toDataURL("image/png");
    } catch {
      return null;
    }
  }
  /** Blow as hard as the real wind (km/h); null = the usual breeze. */
  setWind(kmh: number | null) {
    this.uWind.value = windStrength(kmh);
  }
  windNow() {
    return this.uWind.value;
  }
  setLit(on: boolean) {
    this.lit = on;
    for (const m of this.windowMats) m.emissiveIntensity = on ? (this.phase === "night" ? 3.2 : 1.6) : 0;
  }
  setSleeping(on: boolean) {
    this.sleeping = on;
  }
  setLook(phase: Phase, wet: boolean) {
    if (phase === this.phase && wet === this.wet) return;
    this.phase = phase;
    this.wet = wet;
    this.applyLook();
  }

  /* ── frame ── */

  private loop = () => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    if (document.hidden) return;
    const dt = Math.min(this.clock.getDelta(), 0.05);
    const t = this.clock.elapsedTime;
    this.update(dt, t);
    if (this.composer) this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);

    this.fps.frames++;
    this.fps.time += dt;
    if (this.fps.time > 2.5) {
      const avg = this.fps.frames / this.fps.time;
      this.fps.slow = avg < 38 ? this.fps.slow + 1 : 0;
      if (this.fps.slow >= 2) this.downgrade();
      this.fps.frames = 0;
      this.fps.time = 0;
    }
  };

  private update(dt: number, t: number) {
    this.uTime.value = this.reduced ? t * 0.35 : t;
    const night = this.phase === "night";

    // Opening flight, then the camera orbiting by hand. Not in AR: there the phone is the camera.
    if (!this.xr) {
      if (this.intro.t0 === -1) this.intro.t0 = t;
      if (this.intro.t0 >= 0) {
        const k = Math.min(1, (t - this.intro.t0) / this.intro.dur);
        const e = ease(k);
        const f = this.intro.from;
        const to = this.intro.to;
        this.placeCamera(new THREE.Spherical(f.radius + (to.radius - f.radius) * e, f.phi + (to.phi - f.phi) * e, f.theta + (to.theta - f.theta) * e));
        if (k >= 1) this.finishIntro();
      } else {
        if (!this.controls.autoRotate && !this.reduced && t - this.idleSince > 9) this.controls.autoRotate = true;
        this.controls.update(dt);
      }
    }
    this.updateVisitors(dt, t);
    if (this.tipFollow) this.tip = this.tipFollow.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, this.tipLift, 0));
    // Lamplight breathes a little: each flame flickers on its own (the music takes over while a song plays).
    if (this.uMusicMix.value < 0.01 && !this.reduced) {
      for (const m of this.lampMats) {
        const ph = m.userData.ph as number | undefined;
        if (ph === undefined) continue;
        m.emissiveIntensity = (m.userData.base0 ?? 1) * (1 + 0.07 * Math.sin(t * 7.3 + ph) * Math.sin(t * 3.1 + ph * 2) + 0.03 * Math.sin(t * 17 + ph));
      }
    }
    // Shooting stars on clear nights.
    if (this.shoot && this.phase === "night" && !this.wet && !this.reduced) {
      const st = this.shootAt;
      if (t > st.next) {
        const a = Math.random() * Math.PI * 2;
        const el = 0.35 + Math.random() * 0.4;
        st.from.set(Math.cos(a) * Math.cos(el), Math.sin(el), Math.sin(a) * Math.cos(el)).multiplyScalar(2400);
        st.dir.set(-Math.sin(a), -0.35, Math.cos(a)).normalize();
        st.t0 = t;
        st.next = t + 6 + Math.random() * 9;
      }
      const k = (t - st.t0) / 0.9;
      this.shoot.visible = k >= 0 && k <= 1;
      if (this.shoot.visible) {
        const head = st.from.clone().addScaledVector(st.dir, k * 900);
        const tail = head.clone().addScaledVector(st.dir, -260 * Math.min(1, k * 3));
        const pos = this.shoot.geometry.attributes.position as THREE.BufferAttribute;
        pos.setXYZ(0, head.x, head.y, head.z);
        pos.setXYZ(1, tail.x, tail.y, tail.z);
        pos.needsUpdate = true;
        (this.shoot.material as THREE.LineBasicMaterial).opacity = Math.sin(k * Math.PI);
      }
    }

    // Light-dependent shader uniforms.
    const L = LOOK[this.phase];
    const sunDir = new THREE.Vector3(...L.sun).normalize();
    const sunCol = new THREE.Color(L.sunCol).multiplyScalar(this.sun.intensity * 0.42);
    if (this.grassMat) {
      const u = this.grassMat.uniforms;
      u.uSunDir.value.copy(sunDir);
      u.uSunCol.value.copy(sunCol);
      u.uSky.value.copy(this.hemi.color).multiplyScalar(this.hemi.intensity * 0.55);
      u.uGround.value.copy(this.hemi.groundColor).multiplyScalar(this.hemi.intensity * 0.55);
      const dim = night ? 0.68 : this.phase === "golden" || this.phase === "dusk" ? 0.9 : 1;
      u.uTip.value.set(SEASON_GRASS[this.opts.season ?? "summer"].tip).multiplyScalar(dim);
      this.uSeasonLight.value = night ? 0.5 : this.phase === "golden" || this.phase === "dusk" ? 0.85 : 1;
    }
    for (const w of this.waterMats) {
      w.uniforms.uSky.value.copy(this.hemi.color).multiplyScalar(night ? 0.08 : 0.7);
      w.uniforms.uSunDir.value.copy(sunDir);
      w.uniforms.uSunCol.value.copy(sunCol);
    }

    // The pet walks; the grass parts around it.
    const p = this.pet;
    if (p.dur > 0) {
      const k = Math.min(1, (t - p.t0) / p.dur);
      p.pos.lerpVectors(p.from, p.to, ease(k));
      p.pos.y = this.heightAt(p.pos.x, p.pos.z) + Math.abs(Math.sin(k * Math.PI * p.dur * 2.2)) * 0.05 * (k < 1 ? 1 : 0);
      if (k >= 1) p.dur = 0;
    }
    this.uPet.value.copy(p.pos);

    // Bobbing gems and far islands.
    for (const b of this.bobbers) {
      b.o.position.y = b.y + Math.sin(t * b.sp + b.ph) * (b.spin && b.spin < 0.1 ? this.R * 0.04 : 0.04);
      if (b.spin) b.o.rotation.y += dt * b.spin * (1 + this.uBeat.value * 4);
    }
    this.updateDecor(t, dt);
    // Ease towards the song's loudness (quick to rise, slow to settle): no jolts.
    const want = this.musicRgb ? Math.min(1, this.musicLevel * 1.4) : 0;
    this.uBeat.value += (want - this.uBeat.value) * Math.min(1, dt * (want > this.uBeat.value ? 4 : 1.5));
    const on = this.musicRgb && this.phase !== "night" ? 1 : 0;
    this.uMusicOn.value += (on - this.uMusicOn.value) * Math.min(1, dt * 1.5);
    if (this.confetti) this.confetti.visible = this.uMusicOn.value > 0.01;
    this.uMusicMix.value += ((this.musicRgb ? 1 : 0) - this.uMusicMix.value) * Math.min(1, dt * 1.5);
    this.uKick.value *= Math.exp(-dt * 5);
    this.dropFlash = this.dropFlash > 0.01 ? this.dropFlash * Math.exp(-dt * 1.6) : 0;
    // Only while music plays or fades out (one last frame puts everything back); otherwise no cost.
    const musicNow = this.uMusicMix.value > 0.001 || this.dropFlash > 0 || this.uKick.value > 0.001;
    if (musicNow || this.musicWas) this.updateMusic(t);
    this.musicWas = musicNow;
    // Butterflies on wandering loops, flapping.
    this.flyT += dt * (1 + this.uBeat.value * 1.5);
    this.flapT += dt * (1 + this.uBeat.value * 0.8);
    for (const b of this.butterflies) {
      const a = this.flyT * b.sp + b.ph;
      const x = Math.cos(a) * b.rad + Math.sin(a * 2.3) * 0.5;
      const z = Math.sin(a * 1.3) * b.rad * 0.8;
      const y = this.heightAt(x, z) + b.h + Math.sin(a * 3.1) * 0.2;
      const prev = b.g.position.clone();
      b.g.position.set(x, y, z);
      b.g.lookAt(prev.lerp(b.g.position, 2));
      const flap = Math.sin(this.flapT * 22 + b.ph) * 1.1;
      b.l.rotation.z = flap;
      b.r.rotation.z = -flap;
    }
    // Chimney smoke, or Zzz while it sleeps.
    for (const s of this.smoke) {
      const k = (t * 0.12 + s.userData.ph) % 1;
      s.position.copy(this.chimneyTop).add(new THREE.Vector3(k * 0.5, k * 1.6, -k * 0.2));
      s.scale.setScalar(0.18 + k * 0.6);
      (s.material as THREE.SpriteMaterial).opacity = (this.sleeping ? 0 : 0.35) * Math.sin(k * Math.PI) * (this.wet ? 0.6 : 1);
    }
    for (const s of this.zzz) {
      const k = (t * 0.28 + s.userData.ph) % 1;
      s.position.copy(this.chimneyTop).add(new THREE.Vector3(0.15 + k * 0.4, 0.1 + k * 0.9, 0));
      s.scale.setScalar(0.14 + k * 0.18);
      (s.material as THREE.SpriteMaterial).opacity = this.sleeping ? Math.sin(k * Math.PI) : 0;
    }
    for (const m of this.mist) m.position.y = m.userData.base + Math.sin(t * 0.8 + m.userData.ph) * 0.06;
    // Clouds turn slowly round the island.
    this.clouds.rotation.y = t * 0.006;
    if (!this.musicWas) for (const l of this.lampLights) l.intensity = 1.3 + Math.sin(t * 7 + l.id) * 0.08;

    // In AR the pet is drawn inside the scene (a sprite), so the page has nothing to place.
    if (this.xr) return;
    // Tell the page where the pet and the label are on screen.
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    const proj = (v: THREE.Vector3) => {
      const q = v.clone().project(this.camera);
      return { x: (q.x * 0.5 + 0.5) * w, y: (-q.y * 0.5 + 0.5) * h, z: q.z };
    };
    const foot = proj(p.pos);
    const head = proj(p.pos.clone().add(new THREE.Vector3(0, 1.5, 0)));
    // Hidden behind the island or the cottage? (checked a few times a second)
    if (++this.occlusionTick % 8 === 0) {
      const from = this.camera.position;
      const target = p.pos.clone().add(new THREE.Vector3(0, 0.45, 0));
      const dir = target.clone().sub(from);
      const dist = dir.length();
      this.ray.set(from, dir.normalize());
      this.ray.camera = this.camera;
      this.ray.far = dist - 0.3;
      const blockers = this.pickables.filter((o) => o.userData.id === "home");
      this.petHidden = this.ray.intersectObjects([...(this.ground ? [this.ground] : []), ...blockers], true).length > 0;
      this.ray.far = Infinity;
    }
    const tip = this.tip ? proj(this.tip) : null;
    this.cb.onFrame({
      pet: { x: foot.x, y: foot.y, size: Math.max(this.mobile ? 44 : 30, (foot.y - head.y) * (this.mobile ? 1.6 : 1.25)), facing: Math.sign(p.to.x - p.from.x), hidden: this.petHidden || foot.z > 1 },
      tip: tip && tip.z < 1 ? { x: tip.x, y: tip.y } : null,
    });
  }

  /* ── AR: the island on a real table (WebXR: Chrome on an Android phone with ARCore) ── */

  /** Can this device show the garden through its camera? (False on iPhones and most computers.) */
  static async arSupported() {
    if (typeof window === "undefined" || typeof navigator === "undefined") return false;
    const xr = (navigator as unknown as { xr?: XRSystemLike }).xr;
    if (!xr?.isSessionSupported || !window.isSecureContext) return false;
    try {
      return await xr.isSessionSupported("immersive-ar");
    } catch {
      return false;
    }
  }

  get inAR() {
    return !!this.xr;
  }

  /**
   * Starts AR (it has to come from a tap). The camera feed is the background; the island, its cottage, plants and pet
   * are shrunk to about half a metre and set down on the surface the person taps. `overlay` holds the page's own
   * buttons, which stay on screen; `onEnd` runs when AR closes for any reason.
   */
  async enterAR(overlay: HTMLElement, onState: (s: "find" | "placed") => void, onEnd: () => void) {
    if (this.xr || this.disposed) return;
    const system = (navigator as unknown as { xr: XRSystemLike }).xr;
    const session = await system.requestSession("immersive-ar", { requiredFeatures: ["hit-test"], optionalFeatures: ["dom-overlay"], domOverlay: { root: overlay } });

    cancelAnimationFrame(this.raf);
    const vis = new Map<THREE.Object3D, boolean>();
    for (const o of [this.skyMesh, this.nightSky, this.clouds, this.rain, ...this.farIslands]) {
      if (o instanceof THREE.Object3D) {
        vis.set(o, o.visible);
        o.visible = false; // the real room is the sky now
      }
    }
    const saved = { background: this.scene.background, fog: this.scene.fog, near: this.camera.near, shadow: this.sun.castShadow, vis };
    this.scene.background = null;
    this.scene.fog = null;
    this.sun.castShadow = false; // the shadow box is sized for the big scene
    this.camera.near = 0.01;
    this.camera.updateProjectionMatrix();

    // Everything goes under one root, so the whole garden can be shrunk and set down as one thing.
    // The root is shifted so the island's underside is at the holder's origin and it floats just above the table.
    const root = new THREE.Group();
    root.add(...this.scene.children);
    const box = new THREE.Box3().setFromObject(this.island);
    const centre = box.getCenter(new THREE.Vector3());
    // The underside of the island itself: the wide parts only, so the thin waterfall hanging far below doesn't count.
    let bottom = Infinity;
    const part = new THREE.Box3();
    const size = new THREE.Vector3();
    this.island.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || !m.visible) return;
      part.setFromObject(m).getSize(size);
      if (size.x > (box.max.x - box.min.x) * 0.35 && size.z > (box.max.z - box.min.z) * 0.35) bottom = Math.min(bottom, part.min.y);
    });
    if (!Number.isFinite(bottom)) bottom = box.min.y;
    root.position.set(-centre.x, -bottom, -centre.z);
    for (const l of this.lampLights) l.visible = false;
    const holder = new THREE.Group();
    holder.add(root);
    holder.visible = false; // until it is placed
    this.scene.add(holder);
    const width = Math.max(1, box.max.x - box.min.x);

    // The pet is a flat picture on the page; here it stands in the scene as a sprite cut from its drawing.
    const tex = new THREE.TextureLoader().load("/mascots/nova-directions.webp");
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.repeat.set(1 / 3, 1 / 3);
    tex.offset.set(1 / 3, 1 / 3); // the middle picture of the 3 x 3 sheet: looking straight ahead
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false }));
    sprite.center.set(0.5, 0.04);
    sprite.scale.set(1.9, 1.9, 1);
    root.add(sprite);

    // A ring on the surface the camera is looking at, until the person taps.
    const reticle = new THREE.Mesh(new THREE.RingGeometry(0.07, 0.09, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffd36b, transparent: true, opacity: 0.9, toneMapped: false }));
    reticle.matrixAutoUpdate = false;
    reticle.visible = false;
    this.scene.add(reticle);

    const st: ArState = { session, holder, root, reticle, sprite, hitSource: null, placed: false, scale: AR_WIDTH_M / width, saved, onEnd, onState };
    this.xr = st;
    try {
      this.renderer.xr.enabled = true;
      this.renderer.xr.setReferenceSpaceType("local");
      await this.renderer.xr.setSession(session as never);
      const viewer = await session.requestReferenceSpace("viewer");
      st.hitSource = await session.requestHitTestSource({ space: viewer });
    } catch (err) {
      // Couldn't get going (the phone said no part-way): put the garden back exactly as it was and say so.
      void session.end().catch(() => {});
      this.leaveAR(false);
      throw err;
    }
    this.cb.onFrame({ pet: null, tip: null }); // the page's own pet picture steps aside
    onState("find");

    session.addEventListener("select", () => {
      const s = this.xr;
      if (!s || s.placed || !s.reticle.visible) return;
      const at = new THREE.Vector3().setFromMatrixPosition(s.reticle.matrix);
      s.holder.position.set(at.x, at.y + 0.05, at.z);
      s.holder.scale.setScalar(s.scale);
      // Turned so the front faces the person holding the phone.
      const me = this.renderer.xr.getCamera().position;
      s.holder.rotation.y = Math.atan2(me.x - at.x, me.z - at.z);
      s.holder.visible = true;
      s.reticle.visible = false;
      s.placed = true;
      s.onState("placed");
    });
    session.addEventListener("end", () => this.leaveAR());

    this.clock.getDelta();
    this.renderer.setAnimationLoop((_time: number, frame?: unknown) => {
      const cur = this.xr;
      if (!cur) return;
      const dt = Math.min(this.clock.getDelta(), 0.05);
      this.update(dt, this.clock.elapsedTime);
      cur.sprite.position.copy(this.pet.pos);
      if (frame && !cur.placed && cur.hitSource) {
        const space = this.renderer.xr.getReferenceSpace();
        const hits = (frame as XRFrameLike).getHitTestResults(cur.hitSource);
        const pose = space && hits.length ? hits[0].getPose(space) : null;
        cur.reticle.visible = !!pose;
        if (pose) {
          cur.reticle.matrix.fromArray(pose.transform.matrix as number[]);
          cur.reticle.matrixWorldNeedsUpdate = true; // it has no auto-update, so say it moved
        }
      }
      this.renderer.render(this.scene, this.camera);
    });
  }

  /** "Move it": pick the garden up again and look for a new spot. */
  moveAR() {
    const s = this.xr;
    if (!s) return;
    s.placed = false;
    s.holder.visible = false;
    s.onState("find");
  }

  /** Leaves AR (also what the system's own close button ends up calling). */
  exitAR() {
    void this.xr?.session.end().catch(() => this.leaveAR());
  }

  /** Puts the garden back on the page exactly as it was. */
  private leaveAR(told = true) {
    const s = this.xr;
    if (!s) return;
    this.xr = null;
    this.renderer.setAnimationLoop(null);
    this.renderer.xr.enabled = false;
    s.root.remove(s.sprite);
    (s.sprite.material as THREE.SpriteMaterial).map?.dispose();
    s.sprite.material.dispose();
    s.reticle.geometry.dispose();
    (s.reticle.material as THREE.Material).dispose();
    this.scene.remove(s.reticle, s.holder);
    // Back to being direct children of the scene, with nothing left of the shrinking.
    this.scene.add(...s.root.children);
    for (const [o, v] of s.saved.vis) o.visible = v;
    this.scene.background = s.saved.background;
    this.scene.fog = s.saved.fog;
    this.sun.castShadow = s.saved.shadow;
    this.camera.near = s.saved.near;
    this.camera.updateProjectionMatrix();
    for (const l of this.lampLights) l.visible = this.phase === "night" || this.wet;
    this.renderer.shadowMap.needsUpdate = true;
    this.resize(this.canvas.clientWidth, this.canvas.clientHeight);
    if (!this.disposed) {
      this.clock.getDelta();
      this.raf = requestAnimationFrame(this.loop);
    }
    // (A start that failed is reported by the error thrown to the caller, not by this.)
    if (told) s.onEnd();
  }

  dispose() {
    if (this.xr) {
      this.exitAR();
      this.renderer.setAnimationLoop(null);
    }
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    const c = this.canvas;
    c.removeEventListener("pointerdown", this.onDown);
    c.removeEventListener("pointerup", this.onUp);
    c.removeEventListener("pointermove", this.onMove);
    document.removeEventListener("visibilitychange", this.onVisibility);
    this.controls.dispose();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
      for (const mat of mats) {
        for (const v of Object.values(mat as unknown as Record<string, unknown>)) if (v instanceof THREE.Texture) v.dispose();
        mat.dispose();
      }
    });
    this.envRT?.dispose();
    this.pmrem.dispose();
    this.composer?.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}
