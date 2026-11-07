import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import type { Act } from "./robot";

/**
 * What each robot does around its plinth: a small set (monitor, telescope, workbench, bed...) and the
 * route it walks between spots, doing its job at each one. Coordinates are local to the pod: x to the
 * right, z toward the middle of the deck; `face` is the way the robot turns at a spot (0 = toward z).
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
const PI2 = Math.PI / 2;
export const HOME: Stop = { x: 0, z: 0.1, face: 0, act: "none", dwell: 3 };

export function buildStation(id: StationId, accent: THREE.Color | string, track: Disposable[]): Station {
  const g = new THREE.Group();
  const frame = new THREE.MeshStandardMaterial({ color: "#1a1f2e", metalness: 0.8, roughness: 0.45, envMapIntensity: 0.9 });
  const top = new THREE.MeshStandardMaterial({ color: "#2b3347", metalness: 0.5, roughness: 0.5, envMapIntensity: 0.8 });
  const steel = new THREE.MeshStandardMaterial({ color: "#aab3c6", metalness: 1, roughness: 0.3, envMapIntensity: 1.1 });
  const glow = new THREE.MeshStandardMaterial({ color: "#05070d", emissive: accent, emissiveIntensity: 1.8 });
  const screenDark = new THREE.MeshBasicMaterial({ color: "#060b16", toneMapped: false });
  const barMat = new THREE.MeshBasicMaterial({ color: accent, toneMapped: false });
  const paper = new THREE.MeshStandardMaterial({ color: "#eef1f8", roughness: 0.8 });
  const gold = new THREE.MeshStandardMaterial({ color: "#f2c14e", metalness: 1, roughness: 0.28 });
  track.push(frame, top, steel, glow, screenDark, barMat, paper, gold);

  const add = (parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
    track.push(geo);
    return m;
  };
  const rbox = (w: number, h: number, d: number, r = 0.03) => new RoundedBoxGeometry(w, h, d, 3, r);
  const cyl = (rt: number, rb: number, h: number, seg = 14) => new THREE.CylinderGeometry(rt, rb, h, seg);
  const holder = (x: number, z: number, yaw = 0) => {
    const o = new THREE.Group();
    o.position.set(x, 0, z);
    o.rotation.y = yaw;
    g.add(o);
    return o;
  };

  const texture = (draw: (c: CanvasRenderingContext2D, w: number, h: number) => void, w = 256, h = 192) => {
    const cv = document.createElement("canvas");
    cv.width = w;
    cv.height = h;
    draw(cv.getContext("2d")!, w, h);
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    track.push(t);
    return t;
  };
  const hex = "#" + new THREE.Color(accent).getHexString();

  /** A monitor on a stand whose screen fills with moving lines while the robot is at it. */
  const monitor = (parent: THREE.Object3D, x: number, y: number, z: number, yaw: number, scale = 1) => {
    const m = new THREE.Group();
    m.position.set(x, y, z);
    m.rotation.y = yaw;
    m.scale.setScalar(scale);
    parent.add(m);
    add(m, cyl(0.05, 0.07, 0.4), steel, 0, 0.2, 0);
    add(m, rbox(0.7, 0.05, 0.4), frame, 0, 0.03, 0);
    const scr = new THREE.Group();
    scr.position.y = 0.9;
    m.add(scr);
    add(scr, rbox(1.25, 0.8, 0.07, 0.04), frame);
    add(scr, new THREE.PlaneGeometry(1.12, 0.66), screenDark, 0, 0, 0.04);
    const head = add(scr, new THREE.PlaneGeometry(1.12, 0.06), barMat, 0, 0.3, 0.045);
    head.castShadow = false;
    const bars: THREE.Mesh[] = [];
    for (let r = 0; r < 5; r++) {
      const b = add(scr, new THREE.PlaneGeometry(1, 0.05), barMat, 0, 0.19 - r * 0.1, 0.045);
      b.castShadow = false;
      bars.push(b);
    }
    return {
      bars,
      tick(t: number, live: boolean) {
        bars.forEach((b, r) => {
          const w = live ? 0.25 + 0.7 * (0.5 + 0.5 * Math.sin(t * (2 + r * 0.7) + r * 1.9)) : 0.18;
          b.scale.x = w * 0.5;
          b.position.x = -0.5 + (w * 0.5) / 2 + 0.06;
        });
      },
    };
  };

  const desk = (x: number, z: number, w = 1.3, d = 0.8) => {
    const o = holder(x, z);
    add(o, rbox(w, 0.07, d, 0.02), top, 0, 0.78, 0);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(o, cyl(0.035, 0.035, 0.78, 8), frame, sx * (w / 2 - 0.08), 0.39, sz * (d / 2 - 0.08));
    return o;
  };

  const shelf = (x: number, z: number, cubeColours: string[]) => {
    const o = holder(x, z, -0.55);
    for (const sx of [-0.55, 0.55]) add(o, rbox(0.05, 1.7, 0.4, 0.015), frame, sx, 0.85, 0);
    for (const y of [0.35, 0.95, 1.55]) add(o, rbox(1.15, 0.05, 0.4, 0.015), top, 0, y, 0);
    const cubes: THREE.Mesh[] = [];
    cubeColours.forEach((c, i) => {
      const m = new THREE.MeshStandardMaterial({ color: "#0b1020", emissive: c, emissiveIntensity: 1.6, roughness: 0.3 });
      track.push(m);
      const cube = add(o, rbox(0.2, 0.2, 0.2, 0.04), m, -0.35 + (i % 3) * 0.35, 0.5 + Math.floor(i / 3) * 0.6, 0);
      cubes.push(cube);
    });
    return { o, cubes };
  };

  const board = (x: number, z: number, yaw: number, kind: "calendar" | "notes") => {
    const o = holder(x, z, yaw);
    for (const sx of [-0.6, 0.6]) add(o, cyl(0.035, 0.035, 1.9, 8), frame, sx, 0.95, 0);
    const tex = texture((c, w, h) => {
      c.fillStyle = "#10162a";
      c.fillRect(0, 0, w, h);
      c.strokeStyle = hex;
      c.lineWidth = 4;
      c.strokeRect(4, 4, w - 8, h - 8);
      if (kind === "calendar") {
        c.fillStyle = hex;
        c.fillRect(8, 8, w - 16, 30);
        c.strokeStyle = "rgba(255,255,255,0.25)";
        c.lineWidth = 1.5;
        for (let i = 1; i < 7; i++) {
          c.beginPath();
          c.moveTo(8 + (i * (w - 16)) / 7, 38);
          c.lineTo(8 + (i * (w - 16)) / 7, h - 8);
          c.stroke();
        }
        for (let i = 1; i < 5; i++) {
          c.beginPath();
          c.moveTo(8, 38 + (i * (h - 46)) / 5);
          c.lineTo(w - 8, 38 + (i * (h - 46)) / 5);
          c.stroke();
        }
        c.fillStyle = "#fb7185";
        c.beginPath();
        c.arc(8 + 3.5 * ((w - 16) / 7), 38 + 2.5 * ((h - 46) / 5), 14, 0, Math.PI * 2);
        c.fill();
      } else {
        const cols = ["#fde68a", "#a7f3d0", "#fbcfe8", "#bae6fd", "#ddd6fe", "#fed7aa"];
        cols.forEach((col, i) => {
          c.fillStyle = col;
          c.save();
          c.translate(24 + (i % 3) * 76, 20 + Math.floor(i / 3) * 78);
          c.rotate(((i * 37) % 9) / 60 - 0.07);
          c.fillRect(0, 0, 62, 62);
          c.fillStyle = "rgba(0,0,0,0.35)";
          for (let l = 0; l < 3; l++) c.fillRect(8, 14 + l * 14, 46, 3);
          c.restore();
        });
      }
    });
    const mat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
    track.push(mat);
    const plane = add(o, new THREE.PlaneGeometry(1.15, 0.86), mat, 0, 1.3, 0.03);
    plane.castShadow = false;
    return o;
  };

  let tool: THREE.Object3D | null = null;
  let work: Stop[] = [HOME];
  let idle: Stop[] = [HOME];
  const sleep: Stop = { x: 0, z: 0, face: 0, act: "sleep", dwell: 99 };
  let tick: (t: number, dt: number, act: Act, working: boolean) => void = () => {};

  switch (id) {
    case "scheduler": {
      const post = holder(1.55, 0.4, -0.6);
      add(post, cyl(0.06, 0.08, 1.1), frame, 0, 0.55, 0);
      const clock = new THREE.Group();
      clock.position.y = 1.55;
      clock.scale.setScalar(1.5);
      post.add(clock);
      add(clock, new THREE.TorusGeometry(0.46, 0.055, 14, 56), gold);
      add(clock, cyl(0.42, 0.42, 0.05, 48), frame).rotation.x = PI2;
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        add(clock, new THREE.BoxGeometry(0.025, i % 3 === 0 ? 0.1 : 0.05, 0.02), glow, Math.sin(a) * 0.35, Math.cos(a) * 0.35, 0.04).rotation.z = -a;
      }
      const minute = new THREE.Group();
      clock.add(minute);
      add(minute, new THREE.BoxGeometry(0.035, 0.34, 0.03), glow, 0, 0.17, 0.06);
      const hour = new THREE.Group();
      clock.add(hour);
      add(hour, new THREE.BoxGeometry(0.05, 0.22, 0.03), steel, 0, 0.11, 0.05);

      const stand = holder(-1.55, 0.4, 0.5);
      add(stand, cyl(0.06, 0.08, 0.9), frame, 0, 0.45, 0);
      const gear = new THREE.Group();
      gear.position.y = 1.1;
      stand.add(gear);
      add(gear, cyl(0.5, 0.5, 0.1, 32), steel).rotation.x = PI2;
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        const tooth = add(gear, new THREE.BoxGeometry(0.14, 0.14, 0.1), steel, Math.sin(a) * 0.56, Math.cos(a) * 0.56, 0);
        tooth.rotation.z = -a;
      }
      add(gear, cyl(0.12, 0.12, 0.16, 16), gold).rotation.x = PI2;
      add(gear, cyl(0.03, 0.03, 0.4, 8), steel, 0.3, 0, 0.18).rotation.z = PI2 * 0;
      add(gear, new THREE.SphereGeometry(0.07, 10, 8), glow, 0.3, 0.2, 0.18);

      const A: Stop = { x: 0.6, z: 0.4, face: PI2, act: "look", dwell: 5 };
      const B: Stop = { x: -0.6, z: 0.4, face: -PI2, act: "crank", dwell: 6 };
      work = [B, A];
      idle = [{ ...A, dwell: 7 }, HOME];
      tick = (t, dt, act, working) => {
        minute.rotation.z -= dt * (working ? 1.3 : 0.15);
        hour.rotation.z = minute.rotation.z / 12;
        gear.rotation.z += dt * (act === "crank" ? 3 : 0.15);
      };
      break;
    }
    case "autopilot": {
      const tel = holder(1.55, 0.6, 0);
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2;
        const leg = add(tel, cyl(0.025, 0.035, 1.4, 8), frame, Math.sin(a) * 0.28, 0.65, Math.cos(a) * 0.28);
        leg.rotation.set(Math.cos(a) * 0.2, 0, -Math.sin(a) * 0.2);
      }
      const head = new THREE.Group();
      head.position.y = 1.3;
      tel.add(head);
      const tube = new THREE.Group();
      tube.rotation.z = 0.45;
      head.add(tube);
      add(tube, cyl(0.1, 0.13, 1.1, 20), steel).rotation.z = PI2;
      add(tube, cyl(0.15, 0.15, 0.12, 20), gold, 0.55, 0, 0).rotation.z = PI2;
      add(tube, cyl(0.06, 0.06, 0.2, 14), frame, -0.6, 0, 0).rotation.z = PI2;
      const mon = monitor(g, -1.55, 0, 0.5, Math.PI / 4);
      const S: Stop = { x: 0.6, z: 0.6, face: PI2, act: "scope", dwell: 6 };
      const M: Stop = { x: -0.7, z: 0.5, face: -PI2, act: "type", dwell: 5 };
      work = [S, M];
      idle = [{ ...M, act: "look", dwell: 6 }, HOME];
      tick = (t, dt, act) => {
        head.rotation.y = Math.sin(t * 0.6) * (act === "scope" ? 0.5 : 0.1);
        mon.tick(t, act === "type" || act === "look");
      };
      break;
    }
    case "web": {
      desk(1.5, 0.4);
      const mon = monitor(g, 1.5, 0.82, 0.35, -Math.PI / 4, 1.1);
      const W: Stop = { x: 0.5, z: 0.4, face: PI2, act: "type", dwell: 9 };
      work = [W, { ...HOME, act: "look", dwell: 2 }];
      idle = [{ ...W, act: "look", dwell: 6 }, HOME];
      tick = (t, dt, act) => mon.tick(t, act === "type" || act === "look");
      break;
    }
    case "dream": {
      const bed = holder(-1.45, 0.3, 0.15);
      add(bed, rbox(0.95, 0.28, 1.9, 0.06), frame, 0, 0.2, 0);
      const mattress = new THREE.MeshStandardMaterial({ color: "#2b3562", roughness: 0.9 });
      const pillow = new THREE.MeshStandardMaterial({ color: "#d9defa", roughness: 0.9 });
      track.push(mattress, pillow);
      add(bed, rbox(0.85, 0.16, 1.8, 0.07), mattress, 0, 0.42, 0);
      add(bed, rbox(0.6, 0.12, 0.38, 0.05), pillow, 0, 0.56, -0.62);
      const lamp = add(bed, new THREE.SphereGeometry(0.1, 14, 10), glow, 0.65, 0.62, -0.7);
      lamp.castShadow = false;
      const { cubes } = shelf(1.55, 0.35, ["#818cf8", "#a78bfa", "#38bdf8", "#f0abfc", "#6ee7b7", "#fde68a"]);
      const T: Stop = { x: 0.6, z: 0.4, face: PI2, act: "tidy", dwell: 6 };
      work = [T];
      idle = [T, { ...HOME, act: "look", dwell: 3 }];
      sleep.x = -1.45;
      sleep.z = 1.15;
      sleep.face = 0;
      tick = (t, dt, act) => {
        cubes.forEach((c, i) => {
          c.rotation.y += dt * (act === "tidy" ? 1.8 : 0.4);
          c.rotation.x = Math.sin(t + i) * 0.15;
        });
      };
      break;
    }
    case "brief": {
      desk(1.5, 0.4);
      const sheet = add(g, rbox(0.55, 0.012, 0.75, 0.005), paper, 1.5, 0.83, 0.4);
      sheet.rotation.y = 0.2;
      for (let i = 0; i < 3; i++) add(g, rbox(0.4, 0.008, 0.02, 0.003), frame, 1.5, 0.84, 0.2 + i * 0.12).rotation.y = 0.2;
      const lampPost = holder(1.95, 0.7);
      add(lampPost, cyl(0.02, 0.03, 0.55, 8), steel, 0, 1.05, 0);
      add(lampPost, new THREE.ConeGeometry(0.14, 0.18, 16, 1, true), glow, 0, 1.42, 0);
      board(-1.55, 0.3, 0.6, "notes");
      const pen = new THREE.Group();
      add(pen, cyl(0.012, 0.012, 0.26, 8), frame, 0, -0.17, 0.03).rotation.x = 0.35;
      add(pen, new THREE.SphereGeometry(0.016, 8, 6), glow, 0, -0.29, 0.07);
      tool = pen;
      const D: Stop = { x: 0.5, z: 0.4, face: PI2, act: "write", dwell: 7 };
      const P: Stop = { x: -0.7, z: 0.3, face: -PI2, act: "look", dwell: 4 };
      work = [D, P];
      idle = [{ ...P, dwell: 6 }, HOME];
      break;
    }
    case "reminders": {
      const post = holder(1.55, 0.4, -0.5);
      add(post, cyl(0.06, 0.08, 2), frame, 0, 1, 0);
      add(post, rbox(0.9, 0.07, 0.07, 0.02), frame, -0.4, 2, 0);
      const bellG = new THREE.Group();
      bellG.position.set(-0.7, 2, 0);
      post.add(bellG);
      const pts = [[0.05, 0], [0.38, 0.05], [0.34, 0.3], [0.22, 0.52], [0.08, 0.66], [0, 0.68]].map(([x, y]) => new THREE.Vector2(x, y));
      const bell = add(bellG, new THREE.LatheGeometry(pts, 32), gold, 0, -0.7, 0);
      (bell.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
      add(bellG, new THREE.SphereGeometry(0.08, 10, 8), glow, 0, -0.68, 0);
      add(post, cyl(0.012, 0.012, 0.9, 6), steel, -0.7, 1.55, 0);
      board(-1.55, 0.3, 0.6, "calendar");
      const R: Stop = { x: 0.6, z: 0.4, face: PI2, act: "ring", dwell: 5 };
      const C: Stop = { x: -0.7, z: 0.3, face: -PI2, act: "look", dwell: 4 };
      work = [R, C];
      idle = [{ ...C, dwell: 6 }, HOME];
      tick = (t, dt, act) => {
        bellG.rotation.z = Math.sin(t * (act === "ring" ? 9 : 1.5)) * (act === "ring" ? 0.5 : 0.04);
      };
      break;
    }
    case "apps": {
      const bench = holder(1.5, 0.4);
      add(bench, rbox(1.3, 0.1, 0.8, 0.03), top, 0, 0.8, 0);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(bench, rbox(0.08, 0.8, 0.08, 0.02), frame, sx * 0.55, 0.4, sz * 0.3);
      const appMat = new THREE.MeshStandardMaterial({ color: "#0b1020", emissive: accent, emissiveIntensity: 1.2, roughness: 0.3 });
      track.push(appMat);
      const appCube = add(bench, rbox(0.5, 0.5, 0.5, 0.1), appMat, 0, 1.13, 0);
      const { cubes } = shelf(-1.55, 0.4, ["#38bdf8", "#f472b6", "#a78bfa", "#34d399", "#fb923c", "#fde68a"]);
      const hammer = new THREE.Group();
      add(hammer, cyl(0.022, 0.026, 0.5, 8), frame, 0, -0.2, 0);
      add(hammer, rbox(0.3, 0.13, 0.13, 0.025), steel, 0, -0.47, 0);
      tool = hammer;
      const H: Stop = { x: 0.5, z: 0.4, face: PI2, act: "hammer", dwell: 8 };
      const F: Stop = { x: -0.7, z: 0.4, face: -PI2, act: "look", dwell: 4 };
      work = [H, F];
      idle = [{ ...F, dwell: 6 }, HOME];
      tick = (t, dt, act) => {
        appCube.scale.setScalar(1 + (act === "hammer" ? Math.max(0, Math.sin(t * 7)) * 0.05 : 0));
        appCube.rotation.y += dt * (act === "hammer" ? 0.6 : 0.15);
        cubes.forEach((c, i) => (c.rotation.y += dt * 0.3 + i * 0.0005));
      };
      break;
    }
  }

  // ---- chunky toy-like detail: bright rounded plastic pieces with lots of small parts, animated while working ----
  const toy = (c: string, rough = 0.42) => {
    const m = new THREE.MeshStandardMaterial({ color: c, roughness: rough, metalness: 0.05, envMapIntensity: 0.8 });
    track.push(m);
    return m;
  };
  const makeGear = (r: number, teeth: number, mat: THREE.Material, hub: THREE.Material) => {
    const gr = new THREE.Group();
    add(gr, cyl(r, r, 0.12, 28), mat).rotation.x = PI2;
    for (let i = 0; i < teeth; i++) {
      const ang = (i / teeth) * Math.PI * 2;
      add(gr, new THREE.BoxGeometry(r * 0.3, r * 0.34, 0.12), mat, Math.sin(ang) * (r + r * 0.1), Math.cos(ang) * (r + r * 0.1), 0).rotation.z = -ang;
    }
    add(gr, cyl(r * 0.35, r * 0.35, 0.16, 18), hub).rotation.x = PI2;
    add(gr, cyl(r * 0.12, r * 0.12, 0.2, 10), mat).rotation.x = PI2;
    return gr;
  };
  const bookRow = (parent: THREE.Object3D, x: number, y: number, z: number, n: number, colours: string[]) => {
    let cx = x;
    for (let i = 0; i < n; i++) {
      const w = 0.07 + ((i * 37) % 5) * 0.012;
      const h = 0.3 + ((i * 53) % 4) * 0.05;
      add(parent, rbox(w, h, 0.22, 0.012), toy(colours[i % colours.length]), cx, y + h / 2, z);
      cx += w + 0.012;
    }
  };
  let extraTick: ((t: number, dt: number, act: Act, working: boolean) => void) | null = null;
  const wallBoard = (x: number, y: number, z: number, w: number, h: number, draw: (c: CanvasRenderingContext2D, cw: number, ch: number) => void) => {
    const tx = texture(draw, 512, Math.round((512 * h) / w));
    const mt = new THREE.MeshBasicMaterial({ map: tx, toneMapped: false });
    track.push(mt);
    const o = add(g, new THREE.PlaneGeometry(w, h), mt, x, y, z);
    o.castShadow = false;
    return o;
  };

  switch (id) {
    case "scheduler": {
      // a clockwork wall: a big board of meshing brass gears with a swinging pendulum
      add(g, rbox(3.6, 2.5, 0.14, 0.05), toy("#5b3d28", 0.6), 0, 1.65, -2.05);
      const gearMat = toy("#d99a2b", 0.3);
      const hubMat = toy("#7a4b1a", 0.4);
      const gA = makeGear(0.7, 12, gearMat, hubMat);
      gA.position.set(-0.9, 1.9, -1.93);
      const gB = makeGear(0.45, 9, toy("#c0c6d4", 0.3), hubMat);
      gB.position.set(0.15, 2.1, -1.93);
      const gC = makeGear(0.55, 10, toy("#ef6a5a", 0.4), hubMat);
      gC.position.set(0.95, 1.45, -1.93);
      const gD = makeGear(0.32, 8, gearMat, hubMat);
      gD.position.set(-0.2, 1.1, -1.93);
      g.add(gA, gB, gC, gD);
      const pend = new THREE.Group();
      pend.position.set(1.4, 2.7, -1.9);
      add(pend, cyl(0.02, 0.02, 1.2, 6), toy("#d99a2b", 0.3), 0, -0.6, 0);
      add(pend, new THREE.SphereGeometry(0.2, 18, 14), toy("#f2c14e", 0.25), 0, -1.25, 0);
      g.add(pend);
      extraTick = (t, dt, act, working) => {
        const sp = working ? 1.3 : 0.25;
        gA.rotation.z += dt * sp * 0.6;
        gB.rotation.z -= dt * sp * 0.9;
        gC.rotation.z -= dt * sp * 0.6 * (0.7 / 0.55);
        gD.rotation.z += dt * sp * 1.2;
        pend.rotation.z = Math.sin(t * (working ? 3.2 : 1.8)) * 0.35;
      };
      break;
    }
    case "autopilot": {
      // star chart on the wall and a toy planet model whose rings turn
      wallBoard(0, 1.7, -2.16, 2.8, 1.5, (c, w, h) => {
        c.fillStyle = "#0a1030";
        c.fillRect(0, 0, w, h);
        let sd = 5;
        const r = () => ((sd = (sd * 16807) % 2147483647) / 2147483647);
        c.fillStyle = "#ffffff";
        const pts: Array<[number, number]> = [];
        for (let i = 0; i < 70; i++) {
          const px = r() * w;
          const py = r() * h;
          pts.push([px, py]);
          c.globalAlpha = 0.4 + r() * 0.6;
          c.fillRect(px, py, 3, 3);
        }
        c.globalAlpha = 0.5;
        c.strokeStyle = "#7dd3fc";
        c.lineWidth = 2;
        for (let i = 0; i < 22; i += 2) {
          c.beginPath();
          c.moveTo(pts[i][0], pts[i][1]);
          c.lineTo(pts[i + 1][0], pts[i + 1][1]);
          c.stroke();
        }
        c.globalAlpha = 1;
        c.strokeStyle = "#3b82f6";
        c.lineWidth = 6;
        c.strokeRect(3, 3, w - 6, h - 6);
      });
      const model = holder(-0.3, -1.3);
      add(model, cyl(0.07, 0.1, 0.8, 10), toy("#475569", 0.4), 0, 0.4, 0);
      add(model, cyl(0.28, 0.32, 0.1, 20), toy("#475569", 0.4), 0, 0.06, 0);
      const planet = new THREE.Group();
      planet.position.y = 1.15;
      model.add(planet);
      add(planet, new THREE.SphereGeometry(0.34, 24, 18), toy("#38bdf8", 0.35));
      const orbitRing = add(planet, new THREE.TorusGeometry(0.58, 0.035, 8, 40), toy("#fde68a", 0.3));
      orbitRing.rotation.x = 1.2;
      const moon = add(planet, new THREE.SphereGeometry(0.09, 12, 10), toy("#f1f5f9", 0.4), 0.8, 0, 0);
      const tel = g.children[0]; // the telescope set is built first; make it chunkier
      tel.scale.setScalar(1.3);
      extraTick = (t, dt, act, working) => {
        planet.rotation.y += dt * (working ? 1.2 : 0.4);
        orbitRing.rotation.z += dt * 0.3;
        moon.position.set(Math.cos(t * 1.5) * 0.8, Math.sin(t * 1.5) * 0.15, Math.sin(t * 1.5) * 0.8);
      };
      break;
    }
    case "web": {
      // a proper control desk: three screens, keyboard, mug, and a wall of live data
      const m2 = monitor(g, 0.95, 0.82, 0.1, -0.45, 0.85);
      const m3 = monitor(g, 2.05, 0.82, 0.55, -1.05, 0.85);
      add(g, rbox(0.55, 0.035, 0.2, 0.015), toy("#14b8a6"), 1.35, 0.85, 0.7).rotation.y = -0.4;
      add(g, cyl(0.07, 0.06, 0.13, 14), toy("#ef4444"), 1.95, 0.9, 0.1);
      wallBoard(0, 1.9, -2.16, 3.4, 1.4, (c, w, h) => {
        c.fillStyle = "#08122a";
        c.fillRect(0, 0, w, h);
        const cols = ["#38bdf8", "#34d399", "#f472b6", "#fbbf24"];
        for (let i = 0; i < 4; i++) {
          c.fillStyle = "rgba(255,255,255,0.08)";
          c.fillRect(14 + i * ((w - 28) / 4), 14, (w - 28) / 4 - 10, h - 28);
          c.fillStyle = cols[i];
          for (let k = 0; k < 11; k++) c.fillRect(24 + i * ((w - 28) / 4), 30 + k * 22, 30 + ((k * 53 + i * 31) % 90), 8);
        }
      });
      extraTick = (t, dt, act) => {
        m2.tick(t + 1.3, act === "type" || act === "look");
        m3.tick(t + 2.6, act === "type" || act === "look");
      };
      break;
    }
    case "dream": {
      // cosy bedroom: headboard, blanket, plush toy, moon and stars
      const bed = holder(-1.45, 0.3, 0.15);
      add(bed, rbox(1.1, 0.9, 0.14, 0.06), toy("#7c5cc4"), 0, 0.75, -0.98);
      add(bed, rbox(0.9, 0.12, 0.95, 0.06), toy("#f472b6", 0.7), 0, 0.57, 0.38);
      const tb = new THREE.Group();
      tb.position.set(-0.28, 0.72, -0.55);
      bed.add(tb);
      add(tb, new THREE.SphereGeometry(0.16, 14, 12), toy("#c08457", 0.8), 0, 0, 0);
      add(tb, new THREE.SphereGeometry(0.11, 14, 12), toy("#c08457", 0.8), 0, 0.2, 0);
      for (const sx of [-1, 1]) add(tb, new THREE.SphereGeometry(0.04, 8, 6), toy("#c08457", 0.8), sx * 0.08, 0.3, 0);
      wallBoard(0, 2.1, -2.16, 3.0, 1.5, (c, w, h) => {
        c.fillStyle = "#1c1744";
        c.fillRect(0, 0, w, h);
        c.fillStyle = "#fde68a";
        c.beginPath();
        c.arc(w * 0.3, h * 0.5, 80, 0, Math.PI * 2);
        c.fill();
        c.fillStyle = "#1c1744";
        c.beginPath();
        c.arc(w * 0.3 + 40, h * 0.5 - 14, 74, 0, Math.PI * 2);
        c.fill();
        c.fillStyle = "#fff7c2";
        for (let i = 0; i < 26; i++) c.fillRect(((i * 97) % (w - 20)) + 10, ((i * 61) % (h - 20)) + 10, 3 + (i % 3), 3 + (i % 3));
        c.strokeStyle = "#8b5cf6";
        c.lineWidth = 6;
        c.strokeRect(3, 3, w - 6, h - 6);
      });
      break;
    }
    case "brief": {
      // study: bookshelf wall, book stacks, mug, desk lamp glow
      const sh = holder(0, -2.05);
      add(sh, rbox(3.2, 0.06, 0.34, 0.02), toy("#7a4a2a", 0.6), 0, 0.5, 0);
      add(sh, rbox(3.2, 0.06, 0.34, 0.02), toy("#7a4a2a", 0.6), 0, 1.2, 0);
      add(sh, rbox(3.2, 0.06, 0.34, 0.02), toy("#7a4a2a", 0.6), 0, 1.9, 0);
      for (const sx of [-1.6, 1.6]) add(sh, rbox(0.06, 1.95, 0.34, 0.02), toy("#7a4a2a", 0.6), sx, 0.98, 0);
      const cols = ["#ef4444", "#3b82f6", "#f59e0b", "#10b981", "#a855f7", "#ec4899", "#14b8a6"];
      bookRow(sh, -1.45, 0.53, 0, 14, cols);
      bookRow(sh, -1.2, 1.23, 0, 12, [...cols].reverse());
      bookRow(sh, -1.35, 1.93, 0, 13, cols.slice(2));
      // book stack and mug on the desk
      add(g, rbox(0.5, 0.07, 0.36, 0.02), toy("#ef4444"), 1.9, 0.86, 0.7);
      add(g, rbox(0.46, 0.07, 0.34, 0.02), toy("#3b82f6"), 1.9, 0.93, 0.7).rotation.y = 0.2;
      add(g, rbox(0.42, 0.07, 0.3, 0.02), toy("#facc15"), 1.9, 1.0, 0.7).rotation.y = -0.15;
      add(g, cyl(0.07, 0.06, 0.13, 14), toy("#f8fafc"), 1.15, 0.9, 0.7);
      break;
    }
    case "reminders": {
      // a big toy alarm clock that jangles when a reminder rings, plus a mail pile
      const ac = new THREE.Group();
      ac.position.set(0.9, 0.55, -1.35);
      g.add(ac);
      add(ac, new THREE.SphereGeometry(0.62, 28, 20), toy("#ef4444", 0.35)).scale.set(1, 1, 0.55);
      add(ac, cyl(0.46, 0.46, 0.05, 36), toy("#fff8e8", 0.6), 0, 0, 0.34).rotation.x = PI2;
      for (let i = 0; i < 12; i++) {
        const an = (i / 12) * Math.PI * 2;
        add(ac, new THREE.BoxGeometry(0.03, i % 3 === 0 ? 0.1 : 0.05, 0.02), toy("#1f2937"), Math.sin(an) * 0.38, Math.cos(an) * 0.38, 0.37).rotation.z = -an;
      }
      const hand = new THREE.Group();
      hand.position.z = 0.39;
      ac.add(hand);
      add(hand, new THREE.BoxGeometry(0.04, 0.36, 0.02), toy("#1f2937"), 0, 0.17, 0);
      for (const sx of [-1, 1]) {
        const bellMini = add(ac, new THREE.SphereGeometry(0.2, 14, 10), toy("#facc15", 0.3), sx * 0.38, 0.55, 0);
        bellMini.scale.set(1, 0.7, 1);
        add(ac, cyl(0.03, 0.03, 0.25, 8), toy("#1f2937"), sx * 0.34, -0.55, 0.05).rotation.z = sx * 0.4;
      }
      for (let i = 0; i < 4; i++) add(g, rbox(0.5, 0.04, 0.34, 0.01), toy(["#fde68a", "#bae6fd", "#fbcfe8", "#bbf7d0"][i]), 2.0, 0.84 + i * 0.045, 0.4 + (i % 2) * 0.05).rotation.y = i * 0.5;
      extraTick = (t, dt, act) => {
        ac.rotation.z = act === "ring" ? Math.sin(t * 30) * 0.08 : 0;
        hand.rotation.z = -t * (act === "ring" ? 2 : 0.3);
      };
      break;
    }
    case "apps": {
      // a workshop: pegboard of tools, a red toolbox, a swivelling robot-arm lamp, small glowing parts
      wallBoard(0, 1.85, -2.16, 3.4, 1.7, (c, w, h) => {
        c.fillStyle = "#cbb68a";
        c.fillRect(0, 0, w, h);
        c.fillStyle = "#8a7a56";
        for (let y = 20; y < h; y += 28) for (let x = 20; x < w; x += 28) c.fillRect(x, y, 4, 4);
        const tools: Array<[number, number, string]> = [[80, 70, "#ef4444"], [200, 90, "#3b82f6"], [320, 70, "#22c55e"], [420, 100, "#f59e0b"]];
        for (const [tx, ty, col] of tools) {
          c.fillStyle = col;
          c.beginPath();
          c.roundRect(tx - 18, ty - 18, 36, 130, 14);
          c.fill();
          c.fillStyle = "#e5e7eb";
          c.beginPath();
          c.arc(tx, ty - 18, 34, 0, Math.PI * 2);
          c.fill();
        }
      });
      const tb = holder(0.2, -1.4);
      add(tb, rbox(0.9, 0.42, 0.45, 0.07), toy("#dc2626", 0.35), 0, 0.21, 0);
      add(tb, rbox(0.9, 0.1, 0.5, 0.04), toy("#fca5a5", 0.35), 0, 0.46, 0);
      add(tb, new THREE.TorusGeometry(0.17, 0.03, 8, 16, Math.PI), toy("#1f2937"), 0, 0.51, 0);
      const arm = holder(-0.9, -1.3);
      add(arm, cyl(0.25, 0.3, 0.1, 18), toy("#475569", 0.4), 0, 0.05, 0);
      const lower = new THREE.Group();
      lower.position.y = 0.1;
      arm.add(lower);
      add(lower, rbox(0.1, 0.8, 0.1, 0.04), toy("#facc15", 0.35), 0, 0.4, 0);
      const upper = new THREE.Group();
      upper.position.y = 0.8;
      lower.add(upper);
      add(upper, rbox(0.09, 0.7, 0.09, 0.04), toy("#facc15", 0.35), 0.28, 0.25, 0).rotation.z = -0.9;
      const bulbHead = add(upper, new THREE.SphereGeometry(0.15, 14, 10), glow, 0.55, 0.48, 0);
      bulbHead.castShadow = false;
      extraTick = (t, dt, act, working) => {
        lower.rotation.z = Math.sin(t * (working ? 1.4 : 0.5)) * 0.25;
        upper.rotation.y = Math.sin(t * 0.8) * 0.5;
      };
      break;
    }
  }
  if (extraTick) {
    const baseTick = tick;
    const more = extraTick;
    tick = (t, dt, act, working) => {
      baseTick(t, dt, act, working);
      more(t, dt, act, working);
    };
  }

  // The booths are roomy now: besides its job spots, each robot has its own places to wander to, so nobody stands in the
  // middle of the floor and no two booths look alike (a stretch at the front edge, a look at the crates, the plant, the lamp...).
  const P2 = Math.PI * 0.75;
  const spots: Record<StationId, Stop[]> = {
    scheduler: [
      { x: -1.7, z: 1.3, face: P2, act: "look", dwell: 5 },
      { x: 1.5, z: 1.5, face: -P2, act: "look", dwell: 4 },
    ],
    autopilot: [
      { x: 1.9, z: 0.6, face: -PI2, act: "look", dwell: 5 },
      { x: -1.2, z: 1.7, face: 0.3, act: "look", dwell: 4 },
    ],
    web: [
      { x: -1.9, z: 0.9, face: PI2, act: "look", dwell: 5 },
      { x: 1.1, z: 1.8, face: -0.3, act: "look", dwell: 4 },
    ],
    dream: [
      { x: 1.8, z: 1.4, face: -P2, act: "look", dwell: 5 },
      { x: 1.0, z: 0.1, face: -PI2, act: "look", dwell: 4 },
    ],
    brief: [
      { x: 1.8, z: 1.0, face: -PI2, act: "look", dwell: 5 },
      { x: -1.6, z: 1.6, face: P2, act: "look", dwell: 4 },
    ],
    reminders: [
      { x: -1.8, z: 1.2, face: PI2, act: "look", dwell: 5 },
      { x: 1.6, z: 1.7, face: -P2, act: "look", dwell: 4 },
    ],
    apps: [
      { x: 1.7, z: 1.5, face: -P2, act: "look", dwell: 5 },
      { x: -1.9, z: 0.5, face: PI2, act: "look", dwell: 4 },
    ],
  };
  idle = [...idle.filter((s0) => s0 !== HOME && !(s0.x === HOME.x && s0.z === HOME.z)), ...spots[id]];
  work = work.map((s0) => (s0.x === HOME.x && s0.z === HOME.z ? { ...spots[id][0], dwell: 3 } : s0));

  return { group: g, work, idle, sleep, tool, update: tick };
}
