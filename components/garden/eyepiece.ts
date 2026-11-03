import * as THREE from "three";
import { julianDay, type Body, type BodyId } from "@/lib/astro";

/**
 * The telescope's eyepiece, rendered for real: an actual map of the Moon or planet (NASA data, via Solar System
 * Scope, CC BY 4.0) wrapped on a sphere and lit from the side the Sun really lights it from, so the phase, the
 * terminator and the limb darkening come out of the lighting rather than being painted. Saturn's rings are real
 * geometry tilted by the real ring angle; the globe hides the far half of them, as in a real telescope.
 *
 * It is a live instrument, not a picture: time runs fast (1 s = 20 min) so the planets turn and Jupiter's and
 * Saturn's moons circle, the air makes the image shimmer, focus is pulled in whenever something new is picked,
 * and the view can be zoomed (wheel, pinch, buttons) and dragged.
 */
const MAPS: Record<BodyId, string> = {
  moon: "/sky/moon.jpg",
  mercury: "/sky/mercury.jpg",
  venus: "/sky/venus_atmosphere.jpg",
  mars: "/sky/mars.jpg",
  jupiter: "/sky/jupiter.jpg",
  saturn: "/sky/saturn.jpg",
};
/** Radius of the globe as a fraction of the half-width of the field of view. */
const SIZE: Record<BodyId, number> = { moon: 0.78, mercury: 0.24, venus: 0.46, mars: 0.28, jupiter: 0.34, saturn: 0.3 };
/** How flattened by spin (polar radius / equatorial radius). */
const FLAT: Record<BodyId, number> = { moon: 1, mercury: 1, venus: 1, mars: 0.99, jupiter: 0.935, saturn: 0.902 };
/** Hours for one turn. The Moon always shows us the same face. */
const DAY_HOURS: Record<BodyId, number> = { moon: 0, mercury: 1407.6, venus: 5832, mars: 24.62, jupiter: 9.925, saturn: 10.66 };
/** How far the view starts zoomed (1 = the globe fills the lens; less shows the moons around it). */
const START_ZOOM: Record<BodyId, number> = { moon: 1, mercury: 1, venus: 1, mars: 1, jupiter: 0.42, saturn: 0.62 };
/** Simulated seconds per real second. */
export const TIMELAPSE = 1200;
const MIN_ZOOM = 0.14;
const MAX_ZOOM = 4;

/** Moons that circle the planet: Meeus' low-precision mean elements (angle at J2000-epoch days, degrees per day, orbit radius in planet radii). */
export type MoonDef = { name: string; colour: number; u0: number; rate: number; r: number };
const JUPITER_MOONS: MoonDef[] = [
  { name: "Io", colour: 0xf2dd9a, u0: 163.8069, rate: 203.4058646, r: 5.9057 },
  { name: "Europa", colour: 0xf3efe6, u0: 358.414, rate: 101.2916335, r: 9.3966 },
  { name: "Ganymede", colour: 0xd9d2c6, u0: 5.7176, rate: 50.234518, r: 14.9883 },
  { name: "Callisto", colour: 0xb8b0a4, u0: 224.8092, rate: 21.48798, r: 26.3627 },
];
// Titan: 15.945 day period, 20.27 Saturn radii out. (Its starting angle is approximate.)
const SATURN_MOONS: MoonDef[] = [{ name: "Titan", colour: 0xf0c48a, u0: 20, rate: 360 / 15.945, r: 20.27 }];
export const moonsOf = (id: BodyId) => (id === "jupiter" ? JUPITER_MOONS : id === "saturn" ? SATURN_MOONS : []);
export const MEEUS_EPOCH = 2433282.423;

