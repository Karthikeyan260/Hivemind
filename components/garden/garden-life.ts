import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { clone as cloneModel } from "three/addons/utils/SkeletonUtils.js";
import { hash01 } from "@/lib/garden-layout";

/**
 * Life and detail for the 3D island, kept apart from the big scene file: songbirds (some crossing the
 * sky, some perched on the fence), bees that hover from flower to flower, dragonflies over the pond,
 * koi swimming in it, and a little picket fence and mailbox by the cottage path. Each creature is built
 * from smooth shaded shapes (a lathe-turned body, feathered wings in two joints, veined translucent
 * insect wings, a fish that bends as it swims) and moves by a few formulas each frame. The daytime
 * creatures hide at night and in the rain.
 */
export type LifeCtx = {
  island: THREE.Group;
  R: number;
  quality: "high" | "low";
  reduced: boolean;
  heightAt: (x: number, z: number) => number;
  /** Objects that are only shown by day, in fair weather (the scene hides them at night and in rain). */
  dayOnly: THREE.Object3D[];
  /** Where the flowers are (island-local). */
  flowers: THREE.Vector3[];
  /** The pond: its centre (water level), radius along x, and how much squashed along z. */
  pond: { c: THREE.Vector3; r: number; sy: number } | null;
  /** The cottage door, and the path's x at a given z. */
  home: THREE.Vector3;
  pathWorld: (z: number) => number;
  /** Press the grass flat in a round patch (under the fence posts and the mailbox). */
  clear: (x: number, z: number, r: number) => void;
};

const mat = (color: string, rough = 0.8, extra: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color, roughness: rough, ...extra });

