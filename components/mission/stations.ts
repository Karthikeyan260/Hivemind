import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { placeModel, surface } from "./assets";
import type { Act } from "./robot";

/**
 * Each agent's workplace, furnished like a real department: desks, chairs, monitor setups, racks, shelving, a bench.
 * Every screen shows moving work (code scrolling, logs, charts, a calendar, a document being typed): fast while the
 * agent is really working, slow while it is idle, a dim lock screen while it is asleep on its charging dock.
 * Coordinates are local to the area: x to the right, z toward the open front; `face` is the way the robot turns at a
 * spot (0 = toward the front, Math.PI = toward the back wall where the desks are).
 */

export type StationId = "scheduler" | "autopilot" | "web" | "dream" | "brief" | "reminders" | "apps";
export type Stop = { x: number; z: number; face: number; act: Act; dwell: number };
export type Station = {
  group: THREE.Group;
  work: Stop[];
  idle: Stop[];
  sleep: Stop;
  /** Something the robot holds in its right hand while it works (a pen, a hammer). */
  tool: THREE.Object3D | null;
  update(t: number, dt: number, act: Act, working: boolean): void;
};

type Disposable = { dispose(): void };
type ScreenKind = "code" | "terminal" | "chart" | "graph" | "calendar" | "doc" | "schedule" | "browser" | "cad";
const PI = Math.PI;
const PI2 = Math.PI / 2;
export const HOME: Stop = { x: 0, z: 0.1, face: 0, act: "none", dwell: 3 };

const ROUND = new Set<StationId>(); // every agent now has its own enclosed room (no round platforms)