const rng = (seed: number) => {
  let a = seed | 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/** A photographic star field: many faint stars, a few bright ones with soft halos, slight colour, a little sensor grain. It tiles. */
function starField(size: number, seed: number) {
  const cv = document.createElement("canvas");
  cv.width = cv.height = size;
  const c = cv.getContext("2d");
  if (!c) return new THREE.CanvasTexture(cv);
  c.fillStyle = "#020309";
  c.fillRect(0, 0, size, size);
  const r = rng(seed);
  const tint = ["255,244,232", "255,255,255", "205,222,255", "255,226,190", "255,206,170"];
  for (let i = 0; i < 1700; i++) {
    const x = r() * size;
    const y = r() * size;
    const m = Math.pow(r(), 5); // most are faint
    const rad = 0.35 + m * 1.9;
    const col = tint[Math.floor(r() * tint.length)];
    const g = c.createRadialGradient(x, y, 0, x, y, rad * 2.6);
    g.addColorStop(0, `rgba(${col},${0.35 + m * 0.65})`);
    g.addColorStop(0.35, `rgba(${col},${0.12 + m * 0.35})`);
    g.addColorStop(1, `rgba(${col},0)`);
    c.fillStyle = g;
    c.fillRect(x - rad * 3, y - rad * 3, rad * 6, rad * 6);
  }
  const img = c.getImageData(0, 0, size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (r() - 0.5) * 7;
    img.data[i] += n;
    img.data[i + 1] += n;
    img.data[i + 2] += n * 1.1;
  }
  c.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function labelSprite(text: string) {
  const cv = document.createElement("canvas");
  cv.width = 192;
  cv.height = 48;
  const c = cv.getContext("2d");
  if (c) {
    c.font = "600 26px system-ui, sans-serif";
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.fillStyle = "rgba(0,0,0,0.55)";
    c.fillText(text, 97, 26);
    c.fillStyle = "rgba(236,226,200,0.92)";
    c.fillText(text, 96, 24);
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthTest: false, depthWrite: false }));
  s.renderOrder = 6;
  return s;
}

const loader = new THREE.TextureLoader();
const cache = new Map<string, Promise<THREE.Texture>>();
const load = (url: string) => {
  let p = cache.get(url);
  if (!p) {
    p = new Promise<THREE.Texture>((resolve, reject) =>
      loader.load(
        url,
        (t) => {
          t.colorSpace = THREE.SRGBColorSpace;
          t.anisotropy = 8;
          resolve(t);
        },
        undefined,
        reject,
      ),
    );
    cache.set(url, p);
  }
  return p;
};

type Satellite = { def: MoonDef; dot: THREE.Mesh; halo: THREE.Mesh; label: THREE.Sprite };

