import * as THREE from "three";

/**
 * Nova's diary as a real 3D book. Every page is a subdivided sheet that BENDS as it turns: its root follows the spine,
 * its free edge trails behind and then leads (like paper dragged through air), and light and a moving shadow fall on it
 * as it goes. A leather cover opens, pages fan through to the newest day, stacks grow and shrink on either side,
 * and the gutter dips like a real binding. Text is drawn onto canvas textures: handwriting, ruled lines, tape, a doodle.
 *
 * Maths: a sheet turned by t (0 = flat on the right, 1 = flat on the left) is walked from the spine outwards in small
 * steps; the direction of each step is  angle(s) = θ + gutter(s)·cos θ − bend·sin 2θ·(s/W),  with θ = tπ.
 */
export type DiaryPage = { key: string; kind: "title" | "entry" | "write" | "blank"; date?: string; text?: string; mood?: string };
export type SpreadInfo = { spread: number; max: number; left: string | null; right: string | null; zoom: "spread" | "left" | "right" };
export type DiaryOpts = { hand: string; pet: string; reduced: boolean; onSpread: (i: SpreadInfo) => void };

const W = 1;
const H = 1.38;
const N = 36;
const PAPER_H = 0.0036;
const GAP = 0.0009;
const COVER_H = 0.05;
const TW = 640;
const TH = 880;
const INK = "#3b2f1e";
const PAPER_A = "#f8f0dc";
const PAPER_B = "#efe2c4";
const FLIP_S = 0.9;
const FAN_S = 0.55;
const FAN_STAGGER = 0.075;
const FAN_MAX = 14;

