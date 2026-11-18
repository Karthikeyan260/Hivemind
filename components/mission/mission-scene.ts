import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { RGBELoader } from "three/addons/loaders/RGBELoader.js";
import { N8AOPass } from "n8ao";
import { placeModel, surface } from "./assets";
import { buildRobot, RIG_HEIGHT, type Act, type Rig } from "./robot";
import { buildStation, HOME, type Station, type Stop } from "./stations";
import type { AgentState, CrewAgent, CrewId } from "@/lib/mission";

/**
 * Mission Control: a physically lit command deck. Each background agent is a detailed humanoid robot
 * (built in code, see robot.ts) standing on its own plinth around the HIVE core. PBR metals, an image-based environment, soft shadows and bloom (desktop).
 * Phones skip shadows and bloom to stay smooth.
 */

const HEX: Record<AgentState, string> = { working: "#34d399", idle: "#38bdf8", sleeping: "#64748b", alert: "#f43f5e" };
const ROBOT_H = 1.8; // a robot stands 1.8 m, next to 0.75 m desks (the hall is built in metres)
const ROBOT_SCALE = ROBOT_H / RIG_HEIGHT;
const R = 8.6; // pod ring radius
// Where each area sits on the deck (the core is at 0,0; the camera looks from +z). Four along the back facing the core,
// three along the front facing the camera, so the hall reads as working places all around the K emblem.
const PLACE: Record<string, { x: number; z: number; front?: boolean }> = {
  scheduler: { x: -12, z: -5 },
  autopilot: { x: -6.2, z: -10.5 },
  web: { x: 6.2, z: -10.5 },
  dream: { x: 12, z: -5 },
  brief: { x: -9.5, z: 7, front: true },
  reminders: { x: 6, z: 9, front: true },
  apps: { x: 12, z: 5, front: true },
};
const PORTRAIT_SHRINK = 0.62; // tall, narrow screens: the same layout, closer together
/** The way an area faces: front-row areas face the camera, the rest face the core. */
const faceDir = (pos: THREE.Vector3, front: boolean) => (front ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(-pos.x, 0, -pos.z).normalize());
const HOME_TARGET = new THREE.Vector3(0, 1.3, 0); // eye level, the middle of the floor
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
const STATE_WORD: Record<string, string> = { working: "WORKING", idle: "READY", sleeping: "ASLEEP", alert: "NEEDS YOU" };
const ALERT_STOP: Stop = { x: 0, z: 1.0, face: 0, act: "none", dwell: 99 };
// Each agent has its own paint, so the crew reads as individuals; the mood shows in the visor, halo and floor light.
const PAINT: Record<CrewId, string> = { scheduler: "#c8913a", autopilot: "#5f8fa8", web: "#8486b3", dream: "#6a74a0", brief: "#4f9a8c", reminders: "#b0645a", apps: "#c97a3d" }; // muted industrial paints

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
  /** Reached its door on the way in or out: walk straight through. */
  gated: boolean;
  /** The planned route across the floor (world points), and the goal it was planned for. */
  path: THREE.Vector3[] | null;
  pathGoal: THREE.Vector3 | null;
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

/** A glowing name plate for a workplace: the agent's name in its own colour on a dark panel with a lit edge. */
function nameSign(name: string, colour: string, track: Array<{ dispose(): void }>) {
  const cv = document.createElement("canvas");
  cv.width = 640;
  cv.height = 140;
  const g = cv.getContext("2d")!;
  g.fillStyle = "rgba(10,10,22,0.88)";
  g.beginPath();
  g.roundRect(6, 6, 628, 128, 18);
  g.fill();
  g.strokeStyle = colour;
  g.lineWidth = 5;
  g.stroke();
  g.font = "700 64px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.shadowColor = colour;
  g.shadowBlur = 22;
  g.fillStyle = colour;
  const text = name.toUpperCase().split("").join(String.fromCharCode(8202)); // hair spaces: a little letter-spacing
  g.fillText(text, 320, 74, 590);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2.3, 0.5), mat);
  track.push(tex, mat, mesh.geometry);
  return mesh;
}

/** Does the segment (x0,z0)→(x1,z1) pass through the box |x| < hx, |z| < hz? (Liang–Barsky clipping.) */
function segHitsBox(x0: number, z0: number, x1: number, z1: number, hx: number, hz: number) {
  let t0 = 0;
  let t1 = 1;
  const dx = x1 - x0;
  const dz = z1 - z0;
  for (const [p, q] of [[-dx, x0 + hx], [dx, hx - x0], [-dz, z0 + hz], [dz, hz - z0]]) {
    if (p === 0) {
      if (q < 0) return false;
    } else {
      const r = q / p;
      if (p < 0) t0 = Math.max(t0, r);
      else t1 = Math.min(t1, r);
      if (t0 > t1) return false;
    }
  }
  return true;
}

/** Does the segment (x0,z0)→(x1,z1) come within r of the origin? */
function segHitsCircle(x0: number, z0: number, x1: number, z1: number, r: number) {
  const dx = x1 - x0;
  const dz = z1 - z0;
  const len2 = dx * dx + dz * dz;
  const t = len2 ? Math.max(0, Math.min(1, -(x0 * dx + z0 * dz) / len2)) : 0;
  return Math.hypot(x0 + dx * t, z0 + dz * t) < r;
}

