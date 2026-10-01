import * as THREE from "three";

/**
 * Project Reel: real project screenshots on curved glass panels arranged around the viewer.
 * Drag / scroll / swipe spins the reel with inertia and snaps to the nearest project; panels bend
 * with scroll speed (vertex shader) and pick up a slight RGB split while moving (fragment shader).
 */
export type ReelItem = { id: string; name: string; image: string | null; accent: string; subtitle: string };

const VERT = /* glsl */ `
  uniform float uVel;
  uniform float uCurve;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vec3 p = position;
    // Bend the plane like a curved screen, more while it moves.
    p.z -= (p.x * p.x) * (uCurve + abs(uVel) * 0.35);
    // A wave that runs across the panel with the scroll speed.
    p.y += sin(uv.x * 3.14159) * uVel * 0.45;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

const FRAG = /* glsl */ `
  uniform sampler2D uTex;
  uniform float uVel;
  uniform float uFocus;
  uniform float uHover;
  uniform vec3 uAccent;
  uniform vec2 uSize;
  uniform float uReflect;
  varying vec2 vUv;
  float roundedBox(vec2 p, vec2 b, float r) {
    vec2 q = abs(p) - b + r;
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
  }
  void main() {
    // Rounded corners.
    vec2 p = (vUv - 0.5) * uSize;
    float d = roundedBox(p, uSize * 0.5, 0.06);
    if (d > 0.0) discard;
    // Slight RGB split while the reel is moving.
    float shift = uVel * 0.012;
    vec4 c = vec4(texture2D(uTex, vUv + vec2(shift, 0.0)).r, texture2D(uTex, vUv).g, texture2D(uTex, vUv - vec2(shift, 0.0)).b, 1.0);
    // Unfocused panels sink back: darker and cooler.
    vec3 col = mix(c.rgb * 0.28 + uAccent * 0.04, c.rgb, uFocus);
    // Glass: a soft diagonal sheen and an accent-coloured rim.
    float sheen = smoothstep(0.0, 0.35, 1.0 - abs(vUv.x - vUv.y * 0.6 - 0.15 - uHover * 0.2) * 3.0) * 0.08 * uFocus;
    float rim = smoothstep(-0.02, 0.0, d) * (0.45 + uFocus * 0.55);
    col += sheen + uAccent * rim;
    if (uReflect > 0.5) {
      // Mirror floor: the flipped copy fades out away from the panel's edge.
      float f = smoothstep(0.6, 0.0, vUv.y) * 0.2 * (0.35 + uFocus * 0.65);
      gl_FragColor = vec4(col * f, f);
    } else {
      gl_FragColor = vec4(col, 1.0);
    }
  }