const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const smooth = (x: number) => x * x * (3 - 2 * x);
const hash = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967295;
};
const rng = (seed: string) => {
  let a = Math.floor(hash(seed) * 4294967295) || 1;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

type Sheet = {
  idx: number;
  h: number;
  w: number;
  hh: number;
  front: THREE.Mesh;
  back: THREE.Mesh;
  fGeo: THREE.BufferGeometry;
  bGeo: THREE.BufferGeometry;
  edge: THREE.Mesh | null;
  eGeo: THREE.BufferGeometry | null;
  t: number;
  target: number;
  anim: { from: number; to: number; start: number; dur: number; snd?: boolean } | null;
  dragging: boolean;
  frontKey: string | null;
  backKey: string | null;
  lastT: number;
  lastY: number;
};

export class DiaryScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(32, 1, 0.1, 40);
  private book = new THREE.Group();
  private sheets: Sheet[] = [];
  private pages: DiaryPage[] = [];
  private texCache = new Map<string, { canvas: HTMLCanvasElement; tex: THREE.CanvasTexture }>();
  private reveal = new Map<string, { start: number; dur: number }>();
  private busy = false;
  private spreadNow = 0;
  private zoom: "spread" | "left" | "right" = "spread";
  private raf = 0;
  private disposed = false;
  private last = 0;
  private elapsed = 0;
  private introT = 0;
  private camPos = new THREE.Vector3();
  private camLook = new THREE.Vector3();
  private aspect = 1;
  private lastSound = 0;
  private audio: AudioContext | null = null;
  private noise: AudioBuffer | null = null;
  private leftBlock: THREE.Mesh;
  private rightBlock: THREE.Mesh;
  private leftEdgeTex: THREE.CanvasTexture;
  private rightEdgeTex: THREE.CanvasTexture;
  private motes: THREE.Points;
  private ray = new THREE.Raycaster();
  private plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.04);
  private drag: { locked: boolean; sheet: Sheet; forward: boolean; x0: number; px0: number; t0: number; time0: number; lastX: number; lastTime: number; vx: number; moved: boolean } | null = null;
  private leather: THREE.CanvasTexture;
  private endpaper: THREE.CanvasTexture;
  private paperTexFallback = new THREE.Color(PAPER_B);

  constructor(
    private canvas: HTMLCanvasElement,
    private o: DiaryOpts,
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

    // Light: a soft sky fill, a warm lamp from the front left that casts the shadows, and a faint candle glow.
    this.scene.add(new THREE.HemisphereLight(0xfff6e6, 0x4a3828, 1.7));
    const sun = new THREE.DirectionalLight(0xffefd2, 2.3);
    sun.position.set(-1.6, 3.2, 2.2);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -2.6;
    sun.shadow.camera.right = 2.6;
    sun.shadow.camera.top = 2.2;
    sun.shadow.camera.bottom = -2.2;
    sun.shadow.camera.near = 0.5;
    sun.shadow.camera.far = 9;
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.012;
    sun.shadow.radius = 4;
    this.scene.add(sun);
    const candle = new THREE.PointLight(0xffb866, 2.2, 6, 2);
    candle.position.set(1.8, 0.9, 0.3);
    this.scene.add(candle);

    this.leather = this.makeLeather();
    this.endpaper = this.makeEndpaper();

    // A soft contact shadow under the book, so it sits on something.
    const blob = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: this.makeBlob(), transparent: true, depthWrite: false, opacity: 0.55 }));
    blob.rotation.x = -Math.PI / 2;
    blob.position.y = -0.06;
    blob.scale.set(5.2, 3.9, 1);
    this.scene.add(blob);

    // The back board (the book's own back cover) with its endpaper, and the spine under the gutter.
    const boardW = W + 0.05;
    const boardH = H + 0.09;
    const leatherMat = new THREE.MeshStandardMaterial({ map: this.leather, roughness: 0.55, metalness: 0.05 });
    const board = new THREE.Mesh(new THREE.BoxGeometry(boardW, COVER_H, boardH), [leatherMat, leatherMat, new THREE.MeshStandardMaterial({ map: this.endpaper, roughness: 0.9 }), leatherMat, leatherMat, leatherMat]);
    board.position.set(boardW / 2 - 0.0, -COVER_H / 2, 0);
    board.receiveShadow = true;
    this.book.add(board);
    const spine = new THREE.Mesh(new THREE.BoxGeometry(0.1, COVER_H * 1.02, boardH), new THREE.MeshStandardMaterial({ color: "#5c211d", roughness: 0.5 }));
    spine.position.set(-0.01, -COVER_H / 2, 0);
    this.book.add(spine);

    // The sides of the two page stacks (their thin edges), drawn as lines.
    this.leftEdgeTex = this.makeEdgeTexture();
    this.rightEdgeTex = this.makeEdgeTexture();
    const mkBlock = (tex: THREE.CanvasTexture) => {
      const m = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95 });
      const b = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), m);
      b.receiveShadow = true;
      this.book.add(b);
      return b;
    };
    this.leftBlock = mkBlock(this.leftEdgeTex);
    this.rightBlock = mkBlock(this.rightEdgeTex);

    // Specks of light drifting up, like dust in lamplight.
    const n = 70;
    const pos = new Float32Array(n * 3);
    const r = rng("motes");
    for (let i = 0; i < n; i++) pos.set([(r() - 0.5) * 5, 0.15 + r() * 1.8, (r() - 0.5) * 3.2], i * 3);
    const mg = new THREE.BufferGeometry();
    mg.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    this.motes = new THREE.Points(mg, new THREE.PointsMaterial({ map: this.makeGlow(), color: 0xffd98a, size: 0.09, transparent: true, opacity: 0.75, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true }));
    this.scene.add(this.motes);

    this.scene.add(this.book);
    canvas.addEventListener("pointerdown", this.onDown);
    window.addEventListener("pointermove", this.onMove);
    window.addEventListener("pointerup", this.onUp);
    window.addEventListener("pointercancel", this.onUp);
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.loop);
  }

  /* ───────── public ───────── */

  /** The last spread worth turning to: the one that shows the newest page (the blank pad after it is not a page). */
  private get lastSpread() {
    return this.spreadFor(this.pages.findLast((p) => p.kind !== "blank")?.key ?? "", this.pages);
  }

  /** The book's pages, oldest first (an even count). `keep` holds the page that stays in view; `open` plays the opening. */
  setPages(pages: DiaryPage[], o: { keepKey?: string; open?: boolean; goKey?: string; reveal?: string } = {}) {
    const keepSpread = o.keepKey ? this.spreadFor(o.keepKey, pages) : null;
    this.pages = pages;
    for (const s of this.sheets) this.removeSheet(s);
    this.sheets = [];
    const sheetCount = pages.length / 2 + 1;
    for (let j = 0; j < sheetCount; j++) this.sheets.push(this.makeSheet(j));
    // Textures belong to the previous page list.
    for (const [k, v] of this.texCache) {
      v.tex.dispose();
      this.texCache.delete(k);
    }
    for (const s of this.sheets) this.assignKeys(s);
    const target = o.goKey ? this.spreadFor(o.goKey, pages) : (keepSpread ?? this.spreadFor(pages.findLast((p) => p.kind !== "blank")?.key ?? "", pages));
    if (o.open && !this.o.reduced) {
      this.introT = 0;
      this.spreadNow = 0;
      for (const s of this.sheets) {
        s.t = 0;
        s.target = 0;
      }
      this.zoom = "spread";
      setTimeout(() => !this.disposed && this.goTo(target), 900);
    } else {
      this.introT = o.open ? 9 : this.introT;
      this.spreadNow = target;
      for (const s of this.sheets) {
        s.t = s.idx < target ? 1 : 0;
        s.target = s.t;
      }
    }
    if (o.reveal) this.startReveal(o.reveal);
    this.ensureTextures();
    this.emit();
  }

  /** Marks the write-page as busy ("Nova is thinking…") or not. */
  setBusy(busy: boolean) {
    if (this.busy === busy) return;
    this.busy = busy;
    this.redraw("write");
  }

  /** Writes a page's text out stroke by stroke. */
  startReveal(key: string) {
    const len = this.pages.find((p) => p.key === key)?.text?.length ?? 0;
    if (this.o.reduced || !len) return;
    this.reveal.set(key, { start: this.elapsed, dur: clamp(len * 0.035, 1.4, 5) });
  }

  next() {
    this.goTo(this.spreadNow + 1);
  }
  prev() {
    this.goTo(this.spreadNow - 1);
  }

  /** Flips (several pages at once fan through) until the given spread is open. */
  goTo(spread: number) {
    const target = clamp(Math.round(spread), 0, this.lastSpread);
    if (target === this.spreadNow && this.sheets.every((s) => s.target === (s.idx < target ? 1 : 0))) return;
    const forward = target > this.spreadNow;
    this.spreadNow = target;
    this.zoom = "spread";
    const changing = this.sheets.filter((s) => s.target !== (s.idx < target ? 1 : 0));
    changing.sort((a, b) => (forward ? a.idx - b.idx : b.idx - a.idx));
    changing.forEach((s, order) => {
      const to = s.idx < target ? 1 : 0;
      s.target = to;
      // A long way: only the last few pages are shown turning, the rest are already over.
      if (changing.length - order > FAN_MAX || this.o.reduced) {
        s.t = to;
        s.anim = null;
        return;
      }
      const fan = changing.length > 1;
      const shown = order - Math.max(0, changing.length - FAN_MAX);
      s.anim = { from: s.t, to, start: this.elapsed + Math.max(0, shown) * FAN_STAGGER, dur: fan ? FAN_S : FLIP_S };
    });
    this.ensureTextures();
    this.emit();
  }

  /** Turns to the spread that shows a page (by its key, e.g. a date). False if that page isn't in the book (yet). */
  goToKey(key: string) {
    if (!this.pages.some((p) => p.key === key)) return false;
    this.goTo(this.spreadFor(key, this.pages));
    return true;
  }

  toggleZoom(side: "left" | "right") {
    this.zoom = this.zoom === side ? "spread" : side;
    this.emit();
  }

  resize(w: number, h: number) {
    if (!w || !h) return;
    this.aspect = w / h;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.canvas.removeEventListener("pointerdown", this.onDown);
    window.removeEventListener("pointermove", this.onMove);
    window.removeEventListener("pointerup", this.onUp);
    window.removeEventListener("pointercancel", this.onUp);
    for (const s of this.sheets) this.removeSheet(s);
    for (const v of this.texCache.values()) v.tex.dispose();
    this.texCache.clear();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose?.();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      for (const x of Array.isArray(mat) ? mat : mat ? [mat] : []) {
        (x as THREE.MeshStandardMaterial).map?.dispose();
        x.dispose();
      }
    });
    void this.audio?.close().catch(() => {});
    this.renderer.dispose();
    // Browsers allow only a handful of live WebGL contexts and drop the OLDEST one (the garden's) when over: give this one back.
    this.renderer.forceContextLoss();
  }

  /* ───────── spreads and pages ───────── */

  /** The spread that shows a page (even pages are on the right, odd on the left). */
  private spreadFor(key: string, pages: DiaryPage[]) {
    const i = Math.max(0, pages.findIndex((p) => p.key === key));
    return i % 2 === 0 ? i / 2 + 1 : (i + 3) / 2;
  }

  private visibleKeys() {
    const s = this.spreadNow;
    const left = s >= 2 ? (this.pages[2 * (s - 2) + 1]?.key ?? null) : null;
    const right = s >= 1 && s <= this.pages.length / 2 ? (this.pages[2 * (s - 1)]?.key ?? null) : null;
    return { left, right };
  }

  private emit() {
    this.o.onSpread({ spread: this.spreadNow, max: this.lastSpread, ...this.visibleKeys(), zoom: this.zoom });
  }

  private assignKeys(s: Sheet) {
    if (s.idx === 0) return;
    s.frontKey = this.pages[2 * (s.idx - 1)]?.key ?? null;
    s.backKey = this.pages[2 * (s.idx - 1) + 1]?.key ?? null;
  }

  /* ───────── sheets ───────── */

  private makeSheet(idx: number): Sheet {
    const cover = idx === 0;
    const w = cover ? W + 0.05 : W;
    const hh = cover ? H + 0.09 : H;
    const h = cover ? COVER_H : PAPER_H;
    const mk = (back: boolean) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(new Float32Array((N + 1) * 2 * 3), 3));
      g.setAttribute("normal", new THREE.BufferAttribute(new Float32Array((N + 1) * 2 * 3), 3));
      const uv = new Float32Array((N + 1) * 2 * 2);
      const index: number[] = [];
      for (let i = 0; i <= N; i++) {
        const u = i / N;
        const uu = back ? 1 - u : u;
        uv.set([uu, 1, uu, 0], i * 4);
        if (i < N) {
          const a = i * 2;
          index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
        }
      }
      g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
      g.setIndex(index);
      return g;
    };
    const fGeo = mk(false);
    const bGeo = mk(true);
    const fMat = new THREE.MeshStandardMaterial({ color: cover ? 0xffffff : this.paperTexFallback, roughness: cover ? 0.55 : 0.92, map: cover ? this.leather : null, side: THREE.FrontSide });
    const bMat = new THREE.MeshStandardMaterial({ color: cover ? 0xffffff : this.paperTexFallback, roughness: cover ? 0.9 : 0.92, map: cover ? this.endpaper : null, side: THREE.BackSide });
    const front = new THREE.Mesh(fGeo, fMat);
    const back = new THREE.Mesh(bGeo, bMat);
    for (const m of [front, back]) {
      m.frustumCulled = false;
      this.book.add(m);
    }
    let edge: THREE.Mesh | null = null;
    let eGeo: THREE.BufferGeometry | null = null;
    if (cover) {
      eGeo = new THREE.BufferGeometry();
      eGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(((N + 1) * 4 + 4) * 3), 3));
      const index: number[] = [];
      for (let strip = 0; strip < 2; strip++) {
        const base = strip * (N + 1) * 2;
        for (let i = 0; i < N; i++) {
          const a = base + i * 2;
          index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
        }
      }
      const c = (N + 1) * 4;
      index.push(c, c + 1, c + 2, c, c + 2, c + 3);
      eGeo.setIndex(index);
      edge = new THREE.Mesh(eGeo, new THREE.MeshStandardMaterial({ color: "#4a1a17", roughness: 0.6, side: THREE.DoubleSide }));
      edge.frustumCulled = false;
      this.book.add(edge);
    }
    return { idx, h, w, hh, front, back, fGeo, bGeo, edge, eGeo, t: 0, target: 0, anim: null, dragging: false, frontKey: null, backKey: null, lastT: -1, lastY: -1 };
  }

  private removeSheet(s: Sheet) {
    for (const m of [s.front, s.back, ...(s.edge ? [s.edge] : [])]) {
      this.book.remove(m);
      m.geometry.dispose();
      const mat = m.material as THREE.MeshStandardMaterial;
      if (mat.map && mat.map !== this.leather && mat.map !== this.endpaper) mat.map = null;
      mat.dispose();
    }
  }

  /** Bends one sheet: walk from the spine outwards, turning by the angle for each step. */
  private shape(s: Sheet, t: number, y0: number) {
    const th = t * Math.PI;
    const ds = s.w / N;
    // The bend: the edge trails while the page lifts, then runs ahead as it falls; the gutter dips near the spine.
    const bend = s.idx === 0 ? 0.12 : 0.55;
    let x = 0;
    let y = y0;
    const f = s.fGeo.attributes.position.array as Float32Array;
    const b = s.bGeo.attributes.position.array as Float32Array;
    const nf = s.fGeo.attributes.normal.array as Float32Array;
    const nb = s.bGeo.attributes.normal.array as Float32Array;
    const hz = s.hh / 2;
    const half = s.h / 2;
    for (let i = 0; i <= N; i++) {
      const u = i / N;
      const gutter = 0.07 * Math.pow(1 - clamp(u * 2.2), 2) + 0.012;
      const a = th + (s.idx === 0 ? 0 : gutter * Math.cos(th)) - bend * Math.sin(2 * th) * u;
      const nx = -Math.sin(a);
      const ny = Math.cos(a);
      f.set([x + nx * half, y + ny * half, -hz, x + nx * half, y + ny * half, hz], i * 6);
      b.set([x - nx * half, y - ny * half, -hz, x - nx * half, y - ny * half, hz], i * 6);
      nf.set([nx, ny, 0, nx, ny, 0], i * 6);
      nb.set([nx, ny, 0, nx, ny, 0], i * 6);
      x += Math.cos(a) * ds;
      y += Math.sin(a) * ds;
    }
    s.fGeo.attributes.position.needsUpdate = true;
    s.bGeo.attributes.position.needsUpdate = true;
    s.fGeo.attributes.normal.needsUpdate = true;
    s.bGeo.attributes.normal.needsUpdate = true;
    if (s.eGeo) {
      const e = s.eGeo.attributes.position.array as Float32Array;
      const at = (arr: Float32Array, k: number) => [arr[k * 3], arr[k * 3 + 1], arr[k * 3 + 2]];
      for (let i = 0; i <= N; i++) {
        e.set([...at(f, i * 2), ...at(b, i * 2)], i * 6);
        e.set([...at(f, i * 2 + 1), ...at(b, i * 2 + 1)], ((N + 1) + i) * 6);
      }
      e.set([...at(f, N * 2), ...at(f, N * 2 + 1), ...at(b, N * 2 + 1), ...at(b, N * 2)], (N + 1) * 4 * 3);
      s.eGeo.attributes.position.needsUpdate = true;
      s.eGeo.computeVertexNormals();
    }
  }

  /* ───────── frame ───────── */

  private loop = () => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const now = performance.now();
    const dt = Math.min((now - this.last) / 1000, 0.05);
    this.last = now;
    this.elapsed += dt;
    this.introT += dt;
    this.update(dt);
    this.renderer.render(this.scene, this.camera);
  };

  private update(dt: number) {
    // Animate turns.
    let moving = false;
    for (const s of this.sheets) {
      const a = s.anim;
      if (!a || s.dragging) continue;
      const p = clamp((this.elapsed - a.start) / a.dur);
      if (this.elapsed >= a.start && !a.snd) {
        a.snd = true;
        this.flipSound(0.5);
      }
      const e = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
      s.t = a.from + (a.to - a.from) * (p > 0 ? e : 0);
      if (p >= 1) s.anim = null;
      else moving = true;
    }
    void moving;

    // Stack heights: each sheet's spine height sits on the pages still on its side.
    const n = this.sheets.length;
    let rightH = 0;
    let leftH = 0;
    const yAt: number[] = new Array(n).fill(0);
    const rightAbove = new Array(n + 1).fill(0);
    for (let j = n - 1; j >= 0; j--) rightAbove[j] = rightAbove[j + 1] + (1 - this.sheets[j].t) * (this.sheets[j].h + GAP);
    let leftBelow = 0;
    for (let j = 0; j < n; j++) {
      const s = this.sheets[j];
      const yr = rightAbove[j + 1] + s.h / 2;
      const yl = leftBelow + s.h / 2;
      yAt[j] = yr + (yl - yr) * smooth(s.t) + 0.0004;
      leftBelow += s.t * (s.h + GAP);
    }
    rightH = rightAbove[0];
    leftH = leftBelow;
    for (const s of this.sheets) {
      const flipping = s.t > 0.001 && s.t < 0.999;
      if (Math.abs(s.t - s.lastT) > 1e-5 || Math.abs(yAt[s.idx] - s.lastY) > 1e-6) {
        this.shape(s, s.t, yAt[s.idx]);
        s.lastT = s.t;
        s.lastY = yAt[s.idx];
      }
      // Only a turning page casts a shadow (onto the pages below); resting ones receive it.
      for (const m of [s.front, s.back]) {
        m.castShadow = flipping;
        m.receiveShadow = !flipping;
      }
    }
    const setBlock = (b: THREE.Mesh, h: number, base: number, cx: number, tex: THREE.CanvasTexture) => {
      b.visible = h > 0.004;
      b.scale.set(W - 0.012, Math.max(0.001, h), H - 0.02);
      b.position.set(cx, base + h / 2, 0);
      tex.repeat.set(1, Math.max(1, h / 0.018));
    };
    // The page stacks' sides (the cover is not one of the pages: the left stack rests on it once it is open).
    const coverLeft = (this.sheets[0]?.t ?? 0) * (COVER_H + GAP);
    setBlock(this.rightBlock, rightH - (1 - (this.sheets[0]?.t ?? 0)) * (COVER_H + GAP), 0, W / 2, this.rightEdgeTex);
    setBlock(this.leftBlock, leftH - coverLeft, coverLeft, -W / 2, this.leftEdgeTex);

    // Redraw the page that is being written out.
    for (const [key, r] of this.reveal) {
      const p = clamp((this.elapsed - r.start) / r.dur);
      this.redraw(key, p);
      if (p >= 1) this.reveal.delete(key);
    }

    // The closed book sits centred; opening slides the spine to the middle.
    const open = smooth(clamp((this.sheets[0]?.t ?? 0) * 1.6));
    this.book.position.x = -((W + 0.05) / 2) * (1 - open);
    const intro = smooth(clamp(this.introT / 1.1));
    this.book.position.y = (1 - intro) * 0.3; // settles down onto the table (never below it)
    this.book.rotation.y = Math.sin(this.elapsed * 0.35) * 0.012 + (1 - intro) * 0.35;

    // Camera: frames the open spread (or one page when zoomed), tilted for depth.
    const vfov = (this.camera.fov * Math.PI) / 180;
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * this.aspect);
    const zx = this.zoom === "left" ? -W / 2 : this.zoom === "right" ? W / 2 : 0;
    const needW = this.zoom === "spread" ? 1.35 + 0.95 * open : 1.18;
    const needH = (H + 0.32) * (this.zoom === "spread" ? 1 : 0.95);
    const tilt = this.zoom === "spread" ? 0.62 : 0.34;
    const dW = needW / 2 / Math.tan(hfov / 2);
    const dH = needH / 2 / Math.tan(vfov / 2);
    const d = Math.max(dW, dH) * 1.04 + (1 - intro) * 1.0;
    const look = new THREE.Vector3(zx, 0.04, this.zoom === "spread" ? 0.02 : 0.05);
    const want = new THREE.Vector3(zx + Math.sin(this.elapsed * 0.3) * 0.03, look.y + d * Math.cos(tilt), look.z + d * Math.sin(tilt));
    if (this.camPos.lengthSq() === 0) {
      this.camPos.copy(want).add(new THREE.Vector3(0, 0.5, 0.6));
      this.camLook.copy(look);
    }
    const k = 1 - Math.exp(-dt * 5.5);
    this.camPos.lerp(want, k);
    this.camLook.lerp(look, k);
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);

    // Dust drifting up.
    const mp = this.motes.geometry.attributes.position.array as Float32Array;
    for (let i = 0; i < mp.length; i += 3) {
      mp[i + 1] += dt * (0.03 + ((i * 7) % 5) * 0.012);
      mp[i] += Math.sin(this.elapsed * 0.4 + i) * dt * 0.02;
      if (mp[i + 1] > 2) mp[i + 1] = 0.12;
    }
    this.motes.geometry.attributes.position.needsUpdate = true;
    (this.motes.material as THREE.PointsMaterial).opacity = 0.35 + 0.4 * intro;

    this.ensureTextures();
  }

  /* ───────── pointer: drag a page corner, tap to turn or zoom ───────── */

  private worldX(e: PointerEvent) {
    const r = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(ndc, this.camera);
    const hit = new THREE.Vector3();
    return this.ray.ray.intersectPlane(this.plane, hit) ? hit.x - this.book.position.x : null;
  }

  private onDown = (e: PointerEvent) => {
    const x = this.worldX(e);
    if (x == null || this.drag) return;
    const s = this.spreadNow;
    const forward = x >= 0;
    const sheet = this.sheets[forward ? s : s - 1];
    if (!sheet) return;
    // Past the newest page (or before the cover) nothing turns, but a tap can still zoom.
    const locked = forward ? s >= this.lastSpread : s <= 0;
    this.drag = { locked, sheet, forward, x0: x, px0: e.clientX, t0: sheet.t, time0: performance.now(), lastX: e.clientX, lastTime: performance.now(), vx: 0, moved: false };
    this.canvas.setPointerCapture?.(e.pointerId);
  };

  private onMove = (e: PointerEvent) => {
    const d = this.drag;
    if (!d) return;
    const now = performance.now();
    const x = this.worldX(e);
    if (x == null) return;
    if (d.locked || (!d.moved && Math.abs(e.clientX - d.px0) < 7)) return;
    if (!d.moved) {
      d.moved = true;
      d.sheet.dragging = true;
      d.sheet.anim = null;
      this.zoom = "spread";
      this.emit();
    }
    // The corner follows the finger: cos θ = x / W, kept continuous from where the page began.
    const k0 = Math.cos(d.t0 * Math.PI);
    const k = clamp(k0 + (x - d.x0) / (W * 0.95), -1, 1);
    d.sheet.t = Math.acos(k) / Math.PI;
    const dtm = Math.max(1, now - d.lastTime);
    d.vx = (e.clientX - d.lastX) / dtm;
    d.lastX = e.clientX;
    d.lastTime = now;
  };

  private onUp = () => {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    const sheet = d.sheet;
    sheet.dragging = false;
    if (!d.moved) {
      // A tap: the outer part of a page turns it, the middle zooms in to read it.
      const x = d.x0;
      if (Math.abs(x) > 0.55) {
        if (d.forward) this.next();
        else this.prev();
      }
      else if (Math.abs(x) > 0.02) this.toggleZoom(d.forward ? "right" : "left");
      return;
    }
    // Let go: finish the turn the way it was heading (a flick wins over how far it got).
    let to = sheet.t > 0.5 ? 1 : 0;
    if (d.vx < -0.6) to = 1;
    else if (d.vx > 0.6) to = 0;
    const turned = to === 1;
    this.spreadNow = this.sheets.filter((s) => (s === sheet ? turned : s.t > 0.5)).length;
    sheet.target = to;
    sheet.anim = { from: sheet.t, to, start: this.elapsed, dur: 0.45 };
    if (to !== d.t0) this.flipSound(0.35);
    this.emit();
  };

  /* ───────── sound ───────── */

  /** A soft paper rustle: filtered noise with a quick sweep. */
  private flipSound(strength: number) {
    if (this.o.reduced) return;
    const now = performance.now();
    if (now - this.lastSound < 70) return;
    this.lastSound = now;
    try {
      this.audio ??= new AudioContext();
      const ac = this.audio;
      if (ac.state === "suspended") void ac.resume();
      if (!this.noise) {
        const len = Math.floor(ac.sampleRate * 0.5);
        this.noise = ac.createBuffer(1, len, ac.sampleRate);
        const ch = this.noise.getChannelData(0);
        for (let i = 0; i < len; i++) ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 1.5);
      }
      const src = ac.createBufferSource();
      src.buffer = this.noise;
      const bp = ac.createBiquadFilter();
      bp.type = "bandpass";
      bp.Q.value = 0.9;
      bp.frequency.setValueAtTime(900, ac.currentTime);
      bp.frequency.exponentialRampToValueAtTime(3800, ac.currentTime + 0.35);
      const g = ac.createGain();
      g.gain.value = 0.07 * strength;
      src.connect(bp).connect(g).connect(ac.destination);
      src.start();
    } catch {
      /* no audio is fine */
    }
    if (navigator.vibrate) navigator.vibrate(6);
  }

  /* ───────── textures ───────── */

  /** Gives pages near the open spread their pictures and frees the far ones. */
  private ensureTextures() {
    const s = this.spreadNow;
    for (const sh of this.sheets) {
      if (sh.idx === 0) continue;
      const near = Math.abs(sh.idx - s) <= 3;
      const fm = sh.front.material as THREE.MeshStandardMaterial;
      const bm = sh.back.material as THREE.MeshStandardMaterial;
      if (near) {
        if (sh.frontKey && fm.map?.userData.key !== sh.frontKey) this.setMap(fm, sh.frontKey);
        if (sh.backKey && bm.map?.userData.key !== sh.backKey) this.setMap(bm, sh.backKey);
        fm.color.set(0xffffff);
        bm.color.set(0xffffff);
      } else if (fm.map || bm.map) {
        fm.map = null;
        bm.map = null;
        fm.color.copy(this.paperTexFallback);
        bm.color.copy(this.paperTexFallback);
        fm.needsUpdate = true;
        bm.needsUpdate = true;
      }
    }
    // Free textures that no near sheet uses.
    const used = new Set<string>();
    for (const sh of this.sheets) {
      for (const m of [sh.front, sh.back]) {
        const k = (m.material as THREE.MeshStandardMaterial).map?.userData.key as string | undefined;
        if (k) used.add(k);
      }
    }
    for (const [k, v] of this.texCache) {
      if (!used.has(k)) {
        v.tex.dispose();
        this.texCache.delete(k);
      }
    }
  }

  private setMap(m: THREE.MeshStandardMaterial, key: string) {
    const t = this.pageTexture(key);
    m.map = t;
    m.needsUpdate = true;
  }

  private pageTexture(key: string) {
    let c = this.texCache.get(key);
    if (!c) {
      const canvas = document.createElement("canvas");
      canvas.width = TW;
      canvas.height = TH;
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
      tex.userData.key = key;
      c = { canvas, tex };
      this.texCache.set(key, c);
      this.draw(key, 1);
    }
    return c.tex;
  }

  private redraw(key: string, reveal = 1) {
    if (this.texCache.has(key)) this.draw(key, reveal);
  }

  private draw(key: string, reveal: number) {
    const c = this.texCache.get(key);
    const idx = this.pages.findIndex((p) => p.key === key);
    if (!c || idx < 0) return;
    const ctx = c.canvas.getContext("2d");
    if (!ctx) return;
    drawPage(ctx, this.pages[idx], idx % 2 === 0 ? "right" : "left", idx + 1, { hand: this.o.hand, pet: this.o.pet, busy: this.busy, reveal });
    c.tex.needsUpdate = true;
  }

  private canvasTex(w: number, h: number, paint: (ctx: CanvasRenderingContext2D) => void, repeat = false) {
    const cv = document.createElement("canvas");
    cv.width = w;
    cv.height = h;
    const ctx = cv.getContext("2d");
    if (ctx) paint(ctx);
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  }

  private makeLeather() {
    return this.canvasTex(640, 880, (ctx) => {
      const g = ctx.createLinearGradient(0, 0, TW, TH);
      g.addColorStop(0, "#8c382f");
      g.addColorStop(1, "#5a1f1b");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, TW, TH);
      const r = rng("leather");
      for (let i = 0; i < 9000; i++) {
        ctx.fillStyle = `rgba(${r() > 0.5 ? "255,220,200" : "0,0,0"},${r() * 0.07})`;
        ctx.fillRect(r() * TW, r() * TH, 1 + r() * 2.5, 1 + r() * 2.5);
      }
      // Gold border and a star emblem.
      ctx.strokeStyle = "rgba(224,178,92,0.85)";
      ctx.lineWidth = 5;
      ctx.strokeRect(46, 46, TW - 92, TH - 92);
      ctx.lineWidth = 2;
      ctx.strokeRect(62, 62, TW - 124, TH - 124);
      ctx.fillStyle = "rgba(231,188,104,0.95)";
      ctx.textAlign = "center";
      ctx.shadowColor = "rgba(0,0,0,0.5)";
      ctx.shadowBlur = 6;
      ctx.shadowOffsetY = 2;
      ctx.font = "700 92px Georgia, serif";
      ctx.fillText("Nova's", TW / 2, 390);
      ctx.font = "italic 700 112px Georgia, serif";
      ctx.fillText("Diary", TW / 2, 500);
      ctx.font = "60px serif";
      ctx.fillText("✦", TW / 2, 250);
      ctx.fillText("✦", TW / 2, 700);
    });
  }

  private makeEndpaper() {
    return this.canvasTex(512, 704, (ctx) => {
      ctx.fillStyle = "#2f5a4a";
      ctx.fillRect(0, 0, 512, 704);
      ctx.strokeStyle = "rgba(240,220,160,0.25)";
      ctx.lineWidth = 2;
      for (let y = -40; y < 760; y += 44) for (let x = -40; x < 560; x += 44) {
        ctx.beginPath();
        ctx.moveTo(x + 22, y);
        ctx.lineTo(x + 44, y + 22);
        ctx.lineTo(x + 22, y + 44);
        ctx.lineTo(x, y + 22);
        ctx.closePath();
        ctx.stroke();
      }
    });
  }

  private makeEdgeTexture() {
    return this.canvasTex(8, 16, (ctx) => {
      ctx.fillStyle = "#f3e8cc";
      ctx.fillRect(0, 0, 8, 16);
      ctx.fillStyle = "rgba(120,95,55,0.5)";
      ctx.fillRect(0, 14, 8, 2);
    }, true);
  }

  private makeBlob() {
    return this.canvasTex(128, 128, (ctx) => {
      const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 62);
      g.addColorStop(0, "rgba(0,0,0,0.9)");
      g.addColorStop(0.55, "rgba(0,0,0,0.45)");
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 128, 128);
    });
  }

  private makeGlow() {
    return this.canvasTex(64, 64, (ctx) => {
      const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
      g.addColorStop(0, "rgba(255,255,255,1)");
      g.addColorStop(0.3, "rgba(255,255,255,0.45)");
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 64, 64);
    });
  }
}

