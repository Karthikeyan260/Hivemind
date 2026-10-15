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
import { hash01, homeSpot, islandSize, pathX, POND_ANGLE, pondSpot, type Placed } from "@/lib/garden-layout";

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
type Opts = { n: number; phase: Phase; wet: boolean; butterflies: number; lit: boolean };

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
  float windAt(vec3 p, float t) {
    float gust = pow(sin(p.x * 0.22 + p.z * 0.08 - t * 1.25) * 0.5 + 0.5, 3.0) * 1.3;
    float sway = sin(t * 1.9 + p.x * 0.7 + p.z * 0.45) * 0.28 + sin(t * 1.1 + p.z * 0.33) * 0.18;
    return sway + gust;
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
  private sun = new THREE.DirectionalLight();
  private hemi = new THREE.HemisphereLight();
  private skyMesh: Sky | null = null;
  private nightSky = new THREE.Group();
  private nightOnly: THREE.Object3D[] = [];
  private dayOnly: THREE.Object3D[] = [];
  private grass: THREE.InstancedMesh | null = null;
  private grassCount = 0;
  private grassOrig: Float32Array | null = null;
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
    this.quality = this.mobile ? "low" : "high";
    this.phase = opts.phase;
    this.wet = opts.wet;
    this.lit = opts.lit;
    this.isl = islandSize(opts.n);
    this.R = this.isl.rx / 45;
    this.D = this.R * 0.95;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: this.quality === "low", powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, this.mobile ? 1.5 : 1.75));
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
    this.buildButterflies(opts.butterflies);
    this.buildParticles();
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
    this.placeCamera(this.reduced ? this.intro.to : this.intro.from);
    if (this.reduced) this.finishIntro();

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
    const n = 1800;
    const pos = new Float32Array(n * 3);
    const seed = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const u = hash01(`st${i}`);
      const v = hash01(`sv${i}`) * 0.92 + 0.08;
      const th = u * Math.PI * 2;
      const y = v;
      const rr = Math.sqrt(1 - y * y);
      pos.set([Math.cos(th) * rr * 3000, y * 3000, Math.sin(th) * rr * 3000], i * 3);
      seed[i] = hash01(`ss${i}`);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    sg.setAttribute("seed", new THREE.BufferAttribute(seed, 1));
    // Most stars white, some warm, some blue.
    const tint = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const k = hash01(`sk${i}`);
      const c = k < 0.15 ? [1, 0.78, 0.6] : k < 0.3 ? [0.7, 0.82, 1] : [1, 0.97, 0.92];
      tint.set(c, i * 3);
    }
    sg.setAttribute("tint", new THREE.BufferAttribute(tint, 3));
    const starMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uTime: this.uTime, uDpr: { value: Math.min(devicePixelRatio, 2) } },
      vertexShader: `attribute float seed; attribute vec3 tint; uniform float uTime; uniform float uDpr; varying float vA; varying vec3 vT;
        void main(){ vT = tint; vA = 0.4 + 0.6 * pow(0.5 + 0.5 * sin(uTime * (0.6 + seed * 3.0) + seed * 40.0), 2.0); vec4 mv = modelViewMatrix * vec4(position,1.); gl_PointSize = (1.1 + pow(seed, 6.0) * 5.5) * uDpr; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `varying float vA; varying vec3 vT; void main(){ float d = length(gl_PointCoord - 0.5); float core = smoothstep(0.5, 0.0, d); gl_FragColor = vec4(vT * (1.2 + core * 1.4), vA * core); }`,
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
    // Moon with a halo.
    const moonDir = new THREE.Vector3(...LOOK.night.sun).normalize();
    const moon = new THREE.Mesh(new THREE.CircleGeometry(60, 48), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 2.2, 2.0), fog: false }));
    moon.position.copy(moonDir).multiplyScalar(2600);
    moon.lookAt(0, 0, 0);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: puffTexture("glow"), color: "#9fb3ff", transparent: true, opacity: 0.35, depthWrite: false, fog: false }));
    halo.scale.setScalar(520);
    halo.position.copy(moon.position);
    this.nightSky.add(moon, halo);
    // Northern lights: a tall curtain far away, its rays wandering.
    const aur = new THREE.Mesh(
      new THREE.CylinderGeometry(1800, 1800, 900, 96, 1, true, Math.PI * 0.85, Math.PI * 0.9),
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        uniforms: { uTime: this.uTime },
        vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }`,
        fragmentShader: `uniform float uTime; varying vec2 vUv;
          void main(){
            float x = vUv.x * 18.0;
            float wave = sin(x * 0.7 + uTime * 0.25) * 0.08 + sin(x * 1.9 - uTime * 0.4) * 0.04;
            float band = smoothstep(0.0, 0.25, vUv.y - 0.35 + wave) * smoothstep(1.0, 0.45, vUv.y + wave);
            float rays = 0.55 + 0.45 * sin(x * 9.0 + sin(uTime * 0.3 + x) * 2.0);
            vec3 c = mix(vec3(0.25, 1.0, 0.6), vec3(0.6, 0.35, 1.0), smoothstep(0.55, 1.0, vUv.y));
            gl_FragColor = vec4(c * 0.55, band * rays * 0.55);
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
    for (const m of this.cloudMats) {
      m.color.set(wet ? (night ? "#1c2436" : "#aab4c0") : L.cloud).multiplyScalar(night ? 1 : 1.8);
    }
    if (this.rain) this.rain.visible = wet;
    const exposure = (L.exp + (night ? 0.25 : 0)) * (wet ? 1.15 : 1);
    this.renderer.toneMappingExposure = exposure;
    const u = this.grade?.uniforms.get("exposure");
    if (u) u.value = exposure;

    // Glows: lamps, windows, crystals and gems light up after dark.
    for (const m of this.lampMats) m.emissiveIntensity = night ? 4 : wet ? 1.4 : 0.8;
    for (const l of this.lampLights) l.visible = night || wet;
    for (const m of this.crystalMats) m.emissiveIntensity = night ? 2.6 : 0.35;
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
          uBase: { value: new THREE.Color("#244a1c") },
          uTip: { value: new THREE.Color("#a6d65a") },
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
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <fog_fragment>
        }`,
    });
    this.grassMat.uniforms.uTime = this.uTime;
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
  private windy<T extends THREE.Material>(mat: T, amount: number) {
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = this.uTime;
      sh.vertexShader =
        `uniform float uTime;\n${WIND_GLSL}\n` +
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
          transformed.xz += ${WIND_DIR} * ww * hh * hh;`,
        );
    };
    // Each strength compiles its own program (the default cache key would merge them).
    mat.customProgramCacheKey = () => `garden-wind-${amount}`;
    return mat;
  }

  /* ── the cottage ── */

  private buildCottage() {
    const n = this.opts.n;
    const at = this.toWorld(homeSpot(n).x, homeSpot(n).y);
    const g = new THREE.Group();
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
    const water = new THREE.ShaderMaterial({
      transparent: true,
      fog: true,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uSky: { value: new THREE.Color() }, uSunDir: { value: new THREE.Vector3() }, uSunCol: { value: new THREE.Color() } }]),
      vertexShader: `varying vec3 vW; #include <fog_pars_vertex>
        void main(){ vec4 wp = modelMatrix * vec4(position,1.); vW = wp.xyz; vec4 mvPosition = viewMatrix * wp; gl_Position = projectionMatrix * mvPosition; #include <fog_vertex>
 }`.replace(/ #/g, "\n#"),
      fragmentShader: `uniform float uTime; uniform vec3 uSky; uniform vec3 uSunDir; uniform vec3 uSunCol; varying vec3 vW; #include <fog_pars_fragment>
        void main(){
          vec2 p = vW.xz * 3.0;
          vec3 nrm = normalize(vec3(sin(p.x * 1.7 + uTime * 1.3) * 0.08 + sin(p.y * 2.3 - uTime) * 0.06, 1.0, cos(p.y * 1.9 + uTime * 1.1) * 0.08));
          vec3 v = normalize(cameraPosition - vW);
          float fres = pow(1.0 - max(dot(v, nrm), 0.0), 3.0);
          vec3 deep = vec3(0.008, 0.045, 0.06);
          vec3 col = mix(deep, mix(uSky, vec3(0.3, 0.5, 0.7) * length(uSky), 0.55), 0.2 + fres * 0.7);
          vec3 h = normalize(v + uSunDir);
          col += uSunCol * pow(max(dot(nrm, h), 0.0), 120.0) * 3.0;
          gl_FragColor = vec4(col, 0.92);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <fog_fragment>
        }`.replace(/ #/g, "\n#"),
    });
    water.uniforms.uTime = this.uTime;
    this.animatedMats.push(water);
    this.waterMats.push(water);
    // The pond sits in a small hollow, ringed by stones, with lily pads and reeds.
    const disc = new THREE.Mesh(new THREE.CircleGeometry(pr, 40), water);
    disc.rotation.x = -Math.PI / 2;
    disc.scale.y = (pond.ry / this.isl.ry / (pond.rx / this.isl.rx)) * 1;
    disc.position.set(c.x, c.y + 0.03, c.z);
    this.island.add(disc);
    const rock = new THREE.MeshStandardMaterial({ color: "#8d8577", roughness: 1 });
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2 + hash01(`pk${i}`) * 0.2;
      if (Math.abs(((a - POND_ANGLE + Math.PI * 3) % (Math.PI * 2)) - Math.PI) < 0.35) continue;
      const m = new THREE.Mesh(new THREE.DodecahedronGeometry(0.1 + hash01(`pz${i}`) * 0.08, 0), rock);
      const x = c.x + Math.cos(a) * pr * 1.05;
      const z = c.z + Math.sin(a) * pr * 1.05;
      m.position.set(x, this.heightAt(x, z), z);
      m.scale.y = 0.6;
      m.castShadow = true;
      this.island.add(m);
    }
    const pad = new THREE.MeshStandardMaterial({ color: "#3f8a3a", roughness: 0.6, side: THREE.DoubleSide });
    for (let i = 0; i < 5; i++) {
      const a = hash01(`ly${i}`) * Math.PI * 2;
      const rr = pr * (0.25 + hash01(`lr${i}`) * 0.5);
      const m = new THREE.Mesh(new THREE.CircleGeometry(0.11, 14, 0.4, Math.PI * 2 - 0.4), pad);
      m.rotation.x = -Math.PI / 2;
      m.rotation.z = hash01(`lz${i}`) * 6;
      m.position.set(c.x + Math.cos(a) * rr, c.y + 0.045, c.z + Math.sin(a) * rr);
      this.island.add(m);
      if (i % 2 === 0) {
        const fl = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), new THREE.MeshStandardMaterial({ color: "#ffd1e0", roughness: 0.5 }));
        fl.position.copy(m.position).y += 0.03;
        this.island.add(fl);
      }
    }
    const reed = this.windy(new THREE.MeshStandardMaterial({ color: "#5b8f3a", roughness: 0.8 }), 0.25);
    for (let i = 0; i < 14; i++) {
      const a = Math.PI + hash01(`rd${i}`) * 1.6;
      const x = c.x + Math.cos(a) * pr * (0.95 + hash01(`re${i}`) * 0.2);
      const z = c.z + Math.sin(a) * pr * (0.95 + hash01(`re${i}`) * 0.2);
      const hgt = 0.4 + hash01(`rh${i}`) * 0.3;
      const geo = new THREE.CylinderGeometry(0.008, 0.014, hgt, 4);
      geo.translate(0, hgt / 2, 0);
      const m = new THREE.Mesh(geo, reed);
      m.position.set(x, this.heightAt(x, z), z);
      this.island.add(m);
      if (i % 3 === 0) {
        const cat = new THREE.Mesh(new THREE.CapsuleGeometry(0.02, 0.08, 3, 6), new THREE.MeshStandardMaterial({ color: "#6a4128" }));
        cat.position.set(x, this.heightAt(x, z) + hgt, z);
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

    // Stems (all flowers), heads by kind (each its habit's colour), centres for daisies and sunflowers.
    const stemGeo = (() => {
      const st = new THREE.CylinderGeometry(0.007, 0.01, 0.3, 4);
      st.translate(0, 0.15, 0);
      const leaf = new THREE.SphereGeometry(0.035, 6, 4);
      leaf.scale(1, 0.25, 0.5);
      leaf.rotateZ(0.5);
      leaf.translate(0.03, 0.1, 0);
      return mergeGeometries([unindexed(st), unindexed(leaf)]);
    })();
    const heads: THREE.BufferGeometry[] = [
      // Daisy: a ring of petals.
      mergeGeometries(
        Array.from({ length: 8 }, (_, i) => {
          const p = new THREE.SphereGeometry(0.03, 6, 4);
          p.scale(1.4, 0.25, 0.6);
          p.translate(0.042, 0, 0);
          p.rotateY((i / 8) * Math.PI * 2);
          p.rotateX(-0.25);
          p.translate(0, 0.3, 0);
          return unindexed(p);
        }),
      ),
      // Tulip: a cup.
      (() => {
        const l = new THREE.LatheGeometry([new THREE.Vector2(0.0, 0), new THREE.Vector2(0.035, 0.01), new THREE.Vector2(0.045, 0.05), new THREE.Vector2(0.032, 0.095), new THREE.Vector2(0.036, 0.1)], 10);
        l.translate(0, 0.29, 0);
        return unindexed(l);
      })(),
      // Pompom: a round head.
      (() => {
        const s = new THREE.IcosahedronGeometry(0.055, 1);
        s.translate(0, 0.33, 0);
        return unindexed(s);
      })(),
      // Sunflower: thin petals, wide.
      mergeGeometries(
        Array.from({ length: 14 }, (_, i) => {
          const p = new THREE.SphereGeometry(0.025, 5, 3);
          p.scale(2.2, 0.2, 0.5);
          p.translate(0.07, 0, 0);
          p.rotateY((i / 14) * Math.PI * 2);
          p.rotateZ(0.0);
          p.rotateX(-0.9);
          p.translate(0, 0.34, 0);
          return unindexed(p);
        }),
      ),
    ];
    const centreGeo = new THREE.SphereGeometry(0.022, 8, 6);
    centreGeo.scale(1, 0.6, 1);
    centreGeo.translate(0, 0.305, 0);

    const stems = new THREE.InstancedMesh(stemGeo, this.windy(new THREE.MeshStandardMaterial({ color: "#3f7f30", roughness: 0.8 }), 0.9), Math.max(1, flowers.length));
    const centres = new THREE.InstancedMesh(centreGeo, this.windy(new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.7 }), 0.9), Math.max(1, flowers.length));
    const byKind = [0, 1, 2, 3].map((k) => flowers.filter((f) => kindOf(f.id) === k));
    const headMeshes = byKind.map((list, k) => {
      const mesh = new THREE.InstancedMesh(heads[k], this.windy(new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.55, side: THREE.DoubleSide }), 0.9), Math.max(1, list.length));
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
    flowers.forEach((f, i) => {
      if (f.kind !== "flower") return;
      const p = this.toWorld(f.x, f.y);
      const s = (0.85 + hash01(f.id, 3) * 0.4) * 1.9;
      q.setFromEuler(new THREE.Euler((hash01(f.id, 5) - 0.5) * 0.25, hash01(f.id, 6) * Math.PI * 2, (hash01(f.id, 7) - 0.5) * 0.25));
      sv.setScalar(s);
      m.compose(p, q, sv);
      stems.setMatrixAt(i, m);
      const k = kindOf(f.id);
      headMeshes[k].setMatrixAt(kCount[k], m);
      col.setHSL(f.hue / 360, 0.85, k === 2 ? 0.5 : 0.55);
      headMeshes[k].setColorAt(kCount[k], col);
      kCount[k]++;
      if (k === 0 || k === 3) {
        centres.setMatrixAt(ci, m);
        centres.setColorAt(ci, col.set(k === 0 ? "#ffd23f" : "#5a3418"));
        ci++;
      }
    });
    stems.count = flowers.length;
    centres.count = ci;
    for (const o of [stems, centres, ...headMeshes]) {
      o.castShadow = false;
      o.frustumCulled = false;
      this.island.add(o);
    }

    // Trees, lamps and gems: few enough to be their own objects.
    const bark = new THREE.MeshStandardMaterial({ color: "#5b3d27", roughness: 0.95 });
    for (const it of items) {
      if (it.kind === "tree") this.island.add(this.tree(it, bark));
      if (it.kind === "lamp") this.island.add(this.lamp(it));
      if (it.kind === "gem") this.island.add(this.gem(it));
    }
  }

  private tree(it: Placed & { kind: "tree" }, bark: THREE.Material) {
    const g = new THREE.Group();
    const kind = hash01(it.id, 9);
    const s = (0.55 + it.size * 0.65) * 1.35;
    const trunkH = kind > 0.45 && kind <= 0.75 ? 0.5 : 1.0;
    const trunk = new THREE.CylinderGeometry(0.06, 0.11, trunkH, 7);
    trunk.translate(0, trunkH / 2, 0);
    const tm = new THREE.Mesh(trunk, bark);
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
        [0, 1, 2, 3].map((k) => {
          const c = new THREE.ConeGeometry(0.62 - k * 0.12, 0.75, 9, 3);
          const p = c.attributes.position as THREE.BufferAttribute;
          for (let i = 0; i < p.count; i++) {
            const v = new THREE.Vector3().fromBufferAttribute(p, i);
            const d = 1 + (fbm(v.x * 5 + k, v.y * 5, v.z * 5, 2) - 0.5) * 0.35;
            p.setXYZ(i, v.x * d, v.y, v.z * d);
          }
          c.translate(0, 0.75 + k * 0.42, 0);
          return unindexed(c);
        }),
      );
      leafCol = ["#1f4a2a", "#3d7a45"];
    } else {
      const blossom = kind > 0.75;
      canopy = mergeGeometries([blob(0.62, 0, 1.45, 0, 1), blob(0.45, -0.42, 1.2, 0.12, 2), blob(0.45, 0.4, 1.22, -0.1, 3), blob(0.4, 0.05, 1.85, 0.05, 4), blob(0.38, 0.1, 1.25, 0.42, 5), blob(0.36, -0.2, 1.6, -0.35, 6)]);
      // Weld the vertices so the leaves shade smoothly (not as facets).
      canopy.deleteAttribute("normal");
      canopy.deleteAttribute("uv");
      canopy = mergeVertices(canopy, 1e-4);
      leafCol = blossom ? ["#c96b93", "#ffc4dc"] : ["#2f6b2c", "#7fbf4a"];
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
      const count = this.quality === "high" ? 110 : 60;
      for (let i = 0; i < count; i++) {
        const v = new THREE.Vector3().fromBufferAttribute(cp, Math.floor(hash01(`${it.id}c${i}`) * cp.count));
        const out = v.clone().sub(centre).normalize();
        const q = new THREE.PlaneGeometry(0.42, 0.42);
        q.rotateX(hash01(`${it.id}x${i}`) * Math.PI);
        q.rotateY(hash01(`${it.id}y${i}`) * Math.PI);
        q.rotateZ(hash01(`${it.id}z${i}`) * Math.PI);
        q.translate(v.x + out.x * 0.06, v.y + out.y * 0.06, v.z + out.z * 0.06);
        cards.push(q);
      }
      const cardGeo = mergeGeometries(cards);
      const cardMat = this.windy(new THREE.MeshStandardMaterial({ map: this.leafTex, alphaTest: 0.45, side: THREE.DoubleSide, color: new THREE.Color(leafCol[1]).lerp(new THREE.Color(leafCol[0]), 0.35), roughness: 0.8 }), 0.035);
      const cm = new THREE.Mesh(cardGeo, cardMat);
      cm.receiveShadow = true;
      g.add(cm);
    }
    g.scale.setScalar(s);
    g.position.copy(this.toWorld(it.x, it.y));
    g.rotation.y = hash01(it.id, 4) * Math.PI * 2;
    g.userData.id = it.id;
    this.pickables.push(g);
    return g;
  }

  private lamp(it: Placed) {
    const g = new THREE.Group();
    const iron = new THREE.MeshStandardMaterial({ color: "#2e2a26", roughness: 0.6, metalness: 0.6 });
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.03, 0.85, 6), iron);
    post.position.y = 0.425;
    post.castShadow = true;
    const glow = new THREE.MeshStandardMaterial({ color: "#ffe2a6", emissive: "#ffb347", emissiveIntensity: 1 });
    this.lampMats.push(glow);
    const lantern = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.15, 0.11), glow);
    lantern.position.y = 0.93;
    // A soft halo, so lamps glow at night even where the bloom pass is off (phones).
    this.glowTex ??= puffTexture("glow");
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, color: "#ffb860", transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending }));
    halo.position.y = 0.93;
    halo.scale.setScalar(0.9);
    halo.raycast = () => {};
    this.nightOnly.push(halo);
    g.add(halo);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.08, 4), iron);
    cap.position.y = 1.04;
    cap.rotation.y = Math.PI / 4;
    g.add(post, lantern, cap);
    if (this.lampLights.length < 6) {
      const l = new THREE.PointLight("#ffb860", 1.4, 3.2, 1.6);
      l.position.y = 0.95;
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
        uniforms: { uTime: this.uTime, uColor: { value: new THREE.Color(color) }, uSize: { value: size * this.renderer.getPixelRatio() } },
        vertexShader: `attribute float seed; uniform float uTime; uniform float uSize; varying float vA;
          void main(){
            vec3 p = position;
            float t = uTime * ${speed.toFixed(2)} + seed * 30.0;
            p += vec3(sin(t * 0.7) * 0.6, sin(t * 0.9 + 1.3) * 0.25, cos(t * 0.6) * 0.6);
            vA = mix(1.0, 0.5 + 0.5 * sin(uTime * 2.2 + seed * 20.0), ${pulse.toFixed(2)});
            vec4 mv = modelViewMatrix * vec4(p, 1.0);
            gl_PointSize = uSize * (0.6 + seed) * (10.0 / -mv.z);
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: `uniform vec3 uColor; varying float vA;
          void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.0, d); gl_FragColor = vec4(uColor * 2.5, a * a * vA); }`,
      });
      this.animatedMats.push(mat);
      const pts = new THREE.Points(geo, mat);
      pts.frustumCulled = false;
      this.island.add(pts);
      return pts;
    };
    this.nightOnly.push(make(this.quality === "high" ? 140 : 70, "#d9ff8a", 9, 1.0, 1.6, 0.5, 1));
    this.dayOnly.push(make(this.quality === "high" ? 160 : 70, "#fff2c8", 3.5, 1.25, 3, 0.25, 0.3));
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
  private buildFireworks() {
    this.fireworks = true;
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
    if (!this.fireworks) return;
    if (t > this.nextBurst) {
      const b = this.bursts.find((x) => !x.on);
      if (b) {
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
        (b.pts.material as THREE.ShaderMaterial).uniforms.uColor.value.setHSL(Math.random(), 0.95, 0.6);
        b.t0 = t;
        b.on = true;
        b.pts.visible = true;
      }
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
      const q = this.toWorld(it.x, it.y).add(new THREE.Vector3(0, it.kind === "tree" ? 1.2 : 0.3, 0)).project(this.camera);
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
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
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
    if (!id) {
      this.tip = null;
      return;
    }
    if (id === "home") {
      const h = homeSpot(this.opts.n);
      this.tip = this.toWorld(h.x, h.y).add(new THREE.Vector3(0, 2.4, 0));
      return;
    }
    const it = this.itemsById.get(id);
    if (!it) return;
    this.tip = this.toWorld(it.x, it.y).add(new THREE.Vector3(0, it.kind === "tree" ? 2.6 : it.kind === "lamp" ? 1.25 : 0.55, 0));
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
      if (this.decorClear.some((c) => Math.hypot(x - c.x, z - c.z) < c.r)) {
        // Squash the blade to nothing: scale its columns down.
        for (let j = 0; j < 12; j++) arr[i * 16 + j] *= 0.02;
      }
    }
    this.grass.instanceMatrix.needsUpdate = true;
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

    // Opening flight.
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
      u.uTip.value.set(night ? "#6f9a4a" : this.phase === "golden" || this.phase === "dusk" ? "#8fcf4f" : "#a6d65a");
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
      if (b.spin) b.o.rotation.y += dt * b.spin;
    }
    this.updateDecor(t, dt);
    // Butterflies on wandering loops, flapping.
    for (const b of this.butterflies) {
      const a = t * b.sp + b.ph;
      const x = Math.cos(a) * b.rad + Math.sin(a * 2.3) * 0.5;
      const z = Math.sin(a * 1.3) * b.rad * 0.8;
      const y = this.heightAt(x, z) + b.h + Math.sin(a * 3.1) * 0.2;
      const prev = b.g.position.clone();
      b.g.position.set(x, y, z);
      b.g.lookAt(prev.lerp(b.g.position, 2));
      const flap = Math.sin(t * 22 + b.ph) * 1.1;
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
    for (const l of this.lampLights) l.intensity = 1.3 + Math.sin(t * 7 + l.id) * 0.08;

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

  dispose() {
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
