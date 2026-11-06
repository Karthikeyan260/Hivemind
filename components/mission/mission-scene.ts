import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { buildRobot, RIG_HEIGHT, type Rig } from "./robot";
import type { AgentState, CrewAgent, CrewId } from "@/lib/mission";

/**
 * Mission Control: a physically lit command deck. Each background agent is a detailed humanoid robot
 * (built in code, see robot.ts) standing on its own plinth around the HIVE core. PBR metals, an image-based environment, soft shadows and bloom (desktop).
 * Phones skip shadows and bloom to stay smooth.
 */

const HEX: Record<AgentState, string> = { working: "#34d399", idle: "#38bdf8", sleeping: "#64748b", alert: "#f43f5e" };
const WORD: Record<AgentState, string> = { working: "WORKING", idle: "READY", sleeping: "ASLEEP", alert: "NEEDS YOU" };
const ROBOT_H = 3.1; // height of a robot in world units
const ROBOT_SCALE = ROBOT_H / RIG_HEIGHT;
const R = 8.6; // pod ring radius
const SPAN = Math.PI * 1.2; // arc the pods sit on, open toward the camera
const HOME_TARGET = new THREE.Vector3(0, 2.6, 0);
const PANEL_Y = 6.5;
// Each agent has its own paint, so the crew reads as individuals; the mood shows in the visor, halo and floor light.
const PAINT: Record<CrewId, string> = { scheduler: "#f59e0b", autopilot: "#38bdf8", web: "#a78bfa", dream: "#6366f1", brief: "#2dd4bf", reminders: "#f472b6", apps: "#fb923c" };

type Pod = {
  id: CrewId;
  pos: THREE.Vector3;
  group: THREE.Group;
  rig: Rig;
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
  burst: number;
  hv: number;
};

export type MissionHooks = { onSelect: (id: CrewId | null) => void; onHover: (id: CrewId | null) => void };

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

