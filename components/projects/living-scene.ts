import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { LivingData, LivingMemory } from "@/lib/living-memory";

/**
 * "Living Memory": a 3D scene where time runs left → right along a glowing spine.
 * Memories are luminous cells (bigger + brighter = more important), projects are soft clusters
 * they gather in, skills float above as crystal hubs wired to the memories that mention them,
 * and related memories are joined by flowing links. Everything grows in, oldest first.
 */
export type Picked = { kind: "memory"; id: string } | { kind: "skill"; name: string } | { kind: "project"; id: string } | null;
type Label = { el: HTMLDivElement; pos: THREE.Vector3; kind: "year" | "project" | "skill"; key: string };
type Node = { m: LivingMemory; mesh: THREE.Mesh; glow: THREE.Sprite; base: number; target: THREE.Vector3; born: number; isNew: boolean };

const TYPE_COLOR: Record<string, number> = {
  project_context: 0x7fc6de,
  experience: 0xf0b45a,
  fact: 0x9be29b,
  knowledge: 0xc79bff,
  learning: 0xff9f7a,
  idea: 0xfff27a,
  decision: 0xff7ab8,
  preference: 0x7affd4,
};
/** Width of one year on the time axis: every year that has data gets the same room. */
const YEAR_W = 72;
const SKILL_Y = 88;

function glowTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, "rgba(255,255,255,1)");
  grd.addColorStop(0.25, "rgba(255,255,255,0.55)");
  grd.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