/* ───────────────────────── drawing a page ───────────────────────── */

type DrawOpts = { hand: string; pet: string; busy: boolean; reveal: number };

function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number) {
  const lines: string[] = [];
  for (const para of text.split(/\n+/)) {
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const test = line ? `${line} ${word}` : word;
      if (line && ctx.measureText(test).width > maxW) {
        lines.push(line);
        line = word;
      } else line = test;
    }
    if (line) lines.push(line);
  }
  return lines;
}

function paper(ctx: CanvasRenderingContext2D, seed: string, side: "left" | "right") {
  const g = ctx.createLinearGradient(0, 0, 0, TH);
  g.addColorStop(0, PAPER_A);
  g.addColorStop(1, PAPER_B);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, TW, TH);
  // Fibres and speckle, the same every time for the same page.
  const r = rng(seed);
  for (let i = 0; i < 2600; i++) {
    ctx.fillStyle = `rgba(${r() > 0.5 ? "140,110,60" : "255,255,255"},${r() * 0.06})`;
    ctx.fillRect(r() * TW, r() * TH, 1 + r() * 2, 1 + r() * 1.4);
  }
  // Darker towards the spine, a faint edge wear on the far side.
  const sx = side === "right" ? 0 : TW;
  const sg = ctx.createLinearGradient(sx, 0, side === "right" ? 150 : TW - 150, 0);
  sg.addColorStop(0, "rgba(70,45,20,0.26)");
  sg.addColorStop(1, "rgba(70,45,20,0)");
  ctx.fillStyle = sg;
  ctx.fillRect(0, 0, TW, TH);
  const eg = ctx.createLinearGradient(side === "right" ? TW : 0, 0, side === "right" ? TW - 40 : 40, 0);
  eg.addColorStop(0, "rgba(120,90,40,0.18)");
  eg.addColorStop(1, "rgba(120,90,40,0)");
  ctx.fillStyle = eg;
  ctx.fillRect(0, 0, TW, TH);
}

