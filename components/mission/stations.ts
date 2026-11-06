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

  return { group: g, work, idle, sleep, tool, update: tick };
}
