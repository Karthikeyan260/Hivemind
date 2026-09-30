import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { Lensflare, LensflareElement } from "three/addons/objects/Lensflare.js";
import {
  BlendFunction,
  BloomEffect,
  ChromaticAberrationEffect,
  DepthOfFieldEffect,
  EffectComposer,
  EffectPass,
  GodRaysEffect,
  KernelSize,
  NoiseEffect,
  RenderPass,
  SMAAEffect,
  SMAAPreset,
  ToneMappingEffect,
  ToneMappingMode,
  VignetteEffect,
} from "postprocessing";
import { FlowField } from "./flow";
import {
  FLOW_FRAG,
  FLOW_VERT,
  HALO_FRAG,
  HALO_VERT,
  PLANET_FRAG,
  PLANET_VERT,
  RING_FRAG,
  RING_VERT,
  PLASMA_FRAG,
  PLASMA_VERT,
  SKY_FRAG,
  SKY_VERT,
  STAR_FRAG,
  STAR_VERT,
} from "./shaders";

export type SceneState = "idle" | "thinking" | "answering";
export type GNode = { id: string; kind: "memory" | "note" | "document"; title: string; project_id: string | null; weight: number; subtype: string | null; href: string };
export type GProject = { id: string; name: string; status: string; cluster: string | null };
export type Telemetry = { fps: number; distance: number; locked: number; nodes: number; heading: number; pitch: number };

type Callbacks = {
  onHover: (node: GNode | null, x: number, y: number) => void;
  onSelectNode: (node: GNode) => void;
  onSelectProject: (project: GProject | null) => void;
};

const C = {
  amber: new THREE.Color("#f0b45a"),
  ice: new THREE.Color("#8fd3ea"),
  mint: new THREE.Color("#86e3b0"),
  violet: new THREE.Color("#b59cff"),
  core: new THREE.Color("#fff1d6"),
};
const KIND_COLOR: Record<GNode["kind"], THREE.Color> = { memory: C.ice, note: C.mint, document: C.violet };
const PLANET_PALETTES: [string, string][] = [
  ["#3a2a18", "#f0b45a"],
  ["#12303a", "#8fd3ea"],
  ["#2a1f3d", "#b59cff"],
  ["#173327", "#86e3b0"],
  ["#3b1d1d", "#f08a6c"],
  ["#2e2a17", "#e8d58a"],
];
const HUB_RADIUS = 82;
const HOME = new THREE.Vector3(0, 55, 195);
const MAX_BEAMS = 24;
const RETICLES = 10;

