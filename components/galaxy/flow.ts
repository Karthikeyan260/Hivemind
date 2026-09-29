import * as THREE from "three";
import { GPUComputationRenderer, type Variable } from "three/addons/misc/GPUComputationRenderer.js";

const MAX_TARGETS = 8;

// Curl noise: divergence-free swirl, so particles flow like smoke instead of jittering.
const CURL = /* glsl */ `
  vec3 hash3(vec3 p) {
    p = vec3(dot(p, vec3(127.1, 311.7, 74.7)), dot(p, vec3(269.5, 183.3, 246.1)), dot(p, vec3(113.5, 271.9, 124.6)));
    return -1.0 + 2.0 * fract(sin(p) * 43758.5453123);
  }
  float gnoise(vec3 p) {
    vec3 i = floor(p); vec3 f = fract(p); vec3 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(dot(hash3(i), f), dot(hash3(i + vec3(1,0,0)), f - vec3(1,0,0)), u.x),
                   mix(dot(hash3(i + vec3(0,1,0)), f - vec3(0,1,0)), dot(hash3(i + vec3(1,1,0)), f - vec3(1,1,0)), u.x), u.y),
               mix(mix(dot(hash3(i + vec3(0,0,1)), f - vec3(0,0,1)), dot(hash3(i + vec3(1,0,1)), f - vec3(1,0,1)), u.x),
                   mix(dot(hash3(i + vec3(0,1,1)), f - vec3(0,1,1)), dot(hash3(i + vec3(1,1,1)), f - vec3(1,1,1)), u.x), u.y), u.z);
  }
  vec3 curl(vec3 p) {
    const float e = 0.1;
    vec3 dx = vec3(e, 0, 0), dy = vec3(0, e, 0), dz = vec3(0, 0, e);
    vec3 a = vec3(gnoise(p + vec3(31.4, 0, 0)), gnoise(p + vec3(0, 47.2, 0)), gnoise(p + vec3(0, 0, 12.9)));
    float x = (gnoise(p + dy + vec3(0,0,12.9)) - gnoise(p - dy + vec3(0,0,12.9))) - (gnoise(p + dz + vec3(0,47.2,0)) - gnoise(p - dz + vec3(0,47.2,0)));
    float y = (gnoise(p + dz + vec3(31.4,0,0)) - gnoise(p - dz + vec3(31.4,0,0))) - (gnoise(p + dx + vec3(0,0,12.9)) - gnoise(p - dx + vec3(0,0,12.9)));
    float z = (gnoise(p + dx + vec3(0,47.2,0)) - gnoise(p - dx + vec3(0,47.2,0))) - (gnoise(p + dy + vec3(31.4,0,0)) - gnoise(p - dy + vec3(31.4,0,0)));
    return vec3(x, y, z) / (2.0 * e) + a * 0.0;
  }
  float rnd(vec2 co) { return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453); }
`;

const VELOCITY = /* glsl */ `
  uniform float uTime; uniform float uDelta; uniform float uEnergy;
  uniform vec3 uTargets[${MAX_TARGETS}]; uniform int uTargetCount; uniform float uAttract;
  uniform vec3 uMouse; uniform float uMouseOn;
  ${CURL}
  void main() {
    vec2 uv = gl_FragCoord.xy / resolution.xy;
    vec4 pos = texture2D(texturePosition, uv);
    vec3 vel = texture2D(textureVelocity, uv).xyz;
    vec3 p = pos.xyz;
    float r = length(p);

    // Galactic swirl around the core + curl turbulence; stronger while thinking.
    vec3 swirl = normalize(cross(vec3(0.0, 1.0, 0.0), p + 0.0001)) * (5.0 + uEnergy * 14.0) / (1.0 + r * 0.02);
    vec3 turb = curl(p * 0.018 + uTime * 0.05) * (5.0 + uEnergy * 10.0);
    vec3 hold = -p * (r > 120.0 ? 0.03 : 0.0);                  // keep the cloud bounded
    vec3 flatten = vec3(0.0, -p.y * 0.012, 0.0);                  // galaxy disc
    vec3 acc = swirl + turb + hold + flatten;

    // While answering, streams peel off toward the knowledge being used.
    if (uTargetCount > 0 && uAttract > 0.01) {
      int k = int(mod(floor(rnd(uv) * 97.0), float(uTargetCount)));
      vec3 t = uTargets[0];
      for (int i = 0; i < ${MAX_TARGETS}; i++) if (i == k) t = uTargets[i];
      vec3 d = t - p;
      float follow = step(0.55, rnd(uv * 3.1));                  // ~45% of particles join a stream
      acc += normalize(d) * 60.0 * uAttract * follow;
    }

    // The cursor pushes particles away.
    if (uMouseOn > 0.0) {
      vec3 m = p - uMouse;
      float md = length(m);
      acc += normalize(m + 0.0001) * uMouseOn * 900.0 / (1.0 + md * md * 0.6) ;
    }

    vel = vel * 0.94 + acc * uDelta;
    gl_FragColor = vec4(vel, 1.0);
  }
`;

