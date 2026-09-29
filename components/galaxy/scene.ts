import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { Lensflare, LensflareElement } from "three/addons/objects/Lensflare.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import {
  CINEMA,
  FLOW_FRAG,
  FLOW_VERT,
  HALO_FRAG,
  HALO_VERT,
  PLANET_FRAG,
  PLANET_VERT,
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
export type Telemetry = { fps: number; distance: number; locked: number; nodes: number };

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
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private cinema: ShaderPass;
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

  constructor(
    private canvas: HTMLCanvasElement,
    private labelLayer: HTMLElement,
    private reticleLayer: HTMLElement,
    private cb: Callbacks,
  ) {
    this.reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.9;

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

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.85, 0.6, 0.2);
    this.composer.addPass(this.bloom);
    this.cinema = new ShaderPass(CINEMA);
    this.composer.addPass(this.cinema);
    this.composer.addPass(new OutputPass());

    this.buildSpace();
    this.buildCore();
    this.scene.add(this.world);

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
    this.dust = layer(3200, 260, 1100, 2.2, 0.55, "far");
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
      flare.addElement(new LensflareElement(this.tex.glow, 170, 0, C.amber.clone().multiplyScalar(0.55)));
      flare.addElement(new LensflareElement(this.tex.hex, 50, 0.45, new THREE.Color("#8fd3ea").multiplyScalar(0.3)));
      flare.addElement(new LensflareElement(this.tex.hex, 80, 0.66, new THREE.Color("#f0b45a").multiplyScalar(0.3)));
      flare.addElement(new LensflareElement(this.tex.glow, 36, 0.82, new THREE.Color("#b59cff").multiplyScalar(0.4)));
      flare.addElement(new LensflareElement(this.tex.hex, 120, 1, new THREE.Color("#8fd3ea").multiplyScalar(0.25)));
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
    if (!this.beamIdx.length) return;
    const centroid = new THREE.Vector3();
    for (const i of this.beamIdx) centroid.add(this.nodePos(i, this.tmp));
    centroid.divideScalar(this.beamIdx.length);
    const dir = centroid.lengthSq() > 1 ? centroid.clone().normalize() : this.camera.position.clone().normalize();
    this.flyTo(dir.multiplyScalar(Math.max(90, centroid.length() + 80)).add(new THREE.Vector3(0, 20, 0)), centroid.multiplyScalar(0.4), 2);
  }

  clearHighlight() {
    this.starLitTarget.fill(0);
    this.beamIdx = [];
    this.syncBeamSparks();
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
    return { fps: Math.round(this.fps), distance: Math.round(this.camera.position.distanceTo(this.controls.target)), locked: this.beamIdx.length, nodes: this.nodes.length };
  }

  resize() {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.bloom.resolution.set(w, h);
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
    this.cb.onHover(null, 0, 0);
  };
  private onClick = () => {
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
    if (!this.stars) return;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    this.raycaster.params.Points = { threshold: 1.8 };
    const idx = this.raycaster.intersectObject(this.stars)[0]?.index ?? null;
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
    }

    // Shaders & core
    this.sky.material.uniforms.uTime.value = t;
    this.plasma.material.uniforms.uTime.value = t;
    this.plasma.material.uniforms.uEnergy.value = this.energy;
    this.corona.material.uniforms.uIntensity.value = 1.1 + this.energy * 0.6 + Math.sin(t * 2) * 0.1;
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
    this.plasma.scale.setScalar(pulse);
    this.bloom.strength = 0.8 + this.energy * 0.25 + warpStress * 0.8;
    this.cinema.uniforms.uTime.value = t;
    this.cinema.uniforms.uAberration.value = 0.0016 + this.energy * 0.0005 + warpStress * 0.02;
    if (!this.reduced) this.dust.rotation.y += dt * 0.003;

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
    for (const [id, el] of this.labels) {
      const p = this.hubPos.get(id);
      if (!p) continue;
      const s = this.toScreen(p, w, h);
      const dist = this.camera.position.distanceTo(p);
      const fade = s.behind ? 0 : Math.max(0.3, Math.min(1, 280 / dist - 0.15));
      el.style.transform = `translate(${s.x}px, ${s.y}px) translate(-50%, 18px)`;
      el.style.opacity = String(this.focusedProject && this.focusedProject !== id ? fade * 0.3 : fade);
      el.style.pointerEvents = s.behind ? "none" : "auto";
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
    this.composer.dispose();
    this.renderer.dispose();
  }
}
