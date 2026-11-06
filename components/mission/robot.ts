import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

/**
 * A hand-built humanoid robot (no model file, so no licence to worry about): ceramic armour plates over a
 * graphite frame, steel joints, a glass visor with slit eyes, an arc-reactor in the chest, a back pack with
 * glowing vents, and fingered hands. Every joint is its own pivot, so poses are animated in code.
 * Feet are at y = 0; it stands RIG_HEIGHT tall.
 */

export type RobotState = "working" | "idle" | "sleeping" | "alert";
export const RIG_HEIGHT = 2.66;

export type Rig = {
  root: THREE.Group;
  /** The glowing parts (eyes, ear rings, chest reactor, vents): tinted by mood. */
  glow: THREE.MeshStandardMaterial;
  /** The console's glow: tinted by mood like the rest. */
  holo: THREE.MeshBasicMaterial;
  /** `look`: where the viewer is, as a turn left/right of the robot's front (radians). `greet`: wave hello. */
  pose(state: RobotState, t: number, dt: number, phase: number, look?: number, greet?: boolean): void;
  dispose(): void;
};

type Disposable = { dispose(): void };

export function buildRobot(trimColour: THREE.Color | string, tone: THREE.Color): Rig {
  const track: Disposable[] = [];
  const armor = new THREE.MeshPhysicalMaterial({ color: "#e9edf4", metalness: 0.18, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.08, envMapIntensity: 1.3 });
  const graphite = new THREE.MeshStandardMaterial({ color: "#1b1f2a", metalness: 0.85, roughness: 0.4, envMapIntensity: 1.2 });
  const steel = new THREE.MeshStandardMaterial({ color: "#a3acbe", metalness: 1, roughness: 0.27, envMapIntensity: 1.3 });
  const glass = new THREE.MeshPhysicalMaterial({ color: "#03050b", metalness: 0.3, roughness: 0.05, clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 2.2 });
  const trim = new THREE.MeshStandardMaterial({ color: trimColour, metalness: 0.45, roughness: 0.3, envMapIntensity: 1.2 });
  const glow = new THREE.MeshStandardMaterial({ color: "#05070d", emissive: tone, emissiveIntensity: 2, roughness: 0.4 });
  track.push(armor, graphite, steel, glass, trim, glow);

  const part = (geo: THREE.BufferGeometry, mat: THREE.Material, parent: THREE.Object3D, x = 0, y = 0, z = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
    track.push(geo);
    return m;
  };
  const box = (w: number, h: number, d: number, r = 0.03) => new RoundedBoxGeometry(w, h, d, 3, r);
  const pivot = (parent: THREE.Object3D, x = 0, y = 0, z = 0) => {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    parent.add(g);
    return g;
  };

  const root = new THREE.Group();
  const hips = pivot(root, 0, 1.06, 0);

  // ----- pelvis
  part(box(0.6, 0.2, 0.36, 0.07), graphite, hips);
  part(box(0.64, 0.05, 0.4, 0.02), trim, hips, 0, 0.1, 0);
  part(box(0.2, 0.16, 0.05, 0.03), armor, hips, 0, -0.01, 0.19);

  // ----- legs
  const legs = [-1, 1].map((s) => {
    const hip = pivot(hips, s * 0.21, -0.04, 0);
    part(new THREE.SphereGeometry(0.105, 20, 14), steel, hip);
    part(new THREE.CylinderGeometry(0.095, 0.078, 0.44, 20), graphite, hip, 0, -0.23, 0);
    part(box(0.2, 0.3, 0.22, 0.06), armor, hip, 0, -0.2, 0.035);
    part(box(0.07, 0.24, 0.02, 0.01), trim, hip, s * 0.05, -0.2, 0.15);
    const knee = pivot(hip, 0, -0.45, 0);
    part(new THREE.SphereGeometry(0.088, 18, 12), steel, knee);
    part(box(0.12, 0.1, 0.07, 0.03), armor, knee, 0, 0, 0.08); // knee cap
    part(new THREE.CylinderGeometry(0.078, 0.056, 0.44, 20), graphite, knee, 0, -0.23, 0);
    part(box(0.17, 0.33, 0.2, 0.06), armor, knee, 0, -0.2, 0.045);
    part(box(0.055, 0.26, 0.02, 0.01), trim, knee, 0, -0.2, 0.155);
    part(box(0.15, 0.2, 0.1, 0.04), graphite, knee, 0, -0.2, -0.09); // calf pack
    const ankle = pivot(knee, 0, -0.47, 0);
    part(new THREE.SphereGeometry(0.06, 14, 10), steel, ankle);
    part(box(0.2, 0.09, 0.4, 0.04), graphite, ankle, 0, -0.07, 0.07);
    part(box(0.2, 0.07, 0.17, 0.035), armor, ankle, 0, -0.045, 0.2);
    part(box(0.2, 0.025, 0.42, 0.01), steel, ankle, 0, -0.115, 0.07); // sole
    return { hip, knee };
  });

  // ----- torso
  const spine = pivot(hips, 0, 0.11, 0);
  part(new THREE.CylinderGeometry(0.17, 0.2, 0.22, 24), graphite, spine, 0, 0.1, 0);
  for (const y of [0.03, 0.1, 0.17]) {
    const rib = part(new THREE.TorusGeometry(0.19, 0.016, 8, 32), steel, spine, 0, y, 0);
    rib.rotation.x = Math.PI / 2;
  }
  const chest = pivot(spine, 0, 0.2, 0);
  part(new RoundedBoxGeometry(0.8, 0.58, 0.48, 5, 0.14), armor, chest, 0, 0.3, 0);
  part(box(0.5, 0.3, 0.05, 0.02), graphite, chest, 0, 0.3, 0.245);
  const reactor = part(new THREE.TorusGeometry(0.095, 0.016, 10, 40), steel, chest, 0, 0.3, 0.275);
  reactor.rotation.x = 0;
  const core = part(new THREE.CircleGeometry(0.075, 28), glow, chest, 0, 0.3, 0.272);
  core.castShadow = false;
  for (const s of [-1, 1]) {
    part(box(0.07, 0.48, 0.02, 0.008), trim, chest, s * 0.3, 0.3, 0.245);
    part(box(0.16, 0.05, 0.02, 0.008), trim, chest, s * 0.17, 0.1, 0.245);
  }
  part(box(0.84, 0.05, 0.5, 0.02), graphite, chest, 0, 0.02, 0); // waist ring
  part(box(0.52, 0.44, 0.22, 0.05), graphite, chest, 0, 0.34, -0.34); // back pack
  for (let i = 0; i < 4; i++) part(box(0.36, 0.022, 0.012, 0.005), glow, chest, 0, 0.5 - i * 0.09, -0.455);
  for (const s of [-1, 1]) part(new THREE.CylinderGeometry(0.045, 0.06, 0.2, 14), steel, chest, s * 0.17, 0.62, -0.34); // exhausts
  part(new THREE.CylinderGeometry(0.075, 0.095, 0.12, 18), graphite, chest, 0, 0.64, 0); // neck
  for (const y of [0.62, 0.66]) {
    const c = part(new THREE.TorusGeometry(0.085, 0.012, 8, 24), steel, chest, 0, y, 0);
    c.rotation.x = Math.PI / 2;
  }

  // ----- head
  const head = pivot(chest, 0, 0.68, 0);
  part(new RoundedBoxGeometry(0.5, 0.4, 0.46, 5, 0.15), armor, head, 0, 0.2, 0);
  part(box(0.41, 0.2, 0.1, 0.06), glass, head, 0, 0.22, 0.2);
  for (const s of [-1, 1]) {
    part(box(0.1, 0.034, 0.02, 0.012), glow, head, s * 0.09, 0.235, 0.255);
    const ear = part(new THREE.CylinderGeometry(0.1, 0.1, 0.08, 28), graphite, head, s * 0.27, 0.2, 0);
    ear.rotation.z = Math.PI / 2;
    const ring = part(new THREE.TorusGeometry(0.068, 0.012, 8, 28), glow, head, s * 0.312, 0.2, 0);
    ring.rotation.y = Math.PI / 2;
  }
  part(box(0.06, 0.025, 0.3, 0.01), trim, head, 0, 0.405, 0); // crest
  part(new THREE.CylinderGeometry(0.011, 0.011, 0.22, 8), steel, head, 0.13, 0.5, -0.05);
  const bulb = part(new THREE.SphereGeometry(0.03, 12, 8), glow, head, 0.13, 0.62, -0.05);
  bulb.castShadow = false;

  // ----- arms
  const arms = [-1, 1].map((s) => {
    const shoulder = pivot(chest, s * 0.5, 0.56, 0);
    part(new THREE.SphereGeometry(0.125, 20, 14), steel, shoulder);
    const pad = part(new THREE.SphereGeometry(0.17, 20, 14), armor, shoulder, s * 0.04, 0.045, 0);
    pad.scale.set(0.9, 0.78, 1);
    part(box(0.04, 0.05, 0.2, 0.01), trim, shoulder, s * 0.115, 0.1, 0);
    part(new THREE.CylinderGeometry(0.07, 0.06, 0.37, 18), graphite, shoulder, 0, -0.2, 0);
    part(box(0.15, 0.22, 0.16, 0.05), armor, shoulder, 0, -0.16, 0);
    const elbow = pivot(shoulder, 0, -0.39, 0);
    part(new THREE.SphereGeometry(0.066, 16, 12), steel, elbow);
    part(new THREE.CylinderGeometry(0.06, 0.047, 0.34, 18), graphite, elbow, 0, -0.18, 0);
    part(box(0.135, 0.23, 0.15, 0.05), armor, elbow, 0, -0.15, 0.01);
    part(box(0.05, 0.18, 0.012, 0.005), trim, elbow, 0, -0.15, 0.09);
    const wrist = pivot(elbow, 0, -0.36, 0);
    part(new THREE.SphereGeometry(0.048, 12, 10), steel, wrist);
    part(box(0.105, 0.09, 0.055, 0.02), graphite, wrist, 0, -0.07, 0);
    for (const x of [-0.034, 0, 0.034]) part(box(0.024, 0.075, 0.03, 0.01), steel, wrist, x, -0.15, 0.005);
    part(box(0.03, 0.06, 0.03, 0.01), steel, wrist, -s * 0.07, -0.08, 0.02).rotation.z = s * 0.5;
    return { shoulder, elbow };
  });

  // ----- a holographic console it types on while working
  const holo = new THREE.MeshBasicMaterial({ color: tone, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
  track.push(holo);
  const consoleG = pivot(root, 0, 1.45, 0.78);
  const screen = part(new THREE.PlaneGeometry(0.95, 0.55), new THREE.MeshBasicMaterial({ color: tone, transparent: true, opacity: 0.1, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }), consoleG, 0, 0.42, -0.04);
  screen.castShadow = false;
  screen.rotation.x = -0.28;
  track.push(screen.material as THREE.Material);
  const bars: THREE.Mesh[] = [];
  for (let r = 0; r < 6; r++) {
    const b = part(new THREE.PlaneGeometry(1, 0.04), holo, consoleG, 0, 0.6 - r * 0.075, -0.075 + r * 0.012);
    b.castShadow = false;
    b.rotation.x = -0.28;
    bars.push(b);
  }
  const keys = part(new THREE.PlaneGeometry(0.8, 0.26), holo, consoleG, 0, 0.03, 0.05);
  keys.castShadow = false;
  keys.rotation.x = -Math.PI / 2 + 0.25;
  consoleG.scale.setScalar(0.001);

  // ----- floating symbols: Z while asleep, ! when it needs you
  const symbolTexture = (ch: string, colour: string) => {
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const g = c.getContext("2d")!;
    g.font = "700 104px Georgia, serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.shadowColor = colour;
    g.shadowBlur = 18;
    g.fillStyle = "#ffffff";
    g.fillText(ch, 64, 70);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    track.push(t);
    return t;
  };
  const zTex = symbolTexture("z", "#93c5fd");
  const bangTex = symbolTexture("!", "#fb7185");
  const zs = [0, 1, 2].map(() => {
    const m = new THREE.SpriteMaterial({ map: zTex, transparent: true, opacity: 0, depthWrite: false, toneMapped: false });
    track.push(m);
    const sp = new THREE.Sprite(m);
    root.add(sp);
    return sp;
  });
  const bangMat = new THREE.SpriteMaterial({ map: bangTex, color: "#ff4d6d", transparent: true, opacity: 0, depthWrite: false, toneMapped: false });
  track.push(bangMat);
  const bang = new THREE.Sprite(bangMat);
  root.add(bang);

  // ----- posing: each joint eases toward a target that depends on the mood
  const ease = (obj: THREE.Object3D, axis: "x" | "y" | "z", target: number, k: number) => {
    obj.rotation[axis] += (target - obj.rotation[axis]) * k;
  };
  let hipsY = 0;
  let consoleOn = 0;
  let zOn = 0;
  let bangOn = 0;

  type Pose = { spineX: number; spineY: number; spineZ: number; headX: number; headY: number; sh: [{ x: number; z: number }, { x: number; z: number }]; el: [number, number]; drop: number; thigh: [number, number]; knee: [number, number]; bounce: number };

  // idle: a calm stance, with a different little gesture every few seconds so it never looks frozen
  function gesture(n: number, u: number, t: number, p: Pose) {
    const e = Math.pow(Math.sin(Math.PI * Math.min(1, Math.max(0, u))), 0.6); // fade in and out
    const mix = (a: number, b: number) => a + (b - a) * e;
    switch (n) {
      case 0: // look around
        p.headY = mix(p.headY, Math.sin(t * 1.6) * 0.85);
        p.spineY = mix(p.spineY, Math.sin(t * 1.6 - 0.4) * 0.3);
        break;
      case 1: // thinking: hand to chin
        p.sh[1].x = mix(p.sh[1].x, -1.05);
        p.sh[1].z = mix(p.sh[1].z, 0.05);
        p.el[1] = mix(p.el[1], -2.2);
        p.headX = mix(p.headX, 0.18);
        p.headY = mix(p.headY, -0.25);
        break;
      case 2: // shrug
        for (const k of [0, 1] as const) {
          p.sh[k].x = mix(p.sh[k].x, -0.5);
          p.el[k] = mix(p.el[k], -1.15);
        }
        p.headX = mix(p.headX, -0.12);
        p.spineX = mix(p.spineX, -0.05);
        break;
      case 3: // stretch both arms up
        p.sh[0].z = mix(p.sh[0].z, -2.7);
        p.sh[1].z = mix(p.sh[1].z, 2.7);
        p.headX = mix(p.headX, -0.35);
        p.spineX = mix(p.spineX, -0.12);
        break;
      case 4: // a small wave
        p.sh[1].z = mix(p.sh[1].z, 2.0 + Math.sin(t * 8) * 0.15);
        p.el[1] = mix(p.el[1], -0.5 + Math.sin(t * 8) * 0.4);
        p.headY = mix(p.headY, -0.3);
        break;
      default: // check its wrist
        p.sh[0].x = mix(p.sh[0].x, -0.9);
        p.el[0] = mix(p.el[0], -1.7);
        p.headX = mix(p.headX, 0.35);
        p.headY = mix(p.headY, 0.2);
    }
  }

  function pose(state: RobotState, t: number, dt: number, phase: number, look = 0, greet = false) {
    const k = 1 - Math.exp(-7 * dt);
    const breathe = Math.sin(t * 1.5 + phase);
    const p: Pose = {
      spineX: 0.02 + breathe * 0.015,
      spineY: 0,
      spineZ: 0,
      headX: Math.sin(t * 0.6 + phase) * 0.05,
      headY: Math.sin(t * 0.45 + phase) * 0.25,
      sh: [{ x: Math.sin(t * 1.5 + phase) * 0.05, z: -0.1 }, { x: Math.sin(t * 1.5 + phase + Math.PI) * 0.05, z: 0.1 }],
      el: [-0.18 - breathe * 0.03, -0.18 - breathe * 0.03],
      drop: 0,
      thigh: [0, 0],
      knee: [0, 0],
      bounce: 0,
    };

    if (state === "working") {
      p.spineX = 0.14;
      p.headX = 0.22 + Math.sin(t * 2.5 + phase) * 0.04;
      p.headY = Math.sin(t * 0.9 + phase) * 0.22;
      for (const i of [0, 1] as const) {
        const side = i === 0 ? -1 : 1;
        const hit = Math.sin(t * 11 + phase + (i ? Math.PI : 0));
        p.sh[i].x = -1.05 + hit * 0.07;
        p.sh[i].z = side * 0.16;
        p.el[i] = -(0.8 + 0.3 * hit);
      }
      // a little foot tap while it works
      p.thigh = [Math.max(0, Math.sin(t * 5 + phase)) * -0.16, 0];
      p.knee = [Math.max(0, Math.sin(t * 5 + phase)) * 0.3, 0];
      p.bounce = Math.abs(Math.sin(t * 11 + phase)) * 0.006;
    } else if (state === "sleeping") {
      p.spineX = 0.34 + breathe * 0.02;
      p.headX = 0.7 + breathe * 0.03;
      p.headY = 0;
      p.drop = -0.095;
      p.thigh = [-0.5, -0.5];
      p.knee = [0.9, 0.9];
      for (const i of [0, 1] as const) {
        p.sh[i].x = 0.15;
        p.sh[i].z = (i === 0 ? -1 : 1) * 0.06;
        p.el[i] = -0.35;
      }
      p.bounce = breathe * 0.005;
    } else if (state === "alert") {
      p.headX = -0.12;
      p.headY = Math.sin(t * 2.4 + phase) * 0.45;
      p.spineZ = Math.sin(t * 3.4 + phase) * 0.05;
      p.bounce = Math.abs(Math.sin(t * 4.2 + phase)) * 0.09;
      p.sh[1].x = 0;
      p.sh[1].z = 2.55 + Math.sin(t * 8 + phase) * 0.25;
      p.el[1] = -0.35 + Math.sin(t * 8 + phase) * 0.45;
      p.sh[0].z = -0.35;
      p.sh[0].x = Math.sin(t * 4.2 + phase) * 0.15;
      p.thigh = [Math.sin(t * 4.2 + phase) * 0.05, 0];
    } else {
      // calm weight shift, then a gesture in each ~6 s slot
      const shift = Math.sin(t * 0.55 + phase);
      p.spineZ = shift * 0.02;
      p.thigh = [shift * 0.05, -shift * 0.05];
      p.knee = [Math.max(0, shift) * 0.1, Math.max(0, -shift) * 0.1];
      p.bounce = -Math.abs(shift) * 0.012;
      const slot = (t + phase * 1.7) / 6;
      const n = Math.floor(slot);
      const u = slot - n;
      const pick = Math.abs(Math.floor(Math.sin((n + phase) * 12.9898) * 43758.5453)) % 6;
      gesture(pick, u < 0.12 ? 0 : (u - 0.12) / 0.8, t, p);
    }

    // awake robots turn their head (and a little of their body) toward whoever is looking
    if (state !== "sleeping") {
      const w = state === "idle" ? 0.6 : state === "alert" ? 0.5 : 0.35;
      p.headY = p.headY * (1 - w) + look * w;
      p.spineY += look * 0.22 * w;
    }
    // hover: a friendly wave hello
    if (greet && state !== "sleeping" && state !== "alert") {
      p.sh[1].x = 0;
      p.sh[1].z = 2.3 + Math.sin(t * 9 + phase) * 0.18;
      p.el[1] = -0.4 + Math.sin(t * 9 + phase) * 0.4;
      p.headX = -0.08;
    }

    ease(spine, "x", p.spineX, k);
    ease(spine, "y", p.spineY, k);
    ease(spine, "z", p.spineZ, k);
    ease(head, "x", p.headX, k);
    ease(head, "y", p.headY, k);
    hipsY += (p.drop + p.bounce - hipsY) * k;
    hips.position.y = 1.06 + hipsY;
    legs.forEach((l, i) => {
      ease(l.hip, "x", p.thigh[i], k);
      ease(l.knee, "x", p.knee[i], k);
    });
    arms.forEach((a, i) => {
      ease(a.shoulder, "x", p.sh[i].x, k);
      ease(a.shoulder, "z", p.sh[i].z, k);
      ease(a.elbow, "x", p.el[i], k);
    });

    // eyes blink now and then
    const blink = (t * 0.37 + phase) % 3.1 < 0.12 ? 0.15 : 1;
    glow.emissiveIntensity *= blink;

    // the console grows in front of it while it works; the bars flicker like code
    consoleOn += ((state === "working" ? 1 : 0) - consoleOn) * k;
    consoleG.scale.setScalar(Math.max(0.001, consoleOn));
    consoleG.visible = consoleOn > 0.02;
    holo.opacity = 0.55 * consoleOn;
    if (consoleG.visible) {
      bars.forEach((b, r) => {
        const w = 0.25 + 0.7 * (0.5 + 0.5 * Math.sin(t * (2.2 + r * 0.7) + r * 1.9 + phase));
        b.scale.x = w;
        b.position.x = -0.45 + w / 2;
      });
    }

    // z z z while asleep, a pulsing ! when it needs you
    zOn += ((state === "sleeping" ? 1 : 0) - zOn) * k;
    bangOn += ((state === "alert" ? 1 : 0) - bangOn) * k;
    zs.forEach((sp, n) => {
      const u = ((t * 0.35 + n / 3) % 1);
      sp.position.set(0.28 + u * 0.35, 2.25 + u * 0.75, 0.15);
      sp.scale.setScalar(0.16 + u * 0.22);
      sp.material.opacity = Math.sin(Math.PI * u) * 0.9 * zOn;
    });
    bang.position.set(0, 2.95 + Math.abs(Math.sin(t * 5 + phase)) * 0.12, 0);
    bang.scale.setScalar(0.38 + Math.abs(Math.sin(t * 5 + phase)) * 0.08);
    bangMat.opacity = bangOn;
  }

  return {
    root,
    glow,
    holo,
    pose,
    dispose() {
      track.forEach((d) => d.dispose());
    },
  };
}