function isSelNow(sel: CrewId | null, id: CrewId) {
  return sel === id;
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
  private camera = new THREE.PerspectiveCamera(42, 1, 0.1, 140);
  private pods: Pod[] = [];
  private hit: THREE.Object3D[] = [];
  private disposables: Array<{ dispose(): void }> = [];
  private dead = false;
  private coreGroup = new THREE.Group();
  private sweep = new THREE.Group();
  private gyros: THREE.Mesh[] = [];
  private dust!: THREE.Points;
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
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.mobile ? 1.5 : 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    if (!this.mobile) {
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    }

    const scene = this.scene;
    scene.background = new THREE.Color("#04060d");
    scene.fog = new THREE.Fog("#04060d", 30, 70);
    const pmrem = new THREE.PMREMGenerator(renderer);
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04);
    scene.environment = env.texture;
    scene.environmentIntensity = 0.7;
    this.disposables.push(pmrem, env);

    this.buildLights();
    this.buildFloor();
    this.buildCore();
    this.buildDust();

    if (!this.mobile) {
      const composer = new EffectComposer(renderer);
      composer.addPass(new RenderPass(scene, this.camera));
      composer.addPass(new UnrealBloomPass(new THREE.Vector2(256, 256), 0.35, 0.5, 1.0));
      composer.addPass(new OutputPass());
      this.composer = composer;
    }

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
    s.add(new THREE.HemisphereLight("#8e9cff", "#080a14", 0.7));
    const key = new THREE.DirectionalLight("#cfdcff", 2.1);
    key.position.set(7, 16, 13);
    if (!this.mobile) {
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
    const rim = new THREE.DirectionalLight("#7c6cff", 1.1);
    rim.position.set(-12, 8, -14);
    s.add(rim);
    const core = new THREE.PointLight("#818cf8", 45, 22, 2);
    core.position.set(0, 3.2, 0);
    s.add(core);
  }

  private buildFloor() {
    const floorMat = new THREE.MeshPhysicalMaterial({ color: "#0a0f1c", metalness: 0.7, roughness: 0.5, clearcoat: 0.05, clearcoatRoughness: 0.6, envMapIntensity: 0.12 });
    const floor = new THREE.Mesh(new THREE.CircleGeometry(60, 96), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);

    const ft = floorTexture();
    const decal = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshBasicMaterial({ map: ft, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    decal.rotation.x = -Math.PI / 2;
    decal.position.y = 0.012;
    this.scene.add(decal);
    const sc = document.createElement("canvas");
    sc.width = sc.height = 512;
    const sg = sc.getContext("2d")!;
    const cone = sg.createConicGradient(0, 256, 256);
    cone.addColorStop(0, "rgba(140,170,255,0)");
    cone.addColorStop(0.17, "rgba(140,170,255,0.2)");
    cone.addColorStop(0.175, "rgba(140,170,255,0)");
    cone.addColorStop(1, "rgba(140,170,255,0)");
    sg.fillStyle = cone;
    sg.beginPath();
    sg.arc(256, 256, 254, 0, Math.PI * 2);
    sg.fill();
    const swTex = new THREE.CanvasTexture(sc);
    swTex.colorSpace = THREE.SRGBColorSpace;
    const swMat = new THREE.MeshBasicMaterial({ map: swTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    const swMesh = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), swMat);
    swMesh.rotation.x = -Math.PI / 2;
    swMesh.position.y = 0.02;
    this.sweep.add(swMesh);
    this.scene.add(this.sweep);
    this.disposables.push(floorMat, floor.geometry, ft, decal.geometry, decal.material as THREE.Material, swTex, swMat);
  }

  private buildCore() {
    const g = this.coreGroup;
    const metal = new THREE.MeshStandardMaterial({ color: "#1b2236", metalness: 0.9, roughness: 0.3 });
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

    const coreMat = new THREE.MeshStandardMaterial({ color: "#0b1020", emissive: glowCol, emissiveIntensity: 3, roughness: 0.2, metalness: 0.2 });
    const orb = new THREE.Mesh(new THREE.SphereGeometry(0.62, 48, 32), coreMat);
    orb.position.y = 3.1;
    const cage = new THREE.Mesh(new THREE.IcosahedronGeometry(1.15, 1), new THREE.MeshBasicMaterial({ color: "#a5b4fc", wireframe: true, transparent: true, opacity: 0.55, toneMapped: false }));
    cage.position.y = 3.1;
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(9, 9), new THREE.MeshBasicMaterial({ map: radialTexture([[0, "rgba(129,140,248,0.4)"], [0.4, "rgba(99,102,241,0.1)"], [1, "rgba(99,102,241,0)"]]), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    glow.rotation.x = -Math.PI / 2;
    glow.position.y = 0.04;

    const gyroMat = new THREE.MeshStandardMaterial({ color: "#2a3350", metalness: 1, roughness: 0.25, emissive: "#4f46e5", emissiveIntensity: 0.5 });
    for (const [r, tilt] of [[1.55, 0], [1.9, Math.PI / 3], [2.25, -Math.PI / 3]] as const) {
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
    const ang = (n === 1 ? 0 : i / (n - 1) - 0.5) * SPAN;
    const pos = new THREE.Vector3(Math.sin(ang) * R, 0, -Math.cos(ang) * R);
    const group = new THREE.Group();
    group.position.copy(pos);
    const col = new THREE.Color(HEX[a.state]);

    const metal = new THREE.MeshStandardMaterial({ color: "#1a2133", metalness: 0.92, roughness: 0.32 });
    const ringMat = new THREE.MeshStandardMaterial({ color: "#0b1020", emissive: col, emissiveIntensity: 2.2, roughness: 0.4 });
    const plinth = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.75, 0.4, 56), metal);
    plinth.position.y = 0.2;
    plinth.castShadow = plinth.receiveShadow = true;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.5, 0.05, 12, 80), ringMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.42;

    // the robot itself: built in code, scaled to a fixed height, standing on the plinth
    const rig = buildRobot(PAINT[a.id], col, a.name);
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
    const ripple = new THREE.Mesh(new THREE.RingGeometry(1.8, 1.95, 64), rippleMat);
    ripple.rotation.x = -Math.PI / 2;
    ripple.position.y = 0.05;

    // hologram label (billboarded each frame)
    const cv = document.createElement("canvas");
    cv.width = 640;
    cv.height = 360;
    const ctx = cv.getContext("2d")!;
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 1.91), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false }));
    panel.position.y = PANEL_Y;
    panel.renderOrder = 5;

    // click target: a generous invisible column
    const hit = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 1.8, 6, 16), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
    hit.position.y = 3;
    hit.userData.id = a.id;
    this.hit.push(hit);

    const prop = makeProp(a.id, col, this.disposables);
    prop.position.set(1.75, 2.55, 0.15);
    const shadowTex = radialTexture([[0, "rgba(0,0,0,0.6)"], [0.6, "rgba(0,0,0,0.25)"], [1, "rgba(0,0,0,0)"]]);
    const blob = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 2.6), new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }));
    blob.rotation.x = -Math.PI / 2;
    blob.position.y = 0.415;
    this.disposables.push(shadowTex, blob.material as THREE.Material);
    group.add(plinth, ring, blob, halo, glow, ripple, panel, hit, prop);
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

    return { id: a.id, pos, group, rig, halo, haloMat, prop, ringMat, glowMat, rippleMat, ripple, beamMat, packetMat, curve, packets, panel, tex, ctx, key: "", state: a.state, col, tgt: col.clone(), phase: i * 1.3, born: performance.now() + 250 + i * 130, burst: 0, hv: 0 };
  }

  // ---------- data ----------
  setCrew(crew: CrewAgent[]) {
    if (this.pods.length === 0) crew.forEach((a, i) => this.pods.push(this.buildPod(a, i, crew.length)));
    for (const a of crew) {
      const p = this.pods.find((x) => x.id === a.id);
      if (!p) continue;
      if (p.key && p.state !== a.state) p.burst = 1; // a ring of light when a mood changes
      p.state = a.state;
      p.tgt.set(HEX[a.state]);
      const key = `${a.state}|${a.name}|${a.role}|${a.line}`;
      if (key !== p.key) {
        p.key = key;
        this.drawPanel(p, a);
      }
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
    const H = 360;
    const accent = HEX[a.state];
    g.clearRect(0, 0, W, H);
    const bg = g.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, "rgba(14,22,46,0.88)");
    bg.addColorStop(1, "rgba(6,10,24,0.78)");
    g.fillStyle = bg;
    g.beginPath();
    g.roundRect(6, 6, W - 12, H - 12, 26);
    g.fill();
    g.lineWidth = 3;
    g.strokeStyle = accent;
    g.globalAlpha = 0.85;
    g.stroke();
    g.globalAlpha = 1;
    g.fillStyle = accent;
    g.beginPath();
    g.roundRect(34, 40, 8, 56, 4);
    g.fill();
    g.fillStyle = "rgba(160,190,255,0.035)";
    for (let y = 14; y < H - 14; y += 6) g.fillRect(14, y, W - 28, 2);

    g.textBaseline = "alphabetic";
    g.fillStyle = "#ffffff";
    g.font = "600 56px Georgia, 'Times New Roman', serif";
    g.fillText(a.name, 58, 82);
    g.fillStyle = "rgba(255,255,255,0.58)";
    g.font = "400 25px system-ui, sans-serif";
    g.fillText(a.role, 58, 118);

    g.font = "600 22px ui-monospace, Consolas, monospace";
    const word = WORD[a.state];
    const cw = g.measureText(word).width + 52;
    g.fillStyle = accent;
    g.globalAlpha = 0.18;
    g.beginPath();
    g.roundRect(W - 34 - cw, 40, cw, 40, 20);
    g.fill();
    g.globalAlpha = 1;
    g.fillStyle = accent;
    g.beginPath();
    g.arc(W - 34 - cw + 22, 60, 6, 0, Math.PI * 2);
    g.fill();
    g.fillText(word, W - 34 - cw + 38, 68);

    g.strokeStyle = "rgba(255,255,255,0.12)";
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(34, 142);
    g.lineTo(W - 34, 142);
    g.stroke();

    g.fillStyle = "rgba(255,255,255,0.92)";
    g.font = "400 31px system-ui, sans-serif";
    const lines = wrap(g, a.line, W - 80, 3);
    lines.forEach((l, i) => g.fillText(l, 36, 192 + i * 44));
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
    // view the robot from outside the ring (it turns round to face us), so the core stays behind it
    const want = Math.atan2(p.pos.x, p.pos.z);
    const d = ((want - this.theta + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    this.tTheta = this.theta + d;
  }

  private homeDist() {
    return this.portrait ? 43 : 25;
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
    if (hoverOnly && id !== this.hover) {
      this.hover = id;
      this.canvas.style.cursor = id ? "pointer" : "grab";
      this.hooks.onHover(id);
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
    this.target.lerp(this.tTarget, ease);
    const th = this.theta + sway;
    const sp = Math.sin(this.phi);
    this.camera.position.set(this.target.x + this.dist * sp * Math.sin(th), this.target.y + this.dist * Math.cos(this.phi), this.target.z + this.dist * sp * Math.cos(th));
    this.camera.lookAt(this.target);

    this.sweep.rotation.y -= dt * 0.32;

    // core
    const cg = this.coreGroup;
    const orb = cg.userData.orb as THREE.Mesh;
    const cage = cg.userData.cage as THREE.Mesh;
    cage.rotation.y = t * 0.3;
    cage.rotation.x = t * 0.17;
    orb.scale.setScalar(1 + Math.sin(t * 1.6) * 0.04);
    (cg.userData.coreMat as THREE.MeshStandardMaterial).emissiveIntensity = 2.6 + Math.sin(t * 1.6) * 0.5;
    this.gyros.forEach((m, i) => {
      m.rotation.y = t * m.userData.speed * (i % 2 ? -1 : 1);
    });

    // pods
    const cam = this.camera.position;
    for (const p of this.pods) {
      p.col.lerp(p.tgt, 1 - Math.pow(0.02, dt));
      // each station pops in, one after another, with a little overshoot
      const inT = THREE.MathUtils.clamp((now - p.born) / 800, 0, 1);
      const back = 1 + 2.70158 * Math.pow(inT - 1, 3) + 1.70158 * Math.pow(inT - 1, 2);
      p.group.scale.setScalar(inT <= 0 ? 0.001 : Math.max(0.001, back));
      p.group.visible = inT > 0;
      p.hv += ((this.hover === p.id ? 1 : 0) - p.hv) * (1 - Math.pow(0.002, dt));
      p.rig.root.rotation.y += ((isSelNow(this.selected, p.id) ? Math.PI : 0) - p.rig.root.rotation.y) * (1 - Math.pow(0.02, dt));
      const s = p.state;
      const isSel = this.selected === p.id;
      const pulse = Math.sin(t * (s === "alert" ? 7 : s === "working" ? 3.2 : 1.1) + p.phase);
      p.halo.rotation.z += dt * (s === "working" ? 3 : s === "alert" ? 2 : 0.6);
      p.halo.position.y = ROBOT_H + 0.75 + Math.sin(t * 1.4 + p.phase) * 0.06;
      p.rig.glow.emissive.copy(p.col);
      p.rig.holo.color.copy(p.col);
      p.rig.glow.emissiveIntensity = s === "sleeping" ? 0.15 : s === "alert" ? (pulse > 0 ? 3 : 0.6) : s === "working" ? 2.6 : 1.6;
      // where is the viewer, from the robot's point of view?
      const local = p.rig.root.worldToLocal(this.camera.position.clone());
      const look = THREE.MathUtils.clamp(Math.atan2(local.x, local.z), -1.1, 1.1);
      p.rig.pose(p.state, t, dt, p.phase, look, this.hover === p.id);
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
      p.panel.position.y = PANEL_Y + (isSel ? 0.1 : 0) + Math.sin(t * 0.9 + p.phase) * 0.05;
      const pm = p.panel.material as THREE.MeshBasicMaterial;
      pm.opacity += ((this.selected && !isSel ? 0.1 : 1) - pm.opacity) * (1 - Math.pow(0.01, dt));
      const d = cam.distanceTo(p.group.position);
      p.panel.scale.setScalar(THREE.MathUtils.clamp(d / 22, 0.5, 1.1) * (1 + 0.12 * p.hv));
    }

    const arr = this.dust.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < arr.count; i++) {
      let y = arr.getY(i) + dt * 0.12;
      if (y > 12) y = 0;
      arr.setY(i, y);
    }
    arr.needsUpdate = true;

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
