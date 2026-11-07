import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { GLTFLoader, type GLTF } from "three/addons/loaders/GLTFLoader.js";
import { buildMocapRobot } from "./mocap-robot";
import { buildRobot, RIG_HEIGHT, type Act, type Rig } from "./robot";
import { buildStation, HOME, type Station, type Stop } from "./stations";
import type { AgentState, CrewAgent, CrewId } from "@/lib/mission";

/**
 * Mission Control: a physically lit command deck. Each background agent is a detailed humanoid robot
 * (built in code, see robot.ts) standing on its own plinth around the HIVE core. PBR metals, an image-based environment, soft shadows and bloom (desktop).
 * Phones skip shadows and bloom to stay smooth.
 */

const HEX: Record<AgentState, string> = { working: "#34d399", idle: "#38bdf8", sleeping: "#64748b", alert: "#f43f5e" };
const MODEL = "/models/xbot.glb";
const ROBOT_H = 2.45; // height of a robot in world units
const ROBOT_SCALE = ROBOT_H / RIG_HEIGHT;
const R = 8.6; // pod ring radius
const SPAN = Math.PI * 1.2;
const PLACE: Record<string, { a: number; r: number }> = {
  scheduler: { a: -0.52, r: 10.6 },
  autopilot: { a: -0.4, r: 8.8 },
  web: { a: -0.16, r: 12.6 },
  dream: { a: 0.06, r: 10.6 },
  brief: { a: 0.26, r: 8.8 },
  reminders: { a: 0.4, r: 11.2 },
  apps: { a: 0.57, r: 8.6 },
}; // arc the pods sit on, open toward the camera
const R_PORTRAIT = 6.4; // a tighter ring for tall, narrow screens
const SPAN_PORTRAIT = Math.PI * 1.08;
const HOME_TARGET = new THREE.Vector3(0, 2.4, -3.6);
const PANEL_Y = 6.5;
// Why a robot leaves its area: who it goes to see and what it is doing there (shown on its label while it is out).
const JOBS: Record<CrewId, Array<{ to: CrewId | "core"; text: string }>> = {
  scheduler: [{ to: "autopilot", text: "Winding up Scout's schedule" }, { to: "core", text: "Syncing the clocks with the core" }, { to: "apps", text: "Fetching gears from Maker" }],
  autopilot: [{ to: "web", text: "Comparing sky data with Rover" }, { to: "core", text: "Sending sweep results to the core" }],
  web: [{ to: "brief", text: "Handing research to Scribe" }, { to: "core", text: "Uploading findings to the core" }],
  dream: [{ to: "brief", text: "Sharing last night's notes" }],
  brief: [{ to: "web", text: "Asking Rover for sources" }, { to: "reminders", text: "Passing the brief to Bell" }, { to: "core", text: "Filing the brief in the core" }],
  reminders: [{ to: "apps", text: "Warning Maker of a deadline" }, { to: "brief", text: "Checking the calendar with Scribe" }],
  apps: [{ to: "scheduler", text: "Asking Clockwork for timing" }, { to: "core", text: "Delivering a new app to the core" }],
};
const STROLLS = [
  { z: 5.5, text: "Stretching its legs" },
  { z: 8, text: "Looking out over the city" },
  { z: 6.5, text: "Checking the hall is tidy" },
];
const GLYPH: Record<CrewId, string> = { scheduler: "⚙", autopilot: "🔭", web: "</>", dream: "☾", brief: "✎", reminders: "🔔", apps: "⬢" };
const ALERT_STOP: Stop = { x: 0, z: 1.0, face: 0, act: "none", dwell: 99 };
// Each agent has its own paint, so the crew reads as individuals; the mood shows in the visor, halo and floor light.
const PAINT: Record<CrewId, string> = { scheduler: "#f59e0b", autopilot: "#38bdf8", web: "#a78bfa", dream: "#6366f1", brief: "#2dd4bf", reminders: "#f472b6", apps: "#fb923c" };

type Pod = {
  id: CrewId;
  pos: THREE.Vector3;
  group: THREE.Group;
  rig: Rig;
  station: Station;
  at: { x: number; z: number };
  mode: string;
  stopIdx: number;
  dwell: number;
  arrived: boolean;
  act: Act;
  walk: number;
  errand: { x: number; z: number; face: number; host: Pod | null } | null;
  nextErrand: number;
  fw: number; // half-width of its floor (box rooms)
  fd: number; // half-depth, or the radius for round floors
  fr: number; // radius for round floors, 0 for box rooms
  note: string | null; // what it is doing right now, shown on its label while it is out on a job
  agent: CrewAgent;
  hostUntil: number;
  hostFace: number;
  halo: THREE.Mesh;
  haloMat: THREE.MeshBasicMaterial;
  prop: THREE.Group;
  ringMat: THREE.MeshStandardMaterial;
  glowMat: THREE.MeshBasicMaterial;
  rippleMat: THREE.MeshBasicMaterial;
  ripple: THREE.Mesh;
  beamMat: THREE.MeshBasicMaterial;
  packetMat: THREE.MeshBasicMaterial;
  curve: THREE.QuadraticBezierCurve3;
  packets: THREE.Mesh[];
  panel: THREE.Mesh;
  tex: THREE.CanvasTexture;
  ctx: CanvasRenderingContext2D;
  key: string;
  state: AgentState;
  col: THREE.Color;
  tgt: THREE.Color;
  phase: number;
  born: number;
  cele: number;
  lift: number;
  burst: number;
  hv: number;
};

export type MissionHooks = { onSelect: (id: CrewId | null) => void; onHover: (id: CrewId | null, x: number, y: number) => void; onReady?: () => void };

/** A small floating tool that says what this agent does: clock, radar, globe, moon, paper, bell, hammer. */
function makeProp(id: CrewId, tone: THREE.Color, track: Array<{ dispose(): void }>): THREE.Group {
  const g = new THREE.Group();
  const steel = new THREE.MeshStandardMaterial({ color: "#d5dcec", metalness: 1, roughness: 0.22 });
  const gold = new THREE.MeshStandardMaterial({ color: "#f2c14e", metalness: 1, roughness: 0.25 });
  const dark = new THREE.MeshStandardMaterial({ color: "#0a0e1a", metalness: 0.6, roughness: 0.35 });
  const glow = new THREE.MeshStandardMaterial({ color: "#0b1020", emissive: tone, emissiveIntensity: 2.2 });
  const paper = new THREE.MeshStandardMaterial({ color: "#e9edf7", roughness: 0.8 });
  track.push(steel, gold, dark, glow, paper);
  const add = (parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    parent.add(m);
    track.push(geo);
    return m;
  };
  const spin = new THREE.Group(); // the part that moves
  g.add(spin);
  g.userData.spin = spin;
  switch (id) {
    case "scheduler": {
      add(g, new THREE.TorusGeometry(0.46, 0.055, 14, 56), gold);
      const face = add(g, new THREE.CylinderGeometry(0.42, 0.42, 0.05, 48), dark);
      face.rotation.x = Math.PI / 2;
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        add(g, new THREE.BoxGeometry(0.025, i % 3 === 0 ? 0.1 : 0.05, 0.02), glow, Math.sin(a) * 0.35, Math.cos(a) * 0.35, 0.04).rotation.z = -a;
      }
      add(spin, new THREE.BoxGeometry(0.04, 0.32, 0.03), glow, 0, 0.16, 0.06);
      add(g, new THREE.SphereGeometry(0.05, 12, 8), steel, 0, 0, 0.07);
      g.userData.kind = "tick";
      break;
    }
    case "autopilot": {
      const dish = add(spin, new THREE.SphereGeometry(0.5, 32, 14, 0, Math.PI * 2, 0, Math.PI / 2.4), steel);
      (dish.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
      dish.rotation.x = -Math.PI / 2.6;
      dish.position.y = 0.1;
      add(spin, new THREE.SphereGeometry(0.07, 12, 8), glow, 0, 0.45, 0.2);
      add(g, new THREE.CylinderGeometry(0.04, 0.07, 0.5, 12), steel, 0, -0.32, 0);
      g.userData.kind = "spin";
      break;
    }
    case "web": {
      add(spin, new THREE.SphereGeometry(0.4, 32, 20), dark);
      const wire = new THREE.MeshBasicMaterial({ color: tone, wireframe: true, transparent: true, opacity: 0.8, toneMapped: false });
      track.push(wire);
      add(spin, new THREE.SphereGeometry(0.415, 18, 12), wire);
      const ring = add(g, new THREE.TorusGeometry(0.55, 0.02, 10, 64), steel);
      ring.rotation.set(Math.PI / 2.4, 0.4, 0);
      g.userData.kind = "spin";
      break;
    }
    case "dream": {
      add(spin, new THREE.TorusGeometry(0.4, 0.1, 16, 48, Math.PI * 1.3), glow).rotation.z = Math.PI * 0.35;
      for (const [x, y] of [[0.4, 0.35], [-0.35, -0.3], [0.5, -0.2]]) add(g, new THREE.OctahedronGeometry(0.045), glow, x, y, 0.1);
      g.userData.kind = "float";
      break;
    }
    case "brief": {
      const sheet = add(spin, new THREE.BoxGeometry(0.62, 0.8, 0.04), paper);
      sheet.rotation.z = 0.08;
      add(spin, new THREE.BoxGeometry(0.5, 0.1, 0.045), glow, 0, 0.27, 0);
      for (let i = 0; i < 4; i++) add(spin, new THREE.BoxGeometry(0.46, 0.03, 0.045), dark, 0, 0.1 - i * 0.12, 0);
      g.userData.kind = "float";
      break;
    }
    case "reminders": {
      const pts = [[0.04, 0], [0.38, 0.04], [0.34, 0.26], [0.22, 0.46], [0.08, 0.58], [0.0, 0.6]].map(([x, y]) => new THREE.Vector2(x, y));
      const bell = add(spin, new THREE.LatheGeometry(pts, 36), gold);
      (bell.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
      bell.position.y = -0.3;
      add(spin, new THREE.SphereGeometry(0.07, 12, 8), glow, 0, -0.3, 0);
      g.userData.kind = "swing";
      break;
    }
    case "apps": {
      const hammer = new THREE.Group();
      add(hammer, new THREE.CylinderGeometry(0.045, 0.05, 0.85, 14), dark, 0, -0.1, 0);
      add(hammer, new THREE.BoxGeometry(0.42, 0.2, 0.2), steel, 0, 0.36, 0);
      add(hammer, new THREE.BoxGeometry(0.44, 0.04, 0.22), glow, 0, 0.28, 0);
      spin.add(hammer);
      g.userData.kind = "hammer";
      break;
    }
  }
  return g;
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number, maxLines: number) {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(next).width > maxW && cur) {
      lines.push(cur);
      cur = w;
    } else cur = next;
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) {
    lines.length = maxLines;
    let last = lines[maxLines - 1];
    while (last.length > 1 && ctx.measureText(`${last}…`).width > maxW) last = last.slice(0, -1);
    lines[maxLines - 1] = `${last}…`;
  }
  return lines;
}

