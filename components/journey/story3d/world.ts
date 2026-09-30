import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { FBXLoader } from "three/addons/loaders/FBXLoader.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { Age } from "../story/avatar";
import type { SceneKind } from "../story/scenes";
import type { Stage } from "../story/stages";

/**
 * The owner's 3D avatar walking through their story.
 * - Real places (school, DMI College, Zinnov) use the owner's own photos: shown whole and sharp,
 *   with only the leftover edges filled by a soft blurred copy; the avatar stands on the photo's ground.
 * - Every other milestone is a 3D room furnished with Poly Haven's CC0 photo-scanned models.
 * Each milestone is a scene change: walk out, fade, next place, walk back in, turn and tell the story.
 */

export const AVATAR_URL = "/journey/avatar.glb";
const ANIM_URL = (name: string) => `/journey/anim/${name}.fbx`;
const MODEL_URL = (name: string) => `/journey-3d/${name}.glb`;
const OFFSTAGE = 3.6; // how far out of frame the avatar walks between scenes
const WALK_SPEED = 1.45; // metres per second, natural pace
const FADE = 0.55;

/**
 * ground = where the photo's ground is (fraction of the photo's height, top 0 → bottom 1).
 * person = how tall a person standing there looks in the photo (fraction of the photo's height),
 * judged from doors, gates and statues in the shot. Together they fix the camera height and distance.
 */
type Photo = { url: string; ground: number; person: number };
const PHOTO: Partial<Record<SceneKind, Photo>> = {
  school: { url: "/journey-env/school-photo.jpg", ground: 0.95, person: 0.42 },
  college: { url: "/journey-env/college-photo.jpg", ground: 0.94, person: 0.22 },
  graduation: { url: "/journey-env/college-photo.jpg", ground: 0.94, person: 0.24 },
  office: { url: "/journey-env/office-photo.jpg", ground: 0.93, person: 0.6 },
};

const AGE_SCALE: Record<Age, number> = { kid: 0.78, teen: 0.9, student: 1, grad: 1, pro: 1, future: 1 };

type ClipName = "idle" | "walk" | "wave" | "talk" | "typing";
type Opts = {
  onReady: (info: { clips: ClipName[] }) => void;
  onError: (msg: string) => void;
  onStage: (i: number, age: Age) => void;
  /** 0 → 1 black overlay during scene changes (drawn by the React layer). */
  onFade: (v: number) => void;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const clip = (s: string | undefined, n: number) => (s && s.length > n ? `${s.slice(0, n - 1)}…` : (s ?? ""));

/* ───────────── small texture helpers (floors, windows, signs) ───────────── */

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, repeat?: [number, number]) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d")!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(...repeat);
  }
  return t;
}

const woodFloor = (base: string, dark: string) =>
  canvasTex(
    1024,
    1024,
    (g) => {
      g.fillStyle = base;
      g.fillRect(0, 0, 1024, 1024);
      for (let row = 0; row < 8; row++) {
        const y = row * 128;
        let x = -((row * 173) % 400);
        while (x < 1024) {
          const w = 300 + ((x + row * 97) % 220);
          g.fillStyle = `rgba(0,0,0,${0.04 + ((x + row) % 5) * 0.015})`;
          g.fillRect(x, y, w, 128);
          for (let k = 0; k < 7; k++) {
            g.strokeStyle = `rgba(60,35,15,${0.05 + k * 0.01})`;
            g.beginPath();
            g.moveTo(x, y + 14 + k * 16);
            g.bezierCurveTo(x + w * 0.3, y + 10 + k * 16, x + w * 0.7, y + 20 + k * 16, x + w, y + 14 + k * 16);
            g.stroke();
          }
          g.fillStyle = dark;
          g.fillRect(x, y, 3, 128);
          x += w;
        }
        g.fillStyle = dark;
        g.fillRect(0, y, 1024, 3);
      }
    },
    [3, 3],
  );

const tileFloor = (base: string, line: string) =>
  canvasTex(
    512,
    512,
    (g) => {
      g.fillStyle = base;
      g.fillRect(0, 0, 512, 512);
      g.strokeStyle = line;
      g.lineWidth = 4;
      for (let i = 0; i <= 512; i += 128) {
        g.beginPath();
        g.moveTo(i, 0);
        g.lineTo(i, 512);
        g.moveTo(0, i);
        g.lineTo(512, i);
        g.stroke();
      }
    },
    [6, 6],
  );