const POSITION = /* glsl */ `
  uniform float uTime; uniform float uDelta;
  ${CURL}
  void main() {
    vec2 uv = gl_FragCoord.xy / resolution.xy;
    vec4 pos = texture2D(texturePosition, uv);
    vec3 vel = texture2D(textureVelocity, uv).xyz;
    float life = pos.w - uDelta * (0.05 + rnd(uv) * 0.08);
    vec3 p = pos.xyz + vel * uDelta;
    if (life <= 0.0) {
      // Respawn in a thick disc around the core.
      float a = rnd(uv + uTime) * 6.2831;
      float rr = 10.0 + pow(rnd(uv * 1.7 + uTime), 1.6) * 110.0;
      p = vec3(cos(a) * rr, (rnd(uv * 2.3 + uTime) - 0.5) * 10.0, sin(a) * rr);
      life = 1.0;
    }
    gl_FragColor = vec4(p, life);
  }
`;

const RENDER_VERT = /* glsl */ `
  uniform sampler2D uPos; uniform sampler2D uVel; uniform float uPixel; uniform float uSize;
  attribute vec2 ref;
  varying float vLife; varying float vSpeed;
  void main() {
    vec4 pos = texture2D(uPos, ref);
    vec3 vel = texture2D(uVel, ref).xyz;
    vLife = pos.w; vSpeed = length(vel);
    vec4 mv = modelViewMatrix * vec4(pos.xyz, 1.0);
    gl_PointSize = uSize * uPixel * (140.0 / -mv.z) * smoothstep(0.0, 0.15, pos.w);
    gl_Position = projectionMatrix * mv;
  }
`;
const RENDER_FRAG = /* glsl */ `
  uniform float uOpacity; uniform vec3 uCalm; uniform vec3 uHot;
  varying float vLife; varying float vSpeed;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c);
    float a = smoothstep(0.5, 0.0, d);
    vec3 col = mix(uCalm, uHot, clamp(vSpeed / 26.0, 0.0, 1.0));
    gl_FragColor = vec4(col, a * uOpacity * smoothstep(0.0, 0.25, vLife) * smoothstep(1.0, 0.85, vLife));
  }
`;

/** GPU particle flow: position/velocity live in float textures and are simulated in shaders. */
export class FlowField {
  readonly points: THREE.Points;
  private gpu: GPUComputationRenderer;
  private posVar: Variable;
  private velVar: Variable;
  private mat: THREE.ShaderMaterial;
  private targets = Array.from({ length: MAX_TARGETS }, () => new THREE.Vector3());
  private attract = 0;
  private attractTarget = 0;
  private mouseOn = 0;
  private mouseOnTarget = 0;