function radialTexture(stops: Array<[number, string]>) {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d")!;
  const gr = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  for (const [o, col] of stops) gr.addColorStop(o, col);
  g.fillStyle = gr;
  g.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** A holographic Earth: glowing blue sphere with a lat/long grid and light continents. */
function globeTexture() {
  const W = 1024;
  const H = 512;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d")!;
  const bg = g.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, "#1b3fa8");
  bg.addColorStop(0.5, "#2563eb");
  bg.addColorStop(1, "#1b3fa8");
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  g.fillStyle = "rgba(160,235,255,0.85)";
  const lands: Array<[number, number, number]> = [[220, 190, 1], [330, 340, 0.8], [520, 180, 1.1], [560, 320, 0.9], [760, 170, 1.2], [850, 360, 0.6], [140, 120, 0.5]];
  for (const [lx, ly, sc] of lands) {
    for (let i = 0; i < 26; i++) {
      g.beginPath();
      g.ellipse(lx + (rnd() - 0.5) * 120 * sc, ly + (rnd() - 0.5) * 90 * sc, (14 + rnd() * 36) * sc, (10 + rnd() * 26) * sc, rnd() * 3, 0, Math.PI * 2);
      g.fill();
    }
  }
  g.strokeStyle = "rgba(190,240,255,0.55)";
  g.lineWidth = 1.5;
  for (let x = 0; x <= W; x += W / 24) {
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x, H);
    g.stroke();
  }
  for (let y = 0; y <= H; y += H / 12) {
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(W, y);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Concentric rings and tick marks drawn on the floor, like a landing pad. */
function floorTexture() {
  const S = 2048;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const g = c.getContext("2d")!;
  g.translate(S / 2, S / 2);
  const k = S / 2 / 20; // 20 world units to the edge
  const ring = (r: number, w: number, a: number, dash?: number[]) => {
    g.beginPath();
    g.setLineDash(dash ?? []);
    g.lineWidth = w;
    g.strokeStyle = `rgba(140,170,255,${a})`;
    g.arc(0, 0, r * k, 0, Math.PI * 2);
    g.stroke();
  };
  ring(3.4, 3, 0.5);
  ring(R, 5, 0.38);
  ring(R + 1.8, 2, 0.25, [10, 14]);
  ring(R - 2.2, 2, 0.18, [4, 10]);
  ring(15, 2, 0.12);
  g.setLineDash([]);
  for (let i = 0; i < 120; i++) {
    const a = (i / 120) * Math.PI * 2;
    const long = i % 5 === 0;
    const r0 = (R + 2.4) * k;
    const r1 = r0 + (long ? 26 : 12);
    g.strokeStyle = `rgba(160,185,255,${long ? 0.4 : 0.2})`;
    g.lineWidth = long ? 3 : 2;
    g.beginPath();
    g.moveTo(Math.cos(a) * r0, Math.sin(a) * r0);
    g.lineTo(Math.cos(a) * r1, Math.sin(a) * r1);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

export class MissionScene {
  private renderer: THREE.WebGLRenderer;
  private composer: EffectComposer | null = null;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(42, 1, 0.1, 400);
  private pods: Pod[] = [];
  private hit: THREE.Object3D[] = [];
  private disposables: Array<{ dispose(): void }> = [];
  private dead = false;
  private model: GLTF | null = null;
  private modelDone = false;
  private pending: CrewAgent[] | null = null;
  private coreGroup = new THREE.Group();
  private sweep = new THREE.Group();
  private sweepMat!: THREE.MeshBasicMaterial;
  private gyros: THREE.Mesh[] = [];
  private dust!: THREE.Points;
  private sky: THREE.Mesh | null = null;
  private raf = 0;
  private last = performance.now();
  private t0 = performance.now();
  private selected: CrewId | null = null;
  private hover: CrewId | null = null;
  private ray = new THREE.Raycaster();
  private ptr = new THREE.Vector2();
  private portrait = false;
  private mobile: boolean;
  private w = 1;
  private h = 1;
  // orbit
  private theta = 0;
  private phi = 1.12;
  private dist = 26;
  private tTheta = 0;
  private tPhi = 1.12;
  private tDist = 26;
  private target = HOME_TARGET.clone();
  private tTarget = HOME_TARGET.clone();
  private follow = new THREE.Vector3();
  private tmp = new THREE.Vector3();
  private sepA = new THREE.Vector3();
  private sepB = new THREE.Vector3();
  private ema = 0.016;
  private lastFrame = performance.now();
  private level = 0;
  private since = performance.now();
  private idleSince = performance.now();
  private pointers = new Map<number, { x: number; y: number }>();
  private pinch = 0;
  private down: { x: number; y: number; t: number; moved: number } | null = null;
  private ro: ResizeObserver;
  private cleanup: Array<() => void> = [];

  constructor(private canvas: HTMLCanvasElement, private hooks: MissionHooks) {
    this.mobile = window.matchMedia("(pointer: coarse)").matches || Math.min(window.innerWidth, window.innerHeight) < 600;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: !this.mobile, powerPreference: "high-performance" });
    this.renderer = renderer;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.mobile ? 1.25 : 1.5));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = false;

    const scene = this.scene;
    scene.background = new THREE.Color("#1a1230");
    scene.fog = new THREE.Fog("#241a38", 34, 70); // same as the sky's horizon, so the floor melts into it
    this.buildSky();
    const pmrem = new THREE.PMREMGenerator(renderer);
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04);
    scene.environment = env.texture;
    scene.environmentIntensity = 0.55;
    this.disposables.push(pmrem, env);

    this.buildLights();
    this.buildFloor();
    this.buildCore();
    this.buildHall();
    this.buildDust();

    if (!this.mobile) {
      const composer = new EffectComposer(renderer);
      composer.addPass(new RenderPass(scene, this.camera));
      composer.addPass(new UnrealBloomPass(new THREE.Vector2(256, 256), 0.35, 0.5, 1.0));
      composer.addPass(new OutputPass());
      this.composer = composer;
    }

    // The robot body is a real skinned model; the deck waits for it (and falls back to the built robot if it can't load).
    new GLTFLoader().load(
      MODEL,
      (gltf) => {
        if (this.dead) return;
        this.model = gltf;
        this.modelDone = true;
        if (this.pending) this.setCrew(this.pending);
      },
      undefined,
      () => {
        if (this.dead) return;
        this.modelDone = true;
        if (this.pending) this.setCrew(this.pending);
      },
    );

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas);
    this.resize();
    this.bind();
    this.theta = this.tTheta - 0.9;
    this.phi = 0.45;
    this.dist = this.tDist * 1.7;
    const tick = () => {
      this.raf = requestAnimationFrame(tick);
      this.frame();
    };
    tick();
  }

  // ---------- build ----------
  private buildLights() {
    const s = this.scene;
    s.add(new THREE.HemisphereLight("#ffc9a0", "#2a1c40", 0.55));
    const key = new THREE.DirectionalLight("#ffb27a", 1.5);
    key.position.set(7, 16, 13);
    if (false as boolean) {
      key.castShadow = true;
      key.shadow.mapSize.set(2048, 2048);
      const c = key.shadow.camera;
      c.left = c.bottom = -16;
      c.right = c.top = 16;
      c.near = 1;
      c.far = 50;
      key.shadow.bias = -0.0004;
      key.shadow.normalBias = 0.03;
    }
    s.add(key);
    const rim = new THREE.DirectionalLight("#6a7cff", 1.7);
    rim.position.set(-12, 8, -14);
    s.add(rim);
    const core = new THREE.PointLight("#5aa0ff", 45, 26, 2);
    core.position.set(0, 3.2, 0);
    s.add(core);
  }

  private buildFloor() {
    const floorMat = new THREE.MeshPhysicalMaterial({ color: "#25222f", metalness: 0.65, roughness: 0.3, clearcoat: 0.5, clearcoatRoughness: 0.25, envMapIntensity: 1.0 });
    const floor = new THREE.Mesh(new THREE.CircleGeometry(60, 96), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);

    const ft = floorTexture();
    const decal = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshBasicMaterial({ map: ft, color: "#ffb36b", transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    decal.rotation.x = -Math.PI / 2;
    decal.position.y = 0.012;
    this.scene.add(decal);
    const sc = document.createElement("canvas");
    sc.width = sc.height = 512;
    const sg = sc.getContext("2d")!;
    const cone = sg.createConicGradient(0, 256, 256);
    cone.addColorStop(0, "rgba(140,170,255,0)");
    cone.addColorStop(0.17, "rgba(140,170,255,0.16)");
    cone.addColorStop(0.175, "rgba(140,170,255,0)");
    cone.addColorStop(1, "rgba(140,170,255,0)");
    sg.fillStyle = cone;
    sg.beginPath();
    sg.arc(256, 256, 254, 0, Math.PI * 2);
    sg.fill();
    sg.globalCompositeOperation = "destination-in";
    const fade = sg.createRadialGradient(256, 256, 0, 256, 256, 254);
    fade.addColorStop(0, "rgba(0,0,0,0.05)");
    fade.addColorStop(0.35, "rgba(0,0,0,1)");
    fade.addColorStop(1, "rgba(0,0,0,0)");
    sg.fillStyle = fade;
    sg.fillRect(0, 0, 512, 512);
    const swTex = new THREE.CanvasTexture(sc);
    swTex.colorSpace = THREE.SRGBColorSpace;
    const swMat = new THREE.MeshBasicMaterial({ map: swTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    const swMesh = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), swMat);
    swMesh.rotation.x = -Math.PI / 2;
    swMesh.position.y = 0.02;
    this.sweep.add(swMesh);
    this.sweepMat = swMat;
    this.scene.add(this.sweep);
    this.disposables.push(floorMat, floor.geometry, ft, decal.geometry, decal.material as THREE.Material, swTex, swMat);
  }

  private buildCore() {
    const g = this.coreGroup;
    const metal = new THREE.MeshStandardMaterial({ color: "#2c2a3c", metalness: 0.8, roughness: 0.28 });
    const glowCol = new THREE.Color("#818cf8");
    const base = new THREE.Mesh(new THREE.CylinderGeometry(2.1, 2.5, 0.5, 64), metal);
    base.position.y = 0.25;
    base.castShadow = base.receiveShadow = true;
    const baseRingMat = new THREE.MeshStandardMaterial({ color: "#0b1020", emissive: glowCol, emissiveIntensity: 2.4, roughness: 0.4 });
    const baseRing = new THREE.Mesh(new THREE.TorusGeometry(2.1, 0.06, 12, 96), baseRingMat);
    baseRing.rotation.x = Math.PI / 2;
    baseRing.position.y = 0.52;
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.5, 1.4, 32), metal);
    stem.position.y = 1.2;
    stem.castShadow = true;

    const globeTex = globeTexture();
    const coreMat = new THREE.MeshStandardMaterial({ color: "#1a2f80", map: globeTex, emissive: "#ffffff", emissiveMap: globeTex, emissiveIntensity: 1.1, roughness: 0.25, metalness: 0.1, transparent: true, opacity: 0.93 });
    const orb = new THREE.Mesh(new THREE.SphereGeometry(1.35, 48, 32), coreMat);
    this.disposables.push(globeTex);
    orb.position.y = 3.1;
    const cage = new THREE.Mesh(new THREE.IcosahedronGeometry(1.62, 2), new THREE.MeshBasicMaterial({ color: "#7dd3fc", wireframe: true, transparent: true, opacity: 0.22, toneMapped: false }));
    cage.position.y = 3.1;
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(9, 9), new THREE.MeshBasicMaterial({ map: radialTexture([[0, "rgba(129,140,248,0.4)"], [0.4, "rgba(99,102,241,0.1)"], [1, "rgba(99,102,241,0)"]]), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    glow.rotation.x = -Math.PI / 2;
    glow.position.y = 0.04;

    const gyroMat = new THREE.MeshStandardMaterial({ color: "#2a3350", metalness: 1, roughness: 0.25, emissive: "#4f46e5", emissiveIntensity: 0.5 });
    for (const [r, tilt] of [[2.0, 0], [2.35, Math.PI / 3], [2.7, -Math.PI / 3]] as const) {
      const m = new THREE.Mesh(new THREE.TorusGeometry(r, 0.035, 12, 128), gyroMat);
      m.position.y = 3.1;
      m.rotation.x = Math.PI / 2 + tilt;
      m.userData.speed = 0.35 + r * 0.18;
      this.gyros.push(m);
      g.add(m);
    }
    g.add(base, baseRing, stem, orb, cage, glow);
    g.userData.orb = orb;
    g.userData.cage = cage;
    g.userData.coreMat = coreMat;
    this.scene.add(g);
    this.disposables.push(metal, baseRingMat, coreMat, gyroMat, glow.material as THREE.Material);
  }

  /** A dusk sky over a sci-fi city, seen through the hangar windows. */
  private buildSky() {
    const W = 1024;
    const H = 512;
    const c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    const g = c.getContext("2d")!;
    // top of the image = zenith, middle = horizon
    const grad = g.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, "#150f33");
    grad.addColorStop(0.22, "#2b2060");
    grad.addColorStop(0.38, "#6d3f80");
    grad.addColorStop(0.46, "#c8606a");
    grad.addColorStop(0.5, "#f0905a");
    grad.addColorStop(0.52, "#1a1230");
    grad.addColorStop(1, "#1a1230");
    g.fillStyle = grad;
    g.fillRect(0, 0, W, H);
    // nebula clouds
    const clouds: Array<[number, number, number, string]> = [
      [200, 150, 190, "rgba(255,190,150,0.35)"],
      [520, 100, 230, "rgba(190,140,255,0.30)"],
      [820, 170, 200, "rgba(130,190,255,0.28)"],
      [360, 215, 170, "rgba(255,150,190,0.30)"],
      [960, 90, 150, "rgba(255,200,160,0.30)"],
    ];
    for (const [x, y, r, col] of clouds) {
      const rg = g.createRadialGradient(x, y, 0, x, y, r);
      rg.addColorStop(0, col);
      rg.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = rg;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    }
    // a sci-fi city skyline at dusk: two layers of towers with lit windows, and a few flying ships
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const towers = (fill: string, hMin: number, hMax: number, lit: number) => {
      for (let x = 0; x < W; ) {
        const bw = 12 + rnd() * 30;
        const bh = hMin + rnd() * rnd() * (hMax - hMin);
        g.fillStyle = fill;
        g.fillRect(x, H * 0.52 - bh, bw, bh);
        if (rnd() < 0.3) g.fillRect(x + bw * 0.45, H * 0.52 - bh - 14 - rnd() * 24, 3, 24); // antenna
        for (let wy = H * 0.52 - bh + 4; wy < H * 0.52 - 3; wy += 6) {
          for (let wx = x + 3; wx < x + bw - 3; wx += 5) {
            if (rnd() < lit) {
              g.fillStyle = rnd() < 0.7 ? "rgba(255,200,130,0.85)" : "rgba(130,210,255,0.85)";
              g.fillRect(wx, wy, 2, 3);
            }
          }
        }
        x += bw + 1 + rnd() * 3;
      }
    };
    towers("#3a2a5e", 20, 90, 0.08);
    towers("#14102a", 16, 120, 0.22);
    g.fillStyle = "rgba(255,230,200,0.9)";
    for (let i = 0; i < 9; i++) g.fillRect(rnd() * W, H * (0.3 + rnd() * 0.12), 7, 2);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, fog: false, depthWrite: false, toneMapped: false });
    const dome = new THREE.Mesh(new THREE.SphereGeometry(125, 48, 24), mat);
    dome.renderOrder = -10;
    this.sky = dome;
    this.scene.add(dome);
    this.disposables.push(tex, mat, dome.geometry);
  }

  /** The hangar around the deck: a window wall onto the city, a skylight ring, the hologram column, a K emblem, plants. */
  private buildHall() {
    const sc = this.scene;
    const dark = new THREE.MeshStandardMaterial({ color: "#1d1a29", metalness: 0.7, roughness: 0.4, envMapIntensity: 0.6, side: THREE.BackSide });
    const metal = new THREE.MeshStandardMaterial({ color: "#2b2738", metalness: 0.8, roughness: 0.35, envMapIntensity: 0.7 });
    const amber = new THREE.MeshBasicMaterial({ color: "#ffae5e", toneMapped: false });
    const blue = new THREE.MeshBasicMaterial({ color: "#60b4ff", toneMapped: false });
    this.disposables.push(dark, metal, amber, blue);
    const RW = 31;
    // low wall and window mullions all the way round
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(RW, RW, 4.2, 64, 1, true), dark);
    wall.position.y = 2.1;
    const sill = new THREE.Mesh(new THREE.TorusGeometry(RW - 0.1, 0.12, 6, 96), amber);
    sill.rotation.x = Math.PI / 2;
    sill.position.y = 4.25;
    const base = new THREE.Mesh(new THREE.TorusGeometry(RW - 0.1, 0.07, 6, 96), amber);
    base.rotation.x = Math.PI / 2;
    base.position.y = 0.5;
    sc.add(wall, sill, base);
    const mull = new THREE.BoxGeometry(0.7, 15, 0.7);
    for (let i = 0; i < 28; i++) {
      const a = (i / 28) * Math.PI * 2;
      const m = new THREE.Mesh(mull, metal);
      m.position.set(Math.sin(a) * RW, 4.2 + 7.5, -Math.cos(a) * RW);
      m.rotation.z = Math.sin(a * 2) * 0.05;
      sc.add(m);
    }
    // ceiling: a dark annulus with a skylight over the hologram, lit rings round the opening
    const ceil = new THREE.Mesh(new THREE.RingGeometry(6.2, RW + 1, 64, 1), new THREE.MeshStandardMaterial({ color: "#16131f", metalness: 0.8, roughness: 0.4, side: THREE.FrontSide }));
    ceil.rotation.x = Math.PI / 2;
    ceil.position.y = 19;
    sc.add(ceil);
    for (const [r, y, mat] of [[6.2, 18.85, blue], [7.1, 18.85, amber], [RW - 1, 18.85, amber]] as const) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.1, 6, 96), mat);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = y;
      sc.add(ring);
    }
    this.disposables.push(ceil.material as THREE.Material);
    // the hologram column from the skylight down to the dais
    const cc = document.createElement("canvas");
    cc.width = 4;
    cc.height = 256;
    const cg = cc.getContext("2d")!;
    const gr = cg.createLinearGradient(0, 0, 0, 256);
    gr.addColorStop(0, "rgba(96,180,255,0.35)");
    gr.addColorStop(0.5, "rgba(70,140,255,0.08)");
    gr.addColorStop(1, "rgba(96,180,255,0.3)");
    cg.fillStyle = gr;
    cg.fillRect(0, 0, 4, 256);
    const ct = new THREE.CanvasTexture(cc);
    ct.colorSpace = THREE.SRGBColorSpace;
    const colMat = new THREE.MeshBasicMaterial({ map: ct, transparent: true, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
    const col = new THREE.Mesh(new THREE.CylinderGeometry(3.1, 3.1, 18.6, 48, 1, true), colMat);
    col.position.y = 9.3;
    sc.add(col);
    this.disposables.push(ct, colMat);
    // the K emblem on the back wall
    const ec = document.createElement("canvas");
    ec.width = ec.height = 512;
    const eg = ec.getContext("2d")!;
    const rg = eg.createRadialGradient(256, 256, 40, 256, 256, 250);
    rg.addColorStop(0, "#3a3550");
    rg.addColorStop(1, "#15121f");
    eg.fillStyle = rg;
    eg.beginPath();
    eg.arc(256, 256, 240, 0, Math.PI * 2);
    eg.fill();
    eg.strokeStyle = "#cfd3e6";
    eg.lineWidth = 16;
    eg.stroke();
    eg.strokeStyle = "#ffb36b";
    eg.lineWidth = 5;
    eg.beginPath();
    eg.arc(256, 256, 214, 0, Math.PI * 2);
    eg.stroke();
    eg.font = "900 330px Georgia, serif";
    eg.textAlign = "center";
    eg.textBaseline = "middle";
    eg.shadowColor = "#ffb36b";
    eg.shadowBlur = 24;
    eg.fillStyle = "#e9ecf8";
    eg.fillText("K", 256, 282);
    const et = new THREE.CanvasTexture(ec);
    et.colorSpace = THREE.SRGBColorSpace;
    et.anisotropy = 8;
    const emblem = new THREE.Mesh(new THREE.PlaneGeometry(6, 6), new THREE.MeshBasicMaterial({ map: et, transparent: true, toneMapped: false }));
    emblem.position.set(-9, 11, -(RW - 0.8));
    sc.add(emblem);
    this.disposables.push(et, emblem.material as THREE.Material);
    // plants in pots round the edge and between the stations
    const potGeo = new THREE.CylinderGeometry(0.55, 0.42, 0.9, 12);
    const leafGeo = new THREE.SphereGeometry(0.5, 8, 6);
    const potMat = new THREE.MeshStandardMaterial({ color: "#3a3446", metalness: 0.3, roughness: 0.5 });
    const leafMat = new THREE.MeshStandardMaterial({ color: "#2f8a52", roughness: 0.6, emissive: "#0c3a1c", emissiveIntensity: 0.4 });
    this.disposables.push(potGeo, leafGeo, potMat, leafMat);
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2 + 0.2;
      const r = i % 2 ? RW - 2 : 20.5;
      const g2 = new THREE.Group();
      g2.position.set(Math.sin(a) * r, 0, -Math.cos(a) * r);
      const pot = new THREE.Mesh(potGeo, potMat);
      pot.position.y = 0.45;
      g2.add(pot);
      for (let k = 0; k < 9; k++) {
        const lf = new THREE.Mesh(leafGeo, leafMat);
        const ka = (k / 9) * Math.PI * 2;
        lf.scale.set(0.35, 1.5 + (k % 3) * 0.35, 0.6);
        lf.position.set(Math.sin(ka) * 0.32, 1.5 + (k % 3) * 0.25, Math.cos(ka) * 0.32);
        lf.rotation.set(Math.cos(ka) * 0.5, ka, -Math.sin(ka) * 0.5);
        g2.add(lf);
      }
      sc.add(g2);
    }
  }

  private buildDust() {
    const n = this.mobile ? 160 : 420;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 3 + Math.random() * 22;
      pos[i * 3] = Math.cos(a) * r;
      pos[i * 3 + 1] = Math.random() * 12;
      pos[i * 3 + 2] = Math.sin(a) * r;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({ color: "#9fb4ff", size: 0.06, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true });
    this.dust = new THREE.Points(geo, mat);
    this.scene.add(this.dust);
    this.disposables.push(mat);
  }

  private buildPod(a: CrewAgent, i: number, n: number): Pod {
    // Not an even ring: every area sits at its own angle and distance, so the hall reads as seven different places.
    const spot = PLACE[a.id] ?? { a: (n === 1 ? 0 : i / (n - 1) - 0.5) * 1.2, r: R };
    const ang = spot.a * Math.PI * (this.portrait ? SPAN_PORTRAIT / SPAN : 1);
    const ringR = spot.r * (this.portrait ? R_PORTRAIT / R : 1);
    const pos = new THREE.Vector3(Math.sin(ang) * ringR, 0, -Math.cos(ang) * ringR);
    const group = new THREE.Group();
    group.position.copy(pos);
    const col = new THREE.Color(HEX[a.state]);

    const metal = new THREE.MeshStandardMaterial({ color: "#2a2638", metalness: 0.7, roughness: 0.35, envMapIntensity: 0.7 });
    const ringMat = new THREE.MeshStandardMaterial({ color: "#0b1020", emissive: col, emissiveIntensity: 2.2, roughness: 0.4 });
    // Each agent has its own kind of place: round clock dais, observatory deck, control room, bedroom, study, bell plaza, workshop.
    const TH: Record<string, { shape: "round" | "oct" | "box"; w: number; d: number; floor: string; wall: string | null; rough: number }> = {
      scheduler: { shape: "round", w: 2.9, d: 2.9, floor: "#6a4a30", wall: null, rough: 0.5 },
      autopilot: { shape: "oct", w: 2.9, d: 2.9, floor: "#2b3a58", wall: null, rough: 0.35 },
      web: { shape: "box", w: 5.4, d: 4.7, floor: "#1e2a46", wall: "#16203a", rough: 0.3 },
      dream: { shape: "box", w: 5.3, d: 4.7, floor: "#6b4a33", wall: "#43356a", rough: 0.6 },
      brief: { shape: "box", w: 5.3, d: 4.7, floor: "#7a5a3a", wall: "#4a3a2a", rough: 0.6 },
      reminders: { shape: "oct", w: 2.9, d: 2.9, floor: "#7a4a62", wall: null, rough: 0.45 },
      apps: { shape: "box", w: 5.4, d: 4.7, floor: "#3a3d46", wall: "#2e3038", rough: 0.55 },
    };
    const th = TH[a.id] ?? TH.web;
    const W = th.w;
    const D = th.d;
    const floorMat = new THREE.MeshStandardMaterial({ color: th.floor, metalness: 0.25, roughness: th.rough, envMapIntensity: 0.7 });
    const wallMat = new THREE.MeshStandardMaterial({ color: th.wall ?? "#2a2433", metalness: 0.3, roughness: 0.55, envMapIntensity: 0.6 });
    this.disposables.push(floorMat, wallMat);
    const ring = new THREE.Group();
    let slab: THREE.Mesh;
    let plinth: THREE.Mesh;
    if (th.shape === "box") {
      slab = new THREE.Mesh(new THREE.BoxGeometry(W + 0.3, 0.14, D + 0.3), metal);
      slab.position.y = 0.07;
      plinth = new THREE.Mesh(new THREE.BoxGeometry(W, 0.26, D), floorMat);
      plinth.position.y = 0.27;
      const back = new THREE.Mesh(new THREE.BoxGeometry(W, 2.8, 0.16), wallMat);
      back.position.set(0, 0.4 + 1.4, -D / 2 + 0.08);
      const topStrip = new THREE.Mesh(new THREE.BoxGeometry(W, 0.07, 0.2), ringMat);
      topStrip.position.set(0, 0.4 + 2.8, -D / 2 + 0.08);
      const skirt = new THREE.Mesh(new THREE.BoxGeometry(W, 0.05, 0.2), ringMat);
      skirt.position.set(0, 0.43, -D / 2 + 0.09);
      const frontEdge = new THREE.Mesh(new THREE.BoxGeometry(W, 0.05, 0.08), ringMat);
      frontEdge.position.set(0, 0.41, D / 2 - 0.04);
      ring.add(back, topStrip, skirt, frontEdge);
      // half-height side walls so each room feels enclosed from the front
      for (const sx of [-1, 1]) {
        const sw = new THREE.Mesh(new THREE.BoxGeometry(0.14, 1.1, D * 0.55), wallMat);
        sw.position.set((sx * (W - 0.14)) / 2, 0.4 + 0.55, -D * 0.22);
        const rl = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.05, D * 0.55), ringMat);
        rl.position.set((sx * (W - 0.14)) / 2, 0.4 + 1.1, -D * 0.22);
        ring.add(sw, rl);
      }
    } else {
      const seg = th.shape === "round" ? 56 : 8;
      slab = new THREE.Mesh(new THREE.CylinderGeometry(W + 0.35, W + 0.45, 0.14, seg), metal);
      slab.position.y = 0.07;
      plinth = new THREE.Mesh(new THREE.CylinderGeometry(W, W + 0.1, 0.26, seg), floorMat);
      plinth.position.y = 0.27;
      const edge = new THREE.Mesh(new THREE.TorusGeometry(W - 0.12, 0.05, 6, seg), ringMat);
      edge.rotation.x = Math.PI / 2;
      if (th.shape === "oct") edge.rotation.z = Math.PI / 8;
      edge.position.y = 0.41;
      ring.add(edge);
      if (a.id === "autopilot") {
        // observatory railing round the back half
        const railMat = new THREE.MeshStandardMaterial({ color: "#aab3c6", metalness: 0.9, roughness: 0.3 });
        this.disposables.push(railMat);
        for (let k = 0; k <= 8; k++) {
          const t = Math.PI * (0.08 + (k / 8) * 0.84);
          const post = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.1, 8), railMat);
          post.position.set(Math.cos(t) * (W - 0.25), 0.95, -Math.sin(t) * (W - 0.25));
          ring.add(post);
        }
        const rail = new THREE.Mesh(new THREE.TorusGeometry(W - 0.25, 0.035, 6, 48, Math.PI), railMat);
        rail.rotation.x = -Math.PI / 2;
        rail.position.y = 1.5;
        ring.add(rail);
      }
      // steps up to the dais
      const step = new THREE.Mesh(new THREE.CylinderGeometry(W + 0.75, W + 0.85, 0.07, seg), floorMat);
      step.position.y = 0.035;
      ring.add(step);
    }
    // a rug or floor marking that gives each place its own character
    const rugCol: Record<string, string> = { dream: "#3c2a66", brief: "#5b3a8a", apps: "#facc15", web: "#2a4b8a" };
    if (a.id === "dream" || a.id === "brief" || a.id === "web") {
      const rug = new THREE.Mesh(a.id === "dream" ? new THREE.CircleGeometry(1.6, 40) : new THREE.PlaneGeometry(a.id === "web" ? 3.4 : 2.8, 1.9), new THREE.MeshStandardMaterial({ color: rugCol[a.id], roughness: 0.95 }));
      rug.rotation.x = -Math.PI / 2;
      rug.position.set(0, 0.405, 0.35);
      this.disposables.push(rug.geometry, rug.material as THREE.Material);
      ring.add(rug);
    }
    if (a.id === "apps") {
      // yellow/black hazard stripes along the front of the workshop
      const hz = new THREE.BoxGeometry(0.36, 0.03, 0.2);
      const hy = new THREE.MeshBasicMaterial({ color: "#facc15", toneMapped: false });
      const hk = new THREE.MeshBasicMaterial({ color: "#14141a", toneMapped: false });
      this.disposables.push(hz, hy, hk);
      for (let k = 0; k < 14; k++) {
        const hm = new THREE.Mesh(hz, k % 2 ? hk : hy);
        hm.position.set(-W / 2 + 0.3 + k * ((W - 0.6) / 13), 0.41, D / 2 - 0.2);
        ring.add(hm);
      }
    }
    const mark = new THREE.Mesh(new THREE.RingGeometry(0.95, 1.01, 64), ringMat);
    mark.rotation.x = -Math.PI / 2;
    mark.position.y = 0.405;
    ring.add(mark);
    // clutter that makes it a working space: crates in one back corner, a warm lamp and a plant in the other
    const crateMat = new THREE.MeshStandardMaterial({ color: "#5a4636", metalness: 0.4, roughness: 0.55, envMapIntensity: 0.6 });
    const bandMat = new THREE.MeshBasicMaterial({ color: "#ffae5e", toneMapped: false });
    const crateGeo = new THREE.BoxGeometry(0.95, 0.7, 0.95);
    const crateGeo2 = new THREE.BoxGeometry(0.7, 0.55, 0.7);
    const bandGeo = new THREE.BoxGeometry(0.97, 0.06, 0.97);
    const c1 = new THREE.Mesh(crateGeo, crateMat);
    c1.position.set(-2.0, 0.75, -1.65);
    const c2 = new THREE.Mesh(crateGeo2, crateMat);
    c2.position.set(-2.05, 1.38, -1.62);
    c2.rotation.y = 0.5;
    const c3 = new THREE.Mesh(crateGeo, crateMat);
    c3.position.set(-1.0, 0.75, -1.85);
    c3.rotation.y = -0.2;
    for (const m of a.id === "scheduler" || a.id === "apps" || a.id === "autopilot" ? [c1, c3] : []) {
      const band = new THREE.Mesh(bandGeo, bandMat);
      band.position.copy(m.position);
      band.rotation.y = m.rotation.y;
      ring.add(band);
    }
    const poleMat = new THREE.MeshStandardMaterial({ color: "#2a2638", metalness: 0.8, roughness: 0.35 });
    const lampGlow = new THREE.SpriteMaterial({ map: radialTexture([[0, "rgba(255,190,110,0.95)"], [0.35, "rgba(255,160,70,0.35)"], [1, "rgba(255,150,60,0)"]]), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 1.7, 8), poleMat);
    pole.position.set(2.1, 1.25, 1.95);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.17, 14, 10), bandMat);
    bulb.position.set(2.1, 2.18, 1.95);
    const gl = new THREE.Sprite(lampGlow);
    gl.position.copy(bulb.position);
    gl.scale.setScalar(2.2);
    const potM = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.27, 0.5, 12), poleMat);
    potM.position.set(-2.1, 0.65, 1.9);
    for (let k = 0; k < 7; k++) {
      const lf = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 6), new THREE.MeshStandardMaterial({ color: "#2f8a52", roughness: 0.6, emissive: "#0c3a1c", emissiveIntensity: 0.4 }));
      const ka = (k / 7) * Math.PI * 2;
      lf.scale.set(0.3, 1.5, 0.5);
      lf.position.set(-2.1 + Math.sin(ka) * 0.2, 1.3 + (k % 2) * 0.15, 1.9 + Math.cos(ka) * 0.2);
      lf.rotation.set(Math.cos(ka) * 0.5, ka, -Math.sin(ka) * 0.5);
      ring.add(lf);
      this.disposables.push(lf.geometry, lf.material as THREE.Material);
    }
    if (a.id === "scheduler" || a.id === "apps" || a.id === "autopilot") ring.add(c1, c2, c3);
    ring.add(pole, bulb, gl, potM);
    this.disposables.push(crateMat, bandMat, crateGeo, crateGeo2, bandGeo, poleMat, lampGlow, pole.geometry, bulb.geometry, potM.geometry);

    // the robot itself: built in code, scaled to a fixed height, standing on the plinth
    const rig = this.model ? buildMocapRobot(this.model, PAINT[a.id], col, ROBOT_SCALE) : buildRobot(PAINT[a.id], col, a.name);
    rig.root.scale.setScalar(ROBOT_SCALE);
    rig.root.position.y = 0.4;
    this.disposables.push(rig);
    // a thin halo over its head in the agent's colour: the mood at a glance
    const haloMat = new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.9, toneMapped: false });
    const halo = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.028, 10, 48), haloMat);
    halo.rotation.x = Math.PI / 2;
    halo.position.y = ROBOT_H + 0.75;

    // soft pool of coloured light on the floor + an alert ripple
    const glowMat = new THREE.MeshBasicMaterial({ map: radialTexture([[0, "rgba(255,255,255,0.5)"], [0.5, "rgba(255,255,255,0.08)"], [1, "rgba(255,255,255,0)"]]), color: col, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(6, 6), glowMat);
    glow.rotation.x = -Math.PI / 2;
    glow.position.y = 0.03;
    const rippleMat = new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
    const ripple = new THREE.Mesh(new THREE.RingGeometry(2.4, 2.55, 64), rippleMat);
    ripple.rotation.x = -Math.PI / 2;
    ripple.position.y = 0.05;

    // hologram label (billboarded each frame)
    const cv = document.createElement("canvas");
    cv.width = 640;
    cv.height = 200;
    const ctx = cv.getContext("2d")!;
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 1.06), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false }));
    panel.position.y = PANEL_Y;
    panel.renderOrder = 5;

    // click target: a generous invisible column
    const hit = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.4, 6, 20), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
    hit.position.y = 3;
    hit.userData.id = a.id;
    this.hit.push(hit);

    const station = buildStation(a.id, PAINT[a.id], this.disposables);
    if (station.tool) rig.hands[1].add(station.tool);
    const prop = makeProp(a.id, col, this.disposables); // kept only so moveProp has something to drive
    const shadowTex = radialTexture([[0, "rgba(0,0,0,0.6)"], [0.6, "rgba(0,0,0,0.25)"], [1, "rgba(0,0,0,0)"]]);
    const blob = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 2.2), new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }));
    blob.rotation.x = -Math.PI / 2;
    blob.position.y = 0.03; // rides with the robot, so its shadow follows it across the deck
    this.disposables.push(shadowTex, blob.material as THREE.Material);
    rig.root.add(blob);
    group.add(slab, plinth, ring, halo, glow, ripple, panel, hit, station.group);
    group.add(rig.root);
    group.lookAt(0, 0, 0);
    this.scene.add(group);

    // energy line to the core (curve in world space) and the packets that ride it
    const from = new THREE.Vector3(pos.x * 0.84, 0.35, pos.z * 0.84);
    const to = new THREE.Vector3(0, 0.55, 0);
    const mid = from.clone().lerp(to, 0.5).setY(1.6);
    const curve = new THREE.QuadraticBezierCurve3(from, mid, to);
    const beamMat = new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 48, 0.022, 6, false), beamMat);
    this.scene.add(tube);
    const packetMat = new THREE.MeshBasicMaterial({ color: col, toneMapped: false });
    const pg = new THREE.SphereGeometry(0.11, 12, 8);
    const packets = [0, 1, 2].map(() => {
      const m = new THREE.Mesh(pg, packetMat);
      m.visible = false;
      this.scene.add(m);
      return m;
    });
    this.disposables.push(metal, ringMat, haloMat, glowMat, rippleMat, tex, panel.material as THREE.Material, hit.material as THREE.Material, beamMat, packetMat);

    return { id: a.id, pos, group, rig, station, at: { x: HOME.x, z: HOME.z }, mode: "", stopIdx: 0, dwell: 0, arrived: false, act: "none" as Act, walk: 0, errand: null, nextErrand: performance.now() / 1000 + 2 + i * 1.1, fw: th.shape === "box" ? W / 2 : W, fd: th.shape === "box" ? D / 2 : W, fr: th.shape === "box" ? 0 : W, note: null, agent: a, hostUntil: 0, hostFace: 0, halo, haloMat, prop, ringMat, glowMat, rippleMat, ripple, beamMat, packetMat, curve, packets, panel, tex, ctx, key: "", state: a.state, col, tgt: col.clone(), phase: i * 1.3, born: performance.now() + 250 + i * 130, cele: 0, lift: this.portrait && i % 2 ? 1.7 : 0, burst: 0, hv: 0 };
  }

  // ---------- data ----------
  setCrew(crew: CrewAgent[]) {
    if (!this.modelDone) {
      this.pending = crew; // build the pods once the robot model has arrived
      return;
    }
    if (this.pods.length === 0) {
      crew.forEach((a, i) => this.pods.push(this.buildPod(a, i, crew.length)));
      this.hooks.onReady?.();
    }
    for (const a of crew) {
      const p = this.pods.find((x) => x.id === a.id);
      if (!p) continue;
      p.agent = a;
      if (p.key && p.state !== a.state) {
        p.burst = 1; // a ring of light when a mood changes
        const was = p.state;
        if (was === "working" && (a.state === "idle" || a.state === "sleeping")) {
          p.cele = 1; // it finished: celebrate, then carry the result to the core
          setTimeout(() => !this.dead && this.startErrand(p, null), 2800);
        }
        // Clockwork is what wakes the others: when a job starts, it walks over to set it going
        if (a.state === "working" && was !== "working" && p.id !== "scheduler") {
          const clock = this.pods.find((x) => x.id === "scheduler");
          if (clock) this.startErrand(clock, p);
        }
      }
      p.state = a.state;
      p.tgt.set(HEX[a.state]);
      const key = `${a.state}|${a.name}|${a.role}|${a.line}`;
      if (key !== p.key) {
        p.key = key;
        this.drawPanel(p, a);
      }
    }
  }

  /** Walks the robot between the spots of its set and has it do its job at each one. */
  private behave(p: Pod, dt: number) {
    const st = p.station;
    const mode = p.state === "sleeping" ? "sleep" : p.state === "alert" ? "alert" : p.state === "working" ? "work" : "idle";
    if (mode !== p.mode) {
      p.mode = mode;
      p.stopIdx = 0;
      p.arrived = false;
    }
    const now = performance.now() / 1000;
    const busy = mode === "work" || mode === "idle";
    if (p.errand && (!busy || this.selected === p.id)) this.endErrand(p);
    // Every so often a robot has a reason to walk across the hall to a colleague or to the core.
    if (!p.errand && busy && this.selected !== p.id && now > p.nextErrand) {
      p.nextErrand = now + 9 + ((p.phase * 17) % 8);
      const jobs = JOBS[p.id].filter((j) => j.to === "core" || this.pods.find((x) => x.id === j.to)?.state !== "sleeping");
      const job = jobs[Math.floor(Math.random() * jobs.length)];
      // sometimes it just strolls out onto the open floor in front of its area, to stretch its legs or look around
      if (Math.abs(p.group.position.x) > 4 && Math.random() < 0.4) {
        const spots = STROLLS[Math.floor(Math.random() * STROLLS.length)];
        this.startErrand(p, null, spots.text, { x: p.group.position.x * 0.92, z: spots.z });
      } else if (job) this.startErrand(p, job.to === "core" ? null : (this.pods.find((x) => x.id === job.to) ?? null), job.text);
    }
    const hosting = p.hostUntil > now && busy;
    const list = mode === "work" ? st.work : mode === "idle" ? st.idle : [mode === "sleep" ? st.sleep : ALERT_STOP];
    let stop = list[p.stopIdx % list.length];
    if (p.errand) stop = { x: p.errand.x, z: p.errand.z, face: p.errand.face, act: "chat", dwell: 5.5 };
    if (hosting) stop = { x: p.at.x, z: p.at.z, face: p.hostFace, act: "chat", dwell: 99 };
    // Rooms have walls and props: to get in or out, walk through the open front.
    const inside = (x: number, z: number) => (p.fr > 0 ? Math.hypot(x, z) < p.fr - 0.15 : Math.abs(x) < p.fw - 0.15 && Math.abs(z) < p.fd - 0.15);
    const gate = { x: 0, z: p.fd + 0.75 };
    if (inside(p.at.x, p.at.z) !== inside(stop.x, stop.z) && Math.hypot(gate.x - p.at.x, gate.z - p.at.z) > 0.25) {
      stop = { x: gate.x, z: gate.z, face: 0, act: "none", dwell: 0 };
    }
    const dx = stop.x - p.at.x;
    const dz = stop.z - p.at.z;
    const dist = Math.hypot(dx, dz);
    let yaw = stop.face;
    if (dist > 0.05) {
      const step = Math.min(dist, (mode === "alert" ? 2.6 : p.errand ? 1.6 : 1.2) * dt);
      p.at.x += (dx / dist) * step;
      p.at.z += (dz / dist) * step;
      yaw = Math.atan2(dx, dz);
      p.walk = 1;
      p.act = "none";
      p.arrived = false;
    } else {
      p.walk = 0;
      if (!p.arrived) {
        p.arrived = true;
        p.dwell = stop.dwell * (0.85 + ((p.phase * 7) % 0.3));
      }
      p.act = mode === "work" || mode === "idle" ? stop.act : mode === "sleep" ? "sleep" : "none";
      p.dwell -= dt;
      if (p.errand && !hosting) {
        // the visitor has arrived: the host turns to face them and chats back
        const h = p.errand.host;
        if (h && h.hostUntil < now + 1) {
          h.hostUntil = now + p.dwell + 0.6;
          const w = p.group.localToWorld(new THREE.Vector3(p.at.x, 0, p.at.z));
          const hl = h.group.worldToLocal(w);
          h.hostFace = Math.atan2(hl.x - h.at.x, hl.z - h.at.z);
        }
        if (p.dwell <= 0) {
          this.endErrand(p);
          p.arrived = false;
        }
      } else if (p.dwell <= 0 && list.length > 1 && !hosting) {
        p.stopIdx = (p.stopIdx + 1) % list.length;
        p.arrived = false;
      }
    }
    if (this.selected === p.id && p.act === "none" && p.walk === 0) yaw = Math.PI * 0; // a robot with nothing to do turns to the camera
    const root = p.rig.root;
    const d = ((yaw - root.rotation.y + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    root.rotation.y += d * (1 - Math.pow(0.003, dt));
    root.position.x = p.at.x;
    root.position.z = p.at.z;
    // on the plinth it stands at plinth height; walking off, it steps down to the deck
    const onPlinth = inside(p.at.x, p.at.z);
    root.position.y += ((onPlinth ? 0.4 : 0.02) - root.position.y) * (1 - Math.pow(0.001, dt));
  }

  /** Sends a robot across the deck for a reason: to hand its result to the core (host null), or to see a colleague (host). */
  private startErrand(p: Pod, host: Pod | null, note?: string, to?: { x: number; z: number }) {
    if (p.errand || p.state === "sleeping" || p.state === "alert") return;
    p.group.updateMatrixWorld(true);
    const here = p.group.position;
    let wx: number;
    let wz: number;
    let lookAt: THREE.Vector3;
    if (to) {
      wx = to.x;
      wz = to.z;
      lookAt = new THREE.Vector3(0, 0, 0);
    } else if (host) {
      host.group.updateMatrixWorld(true);
      const g = host.group.localToWorld(new THREE.Vector3(0, 0, host.fd + 1.1)); // just outside the host's open front
      wx = g.x;
      wz = g.z;
      lookAt = new THREE.Vector3(host.group.position.x, 0, host.group.position.z);
    } else {
      const d = new THREE.Vector3(here.x, 0, here.z).normalize();
      wx = d.x * 3.7;
      wz = d.z * 3.7;
      lookAt = new THREE.Vector3(0, 0, 0);
    }
    const hl = p.group.worldToLocal(lookAt.clone());
    const l = p.group.worldToLocal(new THREE.Vector3(wx, 0, wz));
    const face = Math.atan2(hl.x - l.x, hl.z - l.z);
    p.errand = { x: l.x, z: l.z, face, host };
    p.arrived = false;
    if (note) {
      p.note = note;
      this.drawPanel(p, p.agent);
    }
  }

  private endErrand(p: Pod) {
    p.errand = null;
    if (p.note) {
      p.note = null;
      this.drawPanel(p, p.agent);
    }
  }

  /** The tool each agent carries bobs, spins or swings; it works harder when the agent is busy. */
  private moveProp(p: Pod, s: AgentState, t: number, dt: number) {
    const pr = p.prop;
    const spin = pr.userData.spin as THREE.Object3D;
    const busy = s === "working" ? 1 : s === "alert" ? 1.6 : s === "sleeping" ? 0.1 : 0.35;
    pr.position.y = 2.55 + Math.sin(t * 1.3 + p.phase) * 0.09;
    switch (pr.userData.kind) {
      case "tick":
        spin.rotation.z -= dt * (s === "working" ? 3 : 0.5) * busy;
        break;
      case "spin":
        spin.rotation.y += dt * 2 * busy;
        break;
      case "swing":
        spin.rotation.z = Math.sin(t * (s === "alert" ? 10 : 2.2) + p.phase) * (s === "alert" ? 0.55 : 0.12);
        break;
      case "hammer":
        spin.rotation.z = -0.5 + Math.sin(t * (s === "working" ? 6 : 1.4)) * (s === "working" ? 0.55 : 0.1);
        break;
      default:
        pr.rotation.y = Math.sin(t * 0.6 + p.phase) * 0.5;
    }
  }

  private drawPanel(p: Pod, a: CrewAgent) {
    const g = p.ctx;
    const W = 640;
    const H = 200;
    const accent = HEX[a.state];
    g.clearRect(0, 0, W, H);
    // a compact dark-glass speech pill: icon tile, name, one line of status, a status dot
    g.save();
    g.shadowColor = "rgba(0,0,0,0.5)";
    g.shadowBlur = 18;
    g.fillStyle = "rgba(34,30,50,0.86)";
    g.beginPath();
    g.roundRect(10, 8, W - 20, 152, 34);
    g.fill();
    g.restore();
    g.lineWidth = 2;
    g.strokeStyle = "rgba(255,255,255,0.16)";
    g.beginPath();
    g.roundRect(10, 8, W - 20, 152, 34);
    g.stroke();
    // little tail pointing down at the robot
    g.fillStyle = "rgba(34,30,50,0.86)";
    g.beginPath();
    g.moveTo(W / 2 - 16, 158);
    g.lineTo(W / 2, 190);
    g.lineTo(W / 2 + 16, 158);
    g.fill();
    // icon tile
    const tile = g.createLinearGradient(30, 30, 130, 130);
    tile.addColorStop(0, "#8b5cf6");
    tile.addColorStop(1, "#6d28d9");
    g.fillStyle = tile;
    g.beginPath();
    g.roundRect(30, 32, 100, 100, 26);
    g.fill();
    g.fillStyle = "#ffffff";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.font = "600 56px system-ui, 'Segoe UI Emoji', sans-serif";
    g.fillText(GLYPH[a.id], 80, 84);
    g.textAlign = "left";
    g.textBaseline = "alphabetic";
    g.fillStyle = "#ffffff";
    g.font = "600 46px system-ui, 'Segoe UI', sans-serif";
    g.fillText(a.name, 152, 78);
    g.fillStyle = "rgba(255,255,255,0.68)";
    g.font = "400 28px system-ui, 'Segoe UI', sans-serif";
    g.fillText(wrap(g, p.note ?? a.line, W - 152 - 70, 1)[0] ?? "", 152, 120);
    g.fillStyle = accent;
    g.beginPath();
    g.arc(W - 48, 50, 11, 0, Math.PI * 2);
    g.fill();
    p.tex.needsUpdate = true;
  }

  select(id: CrewId | null) {
    this.selected = id;
    this.idleSince = performance.now();
    if (!id) {
      this.tTarget.copy(HOME_TARGET);
      this.tDist = this.homeDist();
      this.tPhi = this.portrait ? 0.92 : 1.12;
      return;
    }
    const p = this.pods.find((x) => x.id === id);
    if (!p) return;
    p.burst = 1;
    this.tTarget.set(p.pos.x * 0.92, 2.45, p.pos.z * 0.92);
    this.tDist = this.portrait ? 11 : 7.6;
    this.tPhi = 1.38;
    // view the pod from the inner side, a little off to one side, so screens face us and the core stays out of shot
    const want = Math.atan2(-p.pos.x, -p.pos.z) + (p.pos.x >= 0 ? -0.95 : 0.95);
    const d = ((want - this.theta + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    this.tTheta = this.theta + d;
  }

  /** Robots never walk through each other: a walker is nudged aside from anyone within arm's reach. */
  private separate(dt: number) {
    const va = this.sepA;
    const vb = this.sepB;
    for (let i = 0; i < this.pods.length; i++) {
      for (let j = i + 1; j < this.pods.length; j++) {
        const a = this.pods[i];
        const b = this.pods[j];
        if (a.walk === 0 && b.walk === 0) continue;
        a.group.localToWorld(va.set(a.at.x, 0, a.at.z));
        b.group.localToWorld(vb.set(b.at.x, 0, b.at.z));
        const dx = va.x - vb.x;
        const dz = va.z - vb.z;
        const d = Math.hypot(dx, dz);
        const min = 1.25;
        if (d >= min || d < 0.001) continue;
        const push = (min - d) * Math.min(1, 6 * dt);
        const mover = a.walk > 0 && b.walk > 0 ? 0.5 : 1;
        const move = (p: Pod, wx: number, wz: number, k: number) => {
          const ry = p.group.rotation.y;
          const c = Math.cos(ry);
          const sn = Math.sin(ry);
          p.at.x += (wx * c - wz * sn) * k;
          p.at.z += (wx * sn + wz * c) * k;
        };
        if (a.walk > 0) move(a, dx / d, dz / d, push * mover);
        if (b.walk > 0) move(b, -dx / d, -dz / d, push * mover);
      }
    }
  }

  private homeDist() {
    return this.portrait ? 31 : 25;
  }

  // ---------- input ----------
  private bind() {
    const c = this.canvas;
    const on = (el: HTMLElement | Window, ev: string, fn: (e: never) => void, opt?: AddEventListenerOptions) => {
      el.addEventListener(ev, fn as EventListener, opt);
      this.cleanup.push(() => el.removeEventListener(ev, fn as EventListener));
    };
    on(c, "pointerdown", (e: PointerEvent) => {
      c.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.idleSince = performance.now();
      if (this.pointers.size === 1) this.down = { x: e.clientX, y: e.clientY, t: performance.now(), moved: 0 };
      if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        this.pinch = Math.hypot(a.x - b.x, a.y - b.y);
        this.down = null;
      }
      c.style.cursor = "grabbing";
    });
    on(c, "pointermove", (e: PointerEvent) => {
      const prev = this.pointers.get(e.pointerId);
      if (!prev) {
        this.pick(e, true);
        return;
      }
      const dx = e.clientX - prev.x;
      const dy = e.clientY - prev.y;
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.idleSince = performance.now();
      if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (this.pinch > 0) this.tDist = THREE.MathUtils.clamp(this.tDist * (this.pinch / d), 6, 46);
        this.pinch = d;
        return;
      }
      if (this.down) this.down.moved += Math.abs(dx) + Math.abs(dy);
      this.tTheta -= dx * 0.0055;
      this.tPhi = THREE.MathUtils.clamp(this.tPhi - dy * 0.0045, 0.62, 1.48);
    });
    const up = (e: PointerEvent) => {
      const d = this.down;
      this.pointers.delete(e.pointerId);
      this.pinch = 0;
      c.style.cursor = this.hover ? "pointer" : "grab";
      if (d && this.pointers.size === 0 && d.moved < 8 && performance.now() - d.t < 500) {
        const id = this.pick(e, false);
        if (id) this.hooks.onSelect(id);
        else if (this.selected) this.hooks.onSelect(null);
      }
      this.down = null;
    };
    on(c, "pointerup", up);
    on(c, "pointercancel", up);
    on(c, "wheel", (e: WheelEvent) => {
      e.preventDefault();
      this.idleSince = performance.now();
      this.tDist = THREE.MathUtils.clamp(this.tDist * Math.exp(e.deltaY * 0.0012), 6, 46);
    }, { passive: false });
  }

  private pick(e: PointerEvent, hoverOnly: boolean): CrewId | null {
    const r = this.canvas.getBoundingClientRect();
    this.ptr.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(this.ptr, this.camera);
    const hit = this.ray.intersectObjects(this.hit, false)[0];
    const id = (hit?.object.userData.id as CrewId | undefined) ?? null;
    if (hoverOnly) {
      if (id !== this.hover) {
        this.hover = id;
        this.canvas.style.cursor = id ? "pointer" : "grab";
        if (!id) this.hooks.onHover(null, e.clientX, e.clientY);
      }
      if (id) this.hooks.onHover(id, e.clientX, e.clientY);
    }
    return id;
  }

  // ---------- loop ----------
  private resize() {
    const r = this.canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width));
    const h = Math.max(1, Math.round(r.height));
    if (w === this.w && h === this.h) return;
    this.w = w;
    this.h = h;
    this.portrait = h > w * 1.1;
    this.renderer.setSize(w, h, false);
    this.composer?.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.fov = this.portrait ? 58 : 42;
    this.camera.updateProjectionMatrix();
    if (!this.selected) {
      this.tDist = this.homeDist();
      this.tPhi = this.portrait ? 0.92 : 1.12;
    }
  }

  private frame() {
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    const t = (now - this.t0) / 1000;
    const ease = 1 - Math.pow(t < 3.5 ? 0.12 : 0.0015, dt);

    // camera: glide to the target view, with a slow sway when left alone
    const idle = !this.selected && !this.pointers.size && now - this.idleSince > 3500;
    const sway = idle ? Math.sin(t * 0.14) * 0.22 : 0;
    this.theta += (this.tTheta - this.theta) * ease;
    this.phi += (this.tPhi - this.phi) * ease;
    this.dist += (this.tDist - this.dist) * ease;
    // a picked robot is followed wherever it walks
    if (this.selected) {
      const sp = this.pods.find((x) => x.id === this.selected);
      if (sp) {
        sp.rig.root.getWorldPosition(this.follow);
        this.tTarget.set(this.follow.x, 2.3, this.follow.z);
      }
    }
    this.target.lerp(this.tTarget, ease);
    const th = this.theta + sway;
    const sp = Math.sin(this.phi);
    this.camera.position.set(this.target.x + this.dist * sp * Math.sin(th), this.target.y + this.dist * Math.cos(this.phi), this.target.z + this.dist * sp * Math.cos(th));
    this.camera.lookAt(this.target);

    this.sweep.rotation.y -= dt * 0.32;
    this.sweepMat.opacity += ((this.selected ? 0 : 1) - this.sweepMat.opacity) * (1 - Math.pow(0.02, dt));

    // core
    const cg = this.coreGroup;
    const orb = cg.userData.orb as THREE.Mesh;
    const cage = cg.userData.cage as THREE.Mesh;
    cage.rotation.y = t * 0.3;
    cage.rotation.x = t * 0.17;
    orb.rotation.y = t * 0.22;
    (cg.userData.coreMat as THREE.MeshStandardMaterial).emissiveIntensity = 1.0 + Math.sin(t * 1.6) * 0.18;
    this.gyros.forEach((m, i) => {
      m.rotation.y = t * m.userData.speed * (i % 2 ? -1 : 1);
    });

    // pods
    this.separate(dt);
    const cam = this.camera.position;
    for (const p of this.pods) {
      p.col.lerp(p.tgt, 1 - Math.pow(0.02, dt));
      // each station pops in, one after another, with a little overshoot
      const inT = THREE.MathUtils.clamp((now - p.born) / 800, 0, 1);
      const back = 1 + 2.70158 * Math.pow(inT - 1, 3) + 1.70158 * Math.pow(inT - 1, 2);
      p.group.scale.setScalar((inT <= 0 ? 0.001 : Math.max(0.001, back)) * (this.portrait ? 0.78 : 1));
      p.group.visible = inT > 0;
      p.hv += ((this.hover === p.id ? 1 : 0) - p.hv) * (1 - Math.pow(0.002, dt));
      const s = p.state;
      const isSel = this.selected === p.id;
      const pulse = Math.sin(t * (s === "alert" ? 7 : s === "working" ? 3.2 : 1.1) + p.phase);
      p.halo.rotation.z += dt * (s === "working" ? 3 : s === "alert" ? 2 : 0.6);
      p.halo.position.y = ROBOT_H + 0.75 + Math.sin(t * 1.4 + p.phase) * 0.06;
      p.rig.glow.emissive.copy(p.col);
      p.rig.holo.color.copy(p.col);
      p.rig.glow.emissiveIntensity = s === "sleeping" ? 0.15 : s === "alert" ? (pulse > 0 ? 3 : 0.6) : s === "working" ? 2.6 : 1.6;
      this.behave(p, dt);

      // where is the viewer, from the robot's point of view?
      const local = p.rig.root.worldToLocal(this.tmp.copy(this.camera.position));
      const look = THREE.MathUtils.clamp(Math.atan2(local.x, local.z), -1.1, 1.1);
      p.rig.pose(p.state, t, dt, p.phase, look, this.hover === p.id, p.cele > 0, p.act, p.walk);
      p.station.update(t, dt, p.act, p.state === "working");
      this.moveProp(p, s, t, dt);
      p.haloMat.color.copy(p.col);
      p.haloMat.opacity = s === "sleeping" ? 0.35 : s === "alert" ? (pulse > 0 ? 1 : 0.35) : 0.9;
      p.ringMat.emissive.copy(p.col);
      p.ringMat.emissiveIntensity = (s === "sleeping" ? 0.5 : 2.2) + (isSel ? 2 : 0) + (this.hover === p.id ? 1 : 0);
      p.glowMat.color.copy(p.col);
      p.glowMat.opacity = (s === "sleeping" ? 0.1 : s === "alert" ? 0.7 : 0.42) * (0.85 + pulse * 0.15);
      p.beamMat.color.copy(p.col);
      p.beamMat.opacity = s === "sleeping" ? 0.08 : s === "working" ? 0.5 : 0.28;
      p.packetMat.color.copy(p.col);

      p.burst = Math.max(0, p.burst - dt * 0.9);
      p.cele = Math.max(0, p.cele - dt / 2.8);
      if (s === "alert") {
        const k = (t * 0.7 + p.phase) % 1;
        p.ripple.scale.setScalar(1 + k * 3.2);
        p.rippleMat.opacity = (1 - k) * 0.7;
        p.rippleMat.color.copy(p.col);
      } else if (p.burst > 0) {
        p.ripple.scale.setScalar(1 + (1 - p.burst) * 3.4);
        p.rippleMat.opacity = p.burst * 0.8;
        p.rippleMat.color.copy(p.col);
      } else p.rippleMat.opacity = 0;

      p.packets.forEach((m, i) => {
        m.visible = s === "working";
        if (!m.visible) return;
        const k = (t * 0.45 + i / p.packets.length + p.phase * 0.1) % 1;
        m.position.copy(p.curve.getPoint(k));
        m.scale.setScalar(0.7 + Math.sin(k * Math.PI) * 0.6);
      });

      // label always faces the viewer, upright
      p.panel.quaternion.copy(p.group.quaternion).invert().multiply(this.camera.quaternion);
      p.panel.position.y = PANEL_Y + p.lift + (isSel ? 0.1 : 0) + Math.sin(t * 0.9 + p.phase) * 0.05;
      const pm = p.panel.material as THREE.MeshBasicMaterial;
      pm.opacity += ((this.selected && !isSel ? 0.1 : 1) - pm.opacity) * (1 - Math.pow(0.01, dt));
      const d = cam.distanceTo(p.group.position);
      p.panel.scale.setScalar(THREE.MathUtils.clamp(d / 22, 0.5, 1.1) * (1 + 0.12 * p.hv) * (this.portrait ? 1.15 : 1));
    }

    if (this.sky) this.sky.rotation.y += dt * 0.004;
    const arr = this.dust.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < arr.count; i++) {
      let y = arr.getY(i) + dt * 0.12;
      if (y > 12) y = 0;
      arr.setY(i, y);
    }
    arr.needsUpdate = true;

    // watch the frame time; if it stays slow, shed the expensive extras one at a time
    this.ema += ((now - this.lastFrame) / 1000 - this.ema) * 0.05;
    this.lastFrame = now;
    if (now - this.since > 2500 && this.ema > 0.034 && this.level < 3) {
      this.level++;
      this.since = now;
      if (this.level === 1) {
        this.composer?.dispose();
        this.composer = null;
      } else if (this.level === 2) {
        this.renderer.setPixelRatio(1);
        this.renderer.setSize(this.w, this.h, false);
      } else {
        this.dust.visible = false;
        this.scene.fog = null;
      }
    }
    if (this.composer) this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.dead = true;
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.cleanup.forEach((f) => f());
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
    });
    this.disposables.forEach((d) => d.dispose());
    this.composer?.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}
