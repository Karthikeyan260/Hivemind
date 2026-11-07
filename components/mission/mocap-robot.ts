import * as THREE from "three";
import type { GLTF } from "three/addons/loaders/GLTFLoader.js";
import { clone as cloneSkinned } from "three/addons/utils/SkeletonUtils.js";
import { RIG_HEIGHT, type Act, type Rig, type RobotState } from "./robot";

/**
 * The robot body: the Mixamo "X Bot" humanoid (a real skinned model with motion-captured clips for walking,
 * idling, nodding and shaking its head), re-skinned in the agent's colours. Walking, nodding and standing use
 * the captured clips. What the hands do at a station (typing, hammering...) is a small procedural layer on
 * top of the idle clip, so the arms move at the job instead of hanging.
 */

type Disposable = { dispose(): void };

export function buildMocapRobot(gltf: GLTF, trimColour: string, tone: THREE.Color, rootScale: number): Rig {
  const track: Disposable[] = [];
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const model = cloneSkinned(gltf.scene) as THREE.Group;
  body.add(model);
  model.rotation.y = Math.PI; // the captured model faces the other way from the station layout

  // size from the skeleton, feet on the ground
  model.updateMatrixWorld(true);
  let lo = Infinity;
  let hi = -Infinity;
  const v = new THREE.Vector3();
  const bones: Record<string, THREE.Bone> = {};
  model.traverse((o) => {
    if ((o as THREE.Bone).isBone) {
      o.getWorldPosition(v);
      lo = Math.min(lo, v.y);
      hi = Math.max(hi, v.y);
      bones[o.name.replace(/[^A-Za-z0-9]/g, "")] = o as THREE.Bone;
    }
  });
  const k = RIG_HEIGHT / Math.max(hi - lo, 0.01) / 1.04;
  model.scale.setScalar(k);
  model.position.y = -lo * k;

  // skin: glossy painted shell, glowing joints
  const paint = new THREE.Color(trimColour);
  // friendly white glossy plastic with a hint of the agent's colour
  const shell = new THREE.MeshPhysicalMaterial({ color: new THREE.Color("#f6f4fc").lerp(paint, 0.14), metalness: 0.08, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.12, envMapIntensity: 0.9 });
  const glow = new THREE.MeshStandardMaterial({ color: "#07090f", emissive: tone, emissiveIntensity: 1.6, roughness: 0.45, metalness: 0.5 });
  track.push(shell, glow);
  model.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.frustumCulled = false;
    m.castShadow = true;
    m.receiveShadow = true;
    const swap = (mt: THREE.Material) => (/joint/i.test(mt.name) ? glow : shell);
    m.material = Array.isArray(m.material) ? m.material.map(swap) : swap(m.material);
  });

  // a hand mount for tools (pen, hammer), at pod scale
  const mount = new THREE.Group();
  const hand = bones.mixamorigRightHand;
  if (hand) {
    hand.add(mount);
    mount.scale.setScalar(1 / (k * rootScale));
    mount.rotation.set(0, 0, -Math.PI / 2);
  }

  // clips
  const mixer = new THREE.AnimationMixer(model);
  const acts = new Map<string, THREE.AnimationAction>();
  for (const c of gltf.animations) acts.set(c.name, mixer.clipAction(c));
  let current = "";
  const play = (name: string, speed: number, fade = 0.35) => {
    const next = acts.get(name);
    if (!next) return;
    if (current === name) {
      next.timeScale = speed;
      return;
    }
    next.reset().play();
    next.timeScale = speed;
    const prev = acts.get(current);
    if (prev) prev.crossFadeTo(next, fade, false);
    next.enabled = true;
    current = name;
  };
  let seeded = false;

  // floating symbols
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
  const holo = new THREE.MeshBasicMaterial({ color: tone });
  track.push(holo);

  const bone = (n: string) => bones[n] as THREE.Bone | undefined;
  const head = bone("mixamorigHead");
  const neck = bone("mixamorigNeck");

  // a friendly face: big head, dark visor with glowing happy eyes, and headphones in the agent's colour
  if (head) {
    model.updateMatrixWorld(true);
    const hs = Math.max(head.getWorldScale(v).x, 1e-4); // rig units per head-bone unit
    head.scale.multiplyScalar(2.3); // chibi: a big head on a small robot
    const face = new THREE.Group();
    face.scale.setScalar(1 / hs);
    face.rotation.y = Math.PI / 2; // the head bone's forward is sideways in this rig
    const visorMat = new THREE.MeshPhysicalMaterial({ color: "#0b0e1a", metalness: 0.2, roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.05 });
    const cupMat = new THREE.MeshStandardMaterial({ color: paint, metalness: 0.2, roughness: 0.35, emissive: paint, emissiveIntensity: 0.25 });
    track.push(visorMat, cupMat);
    const visor = new THREE.Mesh(new THREE.SphereGeometry(0.115, 24, 16), visorMat);
    visor.scale.set(1.12, 0.86, 0.6);
    visor.position.set(0, 0.125, 0.085);
    face.add(visor);
    for (const sx of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.TorusGeometry(0.026, 0.0075, 6, 14, Math.PI), glow);
      eye.position.set(sx * 0.052, 0.118, 0.15);
      face.add(eye);
      const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.058, 0.058, 0.045, 20), cupMat);
      cup.rotation.z = Math.PI / 2;
      cup.position.set(sx * 0.15, 0.125, 0);
      face.add(cup);
    }
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.011, 8, 28, Math.PI), cupMat);
    band.position.set(0, 0.125, 0);
    face.add(band);
    head.add(face);
  }

  let lie = 0;
  let zOn = 0;
  let bangOn = 0;

  function pose(state: RobotState, t: number, dt: number, phase: number, look = 0, greet = false, cheer = false, act: Act = "none", walk = 0) {
    if (!seeded) {
      seeded = true;
      for (const a of acts.values()) a.time = phase % 1;
    }
    // only lie down once it has actually walked to the bed (not mid-stride, not in mid-air)
    const sleeping = state === "sleeping" && walk < 0.01;
    const nodding = greet || cheer || act === "chat";
    // which captured clip?
    if (sleeping) play("sad_pose", 1);
    else if (walk > 0.01) play("walk", 0.62);
    else if (state === "alert") play("headShake", 1.6);
    else if (state === "sleeping") play("idle", 0.85);
    else if (cheer) play("agree", 1.5);
    else if (act === "chat") play(Math.floor((t + phase) / 3) % 2 ? "headShake" : "agree", 0.9);
    else if (greet) play("agree", 1.1);
    else play("idle", 0.85);
    mixer.update(dt);
    glow.emissiveIntensity *= 0.3;

    // lie down on the bed, or stand
    lie += ((sleeping ? 1 : 0) - lie) * (1 - Math.exp(-4 * dt));
    body.rotation.x = -lie * (Math.PI / 2 - 0.1);
    model.rotation.y = Math.PI * (1 - lie); // turn over so it lies on its back, face up
    body.position.y = lie * 0.32;
    body.scale.setScalar(1 - lie * 0.22);

    // the head follows whoever is looking (awake and standing still)
    if (!sleeping && !nodding && walk < 0.01 && head) head.rotation.y += look * 0.55;
    if (!sleeping && walk < 0.01 && neck && !nodding) neck.rotation.y += look * 0.2;

    zOn += ((sleeping ? 1 : 0) - zOn) * (1 - Math.exp(-6 * dt));
    bangOn += ((state === "alert" ? 1 : 0) - bangOn) * (1 - Math.exp(-6 * dt));
    zs.forEach((sp, n) => {
      const u = (t * 0.35 + n / 3) % 1;
      sp.position.set(0.35 + u * 0.35, 1.2 + u * 0.9, 0.2);
      sp.scale.setScalar(0.16 + u * 0.22);
      sp.material.opacity = Math.sin(Math.PI * u) * 0.9 * zOn;
    });
    bang.position.set(0, 3.0 + Math.abs(Math.sin(t * 5 + phase)) * 0.12, 0);
    bang.scale.setScalar(0.38 + Math.abs(Math.sin(t * 5 + phase)) * 0.08);
    bangMat.opacity = bangOn;
  }

  return {
    root,
    hands: [mount, mount],
    glow,
    holo,
    pose,
    dispose() {
      mixer.stopAllAction();
      track.forEach((d) => d.dispose());
    },
  };
}