`;

export class ReelScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
  private panels: { mesh: THREE.Mesh; mat: THREE.ShaderMaterial; item: ReelItem; reflection: THREE.Mesh; h: number }[] = [];
  private born = performance.now() / 1000;
  private look = new THREE.Vector3(0, -0.06, -1);
  private parallax = new THREE.Vector2();
  private pointer = new THREE.Vector2();
  private interacted = false;
  private glows: THREE.Sprite[] = [];
  private raf = 0;
  private ro: ResizeObserver;
  private scroll = 0;
  private target = 0;
  private vel = 0;
  private drag: { x: number; start: number; moved: boolean } | null = null;
  private hovered = -1;
  private active = -1;
  private spacing = 0.5; // radians between panels
  private radius = 9;
  private reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  private ray = new THREE.Raycaster();
  private mouse = new THREE.Vector2();
  private dust: THREE.Points;

  constructor(
    private canvas: HTMLCanvasElement,
    private items: ReelItem[],
    private cb: { onActive: (i: number) => void; onOpen: (i: number) => void; onSnap?: () => void; onInput?: () => void },
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    // Level gaze, slightly above the panels so the title area below stays clear.
    this.camera.position.set(0, 0, 0);
    this.camera.lookAt(0, -0.06, -1);

    const loader = new THREE.TextureLoader();
    items.forEach((it, i) => {
      const tex = it.image ? loader.load(it.image) : this.poster(it);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 4;
      const w = 4.6;
      const h = w * 0.625;
      const mat = new THREE.ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        uniforms: {
          uTex: { value: tex },
          uVel: { value: 0 },
          uCurve: { value: 0.035 },
          uFocus: { value: 0 },
          uHover: { value: 0 },
          uAccent: { value: new THREE.Color(it.accent) },
          uSize: { value: new THREE.Vector2(1, h / w) },
          uReflect: { value: 0 },
        },
      });
      const geo = new THREE.PlaneGeometry(w, h, 40, 20);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.userData.index = i;
      this.scene.add(mesh);
      // Its reflection: same uniforms (so it follows focus/speed), drawn flipped and faded.
      const refMat = new THREE.ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        uniforms: { ...mat.uniforms, uReflect: { value: 1 } },
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const reflection = new THREE.Mesh(geo, refMat);
      this.scene.add(reflection);
      this.panels.push({ mesh, mat, item: it, reflection, h });
      // An accent glow behind each panel, strongest on the active one.
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTexture(), color: it.accent, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
      glow.scale.set(w * 1.9, h * 2.1, 1);
      this.scene.add(glow);
      this.glows.push(glow);
    });

    // Floating dust for depth.
    const n = 700;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 3 + Math.random() * 12;
      pos[i * 3] = Math.cos(a) * r;
      pos[i * 3 + 1] = (Math.random() - 0.5) * 7;
      pos[i * 3 + 2] = Math.sin(a) * r;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    this.dust = new THREE.Points(g, new THREE.PointsMaterial({ color: 0x9fd4e6, size: 0.025, transparent: true, opacity: 0.55, depthWrite: false }));
    this.scene.add(this.dust);

    canvas.addEventListener("pointerdown", this.onDown);
    addEventListener("pointermove", this.onMove);
    addEventListener("pointerup", this.onUp);
    canvas.addEventListener("wheel", this.onWheel, { passive: false });
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas.parentElement!);
    this.resize();
    this.loop();
  }

  /** For projects without a screenshot: a designed poster in the app's style. */
  private poster(it: ReelItem) {
    const c = document.createElement("canvas");
    c.width = 1280;
    c.height = 800;
    const g = c.getContext("2d")!;
    const grd = g.createLinearGradient(0, 0, 1280, 800);
    grd.addColorStop(0, "#0b1220");
    grd.addColorStop(1, "#05080d");
    g.fillStyle = grd;
    g.fillRect(0, 0, 1280, 800);
    g.strokeStyle = `${it.accent}22`;
    g.lineWidth = 1;
    for (let x = 0; x < 1280; x += 48) {
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x, 800);
      g.stroke();
    }
    for (let y = 0; y < 800; y += 48) {
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(1280, y);
      g.stroke();
    }
    const halo = g.createRadialGradient(900, 260, 0, 900, 260, 520);
    halo.addColorStop(0, `${it.accent}66`);
    halo.addColorStop(1, "transparent");
    g.fillStyle = halo;
    g.fillRect(0, 0, 1280, 800);
    g.fillStyle = it.accent;
    g.font = "600 30px monospace";
    g.fillText(it.subtitle.toUpperCase(), 90, 330);
    g.fillStyle = "#e9f1f7";
    g.font = "800 104px system-ui, sans-serif";
    const words = it.name.split(" ");
    let line = "";
    let y = 450;
    for (const w of words) {
      if (g.measureText(`${line} ${w}`).width > 1080 && line) {
        g.fillText(line.trim(), 90, y);
        line = "";
        y += 112;
      }
      line += ` ${w}`;
    }
    g.fillText(line.trim(), 90, y);
    return new THREE.CanvasTexture(c);
  }

  private glowTexture() {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const g = c.getContext("2d")!;
    const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, "rgba(255,255,255,0.9)");
    grd.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grd;
    g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  }

  /** Jump to a project (index), e.g. from the dots or the keyboard. */
  goTo(i: number) {
    this.interacted = true;
    this.target = Math.max(0, Math.min(this.items.length - 1, i));
  }
  next(d: number) {
    this.goTo(Math.round(this.target) + d);
  }

  private onDown = (e: PointerEvent) => {
    this.interacted = true;
    this.cb.onInput?.();
    this.drag = { x: e.clientX, start: this.target, moved: false };
    this.canvas.setPointerCapture?.(e.pointerId);
  };
  private onMove = (e: PointerEvent) => {
    const r = this.canvas.getBoundingClientRect();
    if (this.drag) {
      const dx = e.clientX - this.drag.x;
      if (Math.abs(dx) > 4) this.drag.moved = true;
      this.target = this.drag.start - dx / (r.width * 0.32);
      return;
    }
    this.mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.pointer.copy(this.mouse);
    this.ray.setFromCamera(this.mouse, this.camera);
    const hit = this.ray.intersectObjects(this.panels.map((p) => p.mesh))[0];
    this.hovered = hit ? (hit.object.userData.index as number) : -1;
    this.canvas.style.cursor = this.hovered >= 0 ? "pointer" : "grab";
  };
  private onUp = (e: PointerEvent) => {
    if (!this.drag) return;
    const moved = this.drag.moved;
    this.drag = null;
    this.target = Math.round(this.target);
    if (moved) return;
    // A tap: open the project under the finger (or move to it if it's off to the side).
    const r = this.canvas.getBoundingClientRect();
    this.mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(this.mouse, this.camera);
    const hit = this.ray.intersectObjects(this.panels.map((p) => p.mesh))[0];
    if (!hit) return;
    const i = hit.object.userData.index as number;
    if (i === this.active) this.cb.onOpen(i);
    else this.goTo(i);
  };
  private wheelTimer: ReturnType<typeof setTimeout> | null = null;
  private onWheel = (e: WheelEvent) => {
    // Horizontal or vertical wheel spins the reel; let the page scroll at the ends.
    const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    const atEnd = (d < 0 && this.target <= 0) || (d > 0 && this.target >= this.items.length - 1);
    if (atEnd) return;
    e.preventDefault();
    this.interacted = true;
    this.cb.onInput?.();
    this.target = Math.max(-0.3, Math.min(this.items.length - 0.7, this.target + d * 0.004));
    if (this.wheelTimer) clearTimeout(this.wheelTimer);
    this.wheelTimer = setTimeout(() => (this.target = Math.round(this.target)), 160);
  };

  private resize() {
    const el = this.canvas.parentElement!;
    const w = el.clientWidth;
    const h = el.clientHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(1, h);
    // Narrow screens: panels closer together and nearer, so one fills the view.
    const portrait = this.camera.aspect < 1;
    this.radius = portrait ? 6.4 : 9;
    this.spacing = portrait ? 0.78 : 0.5;
    this.camera.fov = portrait ? 62 : 42;
    // Wide screens: look a little left so the front project sits on the right and the text on the left.
    this.camera.position.set(0, 0, 0);
    this.look.set(portrait ? 0 : -0.27, portrait ? -0.06 : -0.02, -1);
    this.camera.lookAt(this.look);
    this.camera.updateProjectionMatrix();
  }

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    const prev = this.scroll;
    this.scroll += (this.target - this.scroll) * (this.reduced ? 1 : 0.085);
    this.vel += (this.scroll - prev - this.vel) * 0.25;
    const v = this.reduced ? 0 : THREE.MathUtils.clamp(this.vel * 9, -1.2, 1.2);
    const t = performance.now() / 1000;

    const nearest = Math.round(THREE.MathUtils.clamp(this.scroll, 0, this.items.length - 1));
    if (nearest !== this.active) {
      const first = this.active < 0;
      this.active = nearest;
      this.cb.onActive(nearest);
      if (!first && this.interacted) this.cb.onSnap?.();
    }
    // Parallax: the view leans gently toward the pointer.
    if (!this.reduced) {
      this.parallax.lerp(this.drag ? new THREE.Vector2() : this.pointer, 0.04);
      this.camera.lookAt(this.look.x + this.parallax.x * 0.06, this.look.y + this.parallax.y * 0.035, -1);
    }

    this.panels.forEach(({ mesh, mat, reflection, h }, i) => {
      // Intro: panels fly in from deep space, one after another.
      const k = this.reduced ? 1 : THREE.MathUtils.clamp((t - this.born - 0.15 - Math.abs(i - this.scroll) * 0.09) / 1.1, 0, 1);
      const intro = 1 - Math.pow(1 - k, 3);
      const a = (i - this.scroll) * this.spacing + (1 - intro) * 0.5;
      const rad = this.radius * (1 + (1 - intro) * 2.2);
      const x = Math.sin(a) * rad;
      const z = -Math.cos(a) * rad;
      const focus = Math.max(0, 1 - Math.abs(i - this.scroll) * 1.4);
      const float = Math.sin(t * 0.8 + i) * 0.05;
      mesh.position.set(x, float + (this.camera.aspect < 1 ? 0.55 : 0.15), z);
      mesh.rotation.y = -a;
      // Phones: smaller panels so the front one fits the width with a little room.
      const fit = this.camera.aspect < 1 ? Math.min(1, this.camera.aspect * 1.45) : 1;
      const sc = (0.86 + focus * 0.22 + (this.hovered === i ? 0.03 : 0)) * fit * (0.4 + intro * 0.6);
      mesh.scale.setScalar(sc);
      // Wide screens keep the left side for the story: projects already passed slip out of view.
      mesh.visible = this.camera.aspect < 1 ? Math.abs(a) < 1.9 : a > -this.spacing * 0.55 && a < 1.9;
      reflection.visible = mesh.visible;
      reflection.position.set(x, mesh.position.y - h * sc - 0.06, z);
      reflection.rotation.y = mesh.rotation.y;
      reflection.scale.set(sc, -sc, sc);
      mat.uniforms.uVel.value = v;
      mat.uniforms.uFocus.value = 0.12 + focus * 0.88;
      mat.uniforms.uHover.value += ((this.hovered === i ? 1 : 0) - mat.uniforms.uHover.value) * 0.1;
      const glow = this.glows[i];
      glow.position.set(x * 1.04, mesh.position.y, z * 1.04);
      glow.visible = mesh.visible;
      (glow.material as THREE.SpriteMaterial).opacity = focus * 0.22;
    });
    this.dust.rotation.y = this.scroll * -0.12 + t * 0.01;
    this.renderer.render(this.scene, this.camera);
  };

  dispose() {
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.canvas.removeEventListener("pointerdown", this.onDown);
    removeEventListener("pointermove", this.onMove);
    removeEventListener("pointerup", this.onUp);
    this.canvas.removeEventListener("wheel", this.onWheel);
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      const mat = m.material as THREE.Material | undefined;
      mat?.dispose?.();
    });
    this.renderer.dispose();
  }
}