function sign(text: string, sub: string, w: number, fg: string, bg: string) {
  const h = w * 0.28;
  const tex = canvasTex(1024, 287, (g) => {
    g.fillStyle = bg;
    g.fillRect(0, 0, 1024, 287);
    g.fillStyle = fg;
    g.fillRect(0, 0, 10, 287);
    g.textAlign = "left";
    g.textBaseline = "middle";
    let size = 92;
    g.font = `800 ${size}px sans-serif`;
    while (g.measureText(text).width > 940 && size > 30) g.font = `800 ${(size -= 4)}px sans-serif`;
    g.fillStyle = "#f4f7fa";
    g.fillText(text, 44, sub ? 110 : 143);
    if (sub) {
      g.font = "500 44px sans-serif";
      g.fillStyle = fg;
      g.fillText(clip(sub, 44), 46, 205);
    }
  });
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
}

function windowView(kind: "night" | "morning") {
  const tex = canvasTex(768, 512, (g) => {
    const gr = g.createLinearGradient(0, 0, 0, 512);
    if (kind === "night") {
      gr.addColorStop(0, "#040817");
      gr.addColorStop(1, "#1a2a5a");
    } else {
      gr.addColorStop(0, "#8ec5ea");
      gr.addColorStop(1, "#ffe0b5");
    }
    g.fillStyle = gr;
    g.fillRect(0, 0, 768, 512);
    if (kind === "night") {
      for (let i = 0; i < 90; i++) {
        g.fillStyle = `rgba(255,255,255,${0.3 + (i % 5) * 0.14})`;
        g.fillRect((i * 97) % 768, (i * 53) % 330, 2, 2);
      }
      g.fillStyle = "#f3eecf";
      g.beginPath();
      g.arc(560, 120, 44, 0, Math.PI * 2);
      g.fill();
    }
    // distant city silhouette
    for (let i = 0; i < 16; i++) {
      const bw = 30 + ((i * 37) % 40);
      const bh = 70 + ((i * 71) % 150);
      g.fillStyle = kind === "night" ? "#0b1430" : "rgba(90,120,150,0.55)";
      g.fillRect(i * 50, 512 - bh, bw, bh);
      if (kind === "night")
        for (let y = 512 - bh + 10; y < 505; y += 18)
          for (let x = i * 50 + 5; x < i * 50 + bw - 5; x += 10) {
            if ((x + y + i) % 4 !== 0) continue;
            g.fillStyle = "#ffd98a";
            g.fillRect(x, y, 4, 6);
          }
    }
  });
  const g = new THREE.Group();
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.6), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
  const frame = new THREE.MeshStandardMaterial({ color: 0xf2efe9, roughness: 0.5 });
  const bars = [
    [2.56, 0.08, 0, 0.84],
    [2.56, 0.08, 0, -0.84],
    [0.08, 1.76, 1.24, 0],
    [0.08, 1.76, -1.24, 0],
    [0.05, 1.6, 0, 0],
  ];
  for (const [w, h, x, y] of bars) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.08), frame);
    b.position.set(x, y, 0.03);
    g.add(b);
  }
  g.add(glass);
  return g;
}

/* ───────────── the world ───────────── */

export class LifeWorld {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(40, 1, 0.05, 200);
  private timer = new THREE.Timer();
  private pmrem: THREE.PMREMGenerator;
  private raf = 0;
  private disposed = false;
  private gltf = new GLTFLoader();
  private models = new Map<string, Promise<THREE.Object3D>>();
  private rooms = new Map<SceneKind, Promise<THREE.Group>>();
  private room: THREE.Group | null = null;
  private photos = new Map<string, Promise<HTMLImageElement>>();
  private photo: { img: HTMLImageElement; ground: number; person: number } | null = null;
  private photoCanvas = document.createElement("canvas");
  private photoTex = new THREE.CanvasTexture(this.photoCanvas);
  private photoFeet = 0.9;
  private photoPerson = 0.4; // person height as a fraction of screen height
  private shadowFloor: THREE.Mesh;
  private sun: THREE.DirectionalLight;
  private avatar: THREE.Object3D | null = null;
  private head: THREE.Object3D | null = null;
  private mixer: THREE.AnimationMixer | null = null;
  private actions = new Map<ClipName, THREE.AnimationAction>();
  private current: ClipName | null = null;
  private cap: THREE.Object3D | null = null;
  private originalMats = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
  private holo: THREE.MeshBasicMaterial | null = null;
  private portal = new THREE.Group();
  private stageIndex = -1;
  private gen = 0;
  private x = 0;
  private yaw = 0;
  private yawTarget = 0.25;
  private scale = 1;
  private scaleTarget = 1;
  private talking = false;
  private camClose = 0;
  private busy = Promise.resolve();
  private fadeV = 1;
  private ro: ResizeObserver;