function seeded(id: string) {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

function canvasTexture(size: number, draw: (g: CanvasRenderingContext2D, s: number) => void) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  draw(c.getContext("2d")!, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const glowTex = () =>
  canvasTexture(128, (g, s) => {
    const r = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    r.addColorStop(0, "rgba(255,255,255,1)");
    r.addColorStop(0.16, "rgba(255,255,255,0.4)");
    r.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = r;
    g.fillRect(0, 0, s, s);
  });
const hexTex = () =>
  canvasTexture(128, (g, s) => {
    g.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      g.lineTo(s / 2 + Math.cos(a) * s * 0.42, s / 2 + Math.sin(a) * s * 0.42);
    }
    g.closePath();
    g.fillStyle = "rgba(255,255,255,0.18)";
    g.fill();
    g.strokeStyle = "rgba(255,255,255,0.35)";
    g.lineWidth = 2;
    g.stroke();
  });
// The owner's monogram, etched into the reactor: a smoky dark "K" with a thin molten rim.
const monogramTex = () =>
  canvasTexture(512, (g, s) => {
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.font = `900 ${s * 0.72}px "Arial Black", "Segoe UI Black", "Helvetica Neue", sans-serif`;
    const x = s / 2;
    const y = s / 2 + s * 0.04;
    // Soft shadow body
    g.shadowColor = "rgba(20,6,0,1)";
    g.shadowBlur = s * 0.05;
    g.fillStyle = "rgba(34,11,0,0.96)";
    g.fillText("K", x, y);
    g.shadowBlur = 0;
    // Deeper core so it reads as carved, not printed
    g.fillStyle = "rgba(12,3,0,0.8)";
    g.fillText("K", x, y + s * 0.006);
    // Molten rim
    g.shadowColor = "rgba(255,190,90,0.9)";
    g.shadowBlur = s * 0.025;
    g.lineWidth = s * 0.012;
    g.strokeStyle = "rgba(255,222,165,1)";
    g.strokeText("K", x, y);
  });

function flowMaterial(color: THREE.Color, base: number, pulse: number, speed: number, density = 1) {
  return new THREE.ShaderMaterial({
    vertexShader: FLOW_VERT,
    fragmentShader: FLOW_FRAG,
    uniforms: {
      uTime: { value: 0 },
      uColor: { value: color },
      uBase: { value: base },
      uPulse: { value: pulse },
      uSpeed: { value: speed },
      uDensity: { value: density },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

type Orbit = { center: THREE.Vector3; r: number; w: number; phase: number; u: THREE.Vector3; v: THREE.Vector3 };

export class GalaxyScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private composer!: EffectComposer;
  private bloom!: BloomEffect;
  private godRays!: GodRaysEffect;
  private dof: DepthOfFieldEffect | null = null;
  private chroma!: ChromaticAberrationEffect;
  private focusPoint = new THREE.Vector3();
  private focusOn = 0;
  private flow: FlowField | null = null;
  private crystals: THREE.InstancedMesh | null = null;
  private crystalLit: THREE.InstancedBufferAttribute | null = null;
  private crystalSpin = new Float32Array();
  private dummy = new THREE.Object3D();
  private plane = new THREE.Plane();
  private mouseWorld = new THREE.Vector3();
  private timer = new THREE.Timer();
  private raf = 0;
  private disposed = false;
  private reduced: boolean;
  private tex = { glow: glowTex(), hex: hexTex() };

  private sky!: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  private dust!: THREE.Points;
  private inflow!: THREE.Points;
  private inflowSeeds = new Float32Array();
  private plasma!: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  private corona!: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  private coreRings: THREE.Mesh[] = [];
  private monogram!: THREE.Sprite;
  private sonar: { mesh: THREE.Mesh; t: number }[] = [];
  private sonarClock = 0;
  private flowMats: THREE.ShaderMaterial[] = [];

  private world = new THREE.Group();
  private planets: { mesh: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>; id: string }[] = [];
  private stars: THREE.Points | null = null;
  private starPos = new Float32Array();
  private starLit = new Float32Array();
  private starLitTarget = new Float32Array();
  private links: THREE.LineSegments | null = null;
  private orbits: Orbit[] = [];
  private beamGeo: THREE.BufferGeometry;
  private beamLines: THREE.LineSegments;
  private beamIdx: number[] = [];
  private beamSparks: THREE.Sprite[] = [];

  private nodes: GNode[] = [];
  private projects: GProject[] = [];
  private hubPos = new Map<string, THREE.Vector3>();
  private labels = new Map<string, HTMLButtonElement>();
  private reticles: HTMLDivElement[] = [];

  private state: SceneState = "idle";
  private energy = 0;
  private dim = 0.95;
  private dimTarget = 0.95;
  private fly: { fromPos: THREE.Vector3; toPos: THREE.Vector3; fromTarget: THREE.Vector3; toTarget: THREE.Vector3; t: number; dur: number; warp?: boolean } | null = null;
  private warped = false;
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2(9, 9);
  private hovered: number | null = null;
  private selectedId: string | null = null;
  private focusedProject: string | null = null;
  private fps = 60;
  private tmp = new THREE.Vector3();
  private orbitTime = 0;
  private voice = 0;
  private voiceTarget = 0;
  private mobile: boolean;
  private motes!: THREE.Points;
  private moteBase = new Float32Array();
  private meteors: { line: THREE.Line; mat: THREE.ShaderMaterial; from: THREE.Vector3; dir: THREE.Vector3; t: number }[] = [];
  private meteorClock = 3;

  constructor(
    private canvas: HTMLCanvasElement,
    private labelLayer: HTMLElement,
    private reticleLayer: HTMLElement,
    private cb: Callbacks,
  ) {
    this.reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // Phones and small tablets get a lighter render path.
    this.mobile = window.matchMedia("(max-width: 820px)").matches || (navigator.maxTouchPoints > 0 && window.innerWidth < 1100);
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: !this.mobile, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.mobile ? 1.25 : 1.75));
    // Tone mapping happens in the effect stack (HDR until the end).
    this.renderer.toneMapping = THREE.NoToneMapping;

    this.camera = new THREE.PerspectiveCamera(52, 1, 0.1, 3000);
    this.camera.position.copy(this.reduced ? HOME : new THREE.Vector3(40, 260, 1100));

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.06;
    this.controls.enablePan = false;
    this.controls.minDistance = 18;
    this.controls.maxDistance = 420;
    this.controls.autoRotateSpeed = 0.3;
    this.controls.addEventListener("start", () => (this.fly = null));

    this.buildSpace();
    this.buildCore();
    this.scene.add(this.world);
    this.scene.add(new THREE.AmbientLight(0x6a86a8, 0.35));
    this.buildEffects();

    if (!this.reduced) {
      try {
        this.flow = new FlowField(this.renderer, this.mobile ? 96 : 192, this.renderer.getPixelRatio());
        this.scene.add(this.flow.points);
      } catch (err) {
        console.warn("particle flow disabled:", err);
      }
    }

    this.beamGeo = new THREE.BufferGeometry();
    this.beamGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(MAX_BEAMS * 6), 3));
    const bt = new Float32Array(MAX_BEAMS * 2);
    for (let i = 0; i < MAX_BEAMS; i++) bt.set([0, 1], i * 2);
    this.beamGeo.setAttribute("aT", new THREE.BufferAttribute(bt, 1));
    this.beamGeo.setDrawRange(0, 0);
    const beamMat = flowMaterial(C.amber, 0.28, 1.4, 0.9, 2.5);
    this.flowMats.push(beamMat);
    this.beamLines = new THREE.LineSegments(this.beamGeo, beamMat);
    this.beamLines.frustumCulled = false;
    this.scene.add(this.beamLines);

    for (let i = 0; i < RETICLES; i++) {
      const d = document.createElement("div");
      d.className = "reticle";
      d.innerHTML = "<i></i><i></i><i></i><i></i><b></b>";
      this.reticleLayer.appendChild(d);
      this.reticles.push(d);
    }

    canvas.addEventListener("pointermove", this.onPointerMove);
    canvas.addEventListener("pointerleave", this.onPointerLeave);
    canvas.addEventListener("click", this.onClick);
    document.addEventListener("visibilitychange", this.onVisibility);
    this.resize();
    this.loop();
  }

  // ───────────── build ─────────────

  /**
   * Cinematic post stack (pmndrs/postprocessing merges compatible effects into single passes):
   * depth of field → volumetric god rays + mipmap bloom → ACES → vignette → lens fringing + film grain.
   */
  private buildEffects() {
    // No MSAA: Lensflare copies the framebuffer, which is invalid on multisampled targets.
    // Anti-aliasing comes from SMAA at the end of the stack instead.
    this.composer = new EffectComposer(this.renderer, { frameBufferType: THREE.HalfFloatType });
    this.composer.addPass(new RenderPass(this.scene, this.camera));

    if (!this.mobile) {
      this.dof = new DepthOfFieldEffect(this.camera, { worldFocusDistance: 150, worldFocusRange: 70, bokehScale: 0, resolutionScale: 0.5 });
      this.composer.addPass(new EffectPass(this.camera, this.dof));
    }

    this.godRays = new GodRaysEffect(this.camera, this.plasma, {
      samples: this.mobile ? 30 : 60,
      density: 0.95,
      decay: 0.93,
      weight: 0.32,
      exposure: 0.52,
      clampMax: 1,
      blur: true,
      resolutionScale: this.mobile ? 0.35 : 0.5,
    });
    // Mipmap bloom renders black on some Intel/ANGLE (D3D11) GPUs, so use the kernel blur.
    this.bloom = new BloomEffect({ mipmapBlur: false, kernelSize: KernelSize.LARGE, luminanceThreshold: 0.32, luminanceSmoothing: 0.25, intensity: 1.05 });
    const vignette = new VignetteEffect({ darkness: 0.62, offset: 0.26 });
    const tone = new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC });
    this.composer.addPass(new EffectPass(this.camera, this.godRays, this.bloom, tone, vignette));

    this.chroma = new ChromaticAberrationEffect({ offset: new THREE.Vector2(0.0007, 0.0007), radialModulation: true, modulationOffset: 0.25 });
    const noise = new NoiseEffect({ blendFunction: BlendFunction.OVERLAY, premultiply: true });
    noise.blendMode.opacity.value = this.mobile ? 0.12 : 0.22;
    this.composer.addPass(new EffectPass(this.camera, this.chroma, noise));
    if (!this.mobile) this.composer.addPass(new EffectPass(this.camera, new SMAAEffect({ preset: SMAAPreset.HIGH })));
  }

  private buildSpace() {
    this.sky = new THREE.Mesh(
      new THREE.SphereGeometry(1400, 48, 24),
      new THREE.ShaderMaterial({ vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, uniforms: { uTime: { value: 0 } }, side: THREE.BackSide, depthWrite: false }),
    );
    this.scene.add(this.sky);

    // Two star layers: faint distant field + sparse bright foreground stars.
    const layer = (n: number, rMin: number, rMax: number, size: number, opacity: number, seed: string) => {
      const pos = new Float32Array(n * 3);
      const col = new Float32Array(n * 3);
      const rnd = seeded(seed);
      const tints = [C.ice, C.core, C.amber, C.violet];
      for (let i = 0; i < n; i++) {
        const r = rMin + rnd() * (rMax - rMin);
        const th = rnd() * Math.PI * 2;
        const ph = Math.acos(2 * rnd() - 1);
        pos.set([r * Math.sin(ph) * Math.cos(th), r * Math.cos(ph) * 0.7, r * Math.sin(ph) * Math.sin(th)], i * 3);
        const c = tints[Math.floor(rnd() * (rnd() < 0.8 ? 2 : 4))];
        col.set([c.r, c.g, c.b], i * 3);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      g.setAttribute("color", new THREE.BufferAttribute(col, 3));
      return new THREE.Points(
        g,
        new THREE.PointsMaterial({ size, map: this.tex.glow, vertexColors: true, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending }),
      );
    };
    this.dust = layer(this.mobile ? 1400 : 3200, 260, 1100, this.mobile ? 2.8 : 2.2, 0.55, "far");
    this.buildMotes();
    this.buildMeteors();
    this.scene.add(this.dust, layer(260, 160, 420, 3.6, 0.8, "near"));

    const m = 520;
    this.inflowSeeds = new Float32Array(m * 4);
    const r2 = seeded("inflow");
    for (let i = 0; i < m; i++) {
      const th = r2() * Math.PI * 2;
      const ph = Math.acos(2 * r2() - 1);
      this.inflowSeeds.set([Math.sin(ph) * Math.cos(th), Math.cos(ph), Math.sin(ph) * Math.sin(th), r2()], i * 4);
    }
    const ig = new THREE.BufferGeometry();
    ig.setAttribute("position", new THREE.BufferAttribute(new Float32Array(m * 3), 3));
    this.inflow = new THREE.Points(
      ig,
      new THREE.PointsMaterial({ size: 1.5, map: this.tex.glow, color: C.amber, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    this.inflow.frustumCulled = false;
    this.scene.add(this.inflow);
  }

  private buildCore() {
    const core = new THREE.Group();
    this.plasma = new THREE.Mesh(
      new THREE.SphereGeometry(4.2, 64, 48),
      new THREE.ShaderMaterial({ vertexShader: PLASMA_VERT, fragmentShader: PLASMA_FRAG, uniforms: { uTime: { value: 0 }, uEnergy: { value: 0 } } }),
    );
    this.corona = new THREE.Mesh(
      new THREE.SphereGeometry(7.5, 48, 32),
      new THREE.ShaderMaterial({
        vertexShader: HALO_VERT,
        fragmentShader: HALO_FRAG,
        uniforms: { uColor: { value: C.amber }, uPower: { value: 2.4 }, uIntensity: { value: 1.3 } },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.BackSide,
      }),
    );
    core.add(this.plasma, this.corona);

    this.monogram = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: monogramTex(), transparent: true, depthWrite: false, opacity: 1, toneMapped: false }),
    );
    this.monogram.scale.setScalar(10);
    this.monogram.renderOrder = 2;
    core.add(this.monogram);

    const ring = (radius: number, tube: number, color: THREE.Color, opacity: number, tilt: [number, number], dashed = false) => {
      const geo = dashed ? new THREE.TorusGeometry(radius, tube, 4, 240, Math.PI * 1.6) : new THREE.TorusGeometry(radius, tube, 6, 200);
      const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false }));
      mesh.rotation.set(tilt[0], tilt[1], 0);
      core.add(mesh);
      this.coreRings.push(mesh);
    };
    ring(9.5, 0.07, C.amber, 0.95, [Math.PI / 2, 0], true);
    ring(12.5, 0.05, C.ice, 0.6, [Math.PI / 2.6, 0.5]);
    ring(16, 0.06, C.amber, 0.4, [Math.PI / 1.7, -0.6], true);
    ring(24, 0.04, C.ice, 0.22, [Math.PI / 2, 0.2]);

    // Sonar pulses (emitted while thinking)
    for (let i = 0; i < 4; i++) {
      const mesh = new THREE.Mesh(
        new THREE.RingGeometry(0.97, 1, 128),
        new THREE.MeshBasicMaterial({ color: i % 2 ? C.ice : C.amber, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }),
      );
      mesh.rotation.x = -Math.PI / 2 + (i % 2) * 0.35;
      this.scene.add(mesh);
      this.sonar.push({ mesh, t: 1 });
    }

    const light = new THREE.PointLight(0xffe2b0, 2, 0, 0);
    if (!this.reduced) {
      const flare = new Lensflare();
      flare.addElement(new LensflareElement(this.tex.glow, 170, 0, C.amber.clone().multiplyScalar(0.32)));
      flare.addElement(new LensflareElement(this.tex.hex, 50, 0.45, new THREE.Color("#8fd3ea").multiplyScalar(0.3)));
      flare.addElement(new LensflareElement(this.tex.hex, 80, 0.66, new THREE.Color("#f0b45a").multiplyScalar(0.3)));
      if (!this.mobile) {
        flare.addElement(new LensflareElement(this.tex.glow, 36, 0.82, new THREE.Color("#b59cff").multiplyScalar(0.4)));
        flare.addElement(new LensflareElement(this.tex.hex, 120, 1, new THREE.Color("#8fd3ea").multiplyScalar(0.25)));
      }
      light.add(flare);
    }
    core.add(light);
    this.scene.add(core);
  }

  // ───────────── data ─────────────

  setData(nodes: GNode[], projects: GProject[]) {
    this.nodes = nodes;
    this.projects = projects;
    this.hubPos.clear();
    this.world.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
    });
    this.world.clear();
    this.planets = [];
    this.flowMats = this.flowMats.slice(0, 1);
    for (const l of this.labels.values()) l.remove();
    this.labels.clear();

    const counts = new Map<string, number>();
    for (const n of nodes) if (n.project_id) counts.set(n.project_id, (counts.get(n.project_id) ?? 0) + 1);

    // Planets on a flattened golden spiral.
    const n = Math.max(projects.length, 1);
    const hubLine: number[] = [];
    const hubT: number[] = [];
    projects.forEach((p, i) => {
      const y = 1 - (i / Math.max(n - 1, 1)) * 2;
      const rr = Math.sqrt(1 - y * y);
      const th = i * Math.PI * (3 - Math.sqrt(5));
      const v = new THREE.Vector3(Math.cos(th) * rr, y * 0.5, Math.sin(th) * rr).multiplyScalar(HUB_RADIUS);
      this.hubPos.set(p.id, v);
      const rnd = seeded(p.id);
      const [a, b] = PLANET_PALETTES[Math.floor(rnd() * PLANET_PALETTES.length)];
      const radius = 2.6 + Math.min(2.4, (counts.get(p.id) ?? 0) * 0.6);

      const planet = new THREE.Mesh(
        new THREE.SphereGeometry(radius, 48, 32),
        new THREE.ShaderMaterial({
          vertexShader: PLANET_VERT,
          fragmentShader: PLANET_FRAG,
          uniforms: { uA: { value: new THREE.Color(a) }, uB: { value: new THREE.Color(b) }, uSeed: { value: rnd() * 50 }, uTime: { value: 0 }, uLit: { value: 0 } },
        }),
      );
      planet.position.copy(v);
      planet.rotation.z = (rnd() - 0.5) * 0.8;
      planet.userData.projectId = p.id;
      this.world.add(planet);
      this.planets.push({ mesh: planet, id: p.id });

      const atmo = new THREE.Mesh(
        new THREE.SphereGeometry(radius * 1.35, 32, 24),
        new THREE.ShaderMaterial({
          vertexShader: HALO_VERT,
          fragmentShader: HALO_FRAG,
          uniforms: { uColor: { value: new THREE.Color(b) }, uPower: { value: 3 }, uIntensity: { value: 1.4 } },
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          side: THREE.BackSide,
        }),
      );
      atmo.position.copy(v);
      this.world.add(atmo);

      if (rnd() < 0.4) {
        const inner = radius * 1.5;
        const outer = radius * 2.7;
        const rings = new THREE.Mesh(
          new THREE.RingGeometry(inner, outer, 128, 1),
          new THREE.ShaderMaterial({
            vertexShader: RING_VERT,
            fragmentShader: RING_FRAG,
            uniforms: { uColor: { value: new THREE.Color(b).lerp(new THREE.Color("#fff1d6"), 0.35) }, uInner: { value: inner }, uOuter: { value: outer }, uSeed: { value: rnd() * 40 } },
            transparent: true,
            depthWrite: false,
            side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending,
          }),
        );
        rings.position.copy(v);
        rings.rotation.set(Math.PI / 2 - 0.45 + rnd() * 0.3, rnd() * 0.5, 0);
        this.world.add(rings);
      }

      // Faint orbital plane where this project's memories circle.
      const orbitRing = new THREE.Mesh(
        new THREE.RingGeometry(radius + 5.5, radius + 5.62, 96),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(b), transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }),
      );
      orbitRing.position.copy(v);
      orbitRing.rotation.set(Math.PI / 2 + (rnd() - 0.5) * 0.6, (rnd() - 0.5) * 0.6, 0);
      orbitRing.userData.orbitNormal = new THREE.Vector3(0, 0, 1).applyEuler(orbitRing.rotation);
      orbitRing.userData.projectId = p.id;
      this.world.add(orbitRing);

      hubLine.push(v.x, v.y, v.z, 0, 0, 0);
      hubT.push(0, 1);

      const btn = document.createElement("button");
      btn.className = "galaxy-label";
      btn.innerHTML = `<span>${p.name.replace(/[<>&]/g, "")}</span><em>${String(counts.get(p.id) ?? 0).padStart(2, "0")}</em>`;
      btn.onclick = () => this.cb.onSelectProject(p);
      this.labelLayer.appendChild(btn);
      this.labels.set(p.id, btn);
    });

    if (hubLine.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(hubLine, 3));
      g.setAttribute("aT", new THREE.Float32BufferAttribute(hubT, 1));
      const mat = flowMaterial(C.amber, 0.06, 0.55, 0.22, 1.5);
      this.flowMats.push(mat);
      this.world.add(new THREE.LineSegments(g, mat));
    }

    // Knowledge stars as moons on stable orbits.
    const count = nodes.length;
    this.starPos = new Float32Array(count * 3);
    const tint = new Float32Array(count * 3);
    const size = new Float32Array(count);
    this.starLit = new Float32Array(count);
    this.starLitTarget = new Float32Array(count);
    this.orbits = nodes.map((node, i) => {
      const rnd = seeded(node.id);
      const hub = node.project_id ? this.hubPos.get(node.project_id) : undefined;
      const ring = hub ? this.world.children.find((c) => c.userData.orbitNormal && c.userData.projectId === node.project_id) : undefined;
      const normal = hub
        ? (ring?.userData.orbitNormal as THREE.Vector3).clone().applyAxisAngle(new THREE.Vector3(1, 0, 0), (rnd() - 0.5) * 0.5)
        : new THREE.Vector3(0.12, 1, 0.3).normalize();
      const u = new THREE.Vector3(1, 0, 0).cross(normal).normalize();
      if (u.lengthSq() < 0.01) u.set(0, 0, 1);
      const v = normal.clone().cross(u).normalize();
      const r = hub ? 5.5 + rnd() * 6.5 : 30 + rnd() * 24;
      const c = KIND_COLOR[node.kind];
      tint.set([c.r, c.g, c.b], i * 3);
      size[i] = 2.4 + node.weight * 0.4;
      return { center: hub ?? new THREE.Vector3(), r, w: (hub ? 0.9 : 0.35) / Math.sqrt(r), phase: rnd() * Math.PI * 2, u, v };
    });
    this.writeStarPositions();

    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(this.starPos, 3));
    g.setAttribute("tint", new THREE.BufferAttribute(tint, 3));
    g.setAttribute("size", new THREE.BufferAttribute(size, 1));
    g.setAttribute("lit", new THREE.BufferAttribute(this.starLit, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 400);
    this.stars = new THREE.Points(
      g,
      new THREE.ShaderMaterial({
        vertexShader: STAR_VERT,
        fragmentShader: STAR_FRAG,
        uniforms: { uTime: { value: 0 }, uPixel: { value: this.renderer.getPixelRatio() }, uTex: { value: this.tex.glow }, uDim: { value: 0.95 }, uLitColor: { value: C.amber } },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.world.add(this.stars);
    this.buildCrystals(nodes);

    // Tethers: moon → its planet, pulses flowing inward.
    const linked = nodes.map((nd, i) => (nd.project_id && this.hubPos.has(nd.project_id) ? i : -1)).filter((i) => i >= 0);
    if (linked.length) {
      const lg = new THREE.BufferGeometry();
      lg.setAttribute("position", new THREE.BufferAttribute(new Float32Array(linked.length * 6), 3));
      const t = new Float32Array(linked.length * 2);
      for (let k = 0; k < linked.length; k++) t.set([0, 1], k * 2);
      lg.setAttribute("aT", new THREE.BufferAttribute(t, 1));
      lg.userData.linked = linked;
      const mat = flowMaterial(C.ice, 0.07, 0.5, 0.6, 1);
      this.flowMats.push(mat);
      this.links = new THREE.LineSegments(lg, mat);
      this.links.frustumCulled = false;
      this.world.add(this.links);
      this.writeLinks();
    } else {
      this.links = null;
    }

    if (!this.warped) {
      this.warped = true;
      if (!this.reduced) this.flyTo(HOME.clone(), new THREE.Vector3(), 3.4, true);
    }
  }

  /**
   * Knowledge as physical crystal shards (one instanced draw call). They are lit by the reactor,
   * write depth so depth-of-field can focus on them, and glow in their kind colour when locked.
   */
  private buildCrystals(nodes: GNode[]) {
    if (this.crystals) {
      this.world.remove(this.crystals);
      this.crystals.geometry.dispose();
      (this.crystals.material as THREE.Material).dispose();
    }
    const n = nodes.length;
    if (!n) {
      this.crystals = null;
      return;
    }
    const geo = new THREE.OctahedronGeometry(1, 0);
    geo.scale(0.7, 1.25, 0.7);
    this.crystalLit = new THREE.InstancedBufferAttribute(new Float32Array(n), 1);
    geo.setAttribute("aLit", this.crystalLit);
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.18, metalness: 0.55, flatShading: true });
    mat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nattribute float aLit;\nvarying vec3 vGlow;")
        .replace("#include <begin_vertex>", "#include <begin_vertex>\n#ifdef USE_INSTANCING_COLOR\n vGlow = instanceColor * (0.28 + aLit * 3.2);\n#else\n vGlow = vec3(0.3);\n#endif");
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", "#include <common>\nvarying vec3 vGlow;")
        .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\ntotalEmissiveRadiance += vGlow;");
    };
    const mesh = new THREE.InstancedMesh(geo, mat, n);
    this.crystalSpin = new Float32Array(n * 3);
    nodes.forEach((node, i) => {
      const rnd = seeded(node.id + "c");
      mesh.setColorAt(i, KIND_COLOR[node.kind]);
      this.crystalSpin.set([rnd() * 6.28, 0.3 + rnd() * 0.9, 0.55 + node.weight * 0.075], i * 3);
    });
    mesh.frustumCulled = false;
    this.crystals = mesh;
    this.world.add(mesh);
    this.writeCrystals(0);
  }

  private writeCrystals(t: number) {
    if (!this.crystals) return;
    for (let i = 0; i < this.crystals.count; i++) {
      const [phase, speed, scale] = [this.crystalSpin[i * 3], this.crystalSpin[i * 3 + 1], this.crystalSpin[i * 3 + 2]];
      this.dummy.position.set(this.starPos[i * 3], this.starPos[i * 3 + 1], this.starPos[i * 3 + 2]);
      this.dummy.rotation.set(phase + t * speed * 0.6, phase * 2 + t * speed, 0);
      this.dummy.scale.setScalar(scale * (1 + (this.starLit[i] ?? 0) * 0.6));
      this.dummy.updateMatrix();
      this.crystals.setMatrixAt(i, this.dummy.matrix);
      if (this.crystalLit) this.crystalLit.setX(i, this.starLit[i] ?? 0);
    }
    this.crystals.instanceMatrix.needsUpdate = true;
    if (this.crystalLit) this.crystalLit.needsUpdate = true;
  }

  private writeStarPositions() {
    const t = this.orbitTime;
    for (let i = 0; i < this.orbits.length; i++) {
      const o = this.orbits[i];
      const a = o.phase + o.w * t;
      const ca = Math.cos(a) * o.r;
      const sa = Math.sin(a) * o.r;
      this.starPos[i * 3] = o.center.x + o.u.x * ca + o.v.x * sa;
      this.starPos[i * 3 + 1] = o.center.y + o.u.y * ca + o.v.y * sa;
      this.starPos[i * 3 + 2] = o.center.z + o.u.z * ca + o.v.z * sa;
    }
  }

  private writeLinks() {
    if (!this.links) return;
    const linked = this.links.geometry.userData.linked as number[];
    const arr = (this.links.geometry.getAttribute("position") as THREE.BufferAttribute).array as Float32Array;
    linked.forEach((i, k) => {
      const c = this.orbits[i].center;
      arr.set([this.starPos[i * 3], this.starPos[i * 3 + 1], this.starPos[i * 3 + 2], c.x, c.y, c.z], k * 6);
    });
    this.links.geometry.getAttribute("position").needsUpdate = true;
  }

  private nodePos(i: number, out = new THREE.Vector3()) {
    return out.set(this.starPos[i * 3], this.starPos[i * 3 + 1], this.starPos[i * 3 + 2]);
  }

  // ───────────── behaviour ─────────────

  setState(s: SceneState) {
    this.state = s;
    this.controls.autoRotateSpeed = s === "thinking" ? 1.4 : s === "answering" ? 0.55 : 0.3;
    if (s === "thinking") {
      this.dimTarget = 0.4;
      this.sonarClock = 0;
    } else if (!this.beamIdx.length && !this.focusedProject) this.dimTarget = 0.95;
  }

  /** Loudness (0..1) of HIVEMIND's voice right now; the reactor swells and flares with it. */
  setVoiceLevel(level: number) {
    this.voiceTarget = level;
  }

  setSelected(id: string | null) {
    this.selectedId = id;
  }

  highlight(ids: string[]) {
    this.beamIdx = [];
    this.nodes.forEach((n, i) => {
      const on = ids.includes(n.id);
      this.starLitTarget[i] = on ? 1 : 0;
      if (on && this.beamIdx.length < MAX_BEAMS) this.beamIdx.push(i);
    });
    this.dimTarget = this.beamIdx.length ? 0.32 : 0.95;
    this.syncBeamSparks();
    this.flow?.setTargets(this.beamIdx.map((i) => this.nodePos(i)));
    if (!this.beamIdx.length) return;
    const centroid = new THREE.Vector3();
    for (const i of this.beamIdx) centroid.add(this.nodePos(i, this.tmp));
    centroid.divideScalar(this.beamIdx.length);
    const dir = centroid.lengthSq() > 1 ? centroid.clone().normalize() : this.camera.position.clone().normalize();
    // Keep a respectful distance from the reactor so the shot frames the knowledge, not the glare.
    this.flyTo(dir.multiplyScalar(Math.max(115, centroid.length() + 85)).add(new THREE.Vector3(0, 22, 0)), centroid.multiplyScalar(0.55), 2.2);
  }

  clearHighlight() {
    this.starLitTarget.fill(0);
    this.beamIdx = [];
    this.syncBeamSparks();
    this.flow?.setTargets([]);
    this.dimTarget = this.focusedProject ? 0.35 : 0.95;
  }

  private syncBeamSparks() {
    for (const s of this.beamSparks) {
      this.scene.remove(s);
      s.material.dispose();
    }
    this.beamSparks = [];
    for (let k = 0; k < this.beamIdx.length * 2; k++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex.glow, color: C.core, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      sp.scale.setScalar(2.2);
      sp.userData.phase = (k % 2) * 0.5 + Math.random() * 0.2;
      sp.userData.speed = 0.45 + Math.random() * 0.3;
      this.scene.add(sp);
      this.beamSparks.push(sp);
    }
    this.beamGeo.setDrawRange(0, this.beamIdx.length * 2);
  }

  focusProject(id: string | null) {
    this.focusedProject = id;
    for (const [pid, el] of this.labels) el.dataset.active = String(pid === id);
    for (const p of this.planets) p.mesh.material.uniforms.uLit.value = p.id === id ? 1 : 0;
    if (!id) {
      this.flyTo(HOME.clone(), new THREE.Vector3(), 1.8);
      this.clearHighlight();
      return;
    }
    const hub = this.hubPos.get(id);
    if (!hub) return;
    this.nodes.forEach((n, i) => (this.starLitTarget[i] = n.project_id === id ? 0.75 : 0));
    this.beamIdx = [];
    this.syncBeamSparks();
    this.dimTarget = 0.3;
    const dir = hub.clone().normalize();
    this.flyTo(hub.clone().add(dir.multiplyScalar(34)).add(new THREE.Vector3(0, 9, 0)), hub.clone(), 1.8);
  }

  private flyTo(pos: THREE.Vector3, target: THREE.Vector3, dur = 1.8, warp = false) {
    if (this.reduced) {
      this.camera.position.copy(pos);
      this.controls.target.copy(target);
      return;
    }
    this.fly = { fromPos: this.camera.position.clone(), toPos: pos, fromTarget: this.controls.target.clone(), toTarget: target, t: 0, dur, warp };
  }

  telemetry(): Telemetry {
    const off = this.camera.position.clone().sub(this.controls.target);
    const len = Math.max(off.length(), 0.001);
    return {
      fps: Math.round(this.fps),
      distance: Math.round(len),
      locked: this.beamIdx.length,
      nodes: this.nodes.length,
      heading: Math.round((THREE.MathUtils.radToDeg(Math.atan2(off.x, off.z)) + 360) % 360),
      pitch: Math.round(THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(off.y / len, -1, 1)))),
    };
  }

  // ───────────── atmosphere extras ─────────────

  /**
   * Autofocus: the lens racks focus onto what matters (selected star → locked sources → focused
   * planet) and opens up to full sharpness when nothing is targeted.
   */
  private updateFocus(dt: number) {
    let has = true;
    const sel = this.selectedId ? this.nodes.findIndex((n) => n.id === this.selectedId) : -1;
    if (sel >= 0) this.nodePos(sel, this.tmp);
    else if (this.beamIdx.length) {
      this.tmp.set(0, 0, 0);
      const v = new THREE.Vector3();
      for (const i of this.beamIdx) this.tmp.add(this.nodePos(i, v));
      this.tmp.divideScalar(this.beamIdx.length);
    } else if (this.focusedProject && this.hubPos.has(this.focusedProject)) this.tmp.copy(this.hubPos.get(this.focusedProject)!);
    else has = false;

    if (has) this.focusPoint.lerp(this.tmp, Math.min(1, dt * 3));
    this.focusOn += ((has ? 1 : 0) - this.focusOn) * Math.min(1, dt * 1.8);
    if (this.dof) {
      this.dof.target = this.focusPoint;
      this.dof.bokehScale = this.focusOn * 3.2;
    }
    if (this.beamIdx.length) this.flow?.updateTargets(this.beamIdx.map((i) => this.nodePos(i)));
  }

  /** Close dust wrapped around the camera: parallax gives a sense of scale and speed. */
  private buildMotes() {
    const n = this.mobile ? 120 : 260;
    this.moteBase = new Float32Array(n * 3);
    const rnd = seeded("motes");
    for (let i = 0; i < n * 3; i++) this.moteBase[i] = (rnd() - 0.5) * 140;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    this.motes = new THREE.Points(
      g,
      new THREE.PointsMaterial({ size: 0.9, map: this.tex.glow, color: C.ice, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    this.motes.frustumCulled = false;
    this.scene.add(this.motes);
  }

  private updateMotes() {
    const arr = (this.motes.geometry.getAttribute("position") as THREE.BufferAttribute).array as Float32Array;
    const c = this.camera.position;
    const cc = [c.x, c.y, c.z];
    for (let i = 0; i < arr.length; i++) {
      const k = i % 3;
      arr[i] = cc[k] + ((((this.moteBase[i] - cc[k] + 70) % 140) + 140) % 140) - 70;
    }
    this.motes.geometry.getAttribute("position").needsUpdate = true;
  }

  /** Occasional shooting stars streaking through the far field. */
  private buildMeteors() {
    for (let i = 0; i < 3; i++) {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(6), 3));
      g.setAttribute("aT", new THREE.BufferAttribute(new Float32Array([0, 1]), 1));
      const mat = new THREE.ShaderMaterial({
        vertexShader: "attribute float aT; varying float vT; void main(){ vT = aT; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
        fragmentShader: "uniform float uFade; varying float vT; void main(){ gl_FragColor = vec4(vec3(1.0, 0.93, 0.8), vT * vT * uFade); }",
        uniforms: { uFade: { value: 0 } },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const line = new THREE.Line(g, mat);
      line.frustumCulled = false;
      this.scene.add(line);
      this.meteors.push({ line, mat, from: new THREE.Vector3(), dir: new THREE.Vector3(), t: 1 });
    }
  }

  private updateMeteors(dt: number) {
    if (this.reduced) return;
    this.meteorClock -= dt;
    if (this.meteorClock <= 0) {
      this.meteorClock = 3 + Math.random() * 6;
      const m = this.meteors.find((x) => x.t >= 1);
      if (m) {
        const th = Math.random() * Math.PI * 2;
        m.from.set(Math.cos(th) * 420, 60 + Math.random() * 220, Math.sin(th) * 420);
        m.dir.set(-Math.sin(th), -0.35 - Math.random() * 0.3, Math.cos(th)).normalize();
        m.t = 0;
      }
    }
    for (const m of this.meteors) {
      if (m.t >= 1) {
        m.mat.uniforms.uFade.value = 0;
        continue;
      }
      m.t = Math.min(1, m.t + dt / 1.1);
      const head = this.tmp.copy(m.from).addScaledVector(m.dir, m.t * 520);
      const arr = (m.line.geometry.getAttribute("position") as THREE.BufferAttribute).array as Float32Array;
      arr.set([head.x - m.dir.x * 70, head.y - m.dir.y * 70, head.z - m.dir.z * 70, head.x, head.y, head.z]);
      m.line.geometry.getAttribute("position").needsUpdate = true;
      m.mat.uniforms.uFade.value = Math.sin(m.t * Math.PI) * 0.9;
    }
  }

  resize() {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ───────────── input ─────────────

  private onPointerMove = (e: PointerEvent) => {
    const r = this.canvas.getBoundingClientRect();
    this.pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.pick(e.clientX - r.left, e.clientY - r.top);
  };
  private onPointerLeave = () => {
    this.pointer.set(9, 9);
    this.hovered = null;
    this.flow?.setMouse(null);
    this.cb.onHover(null, 0, 0);
  };

  /** Index of the knowledge crystal under the pointer (bigger tolerance on touch). */
  private hitNode(): number | null {
    this.raycaster.setFromCamera(this.pointer, this.camera);
    if (this.crystals) {
      const id = this.raycaster.intersectObject(this.crystals)[0]?.instanceId;
      if (id != null) return id;
    }
    if (!this.stars) return null;
    this.raycaster.params.Points = { threshold: this.mobile ? 3.5 : 1.8 };
    return this.raycaster.intersectObject(this.stars)[0]?.index ?? null;
  }
  private onClick = (e: MouseEvent) => {
    // Touch screens have no hover, so pick at the tap position first.
    const r = this.canvas.getBoundingClientRect();
    this.pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    const idx = this.hitNode();
    if (idx != null) this.hovered = idx;
    if (this.hovered != null) {
      this.cb.onSelectNode(this.nodes[this.hovered]);
      return;
    }
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = this.raycaster.intersectObjects(this.planets.map((p) => p.mesh))[0];
    const pid = hit?.object.userData.projectId as string | undefined;
    const p = pid ? this.projects.find((x) => x.id === pid) : undefined;
    if (p) this.cb.onSelectProject(p);
  };
  private onVisibility = () => {
    cancelAnimationFrame(this.raf);
    if (!document.hidden && !this.disposed) this.loop();
  };

  private pick(x: number, y: number) {
    // The cursor's position on a plane through the orbit target pushes the particle flow.
    if (this.flow) {
      this.camera.getWorldDirection(this.tmp);
      this.plane.setFromNormalAndCoplanarPoint(this.tmp, this.controls.target);
      this.raycaster.setFromCamera(this.pointer, this.camera);
      this.flow.setMouse(this.raycaster.ray.intersectPlane(this.plane, this.mouseWorld));
    }
    const idx = this.hitNode();
    if (idx !== this.hovered) {
      this.hovered = idx;
      this.canvas.style.cursor = idx != null ? "pointer" : "";
    }
    this.cb.onHover(idx != null ? this.nodes[idx] : null, x, y);
  }

  // ───────────── loop ─────────────

  private loop = () => {
    if (this.disposed || document.hidden) return;
    this.raf = requestAnimationFrame(this.loop);
    this.timer.update();
    const dt = Math.min(this.timer.getDelta(), 0.05);
    const t = this.timer.getElapsed();
    if (dt > 0) this.fps += (1 / dt - this.fps) * 0.05;
    const targetEnergy = this.state === "thinking" ? 1 : this.state === "answering" ? 0.5 : 0;
    this.energy += (targetEnergy - this.energy) * Math.min(1, dt * 3);
    this.dim += (this.dimTarget - this.dim) * Math.min(1, dt * 2.5);

    // Camera flight; the arrival warp adds lens stress that settles as the camera slows.
    let warpStress = 0;
    if (this.fly) {
      this.fly.t = Math.min(1, this.fly.t + dt / this.fly.dur);
      const x = this.fly.t;
      const k = this.fly.warp ? 1 - Math.pow(1 - x, 4) : x < 0.5 ? 4 * x ** 3 : 1 - (-2 * x + 2) ** 3 / 2;
      this.camera.position.lerpVectors(this.fly.fromPos, this.fly.toPos, k);
      this.controls.target.lerpVectors(this.fly.fromTarget, this.fly.toTarget, k);
      if (this.fly.warp) warpStress = Math.pow(1 - x, 2);
      if (x >= 1) this.fly = null;
    }
    this.controls.autoRotate = !this.reduced && !this.fly && this.hovered == null;
    this.controls.update();

    // Orbits
    if (!this.reduced) this.orbitTime += dt * (1 + this.energy * 1.5);
    if (this.stars) {
      this.writeStarPositions();
      this.stars.geometry.getAttribute("position").needsUpdate = true;
      this.writeLinks();
      this.writeCrystals(this.reduced ? 0 : t);
    }
    // Fast attack, slower release, like a VU meter.
    this.voice += (this.voiceTarget - this.voice) * Math.min(1, dt * (this.voiceTarget > this.voice ? 22 : 8));
    this.flow?.update(dt, t, Math.max(this.energy, this.voice * 0.7));
    this.updateFocus(dt);

    // Shaders & core
    this.sky.material.uniforms.uTime.value = t;
    this.plasma.material.uniforms.uTime.value = t;
    this.plasma.material.uniforms.uEnergy.value = this.energy;
    this.corona.material.uniforms.uIntensity.value = 1.1 + this.energy * 0.6 + this.voice * 2.2 + Math.sin(t * 2) * 0.1;
    for (const m of this.flowMats) m.uniforms.uTime.value = t * (1 + this.energy * 2);
    for (const p of this.planets) {
      p.mesh.material.uniforms.uTime.value = t;
      if (!this.reduced) p.mesh.rotation.y += dt * 0.08;
    }
    const spin = this.reduced ? 0 : 1 + this.energy * 5;
    this.coreRings.forEach((r, i) => {
      r.rotation.z += dt * (0.12 + i * 0.06) * spin * (i % 2 ? -1 : 1);
    });
    const pulse = 1 + Math.sin(t * (2 + this.energy * 6)) * (0.03 + this.energy * 0.08);
    this.plasma.scale.setScalar(pulse + this.voice * 0.35);
    // Keep the monogram on the camera-facing surface of the plasma so things in front still hide it.
    const coreScale = pulse + this.voice * 0.35;
    this.monogram.position.copy(this.camera.position).normalize().multiplyScalar(4.25 * coreScale);
    this.monogram.scale.setScalar(10 * coreScale);
    this.monogram.material.opacity = 0.94 + Math.sin(t * 1.3) * 0.05 - this.voice * 0.2;
    // Up close the reactor fills the frame, so rays and bloom back off with proximity.
    const near = THREE.MathUtils.smoothstep(this.camera.position.length(), 35, 170);
    this.bloom.intensity = (0.55 + near * 0.5) + this.energy * 0.3 * near + this.voice * 0.6 * near + warpStress * 1.2;
    const ab = 0.0006 + this.energy * 0.0004 + warpStress * 0.012;
    this.chroma.offset.set(ab, ab);
    this.godRays.godRaysMaterial.uniforms.weight.value = (0.08 + near * 0.24) + this.energy * 0.14 * near;
    if (!this.reduced) this.dust.rotation.y += dt * 0.003;
    this.updateMotes();
    this.updateMeteors(dt);

    // Sonar pulses while thinking
    this.sonarClock += dt;
    if (!this.reduced && this.energy > 0.55 && this.sonarClock > 0.55) {
      this.sonarClock = 0;
      const free = this.sonar.find((s) => s.t >= 1);
      if (free) free.t = 0;
    }
    for (const s of this.sonar) {
      if (s.t >= 1) {
        (s.mesh.material as THREE.MeshBasicMaterial).opacity = 0;
        continue;
      }
      s.t = Math.min(1, s.t + dt / 2.2);
      const e = 1 - Math.pow(1 - s.t, 3);
      s.mesh.scale.setScalar(6 + e * 150);
      (s.mesh.material as THREE.MeshBasicMaterial).opacity = (1 - s.t) * 0.55;
    }

    // Inflow particles
    const im = this.inflow.material as THREE.PointsMaterial;
    im.opacity += ((this.energy > 0.6 ? 0.85 : 0) - im.opacity) * Math.min(1, dt * 4);
    if (im.opacity > 0.01) {
      const arr = (this.inflow.geometry.getAttribute("position") as THREE.BufferAttribute).array as Float32Array;
      const s = this.inflowSeeds;
      for (let i = 0; i < arr.length / 3; i++) {
        const ph = (s[i * 4 + 3] + t * 0.4) % 1;
        const r = 90 * (1 - ph) ** 1.5 + 4;
        const swirl = ph * 2.2;
        const x = s[i * 4] * r;
        const z = s[i * 4 + 2] * r;
        arr[i * 3] = x * Math.cos(swirl) - z * Math.sin(swirl);
        arr[i * 3 + 1] = s[i * 4 + 1] * r * 0.6;
        arr[i * 3 + 2] = x * Math.sin(swirl) + z * Math.cos(swirl);
      }
      this.inflow.geometry.getAttribute("position").needsUpdate = true;
    }

    // Star lock-on easing
    if (this.stars) {
      const mat = this.stars.material as THREE.ShaderMaterial;
      mat.uniforms.uTime.value = t;
      mat.uniforms.uDim.value = this.dim;
      let changed = false;
      for (let i = 0; i < this.starLit.length; i++) {
        const target = this.hovered === i ? Math.max(this.starLitTarget[i], 0.65) : this.starLitTarget[i];
        const d = target - this.starLit[i];
        if (Math.abs(d) > 0.002) {
          this.starLit[i] += d * Math.min(1, dt * 4);
          changed = true;
        }
      }
      if (changed) this.stars.geometry.getAttribute("lit").needsUpdate = true;
    }

    // Beams follow their (orbiting) stars into the core
    if (this.beamIdx.length) {
      const arr = (this.beamGeo.getAttribute("position") as THREE.BufferAttribute).array as Float32Array;
      this.beamIdx.forEach((i, k) => arr.set([this.starPos[i * 3], this.starPos[i * 3 + 1], this.starPos[i * 3 + 2], 0, 0, 0], k * 6));
      this.beamGeo.getAttribute("position").needsUpdate = true;
      this.beamSparks.forEach((sp, k) => {
        const i = this.beamIdx[Math.floor(k / 2)];
        const p = ((sp.userData.phase as number) + t * (sp.userData.speed as number)) % 1;
        this.nodePos(i, this.tmp).multiplyScalar(1 - p);
        sp.position.copy(this.tmp);
        sp.material.opacity = Math.sin(p * Math.PI);
      });
    }

    this.composer.render();
    this.updateOverlays();
  };

  private toScreen(v: THREE.Vector3, w: number, h: number) {
    this.tmp.copy(v).project(this.camera);
    return { x: (this.tmp.x * 0.5 + 0.5) * w, y: (-this.tmp.y * 0.5 + 0.5) * h, behind: this.tmp.z > 1 };
  }

  private updateOverlays() {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    // Labels: nearest planets claim screen space first; any label that would collide with one
    // already placed is hidden (the focused sector always wins), so text never piles up.
    const entries = [...this.labels.entries()]
      .map(([id, el]) => {
        const p = this.hubPos.get(id)!;
        return { id, el, p, s: this.toScreen(p, w, h), dist: this.camera.position.distanceTo(p) };
      })
      .filter((e) => e.p)
      .sort((a, z) => (a.id === this.focusedProject ? -1 : z.id === this.focusedProject ? 1 : a.dist - z.dist));
    const placed: { x: number; y: number; w: number; h: number }[] = [];
    for (const { id, el, s, dist } of entries) {
      const lw = el.offsetWidth || 120;
      const lh = el.offsetHeight || 18;
      const rect = { x: s.x - lw / 2 - 4, y: s.y + 18 - 2, w: lw + 8, h: lh + 4 };
      const offscreen = s.behind || s.x < 0 || s.x > w || s.y < 0 || s.y > h - 40;
      const clash = placed.some((r) => rect.x < r.x + r.w && rect.x + rect.w > r.x && rect.y < r.y + r.h && rect.y + rect.h > r.y);
      const visible = !offscreen && (!clash || id === this.focusedProject);
      if (visible) placed.push(rect);
      const fade = Math.max(0.35, Math.min(1, 280 / dist - 0.15));
      el.style.transform = `translate(${s.x}px, ${s.y}px) translate(-50%, 18px)`;
      el.style.opacity = visible ? String(this.focusedProject && this.focusedProject !== id ? fade * 0.3 : fade) : "0";
      el.style.pointerEvents = visible ? "auto" : "none";
    }

    // Reticles: selected, hovered, then locked sources.
    const targets: { i: number; kind: string }[] = [];
    const sel = this.selectedId ? this.nodes.findIndex((n) => n.id === this.selectedId) : -1;
    if (sel >= 0) targets.push({ i: sel, kind: "sel" });
    if (this.hovered != null && this.hovered !== sel) targets.push({ i: this.hovered, kind: "hov" });
    for (const i of this.beamIdx) if (targets.length < RETICLES && i !== sel && i !== this.hovered) targets.push({ i, kind: "lock" });
    const v = new THREE.Vector3();
    this.reticles.forEach((el, k) => {
      const tg = targets[k];
      if (!tg) {
        if (el.dataset.kind) {
          el.dataset.kind = "";
          el.style.opacity = "0";
        }
        return;
      }
      const s = this.toScreen(this.nodePos(tg.i, v), w, h);
      if (el.dataset.kind !== tg.kind || el.dataset.node !== String(tg.i)) {
        el.dataset.kind = tg.kind;
        el.dataset.node = String(tg.i);
        const n = this.nodes[tg.i];
        el.querySelector("b")!.textContent = tg.kind === "lock" ? `${n.kind.slice(0, 3).toUpperCase()}·${n.id.slice(0, 4).toUpperCase()}` : "";
        el.style.animation = "none";
        void el.offsetWidth;
        el.style.animation = "";
      }
      el.style.opacity = s.behind ? "0" : "1";
      el.style.transform = `translate(${s.x}px, ${s.y}px)`;
    });
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.canvas.removeEventListener("pointermove", this.onPointerMove);
    this.canvas.removeEventListener("pointerleave", this.onPointerLeave);
    this.canvas.removeEventListener("click", this.onClick);
    document.removeEventListener("visibilitychange", this.onVisibility);
    for (const l of this.labels.values()) l.remove();
    for (const r of this.reticles) r.remove();
    this.controls.dispose();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose();
    });
    this.tex.glow.dispose();
    this.tex.hex.dispose();
    this.flow?.dispose();
    this.composer.dispose();
    this.renderer.dispose();
  }
}