export class Eyepiece {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 80);
  private holder = new THREE.Group();
  private light = new THREE.DirectionalLight(0xfff6e8, 3);
  private earthshine = new THREE.AmbientLight(0x2a3550, 0.07);
  private sky: THREE.Mesh;
  private token = 0;
  private disposed = false;
  private stars = new Map<string, THREE.Texture>();

  private body: Body | null = null;
  private ball: THREE.Mesh | null = null;
  private sats: Satellite[] = [];
  private ringOpen = 0;
  private zoom = 1;
  private zoomTo = 1;
  private pan = new THREE.Vector2();
  private raf = 0;
  private last = 0;
  /** The simulated moment on screen: starts at now and runs TIMELAPSE times faster. */
  private sim = Date.now();
  private pointers = new Map<number, { x: number; y: number }>();
  private pinch = 0;
  private cleanup: Array<() => void> = [];

  /** Throws if this device can't make a WebGL context (the caller falls back to a flat picture). */
  constructor(private canvas: HTMLCanvasElement, private size: number) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(size, size, false);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.camera.position.z = 5;
    this.scene.add(this.light, this.earthshine, this.holder);
    const plane = 2 / MIN_ZOOM + 2 * 4;
    this.sky = new THREE.Mesh(new THREE.PlaneGeometry(plane, plane), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    this.sky.position.z = -40;
    this.scene.add(this.sky);
    this.bindInput();
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  /** The simulated time, for a clock readout. */
  get simTime() {
    return new Date(this.sim);
  }

  /** Zoom by a factor (the + and - buttons). */
  zoomBy(f: number) {
    this.zoomTo = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, this.zoomTo * f));
  }

  /** Back to the starting view. */
  resetView() {
    this.zoomTo = this.body ? START_ZOOM[this.body.id] : 1;
    this.pan.set(0, 0);
  }

  private bindInput() {
    const cv = this.canvas;
    cv.style.touchAction = "none";
    cv.style.cursor = "grab";
    const down = (e: PointerEvent) => {
      cv.setPointerCapture?.(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      cv.style.cursor = "grabbing";
      this.pinch = this.span();
    };
    const move = (e: PointerEvent) => {
      const p = this.pointers.get(e.pointerId);
      if (!p) return;
      const dx = e.clientX - p.x;
      const dy = e.clientY - p.y;
      p.x = e.clientX;
      p.y = e.clientY;
      if (this.pointers.size >= 2) {
        const s = this.span();
        if (this.pinch > 0 && s > 0) this.zoomBy(s / this.pinch);
        this.pinch = s;
        return;
      }
      // Drag: the picture follows the finger.
      const unit = 2 / (this.size * this.zoom);
      this.pan.x -= dx * unit;
      this.pan.y += dy * unit;
      this.clampPan();
    };
    const up = (e: PointerEvent) => {
      this.pointers.delete(e.pointerId);
      this.pinch = this.span();
      if (this.pointers.size === 0) cv.style.cursor = "grab";
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      this.zoomBy(Math.exp(-e.deltaY * 0.0015));
    };
    const dbl = () => this.resetView();
    cv.addEventListener("pointerdown", down);
    cv.addEventListener("pointermove", move);
    cv.addEventListener("pointerup", up);
    cv.addEventListener("pointercancel", up);
    cv.addEventListener("wheel", wheel, { passive: false });
    cv.addEventListener("dblclick", dbl);
    this.cleanup.push(() => {
      cv.removeEventListener("pointerdown", down);
      cv.removeEventListener("pointermove", move);
      cv.removeEventListener("pointerup", up);
      cv.removeEventListener("pointercancel", up);
      cv.removeEventListener("wheel", wheel);
      cv.removeEventListener("dblclick", dbl);
    });
  }

  private span() {
    const v = [...this.pointers.values()];
    return v.length >= 2 ? Math.hypot(v[0].x - v[1].x, v[0].y - v[1].y) : 0;
  }

  private clampPan() {
    // Far enough to go round the planet and its moons, no further.
    const lim = 1.2 + 6 * (this.body && moonsOf(this.body.id).length ? 1 : 0.2);
    this.pan.x = Math.max(-lim, Math.min(lim, this.pan.x));
    this.pan.y = Math.max(-lim, Math.min(lim, this.pan.y));
  }

  /** Shows a body: its map on a sphere, lit with its real phase, tilted as the sky tilts it. */
  async show(b: Body) {
    const my = ++this.token;
    const tex = await load(MAPS[b.id]).catch(() => null);
    let ring: THREE.Texture | null = null;
    if (b.id === "saturn") ring = await load("/sky/saturn_ring_alpha.png").catch(() => null);
    if (my !== this.token || this.disposed) return;
    this.body = b;

    // A fresh star field per body (the same stars each time for the same body).
    let st = this.stars.get(b.id);
    if (!st) {
      st = starField(1024, b.id.length * 977 + b.id.charCodeAt(0));
      this.stars.set(b.id, st);
    }
    // One tile covers 4.4 units, so the stars stay sharp and sit still on the sky when the view is dragged.
    const tiles = (this.sky.geometry as THREE.PlaneGeometry).parameters.width / 4.4;
    st.repeat.set(tiles, tiles);
    (this.sky.material as THREE.MeshBasicMaterial).map = st;
    (this.sky.material as THREE.MeshBasicMaterial).needsUpdate = true;

    // Clear the last body.
    this.holder.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      const mat = m.material as THREE.Material | THREE.SpriteMaterial | undefined;
      (mat as THREE.SpriteMaterial | undefined)?.map?.dispose();
      mat?.dispose();
    });
    this.holder.clear();
    this.sats = [];

    const R = SIZE[b.id];
    const geo = new THREE.SphereGeometry(R, 128, 96);
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 1, metalness: 0 });
    const ball = new THREE.Mesh(geo, mat);
    ball.scale.y = FLAT[b.id];
    this.ball = ball;
    this.holder.add(ball);

    this.ringOpen = 0;
    if (b.id === "saturn" && ring) {
      const inner = R * 1.24;
      const outer = R * 2.3;
      const rg = new THREE.RingGeometry(inner, outer, 160, 1);
      // The picture of the rings is a strip from the inner to the outer edge: map each vertex by how far out it is.
      const pos = rg.attributes.position;
      const uv = rg.attributes.uv;
      for (let i = 0; i < pos.count; i++) {
        const d = Math.hypot(pos.getX(i), pos.getY(i));
        uv.setXY(i, (d - inner) / (outer - inner), 0.5);
      }
      // Unlit: the rings are very bright (ice), and at this angle the Sun grazes them, so ordinary lighting would turn them black.
      const rm = new THREE.MeshBasicMaterial({ map: ring, transparent: true, side: THREE.DoubleSide, color: 0xf3ead8, alphaTest: 0.02, depthWrite: false });
      const rings = new THREE.Mesh(rg, rm);
      // Face-on is 90 degrees of opening; edge-on is 0. The tilt comes from the real ring angle.
      const open = Math.max(2.5, Math.abs(b.ringTilt ?? 8));
      this.ringOpen = (open * Math.PI) / 180;
      rings.rotation.x = Math.PI / 2 - this.ringOpen;
      rings.renderOrder = 1;
      this.holder.add(rings);
    }

    // Moons in orbit: small bright dots with a soft glow and a name, hidden behind the planet when they pass round the back.
    for (const def of moonsOf(b.id)) {
      const dot = new THREE.Mesh(new THREE.SphereGeometry(0.03, 14, 10), new THREE.MeshBasicMaterial({ color: def.colour }));
      const halo = new THREE.Mesh(new THREE.SphereGeometry(0.06, 14, 10), new THREE.MeshBasicMaterial({ color: def.colour, transparent: true, opacity: 0.22, depthWrite: false, blending: THREE.AdditiveBlending }));
      const label = labelSprite(def.name);
      this.holder.add(dot, halo, label);
      this.sats.push({ def, dot, halo, label });
    }

    // The sky tips a little differently each night; a steady tilt looks natural.
    this.holder.rotation.z = b.id === "saturn" ? -0.33 : b.id === "moon" ? 0.2 : -0.12;

    // The Sun's side: the lit fraction gives the phase angle; a growing body is lit on its right.
    const phase = Math.acos(Math.max(-1, Math.min(1, 2 * b.illum - 1)));
    const side = b.waxing ? 1 : -1;
    this.light.position.set(side * Math.sin(phase) * 8, 0.6, Math.cos(phase) * 8);
    this.light.intensity = b.id === "moon" ? 3.4 : b.id === "venus" ? 3 : 2.6;
    // A faint glow from the Earth lights the dark side of the Moon, and thick Venus holds a little light round its edge.
    this.earthshine.intensity = b.id === "moon" ? 0.22 : b.id === "venus" ? 0.12 : 0.04;

    this.zoomTo = START_ZOOM[b.id];
    this.zoom = this.zoomTo;
    this.pan.set(0, 0);
    this.pullFocus();
    this.place(0);
  }

  /** Racking the focus in: starts soft and bright, sharpens over a moment, as when you look at something new. */
  private pullFocus() {
    const s = this.canvas.style;
    s.transition = "none";
    s.filter = "blur(7px) brightness(1.35)";
    void this.canvas.offsetWidth;
    s.transition = "filter 1.3s cubic-bezier(.2,.7,.2,1)";
    s.filter = "none";
  }

  private frame = (now: number) => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.frame);
    if (document.hidden) {
      this.last = now;
      return;
    }
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.sim += dt * TIMELAPSE * 1000;
    this.place(now / 1000);
    this.renderer.render(this.scene, this.camera);
  };

  /** Puts everything where it is at the simulated time: the turn of the globe, the moons, the zoom, and the shimmer of the air. */
  private place(t: number) {
    const b = this.body;
    if (!b) return;
    // Ease the zoom.
    this.zoom += (this.zoomTo - this.zoom) * 0.18;
    if (Math.abs(this.zoomTo - this.zoom) < 1e-4) this.zoom = this.zoomTo;
    this.camera.zoom = this.zoom;
    this.camera.position.x = this.pan.x;
    this.camera.position.y = this.pan.y;
    this.camera.updateProjectionMatrix();
    // The star field is fixed on the sky: the plane follows the camera and its texture slides the other way.
    this.sky.position.x = this.pan.x;
    this.sky.position.y = this.pan.y;
    const map = (this.sky.material as THREE.MeshBasicMaterial).map;
    if (map) {
      map.offset.set(this.pan.x / 4.4, this.pan.y / 4.4);
    }

    // The globe turns with its real day (sped up); the Moon keeps its face to us.
    if (this.ball) {
      const hours = DAY_HOURS[b.id];
      const turn = hours ? ((this.sim / 3600_000 / hours) % 1) * Math.PI * 2 : 0;
      this.ball.rotation.y = -Math.PI / 2 + turn;
    }

    // The moons, on their orbits. x runs along the planet's equator; z says in front of or behind; behind the disc they are hidden.
    if (this.sats.length && this.ball) {
      const R = SIZE[b.id];
      const d = julianDay(new Date(this.sim)) - MEEUS_EPOCH;
      const k = 1 / this.zoom;
      const lean = b.id === "saturn" ? Math.tan(this.ringOpen) : 0.05;
      for (const s of this.sats) {
        const u = ((s.def.u0 + s.def.rate * d) * Math.PI) / 180;
        const x = s.def.r * R * Math.sin(u);
        const z = -s.def.r * R * Math.cos(u);
        const y = z * lean;
        s.dot.position.set(x, y, z);
        s.halo.position.set(x, y, z);
        s.dot.scale.setScalar(k);
        s.halo.scale.setScalar(k);
        s.label.position.set(x, y + 0.1 * k, 1);
        s.label.scale.set(0.46 * k, 0.115 * k, 1);
        const visible = Math.abs(x) < 9 && this.zoom < 0.9;
        s.label.visible = visible;
      }
    }

    // Air makes the picture shimmer: a fraction of a pixel of slow wobble, more when zoomed in.
    const amp = 0.0035 * Math.min(2.5, this.zoom + 0.3);
    this.holder.position.x = Math.sin(t * 5.3) * amp + Math.sin(t * 11.7 + 1) * amp * 0.5;
    this.holder.position.y = Math.sin(t * 4.1 + 2) * amp + Math.sin(t * 9.1) * amp * 0.5;
  }

  dispose() {
    this.disposed = true;
    this.token++;
    cancelAnimationFrame(this.raf);
    for (const c of this.cleanup) c();
    this.holder.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      const mat = m.material as THREE.Material | THREE.SpriteMaterial | undefined;
      (mat as THREE.SpriteMaterial | undefined)?.map?.dispose();
      mat?.dispose();
    });
    for (const t of this.stars.values()) t.dispose();
    this.sky.geometry.dispose();
    (this.sky.material as THREE.Material).dispose();
    this.renderer.dispose();
    // Browsers keep only a few live WebGL contexts and drop the oldest (the garden's): hand this one back.
    this.renderer.forceContextLoss();
  }
}