function rules(ctx: CanvasRenderingContext2D, y0: number, lh: number, side: "left" | "right") {
  ctx.strokeStyle = "rgba(95,125,160,0.26)";
  ctx.lineWidth = 2;
  for (let y = y0; y < TH - 60; y += lh) {
    ctx.beginPath();
    ctx.moveTo(40, y);
    ctx.lineTo(TW - 40, y);
    ctx.stroke();
  }
  ctx.strokeStyle = "rgba(200,95,95,0.28)";
  const mx = side === "right" ? 92 : TW - 92;
  ctx.beginPath();
  ctx.moveTo(mx, 0);
  ctx.lineTo(mx, TH);
  ctx.stroke();
}

function tape(ctx: CanvasRenderingContext2D, seed: string, side: "left" | "right") {
  const r = rng(`${seed}tape`);
  const hues = ["rgba(240,170,185,0.82)", "rgba(170,215,200,0.82)", "rgba(245,215,140,0.82)", "rgba(175,190,235,0.82)"];
  ctx.save();
  ctx.translate(side === "right" ? 150 + r() * 60 : TW - 210 + r() * 60, 34);
  ctx.rotate((r() - 0.5) * 0.14);
  ctx.fillStyle = hues[Math.floor(r() * hues.length)];
  ctx.fillRect(-64, -18, 128, 38);
  ctx.strokeStyle = "rgba(255,255,255,0.45)";
  ctx.lineWidth = 3;
  for (let x = -60; x < 64; x += 14) {
    ctx.beginPath();
    ctx.moveTo(x, -18);
    ctx.lineTo(x + 18, 20);
    ctx.stroke();
  }
  ctx.restore();
}