/** Polished concrete: mottled grey with wear, a few stains and saw-cut joints every few metres. */
function concreteTexture() {
  const S = 1024;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const g = c.getContext("2d")!;
  g.fillStyle = "#9a958e";
  g.fillRect(0, 0, S, S);
  let seed = 11;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 900; i++) {
    const x = rnd() * S;
    const y = rnd() * S;
    const r = 6 + rnd() * 60;
    const v = 120 + rnd() * 50;
    const rg = g.createRadialGradient(x, y, 0, x, y, r);
    rg.addColorStop(0, `rgba(${v},${v - 4},${v - 9},0.16)`);
    rg.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = rg;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  for (let i = 0; i < 9000; i++) {
    const v = rnd() < 0.5 ? 70 : 190;
    g.fillStyle = `rgba(${v},${v},${v},0.07)`;
    g.fillRect(rnd() * S, rnd() * S, 1.5, 1.5);
  }
  g.strokeStyle = "rgba(40,38,35,0.35)";
  g.lineWidth = 2;
  for (let k = 1; k < 4; k++) {
    g.beginPath();
    g.moveTo((k * S) / 4, 0);
    g.lineTo((k * S) / 4, S);
    g.moveTo(0, (k * S) / 4);
    g.lineTo(S, (k * S) / 4);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(10, 10);
  t.anisotropy = 8;
  return t;
}

/**
 * The Hivemind K: a split stem and a sharp chevron that stands just clear of it, so the letter reads as three solid
 * pieces with two clean cuts of light between them. About 2.5 units tall, centred on the origin, for extruding.
 */
function kEmblemShapes() {
  const poly = (pts: Array<[number, number]>) => new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
  return [
    poly([[-1.05, 0.07], [-0.47, 0.07], [-0.47, 1.25], [-1.05, 1.25]]), // upper stem
    poly([[-1.05, -1.25], [-0.47, -1.25], [-0.47, -0.07], [-1.05, -0.07]]), // lower stem
    poly([[-0.29, 0], [0.31, 0], [1.1, 1.25], [0.5, 1.25]]), // upper arm
    poly([[-0.29, 0], [0.5, -1.25], [1.1, -1.25], [0.31, 0]]), // lower arm
  ];
}

/**
 * The emblem as a permanent piece of architecture: brushed titanium faces on a dark gunmetal body, with a soft white
 * wash of light behind it. `height` in world units. Used in exactly two places: the centre of the operations floor and the facade.
 */
function buildEmblem(height: number, track: Array<{ dispose(): void }>, onWall = true) {
  const g = new THREE.Group();
  const k = height / 2.5;
  const geo = new THREE.ExtrudeGeometry(kEmblemShapes(), { depth: 0.32, bevelEnabled: true, bevelThickness: 0.035, bevelSize: 0.025, bevelSegments: 2 });
  geo.center();
  const titanium = new THREE.MeshStandardMaterial({ color: "#bfc2c7", metalness: 1, roughness: 0.34, envMapIntensity: 1.2 });
  const gunmetal = new THREE.MeshStandardMaterial({ color: "#2e3034", metalness: 0.85, roughness: 0.45 });
  const mesh = new THREE.Mesh(geo, [titanium, gunmetal]);
  mesh.scale.setScalar(k);
  const wash = new THREE.Mesh(
    new THREE.PlaneGeometry(height * 1.7, height * 1.5),
    new THREE.MeshBasicMaterial({ map: radialTexture([[0, "rgba(255,255,255,0.22)"], [0.5, "rgba(255,255,255,0.06)"], [1, "rgba(255,255,255,0)"]]), transparent: true, depthWrite: false, toneMapped: false }),
  );
  wash.position.z = -0.32 * k;
  if (onWall) g.add(wash);
  g.add(mesh);
  track.push(geo, titanium, gunmetal, wash.geometry, wash.material as THREE.Material, (wash.material as THREE.MeshBasicMaterial).map!);
  return g;
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
  private modelDone = true; // classic built robots: no model to wait for
  private pending: CrewAgent[] | null = null;
  private coreGroup = new THREE.Group();
  private sweep = new THREE.Group();
  private sweepMat!: THREE.MeshBasicMaterial;
  private gyros: THREE.Mesh[] = [];
  private dust: THREE.Points | null = null;
  private hemi!: THREE.HemisphereLight;
  private pmrem: THREE.PMREMGenerator | null = null;
  private hdri: "day" | "night" | null = null;
  private shadowsDone = false;
  private concrete: THREE.CanvasTexture | null = null;
  private key!: THREE.DirectionalLight;
  private rim!: THREE.DirectionalLight;
  private skyCtx!: CanvasRenderingContext2D;
  private skyTex!: THREE.CanvasTexture;
  private skyHour = -1;
  private board!: { ctx: CanvasRenderingContext2D; tex: THREE.CanvasTexture };
  private crew: CrewAgent[] = [];
  /** HIVEMIND's latest actions (from the activity log), shown on the operations board. */
  private feed: Array<{ message: string; at: string }> = [];
  /** When the crew data last arrived, for the board's "updated" counter. */
  private fedAt = 0;
  private panelClock = 0;
  /** Inside on the operations floor, or outside looking at the building from the approach. */
  private view: "inside" | "outside" = "inside";
  private roofGroup = new THREE.Group();
  private officeMat: THREE.MeshBasicMaterial | null = null;
  /** Lit floor paths between two places while they really exchange work. */
  private links: Array<{ key: string; mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; until: number }> = [];
  private flowTex: THREE.CanvasTexture | null = null;
  /** 0..1: a command you gave is running (the hub brightens). */
  private busy = 0;
  private busyOn = false;
  private boardMinute = -1;
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
  private swayAmt = 0;
  private drift = new THREE.Vector3();
  private look = new THREE.Vector3();
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
    // real soft shadows from the key light
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const scene = this.scene;
    scene.background = new THREE.Color("#15171b");
    scene.fog = new THREE.Fog("#1a1c20", 40, 95);
    this.buildSky();
    const pmrem = new THREE.PMREMGenerator(renderer);
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04);
    scene.environment = env.texture;
    scene.environmentIntensity = 0.55;
    this.disposables.push(pmrem, env);
    this.pmrem = pmrem;
    this.loadHdri(new Date().getHours() >= 7 && new Date().getHours() < 19 ? "day" : "night");

    this.buildLights();
    this.buildFloor();
    this.buildCore();
    this.buildHall();
    this.buildBoard();
    this.buildExterior();
    this.applyDaylight();

    if (!this.mobile) {
      const composer = new EffectComposer(renderer);
      composer.addPass(new RenderPass(scene, this.camera));
      const ao = new N8AOPass(scene, this.camera, 1, 1);
      ao.configuration.aoRadius = 1.2;
      ao.configuration.distanceFalloff = 1.0;
      ao.configuration.intensity = 2.2;
      ao.setQualityMode("Medium");
      composer.addPass(ao);
      composer.addPass(new UnrealBloomPass(new THREE.Vector2(256, 256), 0.14, 0.4, 0.92));
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
    this.hemi = new THREE.HemisphereLight("#dfe6ee", "#3a3632", 0.6);
    s.add(this.hemi);
    const key = new THREE.DirectionalLight("#fff1de", 1.4);
    this.key = key;
    key.position.set(7, 16, 13);
    {
      key.castShadow = true;
      key.shadow.mapSize.set(this.mobile ? 1024 : 2048, this.mobile ? 1024 : 2048);
      const c = key.shadow.camera;
      c.left = c.bottom = -20;
      c.right = c.top = 20;
      c.near = 1;
      c.far = 60;
      key.shadow.bias = -0.0003;
      key.shadow.normalBias = 0.04;
      key.shadow.radius = 4;
    }
    s.add(key);
    const rim = new THREE.DirectionalLight("#a9bcd6", 0.6);
    rim.position.set(-12, 8, -14);
    this.rim = rim;
    s.add(rim);
    // the coordination desk's own warm work light
    const core = new THREE.PointLight("#ffd9b0", 16, 18, 2);
    core.position.set(0, 4.6, 0);
    s.add(core);
  }

  /** Lights the hall with a real office HDRI (Poly Haven, CC0): the daytime one, or its night version. */
  private loadHdri(which: "day" | "night") {
    if (this.hdri === which || !this.pmrem) return;
    this.hdri = which;
    new RGBELoader().load(`/hq/hdri/${which === "day" ? "unfinished_office" : "unfinished_office_night"}_1k.hdr`, (hdr) => {
      if (this.dead || !this.pmrem) return hdr.dispose();
      const rt = this.pmrem.fromEquirectangular(hdr);
      hdr.dispose();
      this.scene.environment = rt.texture;
      this.scene.environmentIntensity = which === "day" ? 0.9 : 0.6;
      this.disposables.push(rt);
    });
  }

  /** Everything solid casts and receives shadows (glass, screens and light lines don't). Run once the areas exist. */
  private enableShadows() {
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const mat = (Array.isArray(m.material) ? m.material[0] : m.material) as THREE.Material & { isMeshStandardMaterial?: boolean };
      if (!mat?.isMeshStandardMaterial || mat.transparent) return;
      m.castShadow = true;
      m.receiveShadow = true;
    });
  }

  /**
   * Daylight from the real clock: bright, neutral light through the windows by day, a warm low sun at dawn and dusk,
   * and at night the hall runs on its own lamps. Redrawn once a minute at most.
   */
  private applyDaylight(date = new Date()) {
    const h = date.getHours() + date.getMinutes() / 60;
    // 0 at night, 1 in full day, with an hour of twilight either side of 6:30 and 18:30
    const day = THREE.MathUtils.clamp(Math.min(h - 5.5, 19.5 - h) / 2, 0, 1);
    const dusk = day > 0 && day < 1 ? 1 - Math.abs(day - 0.5) * 2 : 0;
    this.hemi.intensity = 0.32 + 0.5 * day;
    this.hemi.color.set(day > 0.5 ? "#e4ebf2" : "#9aa6c2");
    this.key.intensity = 0.55 + 1.05 * day;
    this.key.color.set(dusk > 0.3 ? "#ffc58f" : day > 0.5 ? "#fff4e4" : "#ffd6a8");
    this.rim.intensity = 0.25 + 0.5 * day;
    this.renderer.toneMappingExposure = 0.92 + 0.18 * day;
    this.officeMat?.color.setScalar(0.35 + (1 - day) * 0.65);
    this.loadHdri(day > 0.5 ? "day" : "night");
    const hour = Math.floor(h);
    if (hour !== this.skyHour) {
      this.skyHour = hour;
      this.drawSky(day, dusk);
    }
  }

  private buildFloor() {
    const concrete = concreteTexture();
    this.concrete = concrete;
    const floorMat = new THREE.MeshPhysicalMaterial({ metalness: 0.0, clearcoat: 0.35, clearcoatRoughness: 0.35, envMapIntensity: 0.8 });
    surface(floorMat, "concrete_floor", 30, "#d4d0ca");
    this.disposables.push(concrete);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(60, 96), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);

    const ft = floorTexture();
    const decal = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshBasicMaterial({ map: ft, color: "#6f6a62", transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
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
    this.disposables.push(floorMat, floor.geometry, ft, decal.geometry, decal.material as THREE.Material, swTex, swMat);
  }

  /**
   * The middle of the floor is the coordination desk: an eight-sided ring of desks with screens facing out (they show
   * the same live operations summary as the wall board), round a brushed-steel K on a stone plinth.
   */
  private buildCore() {
    const g = this.coreGroup;
    const stone = new THREE.MeshStandardMaterial({ color: "#55524d", roughness: 0.85, metalness: 0.05 });
    const darkSteel = new THREE.MeshStandardMaterial({ color: "#2c2e32", metalness: 0.8, roughness: 0.45 });
    const wood = new THREE.MeshStandardMaterial({ color: "#7a5a3e", roughness: 0.6, metalness: 0.05 });
    const fabric = new THREE.MeshStandardMaterial({ color: "#2b2d31", roughness: 0.9 });
    // the operations table: a stone pedestal, an oak top, and a built-in display showing the live summary
    const base = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.4, 0.74, 32), stone);
    base.position.y = 0.37;
    const top = new THREE.Mesh(new THREE.CylinderGeometry(2.3, 2.3, 0.08, 64), wood);
    top.position.y = 0.78;
    // the monumental K stands at the very centre, on a stone pedestal rising from the table, lit softly from below
    const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.9, 0.55, 8), stone);
    pedestal.position.y = 1.1;
    const uplightMat = new THREE.MeshBasicMaterial({ color: "#f4f1ea", toneMapped: false });
    const uplight = new THREE.Mesh(new THREE.TorusGeometry(0.76, 0.012, 6, 8), uplightMat);
    uplight.rotation.x = Math.PI / 2;
    uplight.rotation.z = Math.PI / 8;
    uplight.position.y = 1.38;
    const emblem = buildEmblem(3.6, this.disposables, false);
    emblem.position.y = 1.38 + 1.85;
    g.userData.emblem = emblem;
    // a thin light line round the table edge: it brightens while a command you gave is running
    const glowMat = new THREE.MeshBasicMaterial({ color: "#38d6f5", transparent: true, opacity: 0.3, toneMapped: false });
    const edge = new THREE.Mesh(new THREE.TorusGeometry(2.31, 0.015, 6, 96), glowMat);
    edge.rotation.x = Math.PI / 2;
    edge.position.y = 0.8;
    g.add(base, top, pedestal, uplight, emblem, edge);
    g.userData.glow = glowMat;
    // the ring of desks, a screen and a chair at every other one
    const R = 3.6;
    const screenMat = new THREE.MeshBasicMaterial({ map: this.ensureBoard().tex, toneMapped: false });
    const seatGeo = new THREE.BoxGeometry(0.52, 0.08, 0.5);
    const backGeo = new THREE.BoxGeometry(0.5, 0.62, 0.06);
    const poleGeo = new THREE.CylinderGeometry(0.03, 0.03, 0.38, 8);
    const legGeo = new THREE.BoxGeometry(0.34, 0.03, 0.05);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const seg = new THREE.Group();
      seg.position.set(Math.sin(a) * R, 0, Math.cos(a) * R);
      seg.rotation.y = a;
      const deskTop = new THREE.Mesh(new THREE.BoxGeometry(2.9, 0.06, 0.85), wood);
      deskTop.position.y = 0.78;
      const panel = new THREE.Mesh(new THREE.BoxGeometry(2.9, 0.7, 0.05), darkSteel);
      panel.position.set(0, 0.4, -0.38);
      seg.add(deskTop, panel);
      this.disposables.push(deskTop.geometry, panel.geometry);
      if (i % 2 === 0) {
        const bezel = new THREE.Mesh(new THREE.BoxGeometry(1.36, 0.5, 0.05), darkSteel);
        bezel.position.set(0, 1.36, -0.12);
        bezel.rotation.x = -0.12;
        const screen = new THREE.Mesh(new THREE.PlaneGeometry(1.28, 0.42), screenMat);
        screen.position.set(0, 1.36, -0.09);
        screen.rotation.x = -0.12;
        const arm = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.55, 0.06), darkSteel);
        arm.position.set(0, 1.06, -0.18);
        // an office chair pulled up to the screen
        const chair = new THREE.Group();
        chair.position.set(0.15, 0, 0.75);
        chair.rotation.y = Math.PI + 0.25;
        const seat = new THREE.Mesh(seatGeo, fabric);
        seat.position.y = 0.5;
        const back = new THREE.Mesh(backGeo, fabric);
        back.position.set(0, 0.86, -0.24);
        const pole = new THREE.Mesh(poleGeo, darkSteel);
        pole.position.y = 0.27;
        chair.add(seat, back, pole);
        for (let l = 0; l < 5; l++) {
          const leg = new THREE.Mesh(legGeo, darkSteel);
          leg.position.y = 0.06;
          leg.rotation.y = (l / 5) * Math.PI * 2;
          leg.translateX(0.17);
          chair.add(leg);
        }
        seg.add(bezel, screen, arm, chair);
        this.disposables.push(bezel.geometry, screen.geometry, arm.geometry);
      }
      g.add(seg);
    }
    this.scene.add(g);
    this.disposables.push(stone, darkSteel, wood, fabric, glowMat, screenMat, base.geometry, top.geometry, pedestal.geometry, uplightMat, uplight.geometry, edge.geometry, seatGeo, backGeo, poleGeo, legGeo);
  }

  /**
   * The headquarters from outside. In front of the round operations hall stands a three-storey office wing: a glass
   * curtain wall between aluminium fins and concrete floor slabs (offices lit inside after dark), a stone feature panel
   * carrying the facade emblem (the K's only place outside), a cantilevered entrance canopy with glass doors and a
   * name sign, and plant and solar panels on the roof. Around it: a paved plaza with shrub hedges, planters and
   * benches, a stone approach path with street lamps, the road, a car park with covered cars, and a guard booth with
   * a barrier. Real photo textures and real models throughout (Poly Haven, CC0).
   */
  private buildExterior() {
    const sc = this.scene;
    const RW = 31;
    const glass = new THREE.MeshPhysicalMaterial({ color: "#7d93a3", metalness: 0.1, roughness: 0.05, transparent: true, opacity: 0.16, envMapIntensity: 1.4, depthWrite: false });
    const curtain = new THREE.MeshPhysicalMaterial({ color: "#5d7282", metalness: 0.35, roughness: 0.06, transparent: true, opacity: 0.55, envMapIntensity: 1.6, depthWrite: false });
    const concreteMat = surface(new THREE.MeshStandardMaterial({ envMapIntensity: 0.6 }), "concrete_wall", 5, "#d8d3cb");
    const slabMat = surface(new THREE.MeshStandardMaterial({ envMapIntensity: 0.6 }), "concrete_wall", 10, "#e4e0d8");
    const granite = new THREE.MeshStandardMaterial({ color: "#3a3937", roughness: 0.35, metalness: 0.1, envMapIntensity: 1 });
    const alu = new THREE.MeshStandardMaterial({ color: "#9aa0a6", metalness: 0.9, roughness: 0.35 });
    const steel = new THREE.MeshStandardMaterial({ color: "#3a3c40", metalness: 0.8, roughness: 0.4 });
    const grass = surface(new THREE.MeshStandardMaterial(), "grass", 70, "#8fb07a");
    const pavers = surface(new THREE.MeshStandardMaterial(), "pavers", 10, "#b9b9b6");
    const pathMat = surface(new THREE.MeshStandardMaterial(), "pavers", 4, "#c4c3bf");
    const asphalt = surface(new THREE.MeshStandardMaterial(), "asphalt", 12, "#ffffff");
    const lotMat = surface(new THREE.MeshStandardMaterial(), "asphalt", 6, "#ffffff");
    const white = new THREE.MeshBasicMaterial({ color: "#e8e6e0" });
    const lampLight = new THREE.MeshBasicMaterial({ color: "#ffe2b8" });
    const solar = new THREE.MeshStandardMaterial({ color: "#1b2636", metalness: 0.6, roughness: 0.2 });
    this.disposables.push(glass, curtain, concreteMat, slabMat, granite, alu, steel, grass, pavers, pathMat, asphalt, lotMat, white, lampLight, solar);
    let into: THREE.Object3D = sc;
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, ry = 0) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.rotation.y = ry;
      into.add(m);
      this.disposables.push(geo);
      return m;
    };
    const flat = (w: number, d: number, mat: THREE.Material, x: number, y: number, z: number) => {
      const m = add(new THREE.PlaneGeometry(w, d), mat, x, y, z);
      m.rotation.x = -Math.PI / 2;
      m.receiveShadow = true;
      return m;
    };

    // the operations hall: its glass drum above the concrete base (the roof only shows from outside)
    add(new THREE.CylinderGeometry(RW + 0.15, RW + 0.15, 14.8, 64, 1, true), glass, 0, 4.2 + 7.4, 0);
    add(new THREE.CylinderGeometry(RW + 0.3, RW + 0.3, 4.2, 64, 1, true), concreteMat, 0, 2.1, 0);
    const roofGroup = this.roofGroup;
    sc.add(roofGroup);
    roofGroup.visible = this.view === "outside";
    into = roofGroup;
    add(new THREE.TorusGeometry(RW + 0.1, 0.45, 8, 96), concreteMat, 0, 19.2, 0).rotation.x = Math.PI / 2;
    add(new THREE.CircleGeometry(RW, 64), concreteMat, 0, 19.3, 0).rotation.x = -Math.PI / 2;
    into = sc;

    // ---- the office wing ----
    const X0 = -18;
    const X1 = 18;
    const ZB = 27;
    const ZF = 39;
    const FL = 4; // storey height
    const H = FL * 3;
    const W = X1 - X0;
    const cx = (X0 + X1) / 2;
    const cz = (ZB + ZF) / 2;
    for (let fl = 0; fl <= 3; fl++) add(new THREE.BoxGeometry(W + 0.6, 0.38, ZF - ZB + 0.6), slabMat, cx, fl * FL + 0.19, cz);
    for (const x of [X0, X1]) add(new THREE.BoxGeometry(0.6, H, ZF - ZB), concreteMat, x, H / 2, cz);
    add(new THREE.BoxGeometry(W + 0.6, 1.0, 0.5), concreteMat, cx, H + 0.6, ZF + 0.05); // parapet
    // offices seen through the glass: ceiling light rows and desks, lit after dark
    const oc = document.createElement("canvas");
    oc.width = 1024;
    oc.height = 384;
    const og = oc.getContext("2d")!;
    for (let fl = 0; fl < 3; fl++) {
      const y0 = oc.height - (fl + 1) * 128;
      const gr = og.createLinearGradient(0, y0, 0, y0 + 128);
      gr.addColorStop(0, "#2b2a28");
      gr.addColorStop(1, "#14130f");
      og.fillStyle = gr;
      og.fillRect(0, y0, 1024, 128);
      og.fillStyle = "#fff2d6";
      for (let x = 20; x < 1024; x += 64) og.fillRect(x, y0 + 10, 40, 4);
      og.fillStyle = "#3d3a35";
      for (let x = 30; x < 1024; x += 90) og.fillRect(x, y0 + 84, 56, 8);
      og.fillStyle = "#8fb3c9";
      for (let x = 46; x < 1024; x += 90) if ((x * 7) % 3) og.fillRect(x, y0 + 66, 20, 14);
    }
    const ot = new THREE.CanvasTexture(oc);
    ot.colorSpace = THREE.SRGBColorSpace;
    const officeMat = new THREE.MeshBasicMaterial({ map: ot, toneMapped: false });
    this.officeMat = officeMat;
    this.disposables.push(ot, officeMat);
    add(new THREE.PlaneGeometry(W - 0.6, H - 0.4), officeMat, cx, H / 2, ZF - 1.4);
    // the curtain wall and its aluminium fins
    add(new THREE.PlaneGeometry(W - 0.6, H - 0.4), curtain, cx, H / 2, ZF - 0.05).renderOrder = 2;
    for (let x = X0 + 1.8; x < X1; x += 1.8) {
      if (Math.abs(x) < 4.6) continue; // the stone feature panel sits here
      add(new THREE.BoxGeometry(0.1, H, 0.45), alu, x, H / 2, ZF + 0.2);
    }
    // the stone feature panel with the facade emblem, on the upper two floors above the entrance
    add(new THREE.BoxGeometry(9, 8.2, 0.6), granite, 0, FL + 4.1 + 0.2, ZF + 0.25);
    const emblem = buildEmblem(5.4, this.disposables);
    emblem.position.set(0, FL + 4.3, ZF + 0.62);
    sc.add(emblem);
    // the entrance: a cantilevered canopy, glass doors, steps, and the name on the canopy edge
    add(new THREE.BoxGeometry(14, 0.4, 6), concreteMat, 0, 4.3, ZF + 3);
    for (const x of [-6.2, 6.2]) add(new THREE.CylinderGeometry(0.14, 0.14, 4.1, 12), steel, x, 2.05, ZF + 5.6);
    for (const x of [-4.5, -1.5, 1.5, 4.5]) add(new THREE.CircleGeometry(0.2, 16), lampLight, x, 4.09, ZF + 3).rotation.x = Math.PI / 2;
    const doors = add(new THREE.PlaneGeometry(8, 3.4), glass, 0, 1.9, ZF + 0.3);
    doors.renderOrder = 2;
    for (const x of [-4, -2, 0, 2, 4]) add(new THREE.BoxGeometry(0.07, 3.4, 0.1), steel, x, 1.9, ZF + 0.32);
    for (let st = 0; st < 3; st++) add(new THREE.BoxGeometry(12 - st * 0.8, 0.14, 1.0), pathMat, 0, 0.07 + st * 0.14, ZF + 6.2 - st * 0.7);
    const nc = document.createElement("canvas");
    nc.width = 1024;
    nc.height = 96;
    const ng = nc.getContext("2d")!;
    ng.fillStyle = "#d6d8db";
    ng.font = "600 60px ui-monospace, Consolas, monospace";
    ng.textAlign = "center";
    ng.textBaseline = "middle";
    ng.fillText("H I V E M I N D", 512, 50);
    const nt = new THREE.CanvasTexture(nc);
    nt.colorSpace = THREE.SRGBColorSpace;
    const nameMat = new THREE.MeshBasicMaterial({ map: nt, transparent: true, toneMapped: false });
    this.disposables.push(nt, nameMat);
    add(new THREE.PlaneGeometry(6.5, 0.6), nameMat, 0, 4.3, ZF + 6.02);
    // the roof of the wing: plant and solar panels
    for (const [x, z] of [[-12, 30], [-6, 34], [12, 31]]) add(new THREE.BoxGeometry(3.2, 1.6, 2.4), steel, x, H + 1.0, z);
    for (let r = 0; r < 3; r++) for (let c = 0; c < 7; c++) add(new THREE.BoxGeometry(2.0, 0.08, 1.2), solar, 1 + c * 2.2, H + 0.7, 29 + r * 1.7).rotation.x = -0.35;

    // ---- the site ----
    // lawn all round the buildings (a ring, so it stops at the hall wall)
    const lawn = add(new THREE.RingGeometry(RW + 0.35, 130, 96), grass, 0, 0.006, 0);
    lawn.rotation.x = -Math.PI / 2;
    lawn.receiveShadow = true;
    flat(46, 18, pavers, 0, 0.02, ZF + 9); // plaza
    flat(8, 34, pathMat, 0, 0.022, ZF + 35); // approach path
    flat(240, 9, asphalt, 0, 0.018, ZF + 56); // road
    for (let x = -110; x < 110; x += 6) flat(3, 0.18, white, x, 0.03, ZF + 56);
    flat(28, 18, lotMat, 34, 0.02, ZF + 22); // car park
    for (let k = 0; k <= 9; k++) flat(0.14, 5.4, white, 21.5 + k * 2.75, 0.03, ZF + 16.5);
    for (let k = 0; k <= 9; k++) flat(0.14, 5.4, white, 21.5 + k * 2.75, 0.03, ZF + 27.5);
    for (const [x, z, r] of [[24.2, ZF + 16.5, Math.PI], [29.7, ZF + 16.5, Math.PI], [40.7, ZF + 16.5, Math.PI], [27, ZF + 27.5, 0], [38, ZF + 27.5, 0]]) placeModel(sc, "car", { x, z, yaw: r, width: 4.4 });
    // street lamps along the path and round the plaza
    for (let k = 0; k < 5; k++) for (const x of [-5.5, 5.5]) placeModel(sc, "streetLamp", { x, z: ZF + 22 + k * 7, yaw: x > 0 ? -Math.PI / 2 : Math.PI / 2, height: 4.2 });
    for (const x of [-21, 21]) placeModel(sc, "streetLamp", { x, z: ZF + 4, height: 4.2 });
    // shrub hedges along the front of the building, planters and benches on the plaza
    for (let x = X0 + 1; x < X1; x += 1.6) if (Math.abs(x) > 7.5) placeModel(sc, "shrub", { x, z: ZF + 1.4, yaw: x * 1.7, height: 1.1 });
    for (const x of [-15, -9, 9, 15]) {
      placeModel(sc, "planter", { x, z: ZF + 11, yaw: 0, width: 2.4 });
      add(new THREE.BoxGeometry(2.4, 0.45, 0.6), granite, x, 0.23, ZF + 13);
    }
    for (let x = -21; x <= 21; x += 3) if (Math.abs(x) > 4.5) add(new THREE.CylinderGeometry(0.12, 0.12, 0.9, 12), steel, x, 0.45, ZF + 18);
    // the gate: a guard booth and a barrier across the path
    add(new THREE.BoxGeometry(2.6, 0.3, 2.6), concreteMat, 7.2, 2.75, ZF + 50);
    add(new THREE.BoxGeometry(2.4, 2.6, 2.4), glass, 7.2, 1.3, ZF + 50).renderOrder = 2;
    add(new THREE.BoxGeometry(2.6, 0.2, 2.6), concreteMat, 7.2, 0.1, ZF + 50);
    add(new THREE.BoxGeometry(0.4, 1.1, 0.4), steel, -4.6, 0.55, ZF + 50);
    add(new THREE.BoxGeometry(9, 0.12, 0.12), white, -0.1, 1.05, ZF + 50);
    for (const x of [-3, 0, 3]) add(new THREE.BoxGeometry(0.6, 0.13, 0.14), new THREE.MeshBasicMaterial({ color: "#c0392b" }), x, 1.05, ZF + 50);
  }

  /** The live operations summary (a canvas shared by the wall board and the coordination desk screens). */
  private ensureBoard() {
    if (!this.board) {
      const c = document.createElement("canvas");
      c.width = 1600;
      c.height = 520;
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 8;
      this.board = { ctx: c.getContext("2d")!, tex };
      this.disposables.push(tex);
    }
    return this.board;
  }

  /** The big wall display behind the back row: a steel-framed screen on two legs, facing the floor. */
  private buildBoard() {
    const frameMat = new THREE.MeshStandardMaterial({ color: "#26282c", metalness: 0.7, roughness: 0.5 });
    const wallMat = surface(new THREE.MeshStandardMaterial({ envMapIntensity: 0.6 }), "concrete_wall", 3, "#b9b4ac");
    const screenMat = new THREE.MeshBasicMaterial({ map: this.ensureBoard().tex, toneMapped: false });
    const wall = new THREE.Group();
    wall.position.set(0, 0, -19);
    // a board-formed concrete feature wall, the focal point of the floor
    const panel = new THREE.Mesh(new THREE.BoxGeometry(19, 12, 0.5), wallMat);
    panel.position.set(0, 6, -0.45);
    const plinthStrip = new THREE.Mesh(new THREE.BoxGeometry(19, 0.12, 0.08), new THREE.MeshBasicMaterial({ color: "#d9d2c5" }));
    plinthStrip.position.set(0, 0.06, -0.18);
    // the monumental K (the interior one of the emblem's two places)
    // the operations display, mounted on the wall below it
    const frame = new THREE.Mesh(new THREE.BoxGeometry(12.6, 4.2, 0.22), frameMat);
    frame.position.y = 4.4;
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(12.2, 3.96), screenMat);
    screen.position.set(0, 4.4, 0.12);
    wall.add(panel, plinthStrip, frame, screen);
    this.scene.add(wall);
    this.disposables.push(frameMat, wallMat, screenMat, panel.geometry, plinthStrip.geometry, plinthStrip.material as THREE.Material, frame.geometry, screen.geometry);
    this.drawBoard();
  }

  /**
   * The operations display, redrawn every second from real data: a running clock and a blinking LIVE light, the
   * state counts, every agent's own line and how long ago it last did something, HIVEMIND's latest actions from the
   * activity log, and how many seconds since the data was refreshed. Nothing on it is made up.
   */
  private drawBoard() {
    const { ctx: g, tex } = this.ensureBoard();
    const W = 1600;
    const H = 520;
    const now = Date.now();
    const sec = Math.floor(now / 1000);
    const ago = (iso: string | null) => {
      if (!iso) return "—";
      const ms = now - Date.parse(iso.length === 10 ? `${iso}T12:00:00Z` : iso);
      if (!Number.isFinite(ms)) return "—";
      if (ms < 60_000) return `${Math.max(0, Math.floor(ms / 1000))}s ago`;
      if (ms < 3_600_000) return `${Math.floor(ms / 60_000)} min ago`;
      if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)} h ago`;
      return `${Math.floor(ms / 86_400_000)} d ago`;
    };
    g.fillStyle = "#0b0d10";
    g.fillRect(0, 0, W, H);
    g.textBaseline = "alphabetic";
    // header: name, live light, the time with seconds
    g.textAlign = "left";
    g.fillStyle = "#e9e4da";
    g.font = "600 34px ui-monospace, Consolas, monospace";
    g.fillText("HIVEMIND  OPERATIONS", 40, 58);
    g.textAlign = "right";
    g.fillStyle = "#e9e4da";
    g.font = "600 40px ui-monospace, Consolas, monospace";
    g.fillText(new Date(now).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }), W - 40, 60);
    g.fillStyle = sec % 2 ? "#3fbf7f" : "#1f5f40";
    g.beginPath();
    g.arc(W - 300, 46, 9, 0, Math.PI * 2);
    g.fill();
    g.font = "600 22px ui-monospace, Consolas, monospace";
    g.fillStyle = "#7fd3a6";
    g.fillText("LIVE", W - 318, 54);
    g.fillStyle = "#23262b";
    g.fillRect(40, 78, W - 80, 2);
    const crew = this.crew;
    if (!crew.length) {
      g.textAlign = "left";
      g.fillStyle = "#8b8f96";
      g.font = "400 30px system-ui, sans-serif";
      g.fillText("Waiting for the crew's status…", 40, 150);
      tex.needsUpdate = true;
      return;
    }
    // state counts
    const n = (st: string) => crew.filter((c) => c.state === st).length;
    const counts: Array<[string, number, string]> = [["WORKING", n("working"), HEX.working], ["READY", n("idle"), HEX.idle], ["ASLEEP", n("sleeping"), HEX.sleeping], ["NEEDS YOU", n("alert"), HEX.alert]];
    g.textAlign = "left";
    let x = 40;
    for (const [label, v, col] of counts) {
      g.fillStyle = col;
      g.fillRect(x, 102, 6, 30);
      g.fillStyle = "#e9e4da";
      g.font = "600 28px ui-monospace, Consolas, monospace";
      g.fillText(`${v}`, x + 18, 128);
      g.fillStyle = "#8b9097";
      g.font = "600 18px ui-monospace, Consolas, monospace";
      g.fillText(label, x + 18 + g.measureText(`${v}`).width + 34, 126);
      x += 230;
    }
    // agents, one row each
    g.fillStyle = "#6e737a";
    g.font = "600 16px ui-monospace, Consolas, monospace";
    g.fillText("AGENT", 40, 170);
    g.fillText("NOW", 250, 170);
    g.textAlign = "right";
    g.fillText("LAST", 920, 170);
    crew.forEach((c, i) => {
      const y = 205 + i * 42;
      const working = c.state === "working";
      if (working) {
        g.fillStyle = "rgba(63,191,127,0.08)";
        g.fillRect(36, y - 28, 892, 38);
      }
      g.fillStyle = HEX[c.state];
      g.globalAlpha = working ? 0.55 + 0.45 * (sec % 2) : 1;
      g.beginPath();
      g.arc(52, y - 9, 7, 0, Math.PI * 2);
      g.fill();
      g.globalAlpha = 1;
      g.textAlign = "left";
      g.fillStyle = "#f2eee6";
      g.font = "600 25px system-ui, 'Segoe UI', sans-serif";
      g.fillText(c.name, 72, y);
      g.fillStyle = "#a6abb2";
      g.font = "400 22px system-ui, 'Segoe UI', sans-serif";
      g.fillText(wrap(g, c.line, 520, 1)[0] ?? "", 250, y);
      g.textAlign = "right";
      g.fillStyle = "#7c828a";
      g.font = "400 20px ui-monospace, Consolas, monospace";
      g.fillText(ago(c.at), 920, y);
    });
    // HIVEMIND's latest actions
    const fx = 980;
    g.fillStyle = "#1a1d21";
    g.fillRect(fx - 20, 150, 2, H - 190);
    g.textAlign = "left";
    g.fillStyle = "#6e737a";
    g.font = "600 16px ui-monospace, Consolas, monospace";
    g.fillText("LATEST ACTIVITY", fx, 170);
    if (!this.feed.length) {
      g.fillStyle = "#8b8f96";
      g.font = "400 22px system-ui, sans-serif";
      g.fillText("Nothing logged yet.", fx, 210);
    }
    const hi = this.feed.length ? sec % this.feed.length : -1; // the highlight steps down the list, one entry a second
    this.feed.slice(0, 7).forEach((e, i) => {
      const y = 208 + i * 42;
      if (i === hi) {
        g.fillStyle = "rgba(255,255,255,0.05)";
        g.fillRect(fx - 8, y - 27, W - fx - 32, 38);
      }
      g.fillStyle = i === 0 ? "#e9e4da" : "#a6abb2";
      g.font = `${i === 0 ? 600 : 400} 21px system-ui, 'Segoe UI', sans-serif`;
      g.fillText(wrap(g, e.message, 440, 1)[0] ?? "", fx, y);
      g.textAlign = "right";
      g.fillStyle = "#6e737a";
      g.font = "400 18px ui-monospace, Consolas, monospace";
      g.fillText(ago(e.at), W - 40, y);
      g.textAlign = "left";
    });
    // freshness
    g.fillStyle = "#5c6168";
    g.font = "400 17px ui-monospace, Consolas, monospace";
    g.textAlign = "left";
    g.fillText(this.fedAt ? `DATA UPDATED ${Math.max(0, Math.floor((now - this.fedAt) / 1000))}s AGO · REFRESHES EVERY 6s` : "", 40, H - 18);
    tex.needsUpdate = true;
  }

  /** A dusk sky over a sci-fi city, seen through the hangar windows. */
  private buildSky() {
    const c = document.createElement("canvas");
    c.width = 1024;
    c.height = 512;
    this.skyCtx = c.getContext("2d")!;
    this.skyTex = new THREE.CanvasTexture(c);
    this.skyTex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshBasicMaterial({ map: this.skyTex, side: THREE.BackSide, fog: false, depthWrite: false, toneMapped: false });
    const dome = new THREE.Mesh(new THREE.SphereGeometry(125, 48, 24), mat);
    dome.renderOrder = -10;
    this.sky = dome;
    this.scene.add(dome);
    this.disposables.push(this.skyTex, mat, dome.geometry);
  }

  /** Paints the sky for the hour: `day` 0 (night) to 1 (full day), `dusk` 0 to 1 near sunrise and sunset. */
  private drawSky(day: number, dusk: number) {
    const g = this.skyCtx;
    const W = 1024;
    const H = 512;
    const mix = (a: string, b: string, k: number) => "#" + new THREE.Color(a).lerp(new THREE.Color(b), k).getHexString();
    const top = mix("#0b1020", "#6f8fb3", day);
    const mid = mix("#18203a", "#a9bed3", day);
    const horizon = dusk > 0.2 ? mix(mix("#18203a", "#c9d4dc", day), "#e29b62", dusk * 0.8) : mix("#202943", "#d3dbe1", day);
    const grad = g.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, top);
    grad.addColorStop(0.35, mid);
    grad.addColorStop(0.5, horizon);
    grad.addColorStop(0.52, "#121418");
    grad.addColorStop(1, "#121418");
    g.fillStyle = grad;
    g.fillRect(0, 0, W, H);
    // the city outside: two layers of towers; windows lit in the evening and at night
    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const lit = 0.04 + (1 - day) * 0.3;
    const towers = (fill: string, hMin: number, hMax: number, k: number) => {
      for (let x = 0; x < W; ) {
        const bw = 12 + rnd() * 30;
        const bh = hMin + rnd() * rnd() * (hMax - hMin);
        g.fillStyle = fill;
        g.fillRect(x, H * 0.52 - bh, bw, bh);
        for (let wy = H * 0.52 - bh + 4; wy < H * 0.52 - 3; wy += 6) {
          for (let wx = x + 3; wx < x + bw - 3; wx += 5) {
            if (rnd() < lit * k) {
              g.fillStyle = "rgba(255,214,160,0.85)";
              g.fillRect(wx, wy, 2, 3);
            }
          }
        }
        x += bw + 1 + rnd() * 3;
      }
    };
    towers(mix("#2a2f3a", "#8a96a3", day), 20, 90, 0.6);
    towers(mix("#14171d", "#5d6773", day), 16, 120, 1);
    this.skyTex.needsUpdate = true;
  }

  /** The hangar around the deck: a window wall onto the city, a skylight ring, the hologram column, a K emblem, plants. */
  private buildHall() {
    const sc = this.scene;
    const dark = new THREE.MeshStandardMaterial({ color: "#2a2b2e", metalness: 0.4, roughness: 0.7, envMapIntensity: 0.6, side: THREE.BackSide });
    const metal = new THREE.MeshStandardMaterial({ color: "#3a3c40", metalness: 0.8, roughness: 0.45, envMapIntensity: 0.7 });
    const amber = new THREE.MeshBasicMaterial({ color: "#a8784a" });
    const blue = new THREE.MeshBasicMaterial({ color: "#efe4d2" });
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
      if (-Math.cos(a) * RW > 20 && Math.abs(Math.sin(a) * RW) < 9) continue; // the entrance and the facade emblem
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
    this.disposables.push(ct, colMat);
    // real potted plants round the edge of the hall
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2 + 0.2;
      const r = i % 2 ? RW - 2 : 20.5;
      placeModel(sc, "plant", { x: Math.sin(a) * r, z: -Math.cos(a) * r, yaw: a * 3, height: 1.9 });
    }
  }

  private buildPod(a: CrewAgent, i: number, n: number): Pod {
    // Not an even ring: every area sits at its own angle and distance, so the hall reads as seven different places.
    const fallback = (n === 1 ? 0 : i / (n - 1) - 0.5) * Math.PI * 1.2;
    const spot = PLACE[a.id] ?? { x: Math.sin(fallback) * R, z: -Math.cos(fallback) * R };
    const k = this.portrait ? PORTRAIT_SHRINK : 1;
    const pos = new THREE.Vector3(spot.x * k, 0, spot.z * k);
    const group = new THREE.Group();
    group.position.copy(pos);
    const col = new THREE.Color(HEX[a.state]);

    const metal = new THREE.MeshStandardMaterial({ color: "#2a2638", metalness: 0.7, roughness: 0.35, envMapIntensity: 0.7 });
    const ringMat = new THREE.MeshStandardMaterial({ color: "#0b1020", emissive: col, emissiveIntensity: 2.2, roughness: 0.4 });
    // Each agent has its own kind of place: round clock dais, observatory deck, control room, bedroom, study, bell plaza, workshop.
    const TH: Record<string, { shape: "round" | "oct" | "box"; w: number; d: number; floor: string; wall: string | null; rough: number }> = {
      scheduler: { shape: "round", w: 2.9, d: 2.9, floor: "#6a4a30", wall: null, rough: 0.5 },
      autopilot: { shape: "oct", w: 2.9, d: 2.9, floor: "#4a4d52", wall: null, rough: 0.6 },
      web: { shape: "box", w: 5.4, d: 4.7, floor: "#3b3e43", wall: "#2c2f34", rough: 0.6 },
      dream: { shape: "box", w: 5.3, d: 4.7, floor: "#6b4a33", wall: "#4a4642", rough: 0.6 },
      brief: { shape: "box", w: 5.3, d: 4.7, floor: "#7a5a3a", wall: "#4a3a2a", rough: 0.6 },
      reminders: { shape: "oct", w: 2.9, d: 2.9, floor: "#5c544c", wall: null, rough: 0.7 },
      apps: { shape: "box", w: 5.4, d: 4.7, floor: "#3a3d46", wall: "#2e3038", rough: 0.55 },
    };
    const th = TH[a.id] ?? TH.web;
    const W = th.w;
    const D = th.d;
    // each area's own floor: oak boards in the warm rooms, polished concrete in the technical ones
    const woodFloor = a.id === "scheduler" || a.id === "dream" || a.id === "brief";
    const floorMat = surface(new THREE.MeshStandardMaterial({ envMapIntensity: 0.7 }), woodFloor ? "oak" : "concrete_floor", 2, woodFloor ? "#b8a58e" : "#bdb8b0");
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
    const rugCol: Record<string, string> = { dream: "#3d3c40", brief: "#4a4038", apps: "#2a2b2d", web: "#35383d" }; // carpet tiles; a rubber mat at the bench
    if (a.id === "dream" || a.id === "brief" || a.id === "web") {
      const rug = new THREE.Mesh(a.id === "dream" ? new THREE.PlaneGeometry(2.8, 1.9) : new THREE.PlaneGeometry(a.id === "web" ? 3.4 : 2.8, 1.9), new THREE.MeshStandardMaterial({ color: rugCol[a.id], roughness: 0.95 }));
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
    mark.visible = false; // no glowing circle on the floor: the state shows on the station screen
    ring.add(mark);
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
    halo.visible = false; // the state shows on the station screen and the wall board, not as a ring over its head

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
    // the station's status screen: on a floor stand at the front corner, angled toward the open floor
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.47), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
    {
      const sx = th.shape === "box" ? W / 2 - 0.55 : W * 0.62;
      const sz = th.shape === "box" ? D / 2 - 0.3 : W * 0.62;
      const standMat = new THREE.MeshStandardMaterial({ color: "#26282c", metalness: 0.7, roughness: 0.5 });
      const bezel = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.57, 0.06), standMat);
      const pole = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.95, 0.07), standMat);
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.04, 0.35), standMat);
      const stand = new THREE.Group();
      stand.position.set(sx, 0.4, sz);
      stand.rotation.y = -0.45;
      stand.scale.setScalar(0.8);
      bezel.position.set(0, 1.1, -0.035);
      bezel.rotation.x = -0.35; // a waist-height kiosk, tilted up toward whoever walks past
      pole.position.set(0, 0.48, -0.06);
      foot.position.set(0, 0.02, -0.06);
      panel.position.set(0, 1.1, 0.001);
      panel.rotation.x = -0.35;
      stand.add(bezel, pole, foot, panel);
      ring.add(stand);
      this.disposables.push(standMat, bezel.geometry, pole.geometry, foot.geometry);
    }
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
    // A lit name sign, like the room signs in a real office: high on the back wall, or on a post for open platforms.
    const sign = nameSign(a.name, PAINT[a.id], this.disposables);
    if (th.shape === "box") sign.position.set(0, 3.72, -D / 2 + 0.12);
    else {
      sign.position.set(0, 3.05, -W + 0.2);
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 2.5, 8), metal);
      post.position.set(0, 0.4 + 1.25, -W + 0.15);
      this.disposables.push(post.geometry);
      ring.add(post);
    }
    ring.add(sign);
    group.add(slab, plinth, ring, halo, glow, ripple, panel, hit, station.group);
    group.add(rig.root);
    const face = faceDir(pos, !!spot.front);
    group.lookAt(pos.x + face.x, 0, pos.z + face.z);
    this.scene.add(group);

    // energy line to the core (curve in world space) and the packets that ride it
    const from = new THREE.Vector3(pos.x * 0.8, 0.05, pos.z * 0.8);
    const to = new THREE.Vector3(pos.x, 0, pos.z).setLength(4.3).setY(0.05);
    const mid = from.clone().lerp(to, 0.5).setY(0.05);
    const curve = new THREE.QuadraticBezierCurve3(from, mid, to);
    const beamMat = new THREE.MeshBasicMaterial({ color: "#2f3033" });
    const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 24, 0.035, 6, false), beamMat);
    this.scene.add(tube);
    const packetMat = new THREE.MeshBasicMaterial({ color: col, toneMapped: false });
    const pg = new THREE.SphereGeometry(0.055, 10, 6);
    const packets = [0, 1, 2].map(() => {
      const m = new THREE.Mesh(pg, packetMat);
      m.visible = false;
      this.scene.add(m);
      return m;
    });
    this.disposables.push(metal, ringMat, haloMat, glowMat, rippleMat, tex, panel.material as THREE.Material, hit.material as THREE.Material, beamMat, packetMat);

    return { id: a.id, pos, group, rig, station, at: { x: HOME.x, z: HOME.z }, mode: "", stopIdx: 0, dwell: 0, arrived: false, act: "none" as Act, walk: 0, errand: null, nextErrand: performance.now() / 1000 + 2 + i * 1.1, fw: th.shape === "box" ? W / 2 : W, fd: th.shape === "box" ? D / 2 : W, fr: th.shape === "box" ? 0 : W, note: null, agent: a, hostUntil: 0, hostFace: 0, halo, haloMat, prop, ringMat, glowMat, rippleMat, ripple, beamMat, packetMat, curve, packets, panel, tex, ctx, key: "", state: a.state, col, tgt: col.clone(), phase: i * 1.3, born: performance.now() + 250 + i * 130, cele: 0, gated: false, path: null, pathGoal: null, lift: spot.front ? -2.3 : this.portrait && i % 2 ? 1.7 : 0, burst: 0, hv: 0 };
  }

  // ---------- data ----------
  /** The latest entries of HIVEMIND's activity log, newest first. */
  setFeed(feed: Array<{ message: string; at: string }>) {
    this.feed = feed.slice(0, 8);
    if (this.board) this.drawBoard();
  }

  setCrew(crew: CrewAgent[]) {
    this.crew = crew;
    this.fedAt = Date.now();
    if (this.board) this.drawBoard();
    if (!this.modelDone) {
      this.pending = crew; // build the pods once the robot model has arrived
      return;
    }
    if (this.pods.length === 0) {
      crew.forEach((a, i) => this.pods.push(this.buildPod(a, i, crew.length)));
      this.hooks.onReady?.();
      if (!this.shadowsDone) {
        this.shadowsDone = true;
        this.enableShadows();
      }
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
          setTimeout(() => !this.dead && this.startErrand(p, null, "Delivering finished work to the coordination desk"), 2800);
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
    // A working agent now and then takes its work to the coordination desk, or to the colleague it hands work to.
    // Idle and sleeping agents stay at their own stations: no made-up trips.
    if (!p.errand && mode === "work" && this.selected !== p.id && now > p.nextErrand) {
      p.nextErrand = now + 24 + ((p.phase * 17) % 12);
      const jobs = JOBS[p.id].filter((j) => j.to === "core" || this.pods.find((x) => x.id === j.to)?.state !== "sleeping");
      const job = jobs[Math.floor(Math.random() * jobs.length)];
      if (job) {
        const host = job.to === "core" ? null : (this.pods.find((x) => x.id === job.to) ?? null);
        this.startErrand(p, host, host ? `Handing off to ${host.agent.name}` : "Reporting to the coordination desk");
      }
    }
    const hosting = p.hostUntil > now && busy;
    const list = mode === "work" ? st.work : mode === "idle" ? st.idle : [mode === "sleep" ? st.sleep : ALERT_STOP];
    let stop = list[p.stopIdx % list.length];
    if (p.errand) stop = { x: p.errand.x, z: p.errand.z, face: p.errand.face, act: "chat", dwell: 5.5 };
    if (hosting) stop = { x: p.at.x, z: p.at.z, face: p.hostFace, act: "chat", dwell: 99 };
    // Rooms have walls and props: to get in or out, walk through the open front.
    const inside = (x: number, z: number) => (p.fr > 0 ? Math.hypot(x, z) < p.fr - 0.15 : Math.abs(x) < p.fw - 0.15 && Math.abs(z) < p.fd - 0.15);
    // Once it has reached the door it goes straight through (it remembers, so a step past the door doesn't send it back).
    const gate = { x: 0, z: p.fd + 0.75 };
    const crossing = inside(p.at.x, p.at.z) !== inside(stop.x, stop.z);
    if (!crossing) p.gated = false;
    else if (Math.hypot(gate.x - p.at.x, gate.z - p.at.z) <= 0.25) p.gated = true;
    if (crossing && !p.gated) {
      stop = { x: gate.x, z: gate.z, face: 0, act: "none", dwell: 0 };
    }
    // Never through the walls: if the straight line from outside the room to the stop crosses it, go round a corner first.
    // (Without this a robot whose target lay behind its own room walked in, was sent back to the door, and so on: walking in place.)
    // Out on the floor it follows a route planned once, round every room and the coordination desk (planning once,
    // instead of choosing a detour every frame, is what stops a robot dithering between two ways round).
    if (!inside(p.at.x, p.at.z) && !inside(stop.x, stop.z)) {
      const via = this.nextWaypoint(p, stop.x, stop.z);
      if (via) stop = { x: via.x, z: via.z, face: 0, act: "none", dwell: 0 };
    } else p.path = null;
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
      const side = ((this.pods.indexOf(p) % 3) - 1) * 1.3; // visitors stand side by side, not on one spot
      const g = host.group.localToWorld(new THREE.Vector3(side, 0, host.fd + 1.1)); // just outside the host's open front
      wx = g.x;
      wz = g.z;
      lookAt = new THREE.Vector3(host.group.position.x, 0, host.group.position.z);
    } else {
      const d = new THREE.Vector3(here.x, 0, here.z).normalize();
      wx = d.x * 5;
      wz = d.z * 5;
      lookAt = new THREE.Vector3(0, 0, 0);
    }
    const hl = p.group.worldToLocal(lookAt.clone());
    const l = p.group.worldToLocal(new THREE.Vector3(wx, 0, wz));
    const face = Math.atan2(hl.x - l.x, hl.z - l.z);
    p.errand = { x: l.x, z: l.z, face, host };
    // the hand-off shows as a lit path between the two stations (or to the hub) for the length of the trip
    this.link(p.id, host ? host.id : null, 14);
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
    const t = performance.now() / 1000;
    g.fillStyle = "#0c0e11";
    g.fillRect(0, 0, W, H);
    g.fillStyle = HEX[a.state];
    g.fillRect(0, 0, 8, H);
    g.textAlign = "left";
    g.textBaseline = "alphabetic";
    g.fillStyle = "#f2eee6";
    g.font = "600 44px system-ui, 'Segoe UI', sans-serif";
    g.fillText(a.name, 30, 56);
    g.textAlign = "right";
    g.fillStyle = HEX[a.state];
    g.font = "600 25px ui-monospace, Consolas, monospace";
    g.fillText(STATE_WORD[a.state], W - 26, 52);
    g.textAlign = "left";
    g.fillStyle = "#b9bdc3";
    g.font = "400 27px system-ui, 'Segoe UI', sans-serif";
    wrap(g, p.note ?? a.line, W - 60, 2).forEach((l, i) => g.fillText(l, 30, 100 + i * 33));
    // an activity trace along the bottom: busy while working, a slow heartbeat when ready, almost flat asleep
    const speed = a.state === "working" ? 3.2 : a.state === "alert" ? 2 : a.state === "idle" ? 0.8 : 0.2;
    const amp = a.state === "working" ? 14 : a.state === "alert" ? 10 : a.state === "idle" ? 6 : 1.5;
    g.strokeStyle = HEX[a.state];
    g.globalAlpha = 0.85;
    g.lineWidth = 2;
    g.beginPath();
    for (let x = 0; x <= W - 60; x += 4) {
      const u = x / 40 + t * speed;
      const beat = Math.pow(Math.max(0, Math.sin(u)), 12) * 2 - 0.3;
      const y = 172 - (a.state === "working" ? Math.sin(u * 2.3) * 0.6 + Math.sin(u * 0.7) * 0.4 + beat * 0.5 : beat) * amp;
      if (x === 0) g.moveTo(30 + x, y);
      else g.lineTo(30 + x, y);
    }
    g.stroke();
    g.globalAlpha = 1;
    p.tex.needsUpdate = true;
  }

  /** A command you gave is running (true) or finished (false): the hub hologram brightens while it runs. */
  setBusy(on: boolean) {
    this.busyOn = on;
  }

  /** Your command just used this agent's tool: a lit path runs from the hub to its station, and the station flashes. */
  signal(id: CrewId) {
    const p = this.pods.find((x) => x.id === id);
    if (!p) return;
    p.burst = 1;
    this.link(null, id, 7);
  }

  /** A lit path on the floor between two places (an agent's station, or the hub for null) for `seconds`. */
  private link(from: CrewId | null, to: CrewId | null, seconds: number) {
    const key = `${from}>${to}`;
    const until = performance.now() / 1000 + seconds;
    const have = this.links.find((l) => l.key === key);
    if (have) {
      have.until = Math.max(have.until, until);
      return;
    }
    const at = (id: CrewId | null) => (id ? (this.pods.find((x) => x.id === id)?.group.position.clone() ?? null) : new THREE.Vector3());
    const a = at(from);
    const b = at(to);
    if (!a || !b) return;
    a.y = b.y = 0;
    const dir = b.clone().sub(a);
    const len = dir.length();
    dir.normalize();
    // start and end just outside the room (or the hub's desk), not under it
    const sa = from ? 3.1 : 4.6;
    const sb = to ? 3.1 : 4.6;
    if (len < sa + sb + 0.5) return;
    const p0 = a.clone().addScaledVector(dir, sa);
    const p1 = b.clone().addScaledVector(dir, -sb);
    const L = p0.distanceTo(p1);
    if (!this.flowTex) {
      const c = document.createElement("canvas");
      c.width = 128;
      c.height = 16;
      const g = c.getContext("2d")!;
      const gr = g.createLinearGradient(0, 0, 128, 0);
      gr.addColorStop(0, "rgba(56,214,245,0.05)");
      gr.addColorStop(0.7, "rgba(56,214,245,0.55)");
      gr.addColorStop(0.95, "rgba(200,245,255,1)");
      gr.addColorStop(1, "rgba(56,214,245,0.05)");
      g.fillStyle = gr;
      g.fillRect(0, 4, 128, 8);
      this.flowTex = new THREE.CanvasTexture(c);
      this.flowTex.wrapS = THREE.RepeatWrapping;
      this.disposables.push(this.flowTex);
    }
    const tex = this.flowTex.clone();
    tex.needsUpdate = true;
    tex.repeat.set(L / 1.6, 1);
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(L, 0.22), mat);
    mesh.position.copy(p0.clone().lerp(p1, 0.5)).setY(0.07);
    mesh.rotation.order = "YXZ";
    mesh.rotation.y = Math.atan2(-dir.z, dir.x);
    mesh.rotation.x = -Math.PI / 2;
    this.scene.add(mesh);
    this.links.push({ key, mesh, mat, until });
  }

  /** Paths fade in, flow from sender to receiver, and fade out when the exchange is over. */
  private updateLinks(t: number, dt: number) {
    const now = performance.now() / 1000;
    for (const l of [...this.links]) {
      const want = now < l.until ? 0.9 : 0;
      l.mat.opacity += (want - l.mat.opacity) * (1 - Math.pow(0.02, dt));
      if (l.mat.map) l.mat.map.offset.x = -t * 0.9;
      if (want === 0 && l.mat.opacity < 0.02) {
        this.scene.remove(l.mesh);
        l.mesh.geometry.dispose();
        l.mat.map?.dispose();
        l.mat.dispose();
        this.links.splice(this.links.indexOf(l), 1);
      }
    }
  }

  select(id: CrewId | null) {
    if (id && this.view === "outside") {
      this.view = "inside";
      this.roofGroup.visible = false;
    }
    this.selected = id;
    this.idleSince = performance.now();
    if (!id) {
      this.tTarget.copy(this.homeTarget());
      this.tDist = this.homeDist();
      this.tPhi = this.homePhi();
      return;
    }
    const p = this.pods.find((x) => x.id === id);
    if (!p) return;
    p.burst = 1;
    // view the pod from the side it faces, a little off to one side, so screens face us and the core stays out of shot
    const f = faceDir(p.pos, !!PLACE[id]?.front);
    this.tTarget.set(p.pos.x + f.x * 0.7, 1.4, p.pos.z + f.z * 0.7);
    this.tDist = this.portrait ? 10 : 7.5;
    this.tPhi = 1.08; // high enough to look over the room walls at the robot and its desk
    const want = Math.atan2(f.x, f.z) + (p.pos.x >= 0 ? -0.6 : 0.6);
    const d = ((want - this.theta + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    this.tTheta = this.theta + d;
  }

  /** Robots never walk through each other: a walker is nudged aside from anyone within arm's reach. */
  /** The next point to walk to on the way to (tx, tz) in p's own coordinates, planning the route when the goal changes. Null: go straight. */
  private nextWaypoint(p: Pod, tx: number, tz: number) {
    const here = p.group.localToWorld(new THREE.Vector3(p.at.x, 0, p.at.z));
    const goal = p.group.localToWorld(new THREE.Vector3(tx, 0, tz));
    if (!p.pathGoal || p.pathGoal.distanceTo(goal) > 0.3 || !p.path) {
      p.pathGoal = goal;
      p.path = this.plan(here, goal);
    }
    while (p.path.length && p.path[0].distanceTo(here) < 0.3) p.path.shift();
    if (!p.path.length) return null;
    const l = p.group.worldToLocal(p.path[0].clone());
    return { x: l.x, z: l.z };
  }

  /**
   * Shortest route from a to b across the floor that goes round every room and the coordination desk: a small graph of
   * points just outside each room's corners and round the desk, joined wherever the straight line between them is clear.
   * Returns the points to visit after a (ending before b); empty when the straight line is already clear.
   */
  private plan(a: THREE.Vector3, b: THREE.Vector3): THREE.Vector3[] {
    const DESK = 4.5;
    const v = new THREE.Vector3();
    const rooms = this.pods.map((h) => ({ h, r: h.fr > 0 }));
    const inRoom = (x: number, z: number, o: { h: Pod; r: boolean }) => {
      v.set(x, 0, z);
      o.h.group.worldToLocal(v);
      return o.r ? Math.hypot(v.x, v.z) < o.h.fr + 0.25 : Math.abs(v.x) < o.h.fw + 0.25 && Math.abs(v.z) < o.h.fd + 0.25;
    };
    // obstacles a or b sit in (a robot at a door, a goal by a desk) don't count for lines touching that end
    const skipA = rooms.filter((o) => inRoom(a.x, a.z, o));
    const skipB = rooms.filter((o) => inRoom(b.x, b.z, o));
    const deskA = Math.hypot(a.x, a.z) < DESK + 0.1;
    const deskB = Math.hypot(b.x, b.z) < DESK + 0.1;
    const p0 = new THREE.Vector3();
    const p1 = new THREE.Vector3();
    const clear = (x0: number, z0: number, x1: number, z1: number, endA: boolean, endB: boolean) => {
      if (!(endA && deskA) && !(endB && deskB) && segHitsCircle(x0, z0, x1, z1, DESK)) return false;
      for (const o of rooms) {
        // a room the robot (or its goal) stands at the edge of still can't be walked through: only its margin is waived
        const m = (endA && skipA.includes(o)) || (endB && skipB.includes(o)) ? -0.2 : 0.2;
        p0.set(x0, 0, z0);
        p1.set(x1, 0, z1);
        o.h.group.worldToLocal(p0);
        o.h.group.worldToLocal(p1);
        const hit = o.r ? segHitsCircle(p0.x, p0.z, p1.x, p1.z, o.h.fr + m) : segHitsBox(p0.x, p0.z, p1.x, p1.z, o.h.fw + m, o.h.fd + m);
        if (hit) return false;
      }
      return true;
    };
    if (clear(a.x, a.z, b.x, b.z, true, true)) return [];
    // graph nodes: a, b, room corners, points round the desk
    const nodes: THREE.Vector3[] = [a, b];
    for (const o of rooms) {
      const ex = (o.r ? o.h.fr : o.h.fw) + 0.9;
      const ez = (o.r ? o.h.fr : o.h.fd) + 0.9;
      for (const [cx, cz] of [[ex, ez], [-ex, ez], [ex, -ez], [-ex, -ez]]) nodes.push(o.h.group.localToWorld(new THREE.Vector3(cx, 0, cz)));
    }
    for (let i = 0; i < 8; i++) {
      const ang = (i / 8) * Math.PI * 2;
      nodes.push(new THREE.Vector3(Math.sin(ang) * (DESK + 1.2), 0, Math.cos(ang) * (DESK + 1.2)));
    }
    // drop corners that land inside another room or off the floor
    const usable = nodes.filter((n, i) => i < 2 || (Math.hypot(n.x, n.z) < 28 && !rooms.some((o) => inRoom(n.x, n.z, o))));
    const N = usable.length;
    const dist = new Array(N).fill(Infinity);
    const prev = new Array(N).fill(-1);
    const done = new Array(N).fill(false);
    dist[0] = 0;
    for (;;) {
      let u = -1;
      for (let i = 0; i < N; i++) if (!done[i] && dist[i] < Infinity && (u < 0 || dist[i] < dist[u])) u = i;
      if (u < 0 || u === 1) break;
      done[u] = true;
      for (let w = 0; w < N; w++) {
        if (done[w] || w === u) continue;
        const d = dist[u] + usable[u].distanceTo(usable[w]);
        if (d >= dist[w]) continue;
        if (!clear(usable[u].x, usable[u].z, usable[w].x, usable[w].z, u === 0, w === 1)) continue;
        dist[w] = d;
        prev[w] = u;
      }
    }
    if (prev[1] < 0) return []; // no way round found: walk straight
    const route: THREE.Vector3[] = [];
    for (let k = prev[1]; k > 0; k = prev[k]) route.unshift(usable[k].clone());
    return route;
  }

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
        // Mostly sideways, a little apart: a walker slides round whoever is in its way instead of being held
        // in place by a straight push that cancels its step (which looked like walking on the spot).
        const nx = dx / d;
        const nz = dz / d;
        if (a.walk > 0) move(a, nx * 0.4 - nz, nz * 0.4 + nx, push * mover);
        if (b.walk > 0) move(b, -nx * 0.4 + nz, -nz * 0.4 - nx, push * mover);
      }
    }
  }

  /** Where the camera looks when nothing is picked: the middle of the deck. */
  private homeTarget() {
    return this.view === "outside" ? new THREE.Vector3(0, 5.5, 42) : HOME_TARGET.clone();
  }

  private homePhi() {
    return this.view === "outside" ? 1.3 : this.portrait ? 1.05 : 1.27; // low, like standing in the hall
  }

  /** Switches between the operations floor and the view of the building from outside. */
  setView(v: "inside" | "outside") {
    this.view = v;
    this.roofGroup.visible = v === "outside";
    this.selected = null;
    this.idleSince = performance.now();
    this.tTarget.copy(this.homeTarget());
    this.tDist = this.homeDist();
    this.tPhi = this.homePhi();
    this.tTheta = Math.round(this.theta / (Math.PI * 2)) * Math.PI * 2; // face the front of the building
  }

  private homeDist() {
    if (this.view === "outside") return this.portrait ? 46 : 40;
    return this.portrait ? 30 : 21;
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
      this.tTarget.copy(this.homeTarget());
      this.tDist = this.homeDist();
      this.tPhi = this.homePhi();
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
    // left alone inside, it drifts like a film camera: a slow pan and a glide across the floor between departments
    const cine = idle && this.view === "inside";
    this.swayAmt += ((cine ? 1 : idle ? 0.25 : 0) - this.swayAmt) * (1 - Math.pow(0.4, dt));
    const sway = Math.sin(t * 0.045) * 0.9 * this.swayAmt;
    this.drift.lerp(this.tmp.set(cine ? Math.sin(t * 0.031) * 5 : 0, 0, cine ? Math.cos(t * 0.023) * 3.5 : 0), 1 - Math.pow(0.5, dt));
    this.theta += (this.tTheta - this.theta) * ease;
    this.phi += (this.tPhi - this.phi) * ease;
    this.dist += (this.tDist - this.dist) * ease;
    // a picked robot is followed wherever it walks
    if (this.selected) {
      const sp = this.pods.find((x) => x.id === this.selected);
      if (sp) {
        sp.rig.root.getWorldPosition(this.follow);
        this.tTarget.set(this.follow.x, 1.4, this.follow.z);
      }
    }
    this.target.lerp(this.tTarget, ease);
    const th = this.theta + sway;
    const sp = Math.sin(this.phi);
    const look = this.look.copy(this.target).add(this.drift);
    this.camera.position.set(look.x + this.dist * sp * Math.sin(th), look.y + this.dist * Math.cos(this.phi), look.z + this.dist * sp * Math.cos(th));
    this.camera.lookAt(look);


    // the operations table's edge light: brighter (and breathing) while a command you gave is running
    this.busy += ((this.busyOn ? 1 : 0) - this.busy) * (1 - Math.pow(0.05, dt));
    const glow = this.coreGroup.userData.glow as THREE.MeshBasicMaterial | undefined;
    if (glow) glow.opacity = 0.25 + this.busy * (0.55 + Math.sin(t * 3) * 0.15);
    this.updateLinks(t, dt);

    // pods
    this.separate(dt);
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
      p.rig.glow.emissiveIntensity = s === "sleeping" ? 0.1 : s === "alert" ? (pulse > 0 ? 2 : 0.5) : s === "working" ? 1.4 : 0.85;
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
      p.ringMat.emissiveIntensity = (s === "sleeping" ? 0.12 : 0.35) + (isSel ? 0.8 : 0) + (this.hover === p.id ? 0.35 : 0);
      p.glowMat.color.copy(p.col);
      p.glowMat.opacity = (s === "sleeping" ? 0.04 : s === "alert" ? 0.45 : 0.14) * (0.85 + pulse * 0.15);
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

    }

    // the operations board ticks every second; the light outside follows the clock minute by minute
    if (Math.floor(now / 1000) !== Math.floor(this.lastFrame / 1000)) {
      this.drawBoard();
      const m = new Date().getMinutes();
      if (m !== this.boardMinute) {
        this.boardMinute = m;
        this.applyDaylight();
      }
    }
    // the station screens' traces move a couple of times a second
    if (t - this.panelClock > 0.5) {
      this.panelClock = t;
      for (const p of this.pods) this.drawPanel(p, p.agent);
    }

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
        // a slow device: drop the shadows and the pixel ratio
        this.renderer.shadowMap.enabled = false;
        this.key.castShadow = false;
        this.renderer.setPixelRatio(1);
        this.renderer.setSize(this.w, this.h, false);
      } else {
        this.scene.fog = null;
      }
    }
    if (this.composer) this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.dead = true;
    for (const l of this.links) {
      l.mat.map?.dispose();
      l.mat.dispose();
    }
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