export class LivingScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private raf = 0;
  private clock = new THREE.Clock();
  private glowTex = glowTexture();
  private nodes = new Map<string, Node>();
  private skillMeshes = new Map<string, THREE.Mesh>();
  private clusterMeshes = new Map<string, THREE.Mesh>();
  private labels: Label[] = [];
  private relLinks: { a: string; b: string; line: THREE.Line; score: number }[] = [];
  private skillLinks: { m: string; s: string; line: THREE.Line }[] = [];
  private world = new THREE.Group();
  private ray = new THREE.Raycaster();
  private mouse = new THREE.Vector2();
  private hovered: Picked = null;
  private selected: Picked = null;
  private timeT = Infinity;
  private range = { min: 2020, max: 2027 };
  private growStart = 0;
  private playing: { from: number; to: number; start: number; dur: number } | null = null;
  private reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  private ro: ResizeObserver;

  constructor(
    private canvas: HTMLCanvasElement,
    private overlay: HTMLDivElement,
    private cb: { onHover: (p: Picked, x: number, y: number) => void; onSelect: (p: Picked) => void; onTime?: (t: number) => void },
  ) {
    const mobile = innerWidth < 768;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: !mobile, alpha: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, mobile ? 1.5 : 2));
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.5, 2000);
    this.camera.position.set(0, 58, mobile ? 470 : 310);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.07;
    this.controls.minDistance = 40;
    this.controls.maxDistance = 1400;
    this.controls.target.set(0, 16, 0);
    this.controls.autoRotate = !this.reduced;
    this.controls.autoRotateSpeed = 0.25;
    this.controls.addEventListener("start", () => (this.controls.autoRotate = false));

    this.scene.fog = new THREE.FogExp2(0x05080d, 0.0022);
    this.scene.add(new THREE.AmbientLight(0x6688aa, 0.6));
    const key = new THREE.PointLight(0xf0b45a, 2.2, 600, 1.2);
    key.position.set(0, 120, 80);
    this.scene.add(key);
    this.scene.add(this.world);
    this.addDust();

    canvas.addEventListener("pointermove", this.onMove);
    canvas.addEventListener("click", this.onClick);
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas.parentElement!);
    this.resize();
    this.loop();
  }

  private years: number[] = [];
  /** Each year's width: at least YEAR_W, wider when many projects share it (so they don't pile up). */
  private widths: number[] = [];
  private starts: number[] = [];
  private length = YEAR_W;
  /** Time → x: only years with data take room; the fraction of the year places it within its slot. */
  private x = (t: number) => {
    const y = Math.floor(t);
    let i = this.years.indexOf(y);
    if (i < 0) i = Math.max(0, this.years.findIndex((v) => v > y));
    if (i < 0 || i >= this.years.length) i = this.years.length - 1;
    const frac = this.years[i] === y ? t - y : 0.5;
    return this.starts[i] + frac * this.widths[i] - this.length / 2;
  };
  private width = (t: number) => this.widths[Math.max(0, this.years.indexOf(Math.floor(t)))] ?? YEAR_W;

  /** Faint drifting particles so the space feels alive. */
  private addDust() {
    const n = 900;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 520;
      pos[i * 3 + 1] = (Math.random() - 0.4) * 260;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 360;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const dust = new THREE.Points(g, new THREE.PointsMaterial({ color: 0x7fc6de, size: 0.9, transparent: true, opacity: 0.35, depthWrite: false }));
    dust.name = "dust";
    this.scene.add(dust);
  }

  private label(text: string, pos: THREE.Vector3, kind: Label["kind"], key: string) {
    const el = document.createElement("div");
    el.className = `living-label living-${kind}`;
    el.textContent = text;
    el.dataset.key = key;
    this.overlay.appendChild(el);
    this.labels.push({ el, pos, kind, key });
  }

  setData(d: LivingData, lastSeen: number) {
    this.range = d.range;
    this.years = [...new Set([...d.memories.map((m) => Math.floor(m.t)), ...d.projects.map((p) => p.year).filter((y): y is number => !!y)])].sort((a, b) => a - b);
    // Slot widths from how many projects each year holds.
    const perYear = new Map<number, number>();
    for (const p of d.projects) {
      const ms = d.memories.filter((m) => m.project_id === p.id);
      const y = Math.floor(ms.length ? ms.reduce((a, m) => a + m.t, 0) / ms.length : (p.year ?? this.years[this.years.length - 1]) + 0.5);
      perYear.set(y, (perYear.get(y) ?? 0) + 1);
    }
    this.widths = this.years.map((y) => YEAR_W * Math.max(1, (perYear.get(y) ?? 0) * 0.42));
    this.starts = this.widths.map((_, i) => this.widths.slice(0, i).reduce((a, b) => a + b, 0));
    this.length = this.widths.reduce((a, b) => a + b, 0) || YEAR_W;
    this.world.clear();
    this.overlay.innerHTML = "";
    this.labels = [];
    this.nodes.clear();
    this.skillMeshes.clear();
    this.clusterMeshes.clear();
    this.relLinks = [];
    this.skillLinks = [];

    // Time spine with year marks.
    const spine = new THREE.Mesh(
      new THREE.CylinderGeometry(0.35, 0.35, this.length + 30, 12, 1, true).rotateZ(Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x7fc6de, transparent: true, opacity: 0.55 }),
    );
    this.world.add(spine);
    for (const y of this.years) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(4, 0.12, 6, 48).rotateY(Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x7fc6de, transparent: true, opacity: 0.35 }));
      ring.position.x = this.x(y);
      this.world.add(ring);
      this.label(String(y), new THREE.Vector3(this.x(y + 0.5), -10, 0), "year", `y${y}`);
    }

    // Project clusters: placed at their (mean) time, fanned around the spine.
    const byProject = new Map<string, LivingMemory[]>();
    for (const m of d.memories) if (m.project_id) byProject.set(m.project_id, [...(byProject.get(m.project_id) ?? []), m]);
    const centers = new Map<string, THREE.Vector3>();
    const golden = Math.PI * (3 - Math.sqrt(5));
    // Projects sharing a year are spread across that year's slot and around the spine.
    const slotCount = new Map<number, number>();
    const slotIndex = new Map<string, number>();
    const projectT = new Map<string, number>();
    for (const p of d.projects) {
      const ms = byProject.get(p.id) ?? [];
      const t = ms.length ? ms.reduce((a, m) => a + m.t, 0) / ms.length : (p.year ?? this.years[this.years.length - 1]) + 0.5;
      projectT.set(p.id, t);
      const y = Math.floor(t);
      slotIndex.set(p.id, slotCount.get(y) ?? 0);
      slotCount.set(y, (slotCount.get(y) ?? 0) + 1);
    }
    d.projects.forEach((p, i) => {
      const ms = byProject.get(p.id) ?? [];
      const y = Math.floor(projectT.get(p.id)!);
      const k = slotIndex.get(p.id)!;
      const n = slotCount.get(y)!;
      const a = k * golden * 2 + i * 0.7;
      const r = 40 + (k % 3) * 18;
      const xo = n > 1 ? ((k + 0.5) / n - 0.5) * this.width(y) * 0.9 : 0;
      const c = new THREE.Vector3(this.x(y + 0.5) + xo, Math.sin(a) * r * 0.95 + 4, Math.cos(a) * r);
      centers.set(p.id, c);
      const size = 6 + Math.min(10, ms.length * 2.6) + 3;
      const shell = new THREE.Mesh(
        new THREE.SphereGeometry(size, 24, 16),
        new THREE.MeshBasicMaterial({ color: p.status === "done" ? 0x7fc6de : p.status === "paused" ? 0xf0b45a : 0x9be29b, transparent: true, opacity: 0.06, depthWrite: false }),
      );
      shell.position.copy(c);
      shell.userData = { kind: "project", id: p.id };
      this.world.add(shell);
      this.clusterMeshes.set(p.id, shell);
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, color: 0x7fc6de, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false }));
      halo.scale.setScalar(size * 3.2);
      halo.position.copy(c);
      this.world.add(halo);
      // A faint thread back to the spine: where in time this project lives.
      this.world.add(this.line([c, new THREE.Vector3(c.x, 0, 0)], 0x7fc6de, 0.12));
      this.label(p.name, c.clone().add(new THREE.Vector3(0, size + 3, 0)), "project", p.id);
    });

    // Memories: cells inside their cluster (or near the spine), sized and lit by importance.
    const order = [...d.memories].sort((a, b) => a.t - b.t);
    order.forEach((m, i) => {
      const c = m.project_id ? centers.get(m.project_id) : null;
      const seed = parseInt(m.id.slice(0, 8), 16);
      const rnd = (k: number) => ((Math.sin(seed * (k + 1) * 12.9898) * 43758.5453) % 1 + 1) % 1;
      const target = c
        ? c.clone().add(new THREE.Vector3((rnd(1) - 0.5) * 10, (rnd(2) - 0.5) * 10, (rnd(3) - 0.5) * 10))
        : new THREE.Vector3(this.x(m.t), Math.sin(rnd(4) * 6.28) * (12 + rnd(5) * 8), Math.cos(rnd(4) * 6.28) * (12 + rnd(5) * 8));
      const color = TYPE_COLOR[m.type] ?? 0xdde6f0;
      const base = 1.3 + m.importance * 0.38;
      const mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 2), new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.55 + m.importance * 0.06, roughness: 0.35 }));
      mesh.position.copy(target);
      mesh.scale.setScalar(0.001);
      mesh.userData = { kind: "memory", id: m.id };
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, color, transparent: true, opacity: 0.25 + m.importance * 0.05, blending: THREE.AdditiveBlending, depthWrite: false }));
      glow.position.copy(target);
      glow.scale.setScalar(0.001);
      this.world.add(mesh, glow);
      this.nodes.set(m.id, { m, mesh, glow, base, target, born: i / Math.max(1, order.length), isNew: +new Date(m.created_at) > lastSeen && lastSeen > 0 });
    });

    // Skill hubs above the spine, at the mean time of the memories that mention them.
    // Spread along the whole timeline in order of when each skill shows up, at staggered heights.
    const skillT = new Map(d.skills.map((s) => {
      const ms = d.memories.filter((m) => m.skills.includes(s.name));
      return [s.name, ms.length ? ms.reduce((a, m) => a + m.t, 0) / ms.length : this.range.max];
    }));
    const ordered = [...d.skills].sort((a, b) => skillT.get(a.name)! - skillT.get(b.name)!);
    ordered.forEach((s, i) => {
      const ms = d.memories.filter((m) => m.skills.includes(s.name));
      const pos = new THREE.Vector3(-this.length / 2 + ((i + 0.5) / ordered.length) * this.length, SKILL_Y + (i % 3) * 15, (i % 2 ? 1 : -1) * (8 + (i % 4) * 9));
      const size = 1.6 + Math.sqrt(s.count) * 1.1;
      const hub = new THREE.Mesh(new THREE.OctahedronGeometry(size, 0), new THREE.MeshStandardMaterial({ color: 0xf0b45a, emissive: 0xf0b45a, emissiveIntensity: 0.6, roughness: 0.2, metalness: 0.3, flatShading: true }));
      hub.position.copy(pos);
      hub.userData = { kind: "skill", name: s.name };
      this.world.add(hub);
      this.skillMeshes.set(s.name, hub);
      const topOnPhone = [...d.skills].sort((a, b) => b.count - a.count).slice(0, 7).some((x) => x.name === s.name);
      if (!this.portrait || topOnPhone) this.label(`${s.name} · ${s.count}`, pos.clone().add(new THREE.Vector3(0, size + 3, 0)), "skill", s.name);
      for (const m of ms) {
        const n = this.nodes.get(m.id);
        if (!n) continue;
        const line = this.line([pos, n.target], 0xf0b45a, 0.07);
        this.world.add(line);
        this.skillLinks.push({ m: m.id, s: s.name, line });
      }
    });

    // Related memories: curved, flowing links (each pair once).
    const seen = new Set<string>();
    for (const m of d.memories) {
      for (const r of m.related) {
        const key = [m.id, r.id].sort().join("|");
        const a = this.nodes.get(m.id);
        const b = this.nodes.get(r.id);
        if (seen.has(key) || !a || !b) continue;
        seen.add(key);
        const mid = a.target.clone().add(b.target).multiplyScalar(0.5).add(new THREE.Vector3(0, 8 + a.target.distanceTo(b.target) * 0.12, 0));
        const pts = new THREE.QuadraticBezierCurve3(a.target, mid, b.target).getPoints(24);
        const line = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(pts),
          new THREE.LineDashedMaterial({ color: 0x7fc6de, dashSize: 2, gapSize: 2.4, transparent: true, opacity: 0.1 + (r.score - 0.6) * 0.8, depthWrite: false }),
        );
        line.computeLineDistances();
        this.world.add(line);
        this.relLinks.push({ a: m.id, b: r.id, line, score: r.score });
      }
    }
    this.growStart = this.clock.getElapsedTime();
    this.applyFocus();
    this.camera.position.copy(this.homeCam());
    this.controls.target.copy(this.homeTarget());
  }

  /** Portrait phones: a closer view of one stretch of time instead of the whole squeezed timeline. */
  private get portrait() {
    return this.camera.aspect < 1;
  }
  private homeTarget() {
    return this.portrait ? new THREE.Vector3(this.x(this.years[this.years.length - 1] + 0.5) - YEAR_W * 0.6, 22, 0) : new THREE.Vector3(0, 16, 0);
  }
  /** Desktop: far enough back that the whole timeline fits the view's width. */
  private homeCam() {
    if (this.portrait) return this.homeTarget().add(new THREE.Vector3(0, 55, 330));
    const fit = (this.length + 60) / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * Math.max(0.5, this.camera.aspect));
    return new THREE.Vector3(0, 58 + fit * 0.08, Math.max(260, fit * 1.05));
  }

  private line(points: THREE.Vector3[], color: number, opacity: number) {
    return new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false }));
  }

  /** Show the brain as it was at time `t` (memories after it fade out). */
  setTime(t: number) {
    this.timeT = t;
    this.playing = null;
    // On a phone the slider also travels: the camera glides to that point in time.
    if (this.portrait && Number.isFinite(t)) {
      const to = new THREE.Vector3(this.x(Math.min(t, this.range.max)) - YEAR_W * 0.3, 22, 0);
      const off = this.camera.position.clone().sub(this.controls.target);
      this.fly = { from: this.controls.target.clone(), to, camFrom: this.camera.position.clone(), camTo: to.clone().add(off), t: 0.6 };
      this.controls.autoRotate = false;
    }
  }

  /** Replay the brain growing from the beginning. */
  play(seconds = 8) {
    this.playing = { from: this.range.min, to: this.range.max, start: this.clock.getElapsedTime(), dur: seconds };
  }

  select(p: Picked) {
    this.selected = p;
    this.applyFocus();
    if (p?.kind === "memory" || p?.kind === "project" || p?.kind === "skill") {
      const target =
        p.kind === "memory" ? this.nodes.get(p.id)?.target : p.kind === "project" ? this.clusterMeshes.get(p.id)?.position : this.skillMeshes.get(p.name)?.position;
      if (target) this.flyTo(target);
    }
  }

  private fly: { from: THREE.Vector3; to: THREE.Vector3; camFrom: THREE.Vector3; camTo: THREE.Vector3; t: number } | null = null;
  private flyTo(target: THREE.Vector3) {
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    const camTo = target.clone().add(dir.multiplyScalar(this.selected?.kind === "memory" ? 55 : 85));
    this.fly = { from: this.controls.target.clone(), to: target.clone(), camFrom: this.camera.position.clone(), camTo, t: 0 };
    this.controls.autoRotate = false;
  }

  resetView() {
    this.selected = null;
    this.applyFocus();
    this.fly = { from: this.controls.target.clone(), to: this.homeTarget(), camFrom: this.camera.position.clone(), camTo: this.homeCam(), t: 0 };
  }

  /** Dim everything that isn't connected to the selection. */
  private applyFocus() {
    const s = this.selected;
    const lit = new Set<string>();
    if (s?.kind === "memory") {
      lit.add(s.id);
      for (const l of this.relLinks) {
        if (l.a === s.id) lit.add(l.b);
        else if (l.b === s.id) lit.add(l.a);
      }
    } else if (s?.kind === "skill") {
      for (const l of this.skillLinks) if (l.s === s.name) lit.add(l.m);
    } else if (s?.kind === "project") {
      for (const n of this.nodes.values()) if (n.m.project_id === s.id) lit.add(n.m.id);
    }
    const any = !!s;
    for (const [id, n] of this.nodes) {
      const on = !any || lit.has(id);
      (n.mesh.material as THREE.MeshStandardMaterial).opacity = on ? 1 : 0.12;
      (n.mesh.material as THREE.MeshStandardMaterial).transparent = !on;
      (n.glow.material as THREE.SpriteMaterial).opacity = on ? 0.25 + n.m.importance * 0.05 : 0.03;
    }
    for (const l of this.relLinks) {
      const on = any && s?.kind === "memory" && (l.a === s.id || l.b === s.id);
      const mat = l.line.material as THREE.LineDashedMaterial;
      mat.opacity = on ? 0.9 : any ? 0.03 : 0.1 + (l.score - 0.6) * 0.8;
      mat.color.setHex(on ? 0xf0b45a : 0x7fc6de);
    }
    for (const l of this.skillLinks) {
      const on = any && ((s?.kind === "skill" && l.s === s.name) || (s?.kind === "memory" && l.m === s.id));
      (l.line.material as THREE.LineBasicMaterial).opacity = on ? 0.75 : any ? 0.02 : 0.07;
    }
    for (const [name, hub] of this.skillMeshes) {
      const on = !any || (s?.kind === "skill" && s.name === name) || (s?.kind === "memory" && this.skillLinks.some((l) => l.s === name && l.m === s.id));
      (hub.material as THREE.MeshStandardMaterial).emissiveIntensity = on ? 0.9 : 0.12;
    }
    for (const lb of this.labels) {
      if (lb.kind === "year") continue;
      const on =
        !any ||
        (lb.kind === "skill" && ((s?.kind === "skill" && s.name === lb.key) || (s?.kind === "memory" && this.skillLinks.some((l) => l.s === lb.key && l.m === s.id)))) ||
        (lb.kind === "project" && ((s?.kind === "project" && s.id === lb.key) || (s?.kind === "memory" && this.nodes.get(s.id)?.m.project_id === lb.key)));
      lb.el.style.opacity = on ? "1" : "0.18";
    }
  }

  private pick(e: PointerEvent | MouseEvent): Picked {
    const r = this.canvas.getBoundingClientRect();
    this.mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(this.mouse, this.camera);
    const targets = [...[...this.nodes.values()].map((n) => n.mesh), ...this.skillMeshes.values(), ...this.clusterMeshes.values()];
    const hit = this.ray.intersectObjects(targets, false).find((h) => h.object.visible && h.object.scale.x > 0.05);
    const u = hit?.object.userData as { kind?: string; id?: string; name?: string } | undefined;
    if (!u?.kind) return null;
    return u.kind === "skill" ? { kind: "skill", name: u.name! } : { kind: u.kind as "memory" | "project", id: u.id! };
  }

  private onMove = (e: PointerEvent) => {
    const p = this.pick(e);
    this.hovered = p;
    this.canvas.style.cursor = p ? "pointer" : "grab";
    const r = this.canvas.getBoundingClientRect();
    this.cb.onHover(p, e.clientX - r.left, e.clientY - r.top);
  };

  private onClick = (e: MouseEvent) => {
    const p = this.pick(e);
    this.select(p);
    this.cb.onSelect(p);
  };

  private resize() {
    const el = this.canvas.parentElement!;
    const w = el.clientWidth;
    const h = el.clientHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
  }

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    const now = this.clock.getElapsedTime();

    if (this.fly) {
      this.fly.t = Math.min(1, this.fly.t + 0.02);
      const k = 1 - Math.pow(1 - this.fly.t, 3);
      this.controls.target.lerpVectors(this.fly.from, this.fly.to, k);
      this.camera.position.lerpVectors(this.fly.camFrom, this.fly.camTo, k);
      if (this.fly.t >= 1) this.fly = null;
    }

    let T = this.timeT;
    if (this.playing) {
      const p = Math.min(1, (now - this.playing.start) / this.playing.dur);
      T = this.playing.from + (this.playing.to - this.playing.from) * p;
      this.cb.onTime?.(T);
      if (p >= 1) {
        this.playing = null;
        this.timeT = Infinity;
      }
    }

    // Growth: on load, cells sprout oldest-first; the time scrubber hides what came later.
    const grow = this.reduced ? 1 : Math.min(1, (now - this.growStart) / 3.2);
    for (const n of this.nodes.values()) {
      const visibleByTime = n.m.t <= T;
      const sprout = Math.max(0, Math.min(1, (grow - n.born * 0.85) * 6));
      const want = visibleByTime ? sprout : 0;
      const cur = n.mesh.scale.x / n.base;
      const next = cur + (want - cur) * 0.15;
      const breathe = 1 + Math.sin(now * 1.6 + n.born * 20) * 0.05;
      const hover = this.hovered?.kind === "memory" && this.hovered.id === n.m.id ? 1.35 : 1;
      const s = Math.max(0.001, next * n.base * breathe * hover);
      n.mesh.scale.setScalar(s);
      // New since your last visit: a slow pulse so it's easy to spot.
      const pulse = n.isNew ? 1 + (Math.sin(now * 3) * 0.5 + 0.5) * 1.2 : 1;
      n.glow.scale.setScalar(Math.max(0.001, s * 7.5 * pulse));
      n.mesh.visible = n.glow.visible = s > 0.01;
    }
    for (const l of this.relLinks) {
      const a = this.nodes.get(l.a)!;
      const b = this.nodes.get(l.b)!;
      l.line.visible = a.mesh.visible && b.mesh.visible;
      (l.line.material as THREE.LineDashedMaterial & { dashOffset?: number }).dashOffset = -now * 3;
    }
    for (const l of this.skillLinks) l.line.visible = !!this.nodes.get(l.m)?.mesh.visible;
    for (const hub of this.skillMeshes.values()) hub.rotation.y += 0.008;
    const dust = this.scene.getObjectByName("dust");
    if (dust && !this.reduced) dust.rotation.y += 0.0004;

    this.controls.update();
    this.renderer.render(this.scene, this.camera);

    // Labels follow their 3D anchors; hidden when behind the camera.
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    const v = new THREE.Vector3();
    for (const lb of this.labels) {
      v.copy(lb.pos).project(this.camera);
      const behind = v.z > 1;
      lb.el.style.display = behind ? "none" : "";
      lb.el.style.transform = `translate(${((v.x + 1) / 2) * w}px, ${((1 - v.y) / 2) * h}px) translate(-50%, -100%)`;
    }
  };

  dispose() {
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.canvas.removeEventListener("pointermove", this.onMove);
    this.canvas.removeEventListener("click", this.onClick);
    this.controls.dispose();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose();
    });
    this.renderer.dispose();
  }
}