function doodle(ctx: CanvasRenderingContext2D, seed: string, x: number, y: number) {
  const kind = Math.floor(hash(`${seed}d`) * 4);
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = "rgba(70,55,40,0.55)";
  ctx.lineWidth = 4;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  if (kind === 0) {
    // a star
    for (let i = 0; i < 5; i++) {
      const a = (i * 4 * Math.PI) / 5 - Math.PI / 2;
      ctx.lineTo(Math.cos(a) * 34, Math.sin(a) * 34);
    }
    ctx.closePath();
  } else if (kind === 1) {
    // a heart
    ctx.moveTo(0, 26);
    ctx.bezierCurveTo(-48, -6, -22, -40, 0, -14);
    ctx.bezierCurveTo(22, -40, 48, -6, 0, 26);
  } else if (kind === 2) {
    // a little flower
    for (let i = 0; i < 5; i++) {
      const a = (i * 2 * Math.PI) / 5;
      ctx.moveTo(0, 0);
      ctx.ellipse(Math.cos(a) * 20, Math.sin(a) * 20, 14, 9, a, 0, Math.PI * 2);
    }
  } else {
    // a moon
    ctx.arc(0, 0, 28, -2.2, 2.2);
    ctx.arc(10, 0, 22, 2.0, -2.0, true);
  }
  ctx.stroke();
  ctx.restore();
}