  constructor(
    private canvas: HTMLCanvasElement,
    private stages: Stage[],
    private opts: Opts,
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = this.pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.75;
    this.photoTex.colorSpace = THREE.SRGBColorSpace;

    // Invisible floor that shows the avatar's contact shadow on top of photos.
    this.shadowFloor = new THREE.Mesh(new THREE.CircleGeometry(3, 48), new THREE.ShadowMaterial({ opacity: 0.35 }));
    this.shadowFloor.rotation.x = -Math.PI / 2;
    this.shadowFloor.position.y = 0.002;
    this.shadowFloor.receiveShadow = true;
    this.scene.add(this.shadowFloor);
    this.scene.add(new THREE.HemisphereLight(0xf2f6ff, 0x3a3530, 0.5));
    this.sun = new THREE.DirectionalLight(0xfff4e6, 1.6);
    this.sun.position.set(-3, 6, 4);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    Object.assign(this.sun.shadow.camera, { left: -7, right: 7, top: 6, bottom: -4, near: 0.5, far: 20 });
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.radius = 3;
    this.scene.add(this.sun);
    this.buildPortal();

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas.parentElement!);
    this.resize();
    void this.loadAvatar();
    this.loop();
  }

  /* ───── assets ───── */

  private model(name: string) {
    let p = this.models.get(name);
    if (!p) {
      p = this.gltf.loadAsync(MODEL_URL(name)).then((g) => {
        g.scene.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.isMesh) m.castShadow = m.receiveShadow = true;
        });
        return g.scene;
      });
      this.models.set(name, p);
    }
    return p.then((s) => s.clone(true));
  }

  /** Stand an object on the floor (or on another object's top) at x/z, turned by rotY. */
  private async put(parent: THREE.Group, name: string, x: number, z: number, rotY = 0, on?: THREE.Object3D, scale = 1) {
    const o = await this.model(name);
    o.scale.setScalar(scale);
    o.rotation.y = rotY;
    const box = new THREE.Box3().setFromObject(o);
    let y = -box.min.y;
    if (on) y += new THREE.Box3().setFromObject(on).max.y;
    o.position.set(x, y, z);
    parent.add(o);
    return o;
  }

  private loadPhoto(url: string) {
    let p = this.photos.get(url);
    if (!p) {
      p = new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error(`Couldn't load ${url}`));
        img.src = url;
      });
      this.photos.set(url, p);
    }
    return p;
  }

  /**
   * Whole photo, sharp, fitted to the view height (nothing cropped); the empty sides get a darkened,
   * blurred copy of the same photo so it reads as one image. Also works out where the photo's ground
   * lands on screen, so the avatar's feet can be put there.
   */
  private composePhoto() {
    if (!this.photo) return;
    const { img, ground, person } = this.photo;
    const view = this.camera.aspect || 16 / 9;
    const ch = 1600;
    const cw = Math.round(ch * view);
    const c = this.photoCanvas;
    c.width = cw;
    c.height = ch;
    const g = c.getContext("2d")!;
    const iw = img.naturalWidth;
    const ih = img.naturalHeight;
    const cover = Math.max(cw / iw, ch / ih);
    g.filter = "blur(36px) brightness(0.55) saturate(1.1)";
    g.drawImage(img, (cw - iw * cover) / 2, (ch - ih * cover) / 2, iw * cover, ih * cover);
    g.filter = "none";
    const fit = Math.min(cw / iw, ch / ih);
    const dw = iw * fit;
    const dh = ih * fit;
    const dx = (cw - dw) / 2;
    const dy = (ch - dh) / 2;
    g.imageSmoothingQuality = "high";
    g.drawImage(img, dx, dy, dw, dh);
    // feather the photo's side edges into the blurred fill
    for (const [x0, x1] of [
      [dx, dx + 60],
      [dx + dw, dx + dw - 60],
    ]) {
      const gr = g.createLinearGradient(x0, 0, x1, 0);
      gr.addColorStop(0, "rgba(0,0,0,0.35)");
      gr.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = gr;
      g.fillRect(Math.min(x0, x1), dy, 60, dh);
    }
    this.photoTex.needsUpdate = true;
    this.photoFeet = (dy + ground * dh) / ch;
    this.photoPerson = (person * dh) / ch;
  }

  /* ───── 3D rooms for the other milestones ───── */

  private shell(g: THREE.Group, wall: number, floor: THREE.Texture | number) {
    const floorMat = typeof floor === "number" ? new THREE.MeshStandardMaterial({ color: floor, roughness: 0.6 }) : new THREE.MeshStandardMaterial({ map: floor, roughness: 0.55 });
    const fl = new THREE.Mesh(new THREE.PlaneGeometry(16, 12), floorMat);
    fl.rotation.x = -Math.PI / 2;
    fl.position.z = -1;
    fl.receiveShadow = true;
    const wallMat = new THREE.MeshStandardMaterial({ color: wall, roughness: 0.9 });
    const back = new THREE.Mesh(new THREE.PlaneGeometry(16, 6), wallMat);
    back.position.set(0, 3, -4.8);
    back.receiveShadow = true;
    const left = new THREE.Mesh(new THREE.PlaneGeometry(12, 6), wallMat);
    left.rotation.y = Math.PI / 2;
    left.position.set(-6.5, 3, -1);
    left.receiveShadow = true;
    const right = left.clone();
    right.rotation.y = -Math.PI / 2;
    right.position.x = 6.5;
    const skirt = new THREE.Mesh(new THREE.BoxGeometry(16, 0.12, 0.04), new THREE.MeshStandardMaterial({ color: 0xf0ede6, roughness: 0.5 }));
    skirt.position.set(0, 0.06, -4.77);
    g.add(fl, back, left, right, skirt);
  }

  private buildRoom(scene: SceneKind, stage: Stage) {
    let p = this.rooms.get(scene);
    if (p) return p;
    p = (async () => {
      const g = new THREE.Group();
      const c = stage.commit;
      switch (scene) {
        case "lab": {
          this.shell(g, 0x3a4a56, tileFloor("#8f989f", "#737c84"));
          const bench = await this.put(g, "metal_office_desk", 2.0, -3.0);
          await Promise.all([
            this.put(g, "circuit_board", 1.7, -2.9, 0.2, bench),
            this.put(g, "retro_multimeter", 2.35, -2.85, -0.4, bench),
            this.put(g, "industrial_microscope", 1.1, -3.05, 0.5, bench),
            this.put(g, "desk_lamp_arm_01", 2.8, -3.15, -0.6, bench),
            this.put(g, "potted_plant_02", -4.4, -4.0),
          ]);
          const s = sign("IoT LAB", clip(c.subtitle?.split("·")[0], 44), 2.6, "#5ec8e8", "#0e1a24");
          s.position.set(1.8, 3.1, -4.78);
          g.add(s);
          break;
        }
        case "remote": {
          this.shell(g, 0xcbb59a, woodFloor("#9a7452", "#5b4130"));
          const win = windowView("morning");
          win.position.set(1.8, 2.3, -4.78);
          g.add(win);
          const table = await this.put(g, "coffee_table_round_01", 2.0, -1.9);
          await Promise.all([
            this.put(g, "classic_laptop", 1.85, -1.9, -0.3, table),
            this.put(g, "tea_set_01", 2.35, -1.75, 0.4, table, 0.8),
            this.put(g, "Sofa_01", -2.4, -3.8),
            this.put(g, "potted_plant_02", 4.7, -4.0),
          ]);
          const s = sign(clip(c.subtitle?.split("·")[0]?.trim(), 24).toUpperCase(), c.title, 2.6, "#5ec8e8", "#1b2430");
          s.position.set(-2.4, 3.2, -4.78);
          g.add(s);
          break;
        }
        case "certs": {
          this.shell(g, 0x2f2540, woodFloor("#4a3326", "#2a1c14"));
          const frames = [
            ["fancy_picture_frame_01", -3.2, 2.4],
            ["hanging_picture_frame_01", -1.6, 2.1],
            ["fancy_picture_frame_01", 1.6, 2.4],
            ["hanging_picture_frame_01", 3.2, 2.1],
          ] as const;
          for (const [name, x, y] of frames) {
            const f = await this.model(name);
            f.rotation.y = Math.PI; // the scans face -z; turn them toward the room
            const size = new THREE.Box3().setFromObject(f).getSize(new THREE.Vector3());
            f.scale.setScalar(0.9 / Math.max(size.x, size.y));
            const b = new THREE.Box3().setFromObject(f);
            f.position.set(x, y - (b.max.y + b.min.y) / 2, -4.76 - b.min.z);
            g.add(f);
          }
          const ped = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.0, 0.7), new THREE.MeshStandardMaterial({ color: 0x1d1628, roughness: 0.4 }));
          ped.position.set(0, 0.5, -3.9);
          ped.castShadow = ped.receiveShadow = true;
          const gold = new THREE.MeshStandardMaterial({ color: 0xf0c24a, metalness: 1, roughness: 0.22 });
          const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.08, 0.4, 32), gold);
          cup.position.set(0, 1.35, -3.9);
          const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.07, 0.18, 16), gold);
          stem.position.set(0, 1.08, -3.9);
          cup.castShadow = stem.castShadow = true;
          const spot = new THREE.SpotLight(0xfff1c8, 18, 8, 0.45, 0.6, 1.5);
          spot.position.set(0, 4.2, -2.6);
          spot.target = cup;
          g.add(ped, cup, stem, spot);
          const s = sign(clip(c.title, 34), c.subtitle ?? "", 3.4, "#f0c24a", "#1a1426");
          s.position.set(0, 3.45, -4.78);
          g.add(s);
          break;
        }
        case "future": {
          const grid = canvasTex(
            512,
            512,
            (x) => {
              x.fillStyle = "#050b16";
              x.fillRect(0, 0, 512, 512);
              x.strokeStyle = "rgba(95,227,161,0.5)";
              x.lineWidth = 2;
              for (let i = 0; i <= 512; i += 32) {
                x.beginPath();
                x.moveTo(i, 0);
                x.lineTo(i, 512);
                x.moveTo(0, i);
                x.lineTo(512, i);
                x.stroke();
              }
            },
            [8, 8],
          );
          const fl = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), new THREE.MeshStandardMaterial({ map: grid, emissive: 0x0b3a2a, emissiveMap: grid, roughness: 0.4 }));
          fl.rotation.x = -Math.PI / 2;
          fl.receiveShadow = true;
          const n = 1500;
          const pos = new Float32Array(n * 3);
          for (let i = 0; i < n; i++) {
            pos[i * 3] = (Math.random() - 0.5) * 60;
            pos[i * 3 + 1] = Math.random() * 20;
            pos[i * 3 + 2] = -8 - Math.random() * 30;
          }
          const geo = new THREE.BufferGeometry();
          geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
          g.add(fl, new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.06, color: 0xcfe7ff })));
          break;
        }
        default:
          this.shell(g, 0x2a3440, 0x3a3f46);
      }
      return g;
    })();
    this.rooms.set(scene, p);
    return p;
  }

  private buildPortal() {
    const color = new THREE.Color(0x5fe3a1);
    for (let i = 0; i < 4; i++) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.75 + i * 0.2, 0.018, 12, 96), new THREE.MeshBasicMaterial({ color: i % 2 ? 0xb8ffe0 : color, toneMapped: false, transparent: true, opacity: 0.95 - i * 0.18 }));
      ring.scale.y = 1.4;
      ring.userData.spin = (0.3 + i * 0.2) * (i % 2 ? -1 : 1);
      this.portal.add(ring);
    }
    const core = new THREE.Mesh(new THREE.CircleGeometry(0.7, 48), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.3, toneMapped: false }));
    core.scale.y = 1.4;
    this.portal.add(core);
    this.portal.position.set(1.4, 1.3, -1.6);
    this.portal.visible = false;
    this.scene.add(this.portal);
  }

  /** Warm up a milestone's place (photo or room) in the background. */
  private prepare(i: number) {
    const st = this.stages[i];
    if (!st) return Promise.resolve();
    const photo = PHOTO[st.scene];
    return photo ? this.loadPhoto(photo.url).then(() => {}) : this.buildRoom(st.scene, st).then(() => {});
  }

  private async showPlace(i: number) {
    const st = this.stages[i];
    const photo = PHOTO[st.scene];
    if (this.room) this.scene.remove(this.room);
    this.room = null;
    if (photo) {
      this.photo = { img: await this.loadPhoto(photo.url), ground: photo.ground, person: photo.person };
      this.composePhoto();
      this.scene.background = this.photoTex;
      this.shadowFloor.visible = true;
      this.sun.position.set(-3, 6, 4);
    } else {
      this.photo = null;
      this.room = await this.buildRoom(st.scene, st);
      this.scene.add(this.room);
      this.scene.background = new THREE.Color(st.scene === "future" ? 0x02040a : 0x10141a);
      this.shadowFloor.visible = false;
      this.sun.position.set(-3.5, 6.5, 5);
    }
    this.renderer.toneMappingExposure = st.scene === "desk" ? 1.1 : st.scene === "future" ? 1.2 : 1.0;
    this.portal.visible = st.scene === "future";
  }

  /* ───── avatar + animation ───── */

  private async loadAvatar() {
    try {
      const gltf = await this.gltf.loadAsync(AVATAR_URL);
      const root = gltf.scene;
      const maxAniso = this.renderer.capabilities.getMaxAnisotropy();
      root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        m.castShadow = true;
        m.frustumCulled = false;
        for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
          const sm = mat as THREE.MeshStandardMaterial;
          for (const t of [sm.map, sm.normalMap, sm.roughnessMap]) if (t) t.anisotropy = maxAniso;
        }
        this.originalMats.set(m, m.material);
      });
      const box3 = new THREE.Box3().setFromObject(root);
      const h = box3.getSize(new THREE.Vector3()).y || 1.75;
      root.scale.setScalar(1.75 / h);
      root.position.y = -box3.min.y * (1.75 / h);
      const holder = new THREE.Group();
      holder.add(root);
      this.avatar = holder;
      this.head = root.getObjectByName("Head") ?? null;
      this.scene.add(holder);
      holder.updateMatrixWorld(true);
      this.buildCap(root);

      this.mixer = new THREE.AnimationMixer(root);
      const hipsY = (root.getObjectByName("Hips")?.position.y ?? 1) || 1;
      if (gltf.animations[0]) this.actions.set("idle", this.mixer.clipAction(gltf.animations[0]));
      const fbx = new FBXLoader();
      await Promise.all(
        (["idle", "walk", "wave", "talk", "typing"] as ClipName[]).map(async (name) => {
          try {
            const res = await fetch(ANIM_URL(name), { method: "HEAD" });
            if (!res.ok) return;
            const obj = await fbx.loadAsync(ANIM_URL(name));
            if (obj.animations[0]) this.actions.set(name, this.mixer!.clipAction(this.retarget(obj.animations[0], obj, hipsY, name)));
          } catch {
            /* optional clip */
          }
        }),
      );
      await this.prepare(0); // only the first place has to be ready before we start
      this.play("idle", 0);
      this.opts.onReady({ clips: [...this.actions.keys()] });
    } catch (e) {
      this.opts.onError(e instanceof Error ? e.message : "Couldn't load the avatar");
    }
  }

  /** Mixamo bone names ("mixamorig:Hips") → Avaturn ("Hips"); hip translation rescaled, root motion removed. */
  private retarget(src: THREE.AnimationClip, obj: THREE.Group, hipsY: number, name: ClipName) {
    const srcHips = obj.getObjectByName("mixamorigHips") ?? obj.getObjectByName("mixamorig:Hips") ?? obj.getObjectByName("Hips");
    const k = hipsY / (srcHips?.position.y || 100);
    const keepXZ = name === "walk" ? 0 : 1;
    const tracks = src.tracks
      .map((t) => {
        const tr = t.clone();
        tr.name = tr.name.replace(/^mixamorig:?/, "");
        if (/^Hips\.position$/.test(tr.name)) {
          const v = tr.values;
          const x0 = v[0];
          const z0 = v[2];
          for (let i = 0; i < v.length; i += 3) {
            v[i] = (v[i] - x0) * k * keepXZ;
            v[i + 1] *= k;
            v[i + 2] = (v[i + 2] - z0) * k * keepXZ;
          }
        }
        return tr;
      })
      .filter((t) => !/\.scale$/.test(t.name));
    return new THREE.AnimationClip(name, src.duration, tracks);
  }

  /** Mortarboard fitted to the real head (height from the hair's rest-pose top, oriented world-up). */
  private buildCap(root: THREE.Object3D) {
    const head = root.getObjectByName("Head");
    if (!head) return;
    let hairTop = -Infinity;
    let hairMidZ = 0;
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && /hair/i.test(m.name)) {
        const b = new THREE.Box3().setFromObject(m);
        hairTop = Math.max(hairTop, b.max.y);
        hairMidZ = (b.max.z + b.min.z) / 2;
      }
    });
    const headPos = head.getWorldPosition(new THREE.Vector3());
    if (!Number.isFinite(hairTop)) hairTop = headPos.y + 0.2;
    const black = new THREE.MeshStandardMaterial({ color: 0x141418, roughness: 0.75 });
    const gold = new THREE.MeshStandardMaterial({ color: 0xd8a93a, roughness: 0.4, metalness: 0.6 });
    const cap = new THREE.Group();
    const skull = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.105, 0.075, 32), black);
    skull.position.y = -0.03;
    const board = new THREE.Mesh(new THREE.BoxGeometry(0.29, 0.012, 0.29), black);
    board.position.y = 0.012;
    board.rotation.y = Math.PI / 4;
    const button = new THREE.Mesh(new THREE.SphereGeometry(0.012, 12, 8), gold);
    button.position.y = 0.022;
    const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.15, 6), gold);
    cord.rotation.z = Math.PI / 2;
    cord.position.set(0.075, 0.021, 0);
    const hang = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.09, 6), gold);
    hang.position.set(0.148, -0.025, 0);
    const tassel = new THREE.Mesh(new THREE.ConeGeometry(0.018, 0.06, 10), gold);
    tassel.position.set(0.148, -0.08, 0);
    cap.add(skull, board, button, cord, hang, tassel);
    cap.traverse((o) => ((o as THREE.Mesh).castShadow = true));
    cap.rotation.x = -0.12;
    const holder = new THREE.Group();
    holder.position.copy(head.worldToLocal(new THREE.Vector3(headPos.x, hairTop - 0.025, (hairMidZ + headPos.z) / 2)));
    holder.quaternion.copy(head.getWorldQuaternion(new THREE.Quaternion()).invert());
    holder.scale.setScalar(1 / head.getWorldScale(new THREE.Vector3()).x);
    holder.add(cap);
    head.add(holder);
    holder.visible = false;
    this.cap = holder;
  }

  private play(name: ClipName, fade = 0.35) {
    const next = this.actions.get(name) ?? this.actions.get("idle");
    if (!next || this.current === name) return;
    const prev = this.current ? this.actions.get(this.current) : null;
    if (name === "wave") {
      next.setLoop(THREE.LoopOnce, 1);
      next.clampWhenFinished = true;
    } else next.setLoop(THREE.LoopRepeat, Infinity);
    next.reset().setEffectiveWeight(1).fadeIn(fade).play();
    if (prev && prev !== next) prev.fadeOut(fade);
    this.current = name;
  }

  has(name: ClipName) {
    return this.actions.has(name);
  }

  private applyAge(age: Age) {
    this.scaleTarget = AGE_SCALE[age];
    if (this.cap) this.cap.visible = age === "grad";
    this.holo ??= new THREE.MeshBasicMaterial({ color: new THREE.Color(0x5fe3a1).multiplyScalar(1.3), transparent: true, opacity: 0.55, toneMapped: false, depthWrite: false, blending: THREE.AdditiveBlending });
    for (const [mesh, m] of this.originalMats) mesh.material = age === "future" ? this.holo : m;
  }

  /* ───── scene changes ───── */

  private async stroll(from: number, to: number, g = this.gen) {
    this.yawTarget = to > from ? Math.PI / 2 : -Math.PI / 2;
    this.play("walk", 0.25);
    const dur = Math.abs(to - from) / WALK_SPEED;
    const start = performance.now();
    await new Promise<void>((resolve) => {
      const step = () => {
        if (this.disposed || g !== this.gen) return resolve(); // superseded: stop where we are
        const k = Math.min(1, (performance.now() - start) / (dur * 1000));
        const e = k < 0.15 ? (k / 0.15) ** 2 * 0.15 : k > 0.85 ? 1 - ((1 - k) / 0.15) ** 2 * 0.15 : k;
        this.x = from + (to - from) * e;
        if (k < 1) requestAnimationFrame(step);
        else resolve();
      };
      step();
    });
  }

  private async fade(to: 0 | 1) {
    const from = this.fadeV;
    const start = performance.now();
    await new Promise<void>((resolve) => {
      const step = () => {
        const k = Math.min(1, (performance.now() - start) / (FADE * 1000));
        this.fadeV = from + (to - from) * k * k * (3 - 2 * k);
        this.opts.onFade(this.fadeV);
        if (k < 1 && !this.disposed) requestAnimationFrame(step);
        else resolve();
      };
      step();
    });
  }

  /** Change to milestone i: walk off, fade, next place, walk in, turn and greet. */
  goTo(i: number) {
    const g = ++this.gen;
    const run = async () => {
      if (!this.avatar || this.disposed || g !== this.gen) return; // a newer request replaced this one
      const st = this.stages[i];
      this.talking = false;
      this.camClose = 0;
      const ready = this.prepare(i); // load while walking off
      const stale = () => g !== this.gen || this.disposed;
      if (this.stageIndex >= 0 && this.stageIndex !== i) {
        const forward = i > this.stageIndex;
        await this.stroll(this.x, forward ? OFFSTAGE : -OFFSTAGE, g);
        await Promise.all([this.fade(1), ready]);
        if (stale()) return;
        await this.showPlace(i);
        this.applyAge(st.age);
        this.x = forward ? -OFFSTAGE : OFFSTAGE;
        this.scale = this.scaleTarget;
        this.stageIndex = i;
        this.opts.onStage(i, st.age);
        const walkIn = this.stroll(this.x, 0, g);
        await sleep(250);
        await this.fade(0);
        await walkIn;
        if (stale()) return;
      } else {
        await ready;
        await this.showPlace(i);
        this.applyAge(st.age);
        this.scale = this.scaleTarget;
        this.x = 0;
        this.stageIndex = i;
        this.opts.onStage(i, st.age);
        this.fadeV = 0;
        this.opts.onFade(0);
      }
      this.yawTarget = 0.18;
      if (this.has("wave")) {
        this.play("wave", 0.35);
        await sleep(1700);
      } else this.play("idle", 0.35);
      if (this.current === "wave") this.play("idle", 0.4);
      void this.prepare(i + 1);
    };
    // Resolve for the caller when *this* request finishes (or is replaced by a newer one).
    this.busy = this.busy.then(run, run);
    return this.busy;
  }

  setTalking(on: boolean) {
    this.talking = on;
    this.camClose = on ? 1 : 0;
    if (on && this.current !== "wave" && this.current !== "walk") this.play(this.has("talk") ? "talk" : "idle", 0.4);
    if (!on && this.current === "talk") this.play("idle", 0.5);
  }

  jumpTo(i: number) {
    this.stageIndex = -1;
    return this.goTo(i);
  }

  private resize() {
    const el = this.canvas.parentElement!;
    const w = el.clientWidth;
    const h = el.clientHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.fov = w < 640 ? 56 : 40;
    this.camera.updateProjectionMatrix();
    this.composePhoto();
  }

  /* ───── frame ───── */

  private camPos = new THREE.Vector3(0.9, 1.5, 4.6);
  private camLook = new THREE.Vector3(0.3, 1.1, 0);
  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();

  private loop = () => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    this.timer.update();
    const dt = Math.min(this.timer.getDelta(), 0.05);
    const t = this.timer.getElapsed();

    if (this.avatar) {
      this.avatar.position.x = this.x;
      this.yaw += (this.yawTarget - this.yaw) * Math.min(1, dt * 6);
      this.avatar.rotation.y = this.yaw;
      this.scale += (this.scaleTarget - this.scale) * Math.min(1, dt * 3);
      this.avatar.scale.setScalar(this.scale);
    }
    this.mixer?.update(dt);
    if (this.head && this.talking && !this.has("talk")) {
      this.head.rotation.x += Math.sin(t * 7.5) * 0.045;
      this.head.rotation.y += Math.sin(t * 2.3) * 0.06;
    }
    if (this.holo) this.holo.opacity = 0.42 + Math.sin(t * 3) * 0.14;
    for (const c of this.portal.children) if (c.userData.spin) c.rotation.z = t * c.userData.spin;

    const close = this.camClose;
    const lift = this.scale;
    if (this.photo) {
      // Straight-ahead camera like the photo. Distance sets how tall you look (to match people in the
      // photo); camera height then puts your feet exactly on the photo's ground line.
      const tanHalf = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
      const d = (1.75 * lift) / (2 * tanHalf * this.photoPerson);
      const eye = d * tanHalf * Math.max(0.1, 2 * this.photoFeet - 1);
      const k = 1 - close * 0.08;
      this.camPos.lerp(this.tmp.set(0.3 + Math.sin(t * 0.25) * 0.03, eye, d * k), Math.min(1, dt * 2));
      this.camLook.lerp(this.tmp2.set(0.3, eye, 0), Math.min(1, dt * 2.5));
    } else {
      this.camPos.lerp(this.tmp.set(0.95 - close * 0.35 + Math.sin(t * 0.25) * 0.05, 1.5 * lift + 0.15, 5.2 - close * 1.5), Math.min(1, dt * 2));
      this.camLook.lerp(this.tmp2.set(0.45 - close * 0.3, 1.1 * lift + close * 0.1, -0.5), Math.min(1, dt * 2.5));
    }
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);
    this.renderer.render(this.scene, this.camera);
  };

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.timer.dispose();
    this.mixer?.stopAllAction();
    const all = new Set<THREE.Object3D>([this.scene]);
    void Promise.all([...this.rooms.values()]).then((rooms) => rooms.forEach((r) => all.add(r)));
    for (const root of all)
      root.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose();
        const mats = m.material ? (Array.isArray(m.material) ? m.material : [m.material]) : [];
        for (const x of mats) {
          (x as THREE.MeshStandardMaterial).map?.dispose();
          x.dispose();
        }
      });
    this.photoTex.dispose();
    this.holo?.dispose();
    this.pmrem.dispose();
    this.renderer.dispose();
  }
}