export function buildStation(id: StationId, accent: THREE.Color | string, track: Disposable[]): Station {
  const g = new THREE.Group();
  const accentHex = "#" + new THREE.Color(accent).getHexString();
  const mat = (color: string, roughness = 0.6, metalness = 0.05) => {
    const m = new THREE.MeshStandardMaterial({ color, roughness, metalness, envMapIntensity: 0.7 });
    track.push(m);
    return m;
  };
  const oak = surface(mat("#9c7b56", 0.55), "oak", 1);
  const steel = mat("#3b3d42", 0.45, 0.8);
  const brushed = mat("#9a9da3", 0.35, 1);
  const plastic = mat("#18191c", 0.5, 0.1);
  const fabric = mat("#2f3238", 0.95);
  const paper = mat("#ecebe6", 0.9);
  const rackMat = mat("#121316", 0.55, 0.6);
  const ledOn = new THREE.MeshBasicMaterial({ color: "#5fd38a" });
  const ledAmber = new THREE.MeshBasicMaterial({ color: "#f0b94a" });
  track.push(ledOn, ledAmber);

  const add = (parent: THREE.Object3D, geo: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(x, y, z);
    parent.add(mesh);
    track.push(geo);
    return mesh;
  };
  const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
  const rbox = (w: number, h: number, d: number, r = 0.02) => new RoundedBoxGeometry(w, h, d, 2, r);
  const cyl = (rt: number, rb: number, h: number, seg = 12) => new THREE.CylinderGeometry(rt, rb, h, seg);
  const holder = (x: number, z: number, yaw = 0, parent: THREE.Object3D = g) => {
    const o = new THREE.Group();
    o.position.set(x, 0, z);
    o.rotation.y = yaw;
    parent.add(o);
    return o;
  };

  // ---------- screens with moving content ----------
  const screens: Array<{ kind: ScreenKind; ctx: CanvasRenderingContext2D; tex: THREE.CanvasTexture; seed: number; last: number }> = [];
  const screen = (parent: THREE.Object3D, kind: ScreenKind, x: number, y: number, z: number, yaw = 0, w = 0.62, h = 0.36) => {
    const o = new THREE.Group();
    o.position.set(x, y, z);
    o.rotation.y = yaw;
    parent.add(o);
    add(o, rbox(w + 0.04, h + 0.04, 0.03, 0.008), plastic, 0, 0, -0.016);
    const c = document.createElement("canvas");
    c.width = 256;
    c.height = Math.round((256 * h) / w);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const m = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
    track.push(tex, m);
    add(o, new THREE.PlaneGeometry(w, h), m, 0, 0, 0.001);
    screens.push({ kind, ctx: c.getContext("2d")!, tex, seed: screens.length * 7.3 + id.length, last: -1 });
    return o;
  };
  /** A monitor on a desk: a stand and foot, the screen tilted back a touch. */
  const deskMonitor = (parent: THREE.Object3D, kind: ScreenKind, x: number, z: number, yaw = 0, w = 0.62, h = 0.36) => {
    const o = holder(x, z, yaw, parent);
    add(o, box(0.22, 0.015, 0.16), steel, 0, 0.82, 0);
    add(o, box(0.04, 0.26, 0.03), steel, 0, 0.95, -0.03);
    const s = screen(o, kind, 0, 1.06 + h / 2 - 0.12, 0, 0, w, h);
    s.rotation.x = -0.06;
    return o;
  };
  const keyboard = (parent: THREE.Object3D, x: number, z: number) => {
    add(parent, box(0.44, 0.02, 0.14), plastic, x, 0.805, z);
    add(parent, box(0.06, 0.02, 0.1), plastic, x + 0.32, 0.805, z);
  };
  /** A desk with an oak or laminate top, steel legs and a modesty panel, its back edge against z = 0 of `o`. */
  const desk = (x: number, z: number, w: number, d: number, yaw = 0) => {
    const o = holder(x, z, yaw);
    // a real office desk (Poly Haven, CC0), fitted to this length and depth, 77 cm tall
    placeModel(o, "desk", { x: 0, z: 0, fit: { w, h: 0.77, d } });
    return o;
  };
  /** An office chair: five-star base, gas lift, seat and back. */
  const chair = (x: number, z: number, yaw: number) => {
    const o = holder(x, z, yaw);
    for (let l = 0; l < 5; l++) {
      const leg = add(o, box(0.3, 0.025, 0.04), steel, 0, 0.05, 0);
      leg.rotation.y = (l / 5) * PI * 2;
      leg.translateX(0.14);
    }
    add(o, cyl(0.025, 0.025, 0.36), brushed, 0, 0.25, 0);
    add(o, rbox(0.48, 0.07, 0.46, 0.03), fabric, 0, 0.46, 0);
    add(o, rbox(0.46, 0.56, 0.06, 0.03), fabric, 0, 0.8, -0.24).rotation.x = 0.1;
    return o;
  };
  /** A charging dock: a floor plate and a slim column with a status light (where the robot rests when asleep). */
  const dock = (x: number, z: number, yaw: number) => {
    const o = holder(x, z, yaw);
    add(o, cyl(0.55, 0.58, 0.04, 32), steel, 0, 0.02, 0);
    add(o, box(0.18, 1.6, 0.12), plastic, 0, 0.82, -0.5);
    add(o, box(0.04, 0.3, 0.01), ledOn, 0, 1.3, -0.437);
    return o;
  };
  const rack = (x: number, z: number, yaw = 0, units = 9) => {
    const o = holder(x, z, yaw);
    add(o, box(0.62, 2.0, 0.8), rackMat, 0, 1.0, 0);
    const leds: THREE.Mesh[] = [];
    for (let u = 0; u < units; u++) {
      const y = 0.2 + u * 0.19;
      add(o, box(0.56, 0.15, 0.01), mat("#1d1f23", 0.5, 0.5), 0, y, 0.405);
      for (let k = 0; k < 3; k++) leds.push(add(o, box(0.018, 0.018, 0.01), k === 2 && u % 4 === 1 ? ledAmber : ledOn, 0.2 + k * 0.03, y + 0.03, 0.412));
    }
    return { o, leds };
  };
  const bookshelf = (x: number, z: number, yaw: number, w: number, rows = 4) => {
    const o = holder(x, z, yaw);
    const H = 0.42 * rows + 0.1;
    for (const sx of [-1, 1]) add(o, box(0.03, H, 0.32), oak, (sx * w) / 2, H / 2, 0);
    add(o, box(w, H, 0.02), oak, 0, H / 2, -0.15);
    const spine = ["#6b3a2e", "#2f4a5c", "#4d5a3a", "#7a6a4f", "#3c3c46", "#8a4b3a", "#2e3a2f", "#5c4a6b", "#9a8a6a", "#44505a"];
    for (let r = 0; r < rows; r++) {
      const y = 0.05 + r * 0.42;
      add(o, box(w, 0.025, 0.32), oak, 0, y, 0);
      let cx = -w / 2 + 0.04;
      let i = r * 3;
      while (cx < w / 2 - 0.08) {
        const bw = 0.03 + ((i * 37) % 5) * 0.008;
        const bh = 0.24 + ((i * 53) % 4) * 0.03;
        if ((i * 11) % 13 === 0) {
          cx += 0.08; // a gap on the shelf
        } else {
          const b = add(o, box(bw, bh, 0.22), mat(spine[i % spine.length], 0.8), cx + bw / 2, y + 0.012 + bh / 2, 0.01);
          if ((i * 7) % 9 === 0) b.rotation.z = 0.12;
          cx += bw + 0.004;
        }
        i++;
      }
    }
    return o;
  };
  /** A wall-mounted or free-standing whiteboard with a hand-drawn architecture diagram. */
  const whiteboard = (parent: THREE.Object3D, x: number, y: number, z: number, yaw: number, w = 1.6, h = 0.95) => {
    const c = document.createElement("canvas");
    c.width = 512;
    c.height = Math.round((512 * h) / w);
    const k = c.getContext("2d")!;
    k.fillStyle = "#f3f3f0";
    k.fillRect(0, 0, c.width, c.height);
    k.strokeStyle = "#2a4f8a";
    k.lineWidth = 3;
    k.font = "18px 'Segoe Print', 'Comic Sans MS', cursive";
    k.fillStyle = "#2a4f8a";
    const boxes: Array<[number, number, string]> = [[40, 40, "client"], [210, 40, "api"], [380, 40, "agent"], [210, 170, "db"], [380, 170, "queue"]];
    for (const [bx, by, label] of boxes) {
      k.strokeRect(bx, by, 100, 56);
      k.fillText(label, bx + 18, by + 34);
    }
    k.strokeStyle = "#b03a2e";
    const arrow = (x1: number, y1: number, x2: number, y2: number) => {
      k.beginPath();
      k.moveTo(x1, y1);
      k.lineTo(x2, y2);
      k.stroke();
    };
    arrow(140, 68, 210, 68);
    arrow(310, 68, 380, 68);
    arrow(260, 96, 260, 170);
    arrow(430, 96, 430, 170);
    k.fillStyle = "#1f6b3a";
    k.fillText("v2: retry + approvals", 40, c.height - 24);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const m = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.4 });
    track.push(tex, m);
    const o = holder(x, z, yaw, parent);
    add(o, box(w + 0.06, h + 0.06, 0.03), brushed, 0, y, -0.02);
    add(o, new THREE.PlaneGeometry(w, h), m, 0, y, 0.001);
    add(o, box(w * 0.6, 0.03, 0.06), brushed, 0, y - h / 2 - 0.03, 0.03);
    return o;
  };
  const plant = (x: number, z: number, scale = 1) => placeModel(g, "plant", { x, z, yaw: x * 2.1 + z, height: 1.25 * scale });
  const deskLamp = (parent: THREE.Object3D, x: number, z: number) => placeModel(parent, "lamp", { x, y: 0.79, z, yaw: -0.6, height: 0.48 });
  const papers = (parent: THREE.Object3D, x: number, z: number, n = 3) => {
    for (let i = 0; i < n; i++) {
      const p = add(parent, box(0.21, 0.003, 0.297), paper, x + i * 0.02, 0.792 + i * 0.003, z + i * 0.01);
      p.rotation.y = (i - 1) * 0.15;
    }
  };
  const mug = (parent: THREE.Object3D, x: number, z: number) => add(parent, cyl(0.04, 0.035, 0.1, 14), mat("#e8e4dc", 0.5), x, 0.84, z);

  let tool: THREE.Object3D | null = null;
  let work: Stop[] = [HOME];
  let idle: Stop[] = [HOME];
  let extra: (t: number, dt: number, act: Act, working: boolean) => void = () => {};
  const round = ROUND.has(id);
  // every area has a charging dock at its front-left, where the robot rests when it is asleep
  const dockAt = round ? { x: -1.6, z: 1.35 } : { x: -1.95, z: 1.45 };
  dock(dockAt.x, dockAt.z, 0.4);
  const sleep: Stop = { x: dockAt.x, z: dockAt.z, face: 0.4, act: "sleep", dwell: 99 };

  switch (id) {
    case "scheduler": {
      // infrastructure: two server racks, a scheduling console, and a real wall clock on a post
      const r1 = rack(-0.75, -1.85);
      const r2 = rack(0.0, -1.85);
      const leds = [...r1.leds, ...r2.leds];
      const d = desk(1.35, -1.0, 1.3, 0.7, -0.55);
      deskMonitor(d, "schedule", -0.25, -0.12, 0, 0.62, 0.36);
      deskMonitor(d, "terminal", 0.38, -0.08, -0.25, 0.48, 0.3);
      keyboard(d, -0.1, 0.12);
      mug(d, 0.48, 0.15);
      chair(1.05, -0.3, PI - 0.55 + 0.4);
      // the clock: hands follow the real time
      const clock = holder(1.2, -2.05);
      add(clock, cyl(0.025, 0.025, 2.0), steel, 0, 1.0, 0);
      const face = add(clock, cyl(0.3, 0.3, 0.05, 40), mat("#f2f0ea", 0.6), 0, 2.2, 0.03);
      face.rotation.x = PI2;
      add(clock, new THREE.TorusGeometry(0.3, 0.025, 8, 40), steel, 0, 2.2, 0.03);
      const hand = (len: number, wdt: number, m: THREE.Material) => {
        const pivot = new THREE.Group();
        pivot.position.set(0, 2.2, 0.065);
        clock.add(pivot);
        add(pivot, box(wdt, len, 0.008), m, 0, len / 2 - 0.03, 0);
        return pivot;
      };
      const hh = hand(0.17, 0.025, plastic);
      const mh = hand(0.25, 0.016, plastic);
      const sh = hand(0.27, 0.006, mat("#b03a2e", 0.5));
      plant(-1.75, -0.6, 0.9);
      const T: Stop = { x: 0.95, z: -0.2, face: PI - 0.55, act: "type", dwell: 9 };
      const R: Stop = { x: -0.4, z: -1.0, face: PI, act: "tidy", dwell: 6 };
      work = [T, R];
      idle = [{ ...T, act: "look", dwell: 7 }, { x: 0.6, z: 1.0, face: 0.3, act: "look", dwell: 5 }];
      extra = (t) => {
        const now = new Date();
        const s = now.getSeconds() + now.getMilliseconds() / 1000;
        const m = now.getMinutes() + s / 60;
        const h = (now.getHours() % 12) + m / 60;
        sh.rotation.z = -(s / 60) * PI * 2;
        mh.rotation.z = -(m / 60) * PI * 2;
        hh.rotation.z = -(h / 12) * PI * 2;
        leds.forEach((l, i) => (l.visible = Math.sin(t * (3 + (i % 5)) + i * 1.7) > -0.6));
      };
      break;
    }
    case "autopilot": {
      // research: an L-shaped desk with three monitors (feeds, charts, a source being read) and a filing cabinet
      const d = desk(-0.2, -1.55, 1.9, 0.75, 0);
      deskMonitor(d, "chart", -0.6, -0.15, 0.22);
      deskMonitor(d, "browser", 0.05, -0.2);
      deskMonitor(d, "chart", 0.7, -0.15, -0.22);
      keyboard(d, 0.05, 0.1);
      papers(d, -0.75, 0.15);
      mug(d, 0.75, 0.18);
      const side = desk(1.45, -0.55, 1.1, 0.65, -PI2);
      papers(side, 0.1, 0.0, 4);
      deskLamp(side, -0.3, -0.15);
      chair(-0.1, -0.6, PI + 0.15);
      placeModel(g, "cabinet", { x: -1.75, z: -0.9, yaw: PI2, height: 1.0 });
      plant(-1.8, 0.0, 0.85);
      const T: Stop = { x: 0.05, z: -0.75, face: PI, act: "type", dwell: 9 };
      const S: Stop = { x: 0.75, z: -0.55, face: PI2, act: "write", dwell: 6 };
      work = [T, S];
      idle = [{ ...T, act: "look", dwell: 7 }, { x: 1.0, z: 1.1, face: -0.4, act: "look", dwell: 5 }];
      break;
    }
    case "web": {
      // development lab: a long desk with three screens (editor, terminal, browser), a network rack, a whiteboard
      const d = desk(-0.45, -1.8, 2.5, 0.75, 0);
      deskMonitor(d, "code", -0.75, -0.15, 0.2);
      deskMonitor(d, "terminal", 0.0, -0.2);
      deskMonitor(d, "browser", 0.75, -0.15, -0.2);
      keyboard(d, 0.0, 0.1);
      mug(d, -1.05, 0.15);
      deskLamp(d, 1.05, -0.1);
      chair(-0.3, -0.85, PI + 0.6);
      const r = rack(1.95, -1.75, 0, 8);
      whiteboard(g, -2.5, 1.5, -0.9, PI2, 1.5, 0.9);
      plant(1.95, 0.2, 0.9);
      const T: Stop = { x: 0.0, z: -1.0, face: PI, act: "type", dwell: 10 };
      const B: Stop = { x: -1.75, z: -0.9, face: -PI2, act: "look", dwell: 6 };
      const K: Stop = { x: 1.55, z: -0.85, face: PI - 0.3, act: "tidy", dwell: 5 };
      work = [T, B, T, K];
      idle = [{ ...B, dwell: 6 }, { ...T, act: "look", dwell: 6 }];
      extra = (t) => r.leds.forEach((l, i) => (l.visible = Math.sin(t * (4 + (i % 4)) + i) > -0.5));
      break;
    }
    case "dream": {
      // memory archive: a workstation showing the memory graph, archive shelving with boxes, a reading lamp
      const d = desk(-0.5, -1.8, 1.8, 0.75, 0);
      deskMonitor(d, "graph", -0.35, -0.15, 0.12, 0.7, 0.4);
      deskMonitor(d, "doc", 0.45, -0.15, -0.15, 0.5, 0.32);
      keyboard(d, 0.0, 0.1);
      deskLamp(d, -0.8, 0.0);
      chair(-0.3, -0.85, PI + 0.35);
      placeModel(g, "rack", { x: 1.75, z: -1.65, yaw: -0.35, height: 1.9 });
      placeModel(g, "cabinet", { x: 1.85, z: -0.55, yaw: -PI2, height: 1.0 });
      plant(1.9, 0.4, 0.8);
      const T: Stop = { x: -0.1, z: -1.0, face: PI, act: "type", dwell: 9 };
      const A: Stop = { x: 1.3, z: -0.85, face: PI - 0.35, act: "tidy", dwell: 6 };
      work = [T, A];
      idle = [{ ...T, act: "look", dwell: 7 }, { x: 0.9, z: 0.9, face: -0.3, act: "look", dwell: 5 }];
      break;
    }
    case "brief": {
      // writing room: bookshelves along the back, a writing desk with a document on screen, a reading chair
      bookshelf(-0.6, -2.05, 0, 2.2);
      bookshelf(1.65, -2.05, 0, 1.4, 4);
      const d = desk(1.2, -0.75, 1.4, 0.7, -PI2 + 0.2);
      deskMonitor(d, "doc", 0.0, -0.15, 0, 0.52, 0.38);
      keyboard(d, 0.0, 0.12);
      papers(d, -0.5, 0.1, 4);
      deskLamp(d, 0.55, -0.05);
      chair(0.45, -0.6, PI2 + 0.2);
      placeModel(g, "armchair", { x: -1.6, z: -0.4, yaw: 0.6, height: 0.85 });
      placeModel(d, "books", { x: -0.45, y: 0.79, z: -0.15, width: 0.42 });
      const W: Stop = { x: 0.55, z: -0.75, face: PI2 + 0.2, act: "write", dwell: 10 };
      const B: Stop = { x: -0.6, z: -1.25, face: PI, act: "tidy", dwell: 6 };
      work = [W, B];
      idle = [{ ...B, act: "look", dwell: 7 }, { x: -0.8, z: 0.6, face: 0.4, act: "look", dwell: 5 }];
      const pen = new THREE.Group();
      add(pen, cyl(0.012, 0.012, 0.16, 8), plastic, 0, -0.08, 0);
      tool = pen;
      break;
    }
    case "reminders": {
      // front desk: a curved reception counter with a calendar screen and a desk phone, a wall planner on a stand
      const counter = holder(0.0, -1.0);
      for (let i = -2; i <= 2; i++) {
        const a = i * 0.32;
        const seg = holder(Math.sin(a) * 1.4, -Math.cos(a) * 1.4 + 1.4, a, counter);
        add(seg, box(0.46, 1.05, 0.12), mat("#5c5650", 0.7), 0, 0.525, 0.18);
        add(seg, box(0.5, 0.04, 0.55), oak, 0, 0.77, 0);
      }
      deskMonitor(counter, "calendar", 0.0, -0.05, 0, 0.62, 0.36);
      add(counter, box(0.22, 0.06, 0.18), plastic, 0.55, 0.81, 0.05);
      add(counter, box(0.18, 0.03, 0.05), plastic, 0.55, 0.86, 0.0);
      add(counter, cyl(0.05, 0.06, 0.04, 16), brushed, -0.55, 0.81, 0.1); // a small service bell
      const planner = holder(1.35, -1.85, -0.3);
      add(planner, box(0.04, 1.8, 0.04), steel, -0.55, 0.9, 0);
      add(planner, box(0.04, 1.8, 0.04), steel, 0.55, 0.9, 0);
      screen(planner, "calendar", 0, 1.45, 0.03, 0, 1.1, 0.7);
      chair(0.0, -1.35, PI);
      plant(-1.7, -0.9, 0.9);
      const D: Stop = { x: 0.0, z: -0.7, face: PI, act: "type", dwell: 9 };
      const P: Stop = { x: 1.0, z: -1.2, face: PI - 0.3, act: "look", dwell: 5 };
      work = [D, P];
      idle = [{ ...D, act: "look", dwell: 7 }, { x: 0.9, z: 0.8, face: 0.2, act: "look", dwell: 5 }];
      break;
    }
    case "apps": {
      // hardware bench: a steel workbench with a vise, parts bins and a soldering station, a 3D printer, a monitor
      const bench = holder(-0.55, -1.8);
      add(bench, box(2.4, 0.05, 0.75), oak, 0, 0.9, 0);
      for (const sx of [-1.15, 1.15]) for (const sz of [-0.32, 0.32]) add(bench, box(0.05, 0.9, 0.05), steel, sx, 0.45, sz);
      add(bench, box(2.3, 0.03, 0.7), steel, 0, 0.25, 0);
      add(bench, box(2.4, 1.0, 0.03), mat("#c7c2b8", 0.8), 0, 1.45, -0.37); // pegboard
      for (let i = 0; i < 6; i++) add(bench, box(0.03, 0.2 + (i % 3) * 0.06, 0.03), steel, -0.9 + i * 0.36, 1.55, -0.34);
      for (let i = 0; i < 8; i++) add(bench, box(0.16, 0.08, 0.2), mat(["#5a6b7a", "#7a5a3a", "#55604a"][i % 3], 0.7), -1.0 + i * 0.12, 0.96, -0.22);
      add(bench, box(0.22, 0.12, 0.16), steel, 0.65, 0.98, 0.15); // vise
      add(bench, box(0.18, 0.08, 0.14), mat("#2a2c30", 0.5), 1.0, 0.97, 0.05); // soldering station
      deskMonitor(bench, "cad", -0.2, -0.12, 0, 0.62, 0.36).position.y = 0.12;
      const printer = holder(1.85, -1.6, -0.3);
      add(printer, box(0.6, 0.75, 0.6), mat("#d8d6d0", 0.6), 0, 0.78, 0);
      add(printer, box(0.5, 0.5, 0.02), mat("#30343a", 0.2, 0.2), 0, 0.82, 0.305);
      add(printer, box(0.7, 0.4, 0.7), steel, 0, 0.2, 0);
      chair(1.0, -0.9, PI + 0.8);
      plant(1.95, 0.5, 0.8);
      const hammer = new THREE.Group();
      add(hammer, cyl(0.018, 0.022, 0.32, 8), oak, 0, -0.14, 0);
      add(hammer, box(0.16, 0.06, 0.06), brushed, 0, -0.31, 0);
      tool = hammer;
      const H: Stop = { x: 0.1, z: -1.0, face: PI, act: "hammer", dwell: 8 };
      const C: Stop = { x: -0.75, z: -1.0, face: PI, act: "type", dwell: 7 };
      const Pr: Stop = { x: 1.45, z: -0.9, face: PI - 0.3, act: "look", dwell: 5 };
      work = [C, H, Pr];
      idle = [{ ...C, act: "look", dwell: 6 }, { x: 0.8, z: 0.9, face: 0.3, act: "look", dwell: 5 }];
      break;
    }
  }

  // ---------- drawing the screens ----------
  const CODE = ["#c792ea", "#82aaff", "#c3e88d", "#f78c6c", "#89ddff", "#ffcb6b"];
  const draw = (s: (typeof screens)[number], t: number, speed: number, asleep: boolean) => {
    const c = s.ctx;
    const W = c.canvas.width;
    const H = c.canvas.height;
    if (asleep) {
      c.fillStyle = "#07080a";
      c.fillRect(0, 0, W, H);
      c.fillStyle = "rgba(200,205,215,0.35)";
      c.font = "600 26px system-ui, sans-serif";
      c.textAlign = "center";
      const now = new Date();
      c.fillText(now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false }), W / 2, H / 2 + 8);
      c.textAlign = "left";
      s.tex.needsUpdate = true;
      return;
    }
    const p = t * speed + s.seed;
    switch (s.kind) {
      case "code":
      case "terminal": {
        const term = s.kind === "terminal";
        c.fillStyle = term ? "#0b0d10" : "#1b1e24";
        c.fillRect(0, 0, W, H);
        const lh = 11;
        const off = (p * 9) % lh;
        const first = Math.floor(p * 9 / lh);
        for (let i = -1; i < H / lh + 1; i++) {
          const n = first + i;
          const y = i * lh - off + 6;
          if (!term) {
            c.fillStyle = "#4b5160";
            c.fillRect(4, y, 10, 3);
          }
          let x = term ? 6 : 22 + ((n * 13) % 4) * 8;
          const segs = 2 + ((n * 7) % 4);
          for (let k = 0; k < segs; k++) {
            const w = 8 + ((n * 31 + k * 17) % 34);
            c.fillStyle = term ? (k === 0 ? "#6ee7a8" : "#9aa3ad") : CODE[(n + k) % CODE.length];
            c.fillRect(x, y, w, 3);
            x += w + 5;
            if (x > W - 10) break;
          }
        }
        if (Math.floor(t * 2) % 2 === 0) {
          c.fillStyle = "#e6e6e6";
          c.fillRect(term ? 8 : 26, H - 12, 6, 8);
        }
        break;
      }
      case "chart": {
        c.fillStyle = "#101318";
        c.fillRect(0, 0, W, H);
        c.strokeStyle = "rgba(255,255,255,0.06)";
        for (let x = 0; x < W; x += 32) {
          c.beginPath();
          c.moveTo(x, 0);
          c.lineTo(x, H);
          c.stroke();
        }
        c.strokeStyle = accentHex;
        c.lineWidth = 2;
        c.beginPath();
        for (let x = 0; x <= W; x += 4) {
          const v = Math.sin((x + p * 30) * 0.03) * 0.25 + Math.sin((x + p * 30) * 0.011 + s.seed) * 0.35;
          const y = H * 0.45 - v * H * 0.3;
          if (x === 0) c.moveTo(x, y);
          else c.lineTo(x, y);
        }
        c.stroke();
        for (let i = 0; i < 10; i++) {
          const v = 0.3 + 0.6 * Math.abs(Math.sin(p * 0.6 + i * 1.3 + s.seed));
          c.fillStyle = i % 3 ? "#5f7f9a" : "#9ab0c4";
          c.fillRect(8 + i * ((W - 16) / 10), H - 6 - v * H * 0.28, (W - 16) / 10 - 4, v * H * 0.28);
        }
        break;
      }
      case "graph": {
        c.fillStyle = "#0d1014";
        c.fillRect(0, 0, W, H);
        const nodes: Array<[number, number]> = [];
        for (let i = 0; i < 14; i++) {
          const a = i * 2.39996 + s.seed;
          const r = 0.12 + ((i * 37) % 10) / 24;
          nodes.push([W / 2 + Math.cos(a + p * 0.05) * r * W * 0.9, H / 2 + Math.sin(a + p * 0.05) * r * H * 0.85]);
        }
        c.strokeStyle = "rgba(160,180,210,0.35)";
        c.lineWidth = 1;
        nodes.forEach(([x, y], i) => {
          const [x2, y2] = nodes[(i * 5 + 3) % nodes.length];
          c.beginPath();
          c.moveTo(x, y);
          c.lineTo(x2, y2);
          c.stroke();
        });
        nodes.forEach(([x, y], i) => {
          const pulse = 0.5 + 0.5 * Math.sin(p * 2 + i);
          c.fillStyle = i % 4 === 0 ? accentHex : `rgba(200,210,225,${0.5 + pulse * 0.5})`;
          c.beginPath();
          c.arc(x, y, 2.5 + (i % 4 === 0 ? 2 * pulse : 0), 0, Math.PI * 2);
          c.fill();
        });
        break;
      }
      case "calendar":
      case "schedule": {
        c.fillStyle = "#f4f3ef";
        c.fillRect(0, 0, W, H);
        const cols = s.kind === "calendar" ? 5 : 1;
        const rows = s.kind === "calendar" ? 8 : 6;
        c.fillStyle = "#2c3440";
        c.fillRect(0, 0, W, 14);
        c.strokeStyle = "#d7d4cc";
        for (let r = 1; r < rows; r++) {
          const y = 14 + (r * (H - 14)) / rows;
          c.beginPath();
          c.moveTo(0, y);
          c.lineTo(W, y);
          c.stroke();
        }
        if (s.kind === "calendar") {
          for (let k = 1; k < cols; k++) {
            c.beginPath();
            c.moveTo((k * W) / cols, 14);
            c.lineTo((k * W) / cols, H);
            c.stroke();
          }
          for (let e = 0; e < 7; e++) {
            const col = (e * 3 + Math.floor(s.seed)) % cols;
            const row = (e * 5) % (rows - 1);
            c.fillStyle = ["#9db7d8", "#c9b38a", "#a9c7a2"][e % 3];
            c.fillRect((col * W) / cols + 3, 16 + (row * (H - 14)) / rows, W / cols - 6, (H - 14) / rows - 3);
          }
        } else {
          // jobs sliding along a timeline
          for (let r = 0; r < rows; r++) {
            const y = 16 + (r * (H - 14)) / rows;
            for (let k = 0; k < 3; k++) {
              const x = ((k * 97 + r * 41 - p * 18) % (W + 60) + W + 60) % (W + 60) - 60;
              c.fillStyle = ["#7f9cc0", "#c4a46e", "#8fb58a"][(r + k) % 3];
              c.fillRect(x, y + 2, 40 + ((r * 13 + k * 7) % 30), (H - 14) / rows - 5);
            }
          }
        }
        // the "now" line sweeps across
        const nx = ((p * 6) % W + W) % W;
        c.fillStyle = "#c0392b";
        c.fillRect(nx, 14, 2, H - 14);
        break;
      }
      case "doc": {
        c.fillStyle = "#fbfaf7";
        c.fillRect(0, 0, W, H);
        c.fillStyle = "#2b2b2b";
        c.fillRect(14, 10, 90, 6);
        const total = 22;
        const typed = Math.floor(p * 1.6) % (total + 6);
        for (let i = 0; i < Math.min(typed, total); i++) {
          const y = 26 + i * 7;
          if (y > H - 8) break;
          const w = i === typed - 1 ? ((p * 40) % 1) * (W - 40) : W - 30 - ((i * 23) % 50);
          c.fillStyle = "#8d8d8d";
          c.fillRect(14, y, Math.max(4, w), 2.5);
        }
        break;
      }
      case "browser": {
        c.fillStyle = "#f5f5f3";
        c.fillRect(0, 0, W, H);
        c.fillStyle = "#e1e1dd";
        c.fillRect(0, 0, W, 16);
        c.fillStyle = "#ffffff";
        c.fillRect(30, 4, W - 60, 8);
        const off = (p * 14) % 60;
        for (let i = 0; i < 6; i++) {
          const y = 22 + i * 30 - off;
          c.fillStyle = "#cfd6de";
          c.fillRect(10, y, 46, 22);
          c.fillStyle = "#6b7684";
          c.fillRect(64, y + 2, W - 90 - ((i * 19) % 40), 4);
          c.fillStyle = "#a7afb8";
          c.fillRect(64, y + 10, W - 110 - ((i * 29) % 50), 3);
          c.fillRect(64, y + 16, W - 130 - ((i * 11) % 40), 3);
        }
        break;
      }
      case "cad": {
        c.fillStyle = "#1a1d22";
        c.fillRect(0, 0, W, H);
        c.strokeStyle = "rgba(255,255,255,0.07)";
        for (let x = 0; x < W; x += 16) {
          c.beginPath();
          c.moveTo(x, 0);
          c.lineTo(x, H);
          c.stroke();
        }
        c.save();
        c.translate(W / 2, H / 2);
        c.rotate(p * 0.3);
        c.strokeStyle = accentHex;
        c.lineWidth = 1.5;
        const r = H * 0.32;
        c.beginPath();
        for (let i = 0; i <= 6; i++) {
          const a = (i / 6) * Math.PI * 2;
          if (i === 0) c.moveTo(Math.cos(a) * r, Math.sin(a) * r);
          else c.lineTo(Math.cos(a) * r, Math.sin(a) * r);
        }
        c.stroke();
        c.strokeRect(-r * 0.5, -r * 0.5, r, r);
        c.restore();
        break;
      }
    }
    s.tex.needsUpdate = true;
  };

  return {
    group: g,
    work,
    idle,
    sleep,
    tool,
    update(t, dt, act, working) {
      extra(t, dt, act, working);
      const asleep = act === "sleep";
      // redraw a few times a second: quicker while the agent is really working
      const fps = asleep ? 0.5 : working ? 8 : 3;
      for (const s of screens) {
        if (t - s.last < 1 / fps) continue;
        s.last = t;
        draw(s, t, working ? 1 : 0.25, asleep);
      }
    },
  };
}