function drawPage(ctx: CanvasRenderingContext2D, page: DiaryPage, side: "left" | "right", num: number, o: DrawOpts) {
  paper(ctx, page.key, side);
  ctx.textBaseline = "alphabetic";
  const left = side === "right" ? 112 : 52;
  const right = side === "right" ? TW - 56 : TW - 112;
  const hand = o.hand;

  if (page.kind === "title") {
    rules(ctx, 330, 52, side);
    ctx.textAlign = "center";
    ctx.fillStyle = INK;
    ctx.font = `700 150px ${hand}`;
    ctx.fillText("Nova's", TW / 2, 300);
    ctx.font = `700 170px ${hand}`;
    ctx.fillText("Diary", TW / 2, 450);
    ctx.strokeStyle = "rgba(138,53,47,0.7)";
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(130, 482);
    ctx.bezierCurveTo(240, 520, 380, 450, 510, 490);
    ctx.stroke();
    ctx.font = `500 40px ${hand}`;
    ctx.fillStyle = "rgba(59,47,30,0.8)";
    ctx.fillText("a page for every day", TW / 2, 580);
    ctx.font = "54px serif";
    ctx.fillText("🌙", TW / 2, 700);
    return;
  }
  if (page.kind === "blank") {
    rules(ctx, 150, 52, side);
    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(59,47,30,0.45)";
    ctx.font = `500 40px ${hand}`;
    if (page.text) ctx.fillText(page.text, TW / 2, TH / 2);
    return;
  }
  if (page.kind === "write") {
    rules(ctx, 150, 52, side);
    ctx.textAlign = "center";
    ctx.fillStyle = INK;
    ctx.font = "120px serif";
    ctx.fillText(o.busy ? "✍️" : "🌙", TW / 2, 330);
    ctx.font = `600 54px ${hand}`;
    const lines = o.busy ? [`${o.pet} is writing…`] : [`${o.pet} hasn't written`, "today's page yet."];
    lines.forEach((l, i) => ctx.fillText(l, TW / 2, 450 + i * 64));
    if (!o.busy) {
      ctx.font = `500 38px ${hand}`;
      ctx.fillStyle = "rgba(59,47,30,0.65)";
      ctx.fillText("It does that at 11 pm,", TW / 2, 610);
      ctx.fillText("or tap the button below.", TW / 2, 660);
    }
    return;
  }

  // A day's page: tape, the date, the mood, then the handwriting on ruled lines.
  const date = page.date ?? "";
  const d = new Date(`${date}T12:00:00Z`);
  const weekday = d.toLocaleDateString("en-IN", { weekday: "long", timeZone: "UTC" });
  const rest = d.toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  tape(ctx, page.key, side);

  // Lay the text out first (shrinking it until it fits), so the ruling follows the handwriting.
  const text = page.text ?? "";
  let size = 44;
  let lines: string[] = [];
  for (; size >= 26; size -= 2) {
    ctx.font = `500 ${size}px ${hand}`;
    lines = wrap(ctx, text, right - left);
    if (lines.length * size * 1.3 <= TH - 360 - 40) break;
  }
  const lh = Math.round(size * 1.3);
  const y0 = 300;
  rules(ctx, y0 + 8, lh, side);

  ctx.textAlign = "left";
  ctx.fillStyle = "rgba(122,98,66,0.9)";
  ctx.font = `600 26px ${hand}`;
  try {
    (ctx as unknown as { letterSpacing: string }).letterSpacing = "5px";
  } catch {
    /* older browsers: no spacing */
  }
  ctx.fillText(weekday.toUpperCase(), left, 130);
  try {
    (ctx as unknown as { letterSpacing: string }).letterSpacing = "0px";
  } catch {
    /* older browsers */
  }
  ctx.fillStyle = INK;
  ctx.font = `700 58px ${hand}`;
  ctx.fillText(rest, left, 196);
  if (page.mood) {
    ctx.font = "78px serif";
    ctx.textAlign = "right";
    ctx.fillText(page.mood, right, 200);
    ctx.textAlign = "left";
  }
  ctx.strokeStyle = "rgba(138,53,47,0.5)";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(left, 226);
  ctx.bezierCurveTo(left + 120, 238, left + 260, 216, right, 230);
  ctx.stroke();

  ctx.font = `500 ${size}px ${hand}`;
  ctx.fillStyle = INK;
  let budget = Math.floor(text.length * clamp(o.reveal));
  lines.forEach((l, i) => {
    if (budget <= 0) return;
    const part = l.slice(0, budget);
    budget -= l.length + 1;
    // A slight wobble in the baseline, like a hand.
    ctx.save();
    ctx.translate(left, y0 + i * lh);
    ctx.rotate(((hash(`${page.key}${i}`) - 0.5) * 0.012) as number);
    ctx.fillText(part, 0, 0);
    ctx.restore();
  });
  if (o.reveal >= 1 && lines.length * lh < TH - 520) doodle(ctx, page.key, side === "right" ? TW - 120 : 120, TH - 150);
  ctx.fillStyle = "rgba(122,98,66,0.7)";
  ctx.font = `500 28px ${hand}`;
  ctx.textAlign = "center";
  ctx.fillText(`~ ${num} ~`, TW / 2, TH - 38);
}