/** A small canvas texture, or null where there is no canvas (tests, servers). */
function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) {
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d");
  if (!g) return null;
  draw(g);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** An insect wing: a pale, see-through blade with veins and a darker edge. The wing grows along +x. */
function wingTexture(spot = false) {
  return canvasTex(128, 64, (g) => {
    g.clearRect(0, 0, 128, 64);
    const grad = g.createLinearGradient(0, 0, 128, 0);
    grad.addColorStop(0, "rgba(225,242,255,0.8)");
    grad.addColorStop(1, "rgba(200,225,248,0.5)");
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(2, 34);
    g.bezierCurveTo(24, 2, 92, 4, 126, 30);
    g.bezierCurveTo(100, 58, 34, 62, 2, 34);
    g.closePath();
    g.fill();
    g.strokeStyle = "rgba(255,255,255,0.85)";
    g.lineWidth = 1.4;
    g.stroke();
    g.strokeStyle = "rgba(255,255,255,0.5)";
    g.lineWidth = 0.9;
    for (const [y, ey] of [[26, 14], [32, 30], [38, 46], [34, 22], [36, 40]] as const) {
      g.beginPath();
      g.moveTo(4, y);
      g.quadraticCurveTo(60, y + (ey - y) * 0.2, 118, ey + 4);
      g.stroke();
    }
    for (let x = 20; x < 120; x += 16) {
      g.beginPath();
      g.moveTo(x, 12 + Math.abs(60 - x) * 0.08);
      g.lineTo(x + 5, 52 - Math.abs(60 - x) * 0.08);
      g.stroke();
    }
    if (spot) {
      g.fillStyle = "rgba(40,50,60,0.75)";
      g.fillRect(104, 20, 8, 5);
    }
  });
}

/** Colours a geometry per vertex: `tone(x, y, z)` gives a colour. */
function paint(geo: THREE.BufferGeometry, tone: (x: number, y: number, z: number, out: THREE.Color) => void) {
  const p = geo.attributes.position as THREE.BufferAttribute;
  const cols = new Float32Array(p.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    tone(p.getX(i), p.getY(i), p.getZ(i), c);
    cols.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute("color", new THREE.BufferAttribute(cols, 3));
  return geo;
}
/** A wet, glossy skin for the fish: a clear coat over the painted colours, with a soft sheen. */
const vcGloss = () =>
  new THREE.MeshPhysicalMaterial({ color: "#ffffff", vertexColors: true, roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.12, sheen: 0.5, sheenColor: new THREE.Color("#ffffff"), sheenRoughness: 0.4, emissive: "#ffffff", emissiveIntensity: 0.05 });
/** Shiny, rainbow-sheened colour for the dragonfly. */
const irid = (color: string) => new THREE.MeshPhysicalMaterial({ color, roughness: 0.25, metalness: 0.45, iridescence: 1, iridescenceIOR: 1.7, iridescenceThicknessRange: [180, 520] });
const vcMat = (rough = 0.65, extra: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color: "#ffffff", vertexColors: true, roughness: rough, ...extra });

/** A flat shape from points in the x/z plane (y up). */
function flat(points: [number, number][]) {
  const s = new THREE.Shape();
  points.forEach(([x, z], i) => (i ? s.lineTo(x, z) : s.moveTo(x, z)));
  s.closePath();
  const g = new THREE.ShapeGeometry(s);
  g.rotateX(-Math.PI / 2);
  return g;
}

/** A thin fin standing upright (in the y/z plane), from points of (distance back, height). */
function sail(points: [number, number][]) {
  const s = new THREE.Shape();
  points.forEach(([x, y], i) => (i ? s.lineTo(x, y) : s.moveTo(x, y)));
  s.closePath();
  const g = new THREE.ShapeGeometry(s);
  g.rotateY(Math.PI / 2);
  return g;
}

type Species = { name: string; back: string; belly: string; wing: string; tip: string; tail: string; beak: string };
const SPECIES: Species[] = [
  { name: "pigeon", back: "#7d8ca1", belly: "#aebbcb", wing: "#6b7a8f", tip: "#39434f", tail: "#4c5766", beak: "#e8a6a0" },
  { name: "bluebird", back: "#2f6fd0", belly: "#f0a14a", wing: "#2a60b8", tip: "#173b78", tail: "#1f4a96", beak: "#2b2b2b" },
  { name: "finch", back: "#c7a62f", belly: "#f2dc6a", wing: "#a98d27", tip: "#3d3a1c", tail: "#6f5f1f", beak: "#e08a3c" },
  { name: "robin", back: "#8a6a4e", belly: "#e2683a", wing: "#7a5c43", tip: "#4a3727", tail: "#5e4733", beak: "#3a2f27" },
];

type BirdRig = { g: THREE.Group; wl: THREE.Group; wr: THREE.Group; el: THREE.Group; er: THREE.Group; tail: THREE.Object3D; ph: number };

export class GardenLife {
  private birds: (BirdRig & { a0: number; rad: number; h: number; sp: number; dir: number })[] = [];
  private flock: { g: THREE.Object3D; mixer: THREE.AnimationMixer; a0: number; rad: number; h: number; sp: number; dir: number; ph: number }[] = [];
  private perched: (BirdRig & { base: THREE.Vector3; yaw: number })[] = [];
  private bees: { g: THREE.Group; wl: THREE.Object3D[]; wr: THREE.Object3D[]; from: THREE.Vector3; to: THREE.Vector3; t0: number; dwell: number; ph: number; trail: THREE.Points; hist: THREE.Vector3[] }[] = [];
  private dragons: { g: THREE.Group; w: THREE.Object3D[]; ph: number; sp: number }[] = [];
  private koi: { g: THREE.Group; rear: THREE.Group; tail: THREE.Group; fins: THREE.Object3D[]; ph: number; sp: number; rx: number; dir: number; wakes: { m: THREE.Mesh; born: number }[]; nextWake: number }[] = [];
  private posts: THREE.Vector3[] = [];

  constructor(private c: LifeCtx) {
    this.buildFence();
    this.buildBirds();
    this.loadFlock();
    this.buildBees();
    this.buildDragonflies();
    this.buildKoi();
  }

  /* ── a songbird: lathe-turned body shaded back to belly, head with eye and beak, fan tail, and two-jointed feathered wings ── */
  private makeBird(sp: Species, seed: number): BirdRig {
    const g = new THREE.Group();
    const back = new THREE.Color(sp.back);
    const belly = new THREE.Color(sp.belly);
    // The body: a teardrop along z (head end +z), a plump chest and a tapering rear.
    const prof = [[-0.13, 0], [-0.115, 0.011], [-0.08, 0.026], [-0.03, 0.045], [0.02, 0.054], [0.06, 0.052], [0.095, 0.04], [0.115, 0.022], [0.123, 0]].map(([y, r]) => new THREE.Vector2(r, y));
    const bodyGeo = new THREE.LatheGeometry(prof, 20);
    bodyGeo.rotateX(Math.PI / 2);
    paint(bodyGeo, (_x, y, z, out) => out.copy(back).lerp(belly, THREE.MathUtils.smoothstep(-y, -0.012, 0.03) * (z > -0.07 ? 1 : 0.6)));
    g.add(new THREE.Mesh(bodyGeo, vcMat(0.7)));
    // The head, an eye on each side and a beak.
    const headMat = mat(sp.back, 0.7);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.036, 14, 10), headMat);
    head.position.set(0, 0.02, 0.105);
    g.add(head);
    const eye = new THREE.SphereGeometry(0.0072, 8, 6);
    const dark = new THREE.MeshStandardMaterial({ color: "#0c0a09", roughness: 0.2 });
    for (const s of [-1, 1]) {
      const e = new THREE.Mesh(eye, dark);
      e.position.set(s * 0.027, 0.03, 0.12);
      g.add(e);
    }
    const beak = new THREE.Mesh(new THREE.ConeGeometry(0.012, 0.042, 8), mat(sp.beak, 0.5));
    beak.rotation.x = Math.PI / 2;
    beak.position.set(0, 0.016, 0.155);
    g.add(beak);
    // The tail: a fan of feathers, tilted a little.
    const tail = new THREE.Mesh(
      flat([[-0.012, 0], [0.012, 0], [0.034, -0.1], [0.018, -0.13], [0, -0.12], [-0.018, -0.13], [-0.034, -0.1]]),
      mat(sp.tail, 0.8, { side: THREE.DoubleSide }),
    );
    tail.position.set(0, 0.004, -0.1);
    tail.rotation.x = -0.12;
    g.add(tail);
    // Wings: a shoulder joint with the inner wing, and an elbow joint with the long outer feathers.
    const innerGeo = flat([[0, 0.05], [0.07, 0.056], [0.12, 0.04], [0.126, 0.0], [0.108, -0.022], [0.09, -0.042], [0.07, -0.026], [0.05, -0.056], [0.03, -0.03], [0, -0.05]]);
    const outerGeo = flat([[0, 0.042], [0.1, 0.028], [0.19, -0.008], [0.172, -0.04], [0.146, -0.03], [0.124, -0.062], [0.094, -0.04], [0.064, -0.066], [0.032, -0.04], [0, -0.042]]);
    const innerMat = mat(sp.wing, 0.8, { side: THREE.DoubleSide });
    const outerMat = mat(sp.tip, 0.8, { side: THREE.DoubleSide });
    const rig = (side: 1 | -1) => {
      const shoulder = new THREE.Group();
      shoulder.position.set(side * 0.03, 0.025, 0.03);
      if (side < 0) shoulder.scale.x = -1;
      shoulder.add(new THREE.Mesh(innerGeo, innerMat));
      const elbow = new THREE.Group();
      elbow.position.x = 0.12;
      elbow.add(new THREE.Mesh(outerGeo, outerMat));
      shoulder.add(elbow);
      g.add(shoulder);
      return { shoulder, elbow };
    };
    const l = rig(1);
    const r = rig(-1);
    return { g, wl: l.shoulder, wr: r.shoulder, el: l.elbow, er: r.elbow, tail, ph: seed };
  }

  /** The flock from the three.js examples: loads the three bird models once, then makes the flock from clones, each beating its wings in its own time. */
  private loadFlock() {
    if (typeof window === "undefined") return;
    const { R, island, dayOnly, quality } = this.c;
    // [model, wingspan to scale to, turn it to face along +z]
    const plan: [string, number, number][] = [
      ["Parrot", 1.2, 0],
      ["Stork", 1.6, 0],
      ["Flamingo", 1.5, 0],
      ["Parrot", 1.05, 0],
      ["Stork", 1.4, 0],
    ].slice(0, quality === "high" ? 5 : 3) as [string, number, number][];
    const loader = new GLTFLoader();
    const models = new Map<string, Promise<{ scene: THREE.Object3D; clip: THREE.AnimationClip } | null>>();
    const load = (name: string) => {
      let p = models.get(name);
      if (!p) {
        p = new Promise((resolve) => loader.load(`/models/birds/${name}.glb`, (gltf) => resolve(gltf.animations[0] ? { scene: gltf.scene, clip: gltf.animations[0] } : null), undefined, () => resolve(null)));
        models.set(name, p);
      }
      return p;
    };
    void Promise.all(plan.map(([name]) => load(name))).then((all) => {
      if (all.some((m) => !m)) return;
      // Loaded: the real models take over from the hand-built flyers.
      for (const b of this.birds) {
        island.remove(b.g);
        const k = dayOnly.indexOf(b.g);
        if (k >= 0) dayOnly.splice(k, 1);
      }
      this.birds = [];
      plan.forEach(([name, span, yaw], i) => {
        const m = all[i]!;
        const body = cloneModel(m.scene);
        const box = new THREE.Box3().setFromObject(body);
        const size = box.getSize(new THREE.Vector3());
        const k = span / Math.max(size.x, size.z, 1e-6);
        const holder = new THREE.Group();
        const pivot = new THREE.Group();
        body.scale.setScalar(k);
        body.position.sub(box.getCenter(new THREE.Vector3()).multiplyScalar(k));
        pivot.rotation.y = yaw;
        pivot.add(body);
        holder.add(pivot);
        body.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (mesh.isMesh) mesh.castShadow = false;
        });
        const mixer = new THREE.AnimationMixer(body);
        const action = mixer.clipAction(m.clip);
        action.timeScale = 0.9 + hash01(`flock${name}${i}`) * 0.5;
        action.time = hash01(`flockt${i}`) * m.clip.duration;
        action.play();
        this.flock.push({ g: holder, mixer, a0: i * 0.5 + hash01(`bird${i}`) * 0.2, rad: R * (0.85 + (i % 3) * 0.17), h: 4.6 + (i % 3) * 0.9 + hash01(`birdh${i}`) * 0.5, sp: 0.1 + (i % 2) * 0.03, dir: i % 2 ? -1 : 1, ph: i * 1.9 });
        dayOnly.push(holder);
        island.add(holder);
      });
    });
  }

  private buildBirds() {
    const { R, island, dayOnly, quality } = this.c;
    const n = quality === "high" ? 5 : 3;
    for (let i = 0; i < n; i++) {
      const rig = this.makeBird(SPECIES[i % SPECIES.length], i * 1.9);
      rig.g.scale.setScalar(3.3);
      this.birds.push({ ...rig, a0: i * 0.5 + hash01(`bird${i}`) * 0.2, rad: R * (0.85 + (i % 3) * 0.17), h: 4.5 + (i % 3) * 0.9 + hash01(`birdh${i}`) * 0.5, sp: 0.1 + (i % 2) * 0.03, dir: i % 2 ? -1 : 1 });
      dayOnly.push(rig.g);
      island.add(rig.g);
    }
    // Perched on fence posts: they look about, flick their tails and fold their wings.
    const spots = this.posts.slice().sort((a, b) => b.z - a.z);
    const perches = quality === "high" ? 2 : 1;
    for (let i = 0; i < perches && i < spots.length; i++) {
      const p = spots[i * 2 < spots.length ? i * 2 : i];
      const rig = this.makeBird(SPECIES[(i + 1) % SPECIES.length], 7 + i * 2.3);
      rig.g.scale.setScalar(3);
      // Wings folded back along the sides.
      rig.wl.rotation.set(0.05, 1.45, -0.18);
      rig.wr.rotation.set(0.05, -1.45, 0.18);
      rig.el.rotation.y = -0.45;
      rig.er.rotation.y = 0.45;
      const base = new THREE.Vector3(p.x, this.c.heightAt(p.x, p.z) + 0.66 + 0.07, p.z);
      rig.g.position.copy(base);
      this.perched.push({ ...rig, base, yaw: i ? Math.PI * 0.8 : -Math.PI * 0.2 });
      dayOnly.push(rig.g);
      island.add(rig.g);
    }
  }

  /* ── bees: striped, fuzzy and winged; each hovers by a flower, then buzzes across to another ── */
  private buildBees() {
    const { flowers, island, dayOnly } = this.c;
    if (flowers.length < 2) return;
    const stripes = canvasTex(8, 64, (g) => {
      for (let i = 0; i < 8; i++) {
        g.fillStyle = i % 2 ? "#17120c" : "#f2bd1b";
        g.fillRect(0, i * 8, 8, 8);
      }
    });
    if (stripes) {
      stripes.wrapS = stripes.wrapT = THREE.RepeatWrapping;
    }
    const abdomenMat = new THREE.MeshStandardMaterial({ color: stripes ? "#ffffff" : "#f2bd1b", map: stripes, roughness: 0.55 });
    const fuzz = new THREE.MeshPhysicalMaterial({ color: "#d29a2c", roughness: 0.95, sheen: 1, sheenColor: new THREE.Color("#ffe08a"), sheenRoughness: 0.4 });
    const black = mat("#15110c", 0.5);
    const wTex = wingTexture();
    const wingMat = new THREE.MeshBasicMaterial({ color: "#ffffff", map: wTex, transparent: true, opacity: wTex ? 0.9 : 0.5, side: THREE.DoubleSide, depthWrite: false });
    const fore = new THREE.PlaneGeometry(0.1, 0.05);
    fore.translate(0.05, 0, 0);
    fore.rotateX(-Math.PI / 2);
    const hind = new THREE.PlaneGeometry(0.07, 0.036);
    hind.translate(0.035, 0, 0);
    hind.rotateX(-Math.PI / 2);
    const n = Math.min(this.c.quality === "high" ? 4 : 2, flowers.length);
    for (let i = 0; i < n; i++) {
      const g = new THREE.Group();
      const abdomen = new THREE.SphereGeometry(0.03, 16, 12);
      abdomen.rotateX(Math.PI / 2);
      abdomen.scale(0.95, 0.9, 1.45);
      const ab = new THREE.Mesh(abdomen, abdomenMat);
      ab.position.set(0, -0.004, -0.045);
      g.add(ab);
      const thorax = new THREE.Mesh(new THREE.SphereGeometry(0.028, 14, 10), fuzz);
      thorax.position.set(0, 0.002, 0.02);
      g.add(thorax);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.019, 12, 9), black);
      head.position.set(0, 0, 0.058);
      g.add(head);
      for (const s of [-1, 1]) {
        const e = new THREE.Mesh(new THREE.SphereGeometry(0.008, 8, 6), mat("#050403", 0.15));
        e.position.set(s * 0.012, 0.008, 0.068);
        g.add(e);
        const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.0016, 0.0016, 0.036, 5), black);
        ant.position.set(s * 0.008, 0.026, 0.076);
        ant.rotation.set(0.9, 0, -s * 0.35);
        g.add(ant);
        // Legs dangling.
        for (const z of [0.03, 0.012, -0.004]) {
          const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.0018, 0.0014, 0.034, 4), black);
          leg.position.set(s * 0.018, -0.022, z);
          leg.rotation.set(0.25, 0, -s * 0.5);
          g.add(leg);
        }
      }
      const sting = new THREE.Mesh(new THREE.ConeGeometry(0.0045, 0.018, 6), black);
      sting.rotation.x = -Math.PI / 2;
      sting.position.set(0, -0.012, -0.105);
      g.add(sting);
      // Wings: a big pair and a small pair each side, hinged at the back.
      const wl: THREE.Object3D[] = [];
      const wr: THREE.Object3D[] = [];
      for (const [geo, z] of [[fore, 0.014], [hind, -0.006]] as const) {
        const a = new THREE.Group();
        a.position.set(0.012, 0.026, z);
        a.add(new THREE.Mesh(geo, wingMat));
        const b = new THREE.Group();
        b.position.set(-0.012, 0.026, z);
        b.scale.x = -1;
        b.add(new THREE.Mesh(geo, wingMat));
        g.add(a, b);
        wl.push(a);
        wr.push(b);
      }
      g.scale.setScalar(4);
      const start = flowers[Math.floor(hash01(`bee${i}`) * flowers.length)];
      const from = start.clone().add(new THREE.Vector3(0, 0.42, 0));
      g.position.copy(from);
      // A sparkle of pollen drifting off behind it.
      const N = 16;
      const tg = new THREE.BufferGeometry();
      tg.setAttribute("position", new THREE.BufferAttribute(new Float32Array(N * 3), 3));
      const fade = new Float32Array(N * 3);
      for (let k = 0; k < N; k++) {
        const f = (1 - k / N) ** 1.6;
        fade.set([1 * f, 0.82 * f, 0.28 * f], k * 3);
      }
      tg.setAttribute("color", new THREE.BufferAttribute(fade, 3));
      const trail = new THREE.Points(tg, new THREE.PointsMaterial({ size: 0.05, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true }));
      trail.frustumCulled = false;
      island.add(trail);
      dayOnly.push(trail);
      this.bees.push({ g, wl, wr, from, to: from.clone(), t0: -99, dwell: 2 + hash01(`beed${i}`) * 3, ph: hash01(`beep${i}`) * 10, trail, hist: Array.from({ length: N }, () => from.clone()) });
      dayOnly.push(g);
      island.add(g);
    }
  }

  /* ── dragonflies: a long banded body, big eyes and four veined wings; they dart in loops over the pond ── */
  private buildDragonflies() {
    const { pond, island, dayOnly } = this.c;
    if (!pond) return;
    const wTex = wingTexture(true);
    const wingMat = new THREE.MeshBasicMaterial({ color: "#ffffff", map: wTex, transparent: true, opacity: wTex ? 0.95 : 0.45, side: THREE.DoubleSide, depthWrite: false });
    const wing = new THREE.PlaneGeometry(0.2, 0.06);
    wing.translate(0.1, 0, 0);
    wing.rotateX(-Math.PI / 2);
    const n = this.c.quality === "high" ? 2 : 1;
    for (let i = 0; i < n; i++) {
      const g = new THREE.Group();
      const hue = i ? ["#2a8f5a", "#1c6b44"] : ["#2f7fe0", "#1c4fa0"];
      // The abdomen: ten banded segments, thinning towards the tail.
      for (let k = 0; k < 10; k++) {
        const r = 0.0125 - k * 0.00055;
        const seg = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.92, r, 0.026, 8), irid(k % 2 ? hue[1] : hue[0]));
        seg.rotation.x = Math.PI / 2;
        seg.position.z = -0.03 - k * 0.0255;
        g.add(seg);
      }
      const thorax = new THREE.Mesh(new THREE.SphereGeometry(0.024, 12, 9), irid(i ? "#38b36c" : "#46a0f0"));
      thorax.scale.set(1, 0.95, 1.25);
      g.add(thorax);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.018, 10, 8), mat("#1a2530", 0.4));
      head.position.z = 0.036;
      g.add(head);
      for (const s of [-1, 1]) {
        const eye = new THREE.Mesh(new THREE.SphereGeometry(0.0125, 10, 8), mat(i ? "#7bf0b0" : "#58d7ee", 0.2, { emissive: i ? "#1c8f56" : "#1c93b0", emissiveIntensity: 0.45 }));
        eye.position.set(s * 0.012, 0.006, 0.045);
        g.add(eye);
      }
      const w: THREE.Object3D[] = [];
      for (const [z, s] of [[0.016, 1], [-0.004, 1], [0.016, -1], [-0.004, -1]] as const) {
        const a = new THREE.Group();
        a.position.set(s * 0.01, 0.014, z);
        if (s < 0) a.scale.x = -1;
        const m = new THREE.Mesh(wing, wingMat);
        m.scale.set(z > 0.01 ? 0.92 : 1, 1, 1);
        a.add(m);
        g.add(a);
        w.push(a);
      }
      g.scale.setScalar(3.6);
      this.dragons.push({ g, w, ph: i * 3.1, sp: 0.5 + i * 0.12 });
      dayOnly.push(g);
      island.add(g);
    }
  }

  /* ── koi: smooth glossy fish with patches of colour, fins that wave and a body that bends as it swims ── */
  private buildKoi() {
    const { pond, island } = this.c;
    if (!pond) return;
    const n = this.c.quality === "high" ? 5 : 2;
    // Each koi: its base, and the colours of its patches along the back.
    const kinds: { base: string; patch: string[]; fin: string }[] = [
      { base: "#f6f1e8", patch: ["#e5432a", "#e5432a", "#f6f1e8"], fin: "#f2c9b8" },
      { base: "#f6f1e8", patch: ["#e5432a", "#1b1816", "#f6f1e8"], fin: "#efe3d4" },
      { base: "#ff8a2b", patch: ["#ff8a2b", "#ffb257", "#ff8a2b"], fin: "#ff9d4d" },
      { base: "#f3c93a", patch: ["#f3c93a", "#ffe27a", "#f3c93a"], fin: "#f7d96b" },
      { base: "#e8e3d8", patch: ["#2b2a28", "#e8e3d8", "#e5432a"], fin: "#d8d2c4" },
    ];
    for (let i = 0; i < n; i++) {
      const kind = kinds[i % kinds.length];
      const g = new THREE.Group();
      const baseC = new THREE.Color(kind.base);
      const patches = kind.patch.map((p) => new THREE.Color(p));
      const seed = i * 7.31;
      // The front body: a smooth teardrop with a rounded head, patterned with patches of colour.
      const front = new THREE.LatheGeometry([[-0.02, 0.0], [0.0, 0.02], [0.05, 0.043], [0.11, 0.05], [0.17, 0.04], [0.2, 0.02], [0.21, 0]].map(([y, r]) => new THREE.Vector2(r, y)), 20);
      front.rotateX(Math.PI / 2);
      paint(front, (x, y, z, out) => {
        const u = Math.sin(z * 22 + seed) + Math.sin(x * 40 + z * 9 + seed * 2) * 0.6;
        out.copy(baseC);
        if (y > -0.004 && u > 0.1) out.lerp(patches[Math.floor(Math.abs(u * 3 + seed)) % patches.length], 0.92);
        if (z > 0.17) out.copy(baseC);
      });
      const bodyMat = vcGloss();
      g.add(new THREE.Mesh(front, bodyMat));
      // The rear body and the tail hinge from it, so the fish bends in an S as it swims.
      const rear = new THREE.Group();
      rear.position.z = -0.02;
      const rearGeo = new THREE.LatheGeometry([[0, 0.02], [0.06, 0.036], [0.11, 0.026], [0.16, 0.012], [0.19, 0.0]].map(([y, r]) => new THREE.Vector2(r, y)), 16);
      rearGeo.rotateX(-Math.PI / 2);
      paint(rearGeo, (x, _y, z, out) => {
        out.copy(baseC);
        if (Math.sin(z * 26 + seed * 3) + Math.sin(x * 50) * 0.5 > 0.35) out.lerp(patches[0], 0.9);
      });
      rear.add(new THREE.Mesh(rearGeo, bodyMat));
      g.add(rear);
      const tail = new THREE.Group();
      tail.position.z = -0.185;
      rear.add(tail);
      const finMat = new THREE.MeshStandardMaterial({ color: kind.fin, roughness: 0.5, transparent: true, opacity: 0.88, side: THREE.DoubleSide, depthWrite: false });
      // A two-lobed tail fan.
      tail.add(new THREE.Mesh(flat([[0, 0], [0.026, -0.05], [0.07, -0.13], [0.05, -0.145], [0.02, -0.12], [0, -0.1], [-0.02, -0.12], [-0.05, -0.145], [-0.07, -0.13], [-0.026, -0.05]]), finMat));
      // Pectoral fins wave on either side, a dorsal fin stands on the back.
      const fins: THREE.Object3D[] = [];
      for (const s of [-1, 1]) {
        const pf = new THREE.Group();
        pf.position.set(s * 0.04, -0.012, 0.11);
        const m = new THREE.Mesh(flat([[0, 0.02], [0.05, 0.03], [0.08, -0.02], [0.04, -0.045], [0, -0.02]]), finMat);
        if (s < 0) m.scale.x = -1;
        pf.add(m);
        g.add(pf);
        fins.push(pf);
      }
      // A thin fin standing up from the back.
      const dfin = new THREE.Mesh(sail([[-0.06, 0], [0.0, 0.05], [0.02, 0.055], [0.09, 0]]), finMat);
      dfin.position.set(0, 0.05, 0.02);
      g.add(dfin);
      // Eyes and a pale snout, and whiskers (barbels).
      for (const s of [-1, 1]) {
        const eye = new THREE.Mesh(new THREE.SphereGeometry(0.008, 8, 6), new THREE.MeshStandardMaterial({ color: "#050403", roughness: 0.15 }));
        eye.position.set(s * 0.032, 0.022, 0.17);
        g.add(eye);
        const barbel = new THREE.Mesh(new THREE.CylinderGeometry(0.0015, 0.001, 0.035, 4), finMat);
        barbel.position.set(s * 0.018, -0.006, 0.222);
        barbel.rotation.set(Math.PI / 2 - 0.4, 0, s * 0.5);
        g.add(barbel);
      }
      g.scale.setScalar(2.3);
      // Rings that spread out on the water behind it.
      const wakes = Array.from({ length: 3 }, () => {
        const m = new THREE.Mesh(new THREE.RingGeometry(0.86, 1, 32), new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }));
        m.rotation.x = -Math.PI / 2;
        m.visible = false;
        island.add(m);
        return { m, born: -99 };
      });
      this.koi.push({ g, rear, tail, fins, wakes, nextWake: 0, ph: i * 1.7 + hash01(`koi${i}`) * 2, sp: 0.28 + hash01(`kois${i}`) * 0.12, rx: 0.32 + (i % 3) * 0.14, dir: i % 2 ? -1 : 1 });
      island.add(g);
    }
  }

  /* ── a picket fence either side of the path by the cottage, and a mailbox ── */
  private buildFence() {
    const { home, pathWorld, island, heightAt, clear } = this.c;
    const wood = mat("#e9e1cf", 0.85);
    const woodDark = mat("#b9ad93", 0.9);
    const z0 = home.z + 0.95;
    const z1 = home.z + 3.1;
    const pickets: THREE.Vector3[] = [];
    const posts: THREE.Vector3[] = [];
    for (const side of [-1, 1]) {
      for (let z = z0; z <= z1; z += 0.13) pickets.push(new THREE.Vector3(pathWorld(z) + side * 1.15, 0, z));
      for (const z of [z0, (z0 + z1) / 2, z1]) posts.push(new THREE.Vector3(pathWorld(z) + side * 1.15, 0, z));
    }
    this.posts = posts;
    const picketGeo = new THREE.BoxGeometry(0.05, 0.52, 0.014);
    picketGeo.translate(0, 0.26, 0);
    const picketTop = new THREE.ConeGeometry(0.032, 0.05, 4);
    picketTop.rotateY(Math.PI / 4);
    picketTop.translate(0, 0.545, 0);
    const mesh = new THREE.InstancedMesh(picketGeo, wood, pickets.length);
    const tops = new THREE.InstancedMesh(picketTop, wood, pickets.length);
    const m4 = new THREE.Matrix4();
    pickets.forEach((p, i) => {
      // The fence follows the ground and leans a hair, so it does not look ruled.
      const y = heightAt(p.x, p.z);
      m4.makeRotationFromEuler(new THREE.Euler(0, Math.PI / 2 + (hash01(`pk${i}`) - 0.5) * 0.05, (hash01(`pl${i}`) - 0.5) * 0.06));
      m4.setPosition(p.x, y, p.z);
      mesh.setMatrixAt(i, m4);
      tops.setMatrixAt(i, m4);
    });
    mesh.castShadow = true;
    tops.castShadow = true;
    island.add(mesh, tops);
    const postGeo = new THREE.BoxGeometry(0.085, 0.66, 0.085);
    postGeo.translate(0, 0.33, 0);
    const postMesh = new THREE.InstancedMesh(postGeo, woodDark, posts.length);
    posts.forEach((p, i) => {
      m4.makeTranslation(p.x, heightAt(p.x, p.z), p.z);
      postMesh.setMatrixAt(i, m4);
      clear(p.x, p.z, 0.45);
    });
    postMesh.castShadow = true;
    island.add(postMesh);
    // Two rails along each side.
    for (const side of [-1, 1]) {
      for (const yy of [0.18, 0.4]) {
        const len = z1 - z0;
        const rail = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, len), woodDark);
        const zc = (z0 + z1) / 2;
        const x = pathWorld(zc) + side * 1.15;
        rail.position.set(x, heightAt(x, zc) + yy, zc);
        // Follows the path's gentle curve: turn to match its ends.
        rail.rotation.y = Math.atan2(pathWorld(z1) - pathWorld(z0), len) * -1;
        rail.castShadow = true;
        island.add(rail);
      }
    }
    // Bare earth along the fence line, so the grass does not swallow it.
    for (const side of [-1, 1]) for (let z = z0; z <= z1; z += 0.45) clear(pathWorld(z) + side * 1.15, z, 0.34);
    // The mailbox: a post, a rounded blue box and a red flag.
    const mx = pathWorld(z0 + 0.2) + 1.55;
    const mz = z0 + 0.2;
    const my = heightAt(mx, mz);
    const box = new THREE.Group();
    const stand = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.5, 0.05), woodDark);
    stand.position.y = 0.25;
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.2, 14, 1, false, 0, Math.PI), mat("#2f6fb5", 0.45, { metalness: 0.3 }));
    body.rotation.z = Math.PI / 2;
    body.rotation.y = Math.PI / 2;
    body.position.y = 0.58;
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.04, 0.22), mat("#2f6fb5", 0.45, { metalness: 0.3 }));
    base.position.y = 0.52;
    const flagPole = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.13, 0.012), mat("#9aa0a6", 0.4, { metalness: 0.6 }));
    flagPole.position.set(0.09, 0.6, 0.05);
    const flag = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.045, 0.07), mat("#d63b3b", 0.6));
    flag.position.set(0.09, 0.66, 0.085);
    box.add(stand, body, base, flagPole, flag);
    box.position.set(mx, my, mz);
    box.scale.setScalar(1.4);
    box.rotation.y = -Math.PI / 2;
    box.traverse((o) => ((o as THREE.Mesh).castShadow = true));
    island.add(box);
    clear(mx, mz, 0.25);
  }

  /** Moves everything on by a frame: `t` is the scene's clock (s), `dt` the frame time (s). */
  update(t: number, dt: number) {
    const slow = this.c.reduced ? 0.35 : 1;
    // Birds in flight: a wide loop over the island, banking into the turn, flapping between glides
    // (wings bend at the elbow and the tips lag behind the shoulders).
    for (const b of this.birds) {
      const a = b.a0 + t * b.sp * slow * b.dir;
      const x = Math.cos(a) * b.rad;
      const z = Math.sin(a) * b.rad * 0.85;
      const y = b.h + Math.sin(a * 5 * b.dir + b.a0 * 9) * 0.2;
      const prev = b.g.position.clone();
      b.g.position.set(x, y, z);
      b.g.lookAt(prev.lerp(b.g.position, 2));
      b.g.rotateZ(-0.38 * b.dir);
      const glide = Math.sin(t * 0.55 + b.ph * 2.3) > 0.3;
      const cycle = t * 8.5 + b.ph * 3;
      const flap = glide ? 0.16 + Math.sin(t * 1.3 + b.ph) * 0.05 : Math.sin(cycle) * 0.7;
      const tip = glide ? 0.05 : Math.sin(cycle - 0.7) * 0.55;
      b.wl.rotation.z = flap;
      b.wr.rotation.z = -flap;
      b.el.rotation.z = tip;
      b.er.rotation.z = -tip;
      b.tail.rotation.x = -0.12 + Math.sin(t * 2 + b.ph) * 0.05;
    }
    // The real flock: a wide loop over the island, banking into the turn, the models' own wing-beat playing.
    for (const f of this.flock) {
      f.mixer.update(dt * slow);
      const a = f.a0 + t * f.sp * slow * f.dir;
      const x = Math.cos(a) * f.rad;
      const z = Math.sin(a) * f.rad * 0.85;
      const y = f.h + Math.sin(a * 5 * f.dir + f.a0 * 9) * 0.22;
      const prev = f.g.position.clone();
      f.g.position.set(x, y, z);
      f.g.lookAt(prev.lerp(f.g.position, 2));
      f.g.rotateZ(-0.3 * f.dir);
    }
    // Perched birds: look around, hop a little, flick the tail.
    for (const p of this.perched) {
      const look = Math.sin(t * 0.45 + p.ph) * Math.sin(t * 0.21 + p.ph * 2);
      p.g.rotation.y = p.yaw + look * 0.9;
      const hop = Math.max(0, Math.sin(t * 0.9 + p.ph * 5) - 0.93) * 3;
      p.g.position.y = p.base.y + hop * 0.12;
      p.tail.rotation.x = -0.12 + Math.max(0, Math.sin(t * 1.7 + p.ph)) * 0.22;
      p.g.rotation.x = Math.sin(t * 1.1 + p.ph) * 0.03;
    }
    // Bees: hover, then cross to another flower on an arc, wings a blur.
    const { flowers } = this.c;
    for (const b of this.bees) {
      if (t - b.t0 > b.dwell) {
        const next = flowers[Math.floor(hash01(`beeflower${b.ph}${Math.floor(t)}`) * flowers.length)];
        b.from.copy(b.g.position);
        b.to.copy(next).add(new THREE.Vector3(0, 0.4, 0));
        b.t0 = t;
        b.dwell = 2.2 + hash01(`d${b.ph}${Math.floor(t)}`) * 3.5;
      }
      const k = Math.min(1, (t - b.t0) / 1.3);
      const e = k * k * (3 - 2 * k);
      const hover = k >= 1 ? 1 : 0;
      b.g.position.lerpVectors(b.from, b.to, e);
      b.g.position.y += Math.sin(e * Math.PI) * 0.35 + Math.sin(t * 2.3 + b.ph) * 0.03 * hover;
      b.g.position.x += Math.cos(t * 1.7 + b.ph) * 0.07 * hover;
      b.g.position.z += Math.sin(t * 1.9 + b.ph) * 0.07 * hover;
      const dir = new THREE.Vector3().subVectors(b.to, b.from);
      if (k < 1 && dir.lengthSq() > 0.001) b.g.rotation.y = Math.atan2(dir.x, dir.z);
      else b.g.rotation.y += dt * 0.4;
      // Nose down a touch when it lands on the flower; body tilts as it flies.
      b.g.rotation.x = hover ? 0.45 : 0.15;
      // The pollen trail: the last few places it was, scattered a little.
      b.hist.pop();
      b.hist.unshift(b.g.position.clone());
      const tp = b.trail.geometry.attributes.position as THREE.BufferAttribute;
      b.hist.forEach((h, k) => tp.setXYZ(k, h.x + Math.sin(t * 3 + k * 1.7 + b.ph) * 0.03 * k * 0.4, h.y - 0.02 * k * 0.3 + Math.cos(t * 2.4 + k) * 0.015, h.z + Math.cos(t * 2.8 + k * 1.3) * 0.03 * k * 0.4));
      tp.needsUpdate = true;
      const buzz = Math.sin(t * 95 + b.ph) * 0.85;
      b.wl.forEach((w, i) => (w.rotation.z = buzz * (i ? 0.8 : 1) + 0.25));
      b.wr.forEach((w, i) => (w.rotation.z = -buzz * (i ? 0.8 : 1) - 0.25));
    }
    // Dragonflies: figure-eights over the pond with sudden turns, wings beating fast and out flat.
    const pond = this.c.pond;
    if (pond) {
      for (const d of this.dragons) {
        const a = t * d.sp * slow + d.ph;
        const x = pond.c.x + Math.cos(a) * pond.r * 0.85;
        const z = pond.c.z + Math.sin(a * 2) * pond.r * pond.sy * 0.55;
        const y = pond.c.y + 0.5 + Math.sin(a * 3.1) * 0.12;
        const prev = d.g.position.clone();
        d.g.position.set(x, y, z);
        d.g.lookAt(prev.lerp(d.g.position, 2));
        const w = Math.sin(t * 70 + d.ph) * 0.3;
        d.w.forEach((m, i) => (m.rotation.z = (i % 2 ? -w : w) * (i < 2 ? 1 : -1) * (i === 0 || i === 2 ? 1 : 0.8)));
      }
      // Koi: round the pond at their own pace, the body bending from head to tail, the fins waving.
      for (const k of this.koi) {
        const a = t * k.sp * k.dir * slow + k.ph;
        const x = pond.c.x + Math.cos(a) * pond.r * k.rx;
        const z = pond.c.z + Math.sin(a) * pond.r * pond.sy * k.rx;
        const prev = k.g.position.clone();
        k.g.position.set(x, pond.c.y + 0.034, z);
        k.g.lookAt(prev.lerp(k.g.position, 2));
        const swim = t * 5.2 + k.ph;
        k.rear.rotation.y = Math.sin(swim) * 0.28;
        k.tail.rotation.y = Math.sin(swim - 0.9) * 0.5;
        // A ring on the water every so often, spreading and fading.
        if (t > k.nextWake) {
          const oldest = k.wakes.reduce((a, w) => (w.born < a.born ? w : a));
          oldest.born = t;
          oldest.m.position.set(k.g.position.x, pond.c.y + 0.036, k.g.position.z);
          k.nextWake = t + 1.2 + hash01(`wk${k.ph}${Math.floor(t)}`) * 0.8;
        }
        for (const w of k.wakes) {
          const age = t - w.born;
          w.m.visible = age >= 0 && age < 2.2;
          if (!w.m.visible) continue;
          w.m.scale.setScalar(0.06 + age * 0.3);
          (w.m.material as THREE.MeshBasicMaterial).opacity = 0.32 * (1 - age / 2.2);
        }
        k.fins.forEach((f, i) => (f.rotation.z = (i ? -1 : 1) * (0.25 + Math.sin(t * 3 + k.ph + i) * 0.3)));
      }
    }
  }

  /** (for looking at them) Where a creature of this kind is now, in island space: the first bird, bee, dragonfly, koi or perched bird. */
  where(kind: "bird" | "perched" | "bee" | "dragon" | "koi"): THREE.Vector3 | null {
    const g = kind === "bird" ? (this.flock[0]?.g ?? this.birds[0]?.g) : kind === "perched" ? this.perched[0]?.g : kind === "bee" ? this.bees[0]?.g : kind === "dragon" ? this.dragons[0]?.g : this.koi[0]?.g;
    return g ? g.position.clone() : null;
  }

  /** Frees the geometry and materials this made. */
  dispose() {
    for (const o of [...this.flock.map((b) => b.g), ...this.birds.map((b) => b.g), ...this.perched.map((b) => b.g), ...this.bees.map((b) => b.g), ...this.dragons.map((d) => d.g), ...this.koi.map((k) => k.g)]) {
      o.traverse((m) => {
        const mesh = m as THREE.Mesh;
        mesh.geometry?.dispose();
      });
    }
  }
}