  constructor(renderer: THREE.WebGLRenderer, size: number, pixelRatio: number) {
    this.gpu = new GPUComputationRenderer(size, size, renderer);
    const pos0 = this.gpu.createTexture();
    const vel0 = this.gpu.createTexture();
    const p = pos0.image.data as Float32Array;
    for (let i = 0; i < p.length; i += 4) {
      const a = Math.random() * Math.PI * 2;
      const r = 10 + Math.pow(Math.random(), 1.6) * 110;
      p[i] = Math.cos(a) * r;
      p[i + 1] = (Math.random() - 0.5) * 10;
      p[i + 2] = Math.sin(a) * r;
      p[i + 3] = Math.random();
    }
    this.velVar = this.gpu.addVariable("textureVelocity", VELOCITY, vel0);
    this.posVar = this.gpu.addVariable("texturePosition", POSITION, pos0);
    this.gpu.setVariableDependencies(this.velVar, [this.posVar, this.velVar]);
    this.gpu.setVariableDependencies(this.posVar, [this.posVar, this.velVar]);
    Object.assign(this.velVar.material.uniforms, {
      uTime: { value: 0 },
      uDelta: { value: 0 },
      uEnergy: { value: 0 },
      uTargets: { value: this.targets },
      uTargetCount: { value: 0 },
      uAttract: { value: 0 },
      uMouse: { value: new THREE.Vector3(9999, 0, 0) },
      uMouseOn: { value: 0 },
    });
    Object.assign(this.posVar.material.uniforms, { uTime: { value: 0 }, uDelta: { value: 0 } });
    const err = this.gpu.init();
    if (err) throw new Error(err);

    const count = size * size;
    const ref = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) ref.set([(i % size + 0.5) / size, (Math.floor(i / size) + 0.5) / size], i * 2);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    g.setAttribute("ref", new THREE.BufferAttribute(ref, 2));
    this.mat = new THREE.ShaderMaterial({
      vertexShader: RENDER_VERT,
      fragmentShader: RENDER_FRAG,
      uniforms: {
        uPos: { value: null },
        uVel: { value: null },
        uPixel: { value: pixelRatio },
        uSize: { value: size > 160 ? 1.6 : 2.2 },
        uOpacity: { value: 0.5 },
        uCalm: { value: new THREE.Color("#5fb8d6") },
        uHot: { value: new THREE.Color("#ffc36b") },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
  }

  /** Points to stream toward (empty = free flow). */
  setTargets(list: THREE.Vector3[]) {
    list.slice(0, MAX_TARGETS).forEach((v, i) => this.targets[i].copy(v));
    this.velVar.material.uniforms.uTargetCount.value = Math.min(list.length, MAX_TARGETS);
    this.attractTarget = list.length ? 1 : 0;
  }

  updateTargets(list: THREE.Vector3[]) {
    list.slice(0, MAX_TARGETS).forEach((v, i) => this.targets[i].copy(v));
  }

  setMouse(world: THREE.Vector3 | null) {
    if (world) this.velVar.material.uniforms.uMouse.value.copy(world);
    this.mouseOnTarget = world ? 1 : 0;
  }

  update(dt: number, t: number, energy: number) {
    this.attract += (this.attractTarget - this.attract) * Math.min(1, dt * 2);
    this.mouseOn += (this.mouseOnTarget - this.mouseOn) * Math.min(1, dt * 6);
    const vu = this.velVar.material.uniforms;
    vu.uTime.value = t;
    vu.uDelta.value = dt;
    vu.uEnergy.value = energy;
    vu.uAttract.value = this.attract;
    vu.uMouseOn.value = this.mouseOn;
    const pu = this.posVar.material.uniforms;
    pu.uTime.value = t;
    pu.uDelta.value = dt;
    this.gpu.compute();
    this.mat.uniforms.uPos.value = this.gpu.getCurrentRenderTarget(this.posVar).texture;
    this.mat.uniforms.uVel.value = this.gpu.getCurrentRenderTarget(this.velVar).texture;
    this.mat.uniforms.uOpacity.value = 0.42 + energy * 0.35;
  }

  dispose() {
    this.gpu.dispose();
    this.points.geometry.dispose();
    this.mat.dispose();
  }
}
