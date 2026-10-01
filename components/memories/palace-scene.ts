import * as THREE from "three";
import { Reflector } from "three/addons/objects/Reflector.js";
import {
  BlendFunction,
  BloomEffect,
  ChromaticAberrationEffect,
  Effect,
  EffectComposer,
  EffectPass,
  KernelSize,
  NoiseEffect,
  RenderPass,
  SMAAEffect,
  SMAAPreset,
  ToneMappingEffect,
  ToneMappingMode,
  VignetteEffect,
} from "postprocessing";

/** Night-museum grade: cool shadows, warm highlights, blacks lifted a hair so nothing is crushed. */
class GradeEffect extends Effect {
  constructor() {
    super(
      "PalaceGrade",
      /* glsl */ `
      void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
        vec3 c = inputColor.rgb;
        float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
        c += vec3(-0.002, 0.0, 0.004) * (1.0 - smoothstep(0.0, 0.05, l));
        c += vec3(0.02, 0.008, -0.008) * smoothstep(0.3, 1.0, l);
        c = mix(vec3(l), c, 0.93);
        c = max(c, vec3(0.0022, 0.0024, 0.003));
        outputColor = vec4(c, inputColor.a);
      }`,
      { blendFunction: BlendFunction.NORMAL },
    );
  }
}

/**
 * Memory Palace: a night museum you walk through yourself. A domed rotunda (hub) with five
 * glowing doorways, one gallery wing per kind of memory; each memory hangs as a lit frame.
 * The only scripted camera motion is the short step up to a frame the owner clicked.
 */

export type PalaceItem = { id: string; title: string; snippet: string; memory_type: string; importance: number; updated_at: string; source: string };
export type Wing = { id: string; name: string; tagline: string; types: string[]; color: string; empty: string };

export const WINGS: Wing[] = [
  { id: "knowledge", name: "Hall of Knowledge", tagline: "Facts, knowledge and what you learned", types: ["knowledge", "fact", "learning"], color: "#7fd1ff", empty: "No knowledge saved yet." },
  { id: "experience", name: "Hall of Experience", tagline: "What you lived through and decided", types: ["experience", "decision"], color: "#f2c46d", empty: "No experiences saved yet." },
  { id: "projects", name: "Project Archive", tagline: "Context from your projects", types: ["project_context"], color: "#5fe0a0", empty: "No project context yet." },
  { id: "ideas", name: "Idea Studio", tagline: "Sparks worth keeping", types: ["idea"], color: "#b48cff", empty: "No ideas yet. Tell HIVEMIND “remember my idea …”." },
  { id: "self", name: "The Self", tagline: "Your preferences and ways of working", types: ["preference"], color: "#ff8fb1", empty: "No preferences yet. Tell HIVEMIND “remember I prefer …”." },
];
export const wingOf = (type: string) => WINGS.find((w) => w.types.includes(type)) ?? WINGS[0];

// World units are metres.
export const HUB_R = 9;
const WALL_H = 7;
const DOOR_W = 3.6;
const DOOR_H = 4.4;
const HALL_W = 7;
const HALL_H = 6;
const EYE = 1.65;
const SPACING = 3.4;
const FIRST = 3.2; // distance from the doorway to the first pair of frames
const FOG = new THREE.Color("#06080d");
const FOG_DENSITY = 0.03;

export type WingLayout = { wing: Wing; angle: number; length: number; items: PalaceItem[] };
export type Zone = { kind: "hub" } | { kind: "wing"; index: number };
export type Callbacks = {
  onOpen: (id: string) => void;
  onMove: (x: number, z: number, yaw: number, zone: Zone) => void;
  onHover?: (id: string | null) => void;
  /** The visitor walked away from the open memory (or set off somewhere else): close its panel. */
  onClose?: () => void;
};

/* ───── shaders ───── */

const FOG_GLSL = /* glsl */ `
uniform vec3 uFogColor; uniform float uFogDensity;
vec3 applyFog(vec3 c, float depth) { float f = 1.0 - exp(-uFogDensity * uFogDensity * depth * depth); return mix(c, uFogColor, clamp(f, 0.0, 1.0)); }
// Height fog: thicker near the floor, so the far end of a hall sinks into a low haze.
vec3 applyFogH(vec3 c, float depth, float y) {
  float d = uFogDensity * (1.0 + 0.9 * exp(-max(y, 0.0) * 0.55));
  float f = 1.0 - exp(-d * d * depth * depth);
  return mix(c, uFogColor, clamp(f, 0.0, 1.0));
}`;

const NOISE_GLSL = /* glsl */ `
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y); }
float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }`;

const OUTPUT = "\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n";

const fogUniforms = () => ({ uFogColor: { value: FOG.clone() }, uFogDensity: { value: FOG_DENSITY } });

/** Reflective marble floor with gold inlay rings in the rotunda. Used by Reflector (high) or plain (low). */
const FLOOR_SHADER = {
  name: "PalaceFloor",
  uniforms: {
    color: { value: null as THREE.Color | null },
    tDiffuse: { value: null as THREE.Texture | null },
    textureMatrix: { value: null as THREE.Matrix4 | null },
    uReflect: { value: 0.0 },
    uRing: { value: 1.0 },
    uTexel: { value: new THREE.Vector2(1 / 512, 1 / 512) },
    ...fogUniforms(),
  },
  vertexShader: /* glsl */ `
    uniform mat4 textureMatrix;
    varying vec4 vUv; varying vec3 vWorld; varying float vDepth;
    void main() {
      vUv = textureMatrix * vec4(position, 1.0);
      vec4 w = modelMatrix * vec4(position, 1.0); vWorld = w.xyz;
      vec4 mv = viewMatrix * w; vDepth = -mv.z;
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float uReflect; uniform vec2 uTexel; uniform float uRing;
    varying vec4 vUv; varying vec3 vWorld; varying float vDepth;
    ${FOG_GLSL}
    ${NOISE_GLSL}
    void main() {
      vec2 p = vWorld.xz;
      // Marble: warped fbm gives soft veins.
      float w = fbm(p * 0.18 + fbm(p * 0.35) * 1.6);
      float veins = smoothstep(0.42, 0.5, w) * (1.0 - smoothstep(0.5, 0.6, w));
      vec3 col = mix(vec3(0.012, 0.014, 0.02), vec3(0.03, 0.033, 0.042), w);
      col += vec3(0.16, 0.17, 0.2) * veins * 0.18;
      // Rotunda inlay: thin gold rings and spokes toward the doorways.
      float r = length(p);
      if (r < ${HUB_R.toFixed(1)}) {
        float ring = 0.0;
        ring += 1.0 - smoothstep(0.0, 0.035, abs(r - 2.6));
        ring += 1.0 - smoothstep(0.0, 0.035, abs(r - 6.4));
        ring += (1.0 - smoothstep(0.0, 0.05, abs(r - 8.6))) * 0.7;
        float a = atan(p.x, p.y) / 6.28318 * 5.0;
        float spoke = (1.0 - smoothstep(0.0, 0.02, abs(fract(a + 0.5) - 0.5) * r * 0.2)) * step(2.6, r) * step(r, 6.4);
        // uRing 0→1 when the palace wakes: the inlay lights from the centre outward.
        float wake = smoothstep(r - 1.5, r, uRing * 10.5);
        col += vec3(0.85, 0.66, 0.33) * (ring + spoke * 0.6) * 0.32 * wake;
      }
      // Gallery halls: large stone tiles laid along each wing (2 mm seams every 1.2 m).
      float seam = 0.0;
      if (r > ${(HUB_R - 0.2).toFixed(1)}) {
        float th = atan(-p.x, -p.y);
        float wa = floor(th / 1.256637 + 0.5) * 1.256637;
        vec2 lp = vec2(p.x * cos(wa) - p.y * sin(wa), -(p.x * sin(wa) + p.y * cos(wa)));
        vec2 ds = (0.5 - abs(fract(lp / 1.2) - 0.5)) * 1.2;
        seam = 1.0 - smoothstep(0.0, 0.01, min(ds.x, ds.y));
        col *= 1.0 - 0.55 * seam;
      }
      // Blurred planar reflection (13 taps), slightly warped by the veins. Polished stone reflects
      // weakly looking down and strongly at grazing angles (fresnel).
      if (uReflect > 0.0) {
        vec2 uv = vUv.xy / vUv.w + (w - 0.5) * 0.004;
        vec3 refl = vec3(0.0); float tot = 0.0;
        for (int x = -2; x <= 2; x++) for (int y = -2; y <= 2; y++) {
          if (abs(float(x)) + abs(float(y)) > 3.0) continue;
          float k = 1.0 / (1.0 + float(x * x + y * y));
          refl += texture2D(tDiffuse, uv + vec2(float(x), float(y)) * uTexel * 2.2).rgb * k; tot += k;
        }
        float ndv = abs(normalize(cameraPosition - vWorld).y);
        float fres = mix(0.12, 1.0, pow(1.0 - ndv, 3.0));
        col += refl / tot * uReflect * fres * (0.8 + 0.2 * w) * (1.0 - seam);
      }
      gl_FragColor = vec4(applyFogH(col, vDepth, 0.0), 1.0); ${OUTPUT}
    }`,
};

/** Dark stone walls: soft floor occlusion and a coloured cove wash near the top (Turrell-style). */
function wallMaterial(tint: THREE.Color, height: number, cove = 0.55, side: THREE.Side = THREE.FrontSide) {
  return new THREE.ShaderMaterial({
    side,
    uniforms: { uTint: { value: tint.clone() }, uHeight: { value: height }, uCove: { value: cove }, ...fogUniforms() },
    vertexShader: /* glsl */ `
      varying vec3 vWorld; varying float vDepth;
      void main() { vec4 w = modelMatrix * vec4(position, 1.0); vWorld = w.xyz; vec4 mv = viewMatrix * w; vDepth = -mv.z; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uTint; uniform float uHeight; uniform float uCove;
      varying vec3 vWorld; varying float vDepth;
      ${FOG_GLSL}
      ${NOISE_GLSL}
      void main() {
        float h = clamp(vWorld.y / uHeight, 0.0, 1.0);
        vec3 c = vec3(0.014, 0.016, 0.022) * (0.4 + 0.6 * smoothstep(0.0, 0.3, h));
        c += uTint * pow(h, 6.0) * uCove * 0.3;
        c += uTint * 0.015 * (1.0 - smoothstep(0.0, 0.06, h));
        c += (noise(vWorld.xz * 9.0 + vWorld.y * 7.0) - 0.5) * 0.004;
        gl_FragColor = vec4(applyFog(c, vDepth), 1.0); ${OUTPUT}
      }`,
  });
}

/**
 * The long side walls of a gallery wing, lit like a real museum: a wall-washer "scallop" of warm
 * light above every frame bay, soft occlusion at the floor and ceiling, shadow-gap reveals between
 * bays, a hot cove strip near the top, and a recessed LED line at the floor with light pulses
 * travelling along it. uWake (0→1) switches the wing's lights on.
 */
function galleryWallMaterial(tint: THREE.Color, angle: number, pairs: number, time: { value: number }) {
  return new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    uniforms: {
      uTint: { value: tint.clone() },
      uSin: { value: Math.sin(angle) },
      uCos: { value: Math.cos(angle) },
      uFirst: { value: HUB_R + FIRST },
      uSpacing: { value: SPACING },
      uPairs: { value: pairs },
      uWake: { value: 0 },
      uTime: time,
      ...fogUniforms(),
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorld; varying float vDepth;
      void main() { vec4 w = modelMatrix * vec4(position, 1.0); vWorld = w.xyz; vec4 mv = viewMatrix * w; vDepth = -mv.z; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uTint; uniform float uSin; uniform float uCos; uniform float uFirst; uniform float uSpacing;
      uniform float uPairs; uniform float uWake; uniform float uTime;
      varying vec3 vWorld; varying float vDepth;
      ${FOG_GLSL}
      ${NOISE_GLSL}
      void main() {
        float H = ${HALL_H.toFixed(1)};
        float y = vWorld.y;
        float r = -(vWorld.x * uSin + vWorld.z * uCos); // distance from the rotunda centre along the wing

        // Occlusion where wall meets floor and ceiling, and on both sides of every bay gap.
        float ao = mix(0.45, 1.0, smoothstep(0.0, 0.8, y)) * mix(0.55, 1.0, smoothstep(0.0, 0.6, H - y));
        float bay = (r - (uFirst - uSpacing * 0.5)) / uSpacing;
        float bd = abs(bay - floor(bay + 0.5)) * uSpacing;
        ao *= mix(0.6, 1.0, smoothstep(0.0, 0.5, bd));
        vec3 c = vec3(0.009, 0.010, 0.014) * ao;
        c += (noise(vec2(r * 6.0, y * 6.0)) - 0.5) * 0.003;

        // Wall-washer scallop over the nearest frame: bright cusp under the ceiling, a soft V below.
        float k = clamp(floor((r - uFirst) / uSpacing + 0.5), 0.0, max(uPairs - 1.0, 0.0));
        float dx = r - (uFirst + k * uSpacing);
        float dy = H - y;
        float sr = length(vec2(dx * 1.9, dy * 0.95 - 0.3 * dx * dx));
        float scallop = pow(1.0 - smoothstep(0.0, 2.1, sr), 1.6) * smoothstep(0.0, 0.3, dy) * step(0.5, uPairs);
        c += (vec3(1.0, 0.84, 0.64) * 0.036 + uTint * 0.016) * scallop * uWake;

        // Reveals: skirting groove, cove groove, and the dark shadow gap between bays.
        float groove = max(1.0 - smoothstep(0.0, 0.014, abs(y - 0.15)), 1.0 - smoothstep(0.0, 0.014, abs(y - (H - 0.6))));
        c *= 1.0 - 0.7 * groove;
        c *= 1.0 - 0.9 * (1.0 - smoothstep(0.035, 0.055, bd));

        // Cove strip: hot core with a short spill below it.
        float hc = H - 0.38;
        c += uTint * (exp(-abs(y - hc) * 55.0) * 1.5 + exp(-max(hc - y, 0.0) * 2.2) * step(y, hc) * 0.045) * (0.15 + 0.85 * uWake);

        // Floor LED line, with a pulse of light running down the hall every few seconds.
        float led = exp(-abs(y - 0.07) * 110.0);
        float ph = fract((r - uTime * 2.2) / 15.0);
        float pq = (ph - 0.5) * 15.0;
        float pulse = exp(-pq * pq * 0.7);
        c += uTint * led * (0.9 + 1.3 * pulse * uWake) * (0.25 + 0.75 * uWake);

        gl_FragColor = vec4(applyFogH(c, vDepth, y), 1.0); ${OUTPUT}
      }`,
  });
}

/**
 * The rotunda's curved wall, lit like the wings: a warm wall-washer scallop behind each plinth,
 * occlusion at floor and top, reveals, a gold cove line under the dome and a floor LED line with
 * light pulses circling the room. uPower fades it all in when the palace wakes.
 */
function rotundaWallMaterial(time: { value: number }) {
  return new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    uniforms: { uPower: { value: 0 }, uTime: time, ...fogUniforms() },
    vertexShader: /* glsl */ `
      varying vec3 vWorld; varying float vDepth;
      void main() { vec4 w = modelMatrix * vec4(position, 1.0); vWorld = w.xyz; vec4 mv = viewMatrix * w; vDepth = -mv.z; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */ `
      uniform float uPower; uniform float uTime;
      varying vec3 vWorld; varying float vDepth;
      ${FOG_GLSL}
      ${NOISE_GLSL}
      void main() {
        float H = ${WALL_H.toFixed(1)};
        float R = ${HUB_R.toFixed(1)};
        float y = vWorld.y;
        vec3 gold = vec3(1.0, 0.78, 0.45);
        // Arc distance from the nearest plinth (plinths stand midway between doorways).
        float th = atan(vWorld.x, vWorld.z);
        float u = th - 3.14159265 - 0.6283185;
        float dth = u - 1.2566371 * floor(u / 1.2566371 + 0.5);
        float dx = dth * R;
        float ao = mix(0.45, 1.0, smoothstep(0.0, 0.9, y)) * mix(0.6, 1.0, smoothstep(0.0, 0.7, H - y));
        vec3 c = vec3(0.011, 0.011, 0.013) * ao;
        c += (noise(vec2(th * 40.0, y * 6.0)) - 0.5) * 0.003;
        // Warm scallop on the wall behind each plinth.
        float dy = H - y;
        float sr = length(vec2(dx * 1.3, dy * 0.75 - 0.18 * dx * dx));
        float scallop = pow(1.0 - smoothstep(0.0, 3.2, sr), 1.6) * smoothstep(0.0, 0.4, dy);
        c += vec3(1.0, 0.84, 0.64) * 0.085 * scallop * uPower;
        // Reveals at the skirting and under the cornice.
        float groove = max(1.0 - smoothstep(0.0, 0.016, abs(y - 0.16)), 1.0 - smoothstep(0.0, 0.016, abs(y - (H - 0.7))));
        c *= 1.0 - 0.7 * groove;
        // Gold cove line under the dome, with a soft spill.
        float hc = H - 0.42;
        c += gold * (exp(-abs(y - hc) * 50.0) * 1.3 + exp(-max(hc - y, 0.0) * 2.0) * step(y, hc) * 0.04) * uPower;
        // Floor LED line with pulses circling the room.
        float led = exp(-abs(y - 0.07) * 110.0);
        float ph = fract((th * R - uTime * 2.0) / 14.0);
        float pq = (ph - 0.5) * 14.0;
        c += gold * led * (0.7 + 1.1 * exp(-pq * pq * 0.7)) * uPower;
        gl_FragColor = vec4(applyFogH(c, vDepth, y), 1.0); ${OUTPUT}
      }`,
  });
}

/** Lit surfaces that need the view direction: slim bay fins (rim-lit) and ceiling ribs (lit by the slit). */
function archMaterial(tint: THREE.Color, kind: "fin" | "rib", angle: number) {
  return new THREE.ShaderMaterial({
    uniforms: { uTint: { value: tint.clone() }, uSin: { value: Math.sin(angle) }, uCos: { value: Math.cos(angle) }, uWake: { value: 0 }, ...fogUniforms() },
    vertexShader: /* glsl */ `
      varying vec3 vWorld; varying vec3 vN; varying float vDepth;
      void main() { vec4 w = modelMatrix * vec4(position, 1.0); vWorld = w.xyz; vN = normalize(mat3(modelMatrix) * normal); vec4 mv = viewMatrix * w; vDepth = -mv.z; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uTint; uniform float uSin; uniform float uCos; uniform float uWake;
      varying vec3 vWorld; varying vec3 vN; varying float vDepth;
      ${FOG_GLSL}
      void main() {
        vec3 N = normalize(vN);
        vec3 V = normalize(cameraPosition - vWorld);
        float H = ${HALL_H.toFixed(1)};
        vec3 c;
        ${
          kind === "fin"
            ? `float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0);
               float up = smoothstep(0.0, H, vWorld.y);
               c = vec3(0.007, 0.008, 0.011) * mix(0.5, 1.0, smoothstep(0.0, 0.8, vWorld.y));
               c += uTint * fres * (0.12 + 0.3 * up) * (0.3 + 0.7 * uWake);`
            : `float s = vWorld.x * uCos - vWorld.z * uSin; // sideways from the slit
               float under = smoothstep(-0.2, -0.9, N.y);
               c = vec3(0.01, 0.011, 0.015) + uTint * exp(-abs(s) * 1.25) * (0.05 + 0.22 * under) * (0.2 + 0.8 * uWake);`
        }
        gl_FragColor = vec4(applyFogH(c, vDepth, vWorld.y), 1.0); ${OUTPUT}
      }`,
  });
}

/** Shared uniform: a phase driven by where the visitor stands, so card glass glints as you walk. */
const CAM_PHASE = { value: 0 };

/**
 * A memory card behind glass: the drawn card, a soft inner-edge shadow, a lit top lip, fresnel glass,
 * a glint band that moves with the visitor, and a one-shot sheen sweep on hover (uSweep 0→1).
 */
function cardMaterial(map: THREE.Texture) {
  return new THREE.ShaderMaterial({
    uniforms: { map: { value: map }, uLevel: { value: 0 }, uSweep: { value: 0 }, uPhase: CAM_PHASE, ...fogUniforms() },
    vertexShader: /* glsl */ `
      varying vec2 vUv; varying vec3 vWorld; varying vec3 vN; varying float vDepth;
      void main() { vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vWorld = w.xyz; vN = normalize(mat3(modelMatrix) * normal); vec4 mv = viewMatrix * w; vDepth = -mv.z; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D map; uniform float uLevel; uniform float uSweep; uniform float uPhase;
      varying vec2 vUv; varying vec3 vWorld; varying vec3 vN; varying float vDepth;
      ${FOG_GLSL}
      void main() {
        vec3 c = texture2D(map, vUv).rgb * uLevel;
        float d = min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y));
        c *= mix(0.5, 1.0, smoothstep(0.0, 0.05, d));
        c += vec3(0.9, 0.85, 0.75) * 0.22 * (1.0 - smoothstep(0.0, 0.006, 1.0 - vUv.y)) * uLevel;
        float ndv = clamp(dot(normalize(vN), normalize(cameraPosition - vWorld)), 0.0, 1.0);
        float F = 0.04 + 0.96 * pow(1.0 - ndv, 5.0);
        float diag = dot(vUv, vec2(0.857, 0.514));
        float b1 = (diag - fract(uPhase) * 1.8 + 0.4) * 9.0;
        float band = exp(-b1 * b1) * 0.05;
        float b2 = (diag - (uSweep * 2.0 - 0.45)) * 8.0;
        float sweep = exp(-b2 * b2) * 0.3 * step(0.001, uSweep) * step(uSweep, 0.999);
        c += vec3(0.85, 0.9, 1.0) * (F * 0.18 + band + sweep) * max(uLevel, 0.25);
        gl_FragColor = vec4(applyFog(c, vDepth), 1.0); ${OUTPUT}
      }`,
  });
}

/** Frame moulding with a metallic glint from the picture light above and a soft rim. */
function metalMaterial(color: THREE.Color) {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: color.clone() }, uLevel: { value: 0 }, ...fogUniforms() },
    vertexShader: /* glsl */ `
      varying vec3 vWorld; varying vec3 vN; varying float vDepth;
      void main() { vec4 w = modelMatrix * vec4(position, 1.0); vWorld = w.xyz; vN = normalize(mat3(modelMatrix) * normal); vec4 mv = viewMatrix * w; vDepth = -mv.z; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform float uLevel;
      varying vec3 vWorld; varying vec3 vN; varying float vDepth;
      ${FOG_GLSL}
      void main() {
        vec3 N = normalize(vN);
        vec3 V = normalize(cameraPosition - vWorld);
        vec3 L = normalize(vec3(0.0, 1.0, 0.0) + V * 0.6);
        float spec = pow(max(dot(reflect(-L, N), V), 0.0), 24.0);
        float fres = pow(1.0 - max(dot(N, V), 0.0), 2.0);
        vec3 c = uColor * uLevel * (0.55 + 0.45 * max(N.y, 0.0)) + vec3(1.0, 0.9, 0.72) * spec * 0.55 * uLevel + uColor * fres * 0.25 * uLevel;
        gl_FragColor = vec4(applyFog(c, vDepth), 1.0); ${OUTPUT}
      }`,
  });
}

/**
 * Additive soft glow: radial pool (frames, floor), a light veil across a doorway, a volumetric ray,
 * or a thin ring (open pulse, walk marker). uPower fades it in when the palace wakes; uRipple is the
 * time since someone walked through a veil.
 */
function glowMaterial(color: THREE.Color, opacity: number, mode: "radial" | "veil" | "ray" | "ring" | "scallop") {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: { uColor: { value: color.clone() }, uOpacity: { value: opacity }, uTime: { value: 0 }, uPower: { value: 1 }, uRipple: { value: 99 } },
    vertexShader: /* glsl */ `
      varying vec2 vUv; varying vec3 vN; varying vec3 vView;
      void main() { vUv = uv; vec4 mv = modelViewMatrix * vec4(position, 1.0); vView = normalize(-mv.xyz); vN = normalize(normalMatrix * normal); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform float uOpacity; uniform float uTime; uniform float uPower; uniform float uRipple;
      varying vec2 vUv; varying vec3 vN; varying vec3 vView;
      ${NOISE_GLSL}
      void main() {
        float a;
        ${
          mode === "radial"
            ? "vec2 d = vUv - 0.5; a = pow(max(0.0, 1.0 - length(d) * 2.0), 2.2);"
            : mode === "veil"
              ? `float edge = smoothstep(0.0, 0.25, vUv.x) * smoothstep(1.0, 0.75, vUv.x); a = (0.35 + 0.65 * (1.0 - vUv.y)) * (0.3 + 0.7 * (1.0 - edge * 0.85)); a *= 0.8 + 0.2 * noise(vec2(vUv.x * 6.0, vUv.y * 3.0 - uTime * 0.25)); a *= pow(abs(dot(vN, vView)), 2.0);
                 float rr = length((vUv - vec2(0.5, 0.38)) * vec2(1.0, 1.25));
                 float rq = (rr - uRipple * 0.9) * 9.0;
                 a += exp(-rq * rq) * exp(-uRipple * 2.4) * 1.6;`
              : mode === "scallop"
                ? "float dx = (vUv.x - 0.5) * 2.0; float dy = (1.0 - vUv.y) * 1.7; a = exp(-(dx * dx * (1.6 / (0.35 + dy)) + dy * dy * 0.8)) * smoothstep(0.0, 0.05, 1.0 - vUv.y);"
                : mode === "ring"
                ?"float r = length(vUv - 0.5) * 2.0; float q1 = (r - 0.86) * 16.0; float q2 = (r - 0.86) * 4.0; a = exp(-q1 * q1) + 0.12 * exp(-q2 * q2);"
                : "float f = pow(abs(dot(vN, vView)), 1.6); a = f * pow(vUv.y, 1.4) * (0.75 + 0.25 * noise(vec2(vUv.x * 18.0, vUv.y * 4.0 + uTime * 0.08)));"
        }
        gl_FragColor = vec4(uColor * a * uOpacity * uPower, 1.0); ${OUTPUT}
      }`,
  });
}

/** Domed coffered ceiling with a bright oculus. */
function domeMaterial() {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    uniforms: { ...fogUniforms(), uPower: { value: 1 } },
    vertexShader: /* glsl */ `
      varying vec2 vUv; varying float vDepth;
      void main() { vUv = uv; vec4 mv = modelViewMatrix * vec4(position, 1.0); vDepth = -mv.z; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */ `
      uniform float uPower;
      varying vec2 vUv; varying float vDepth;
      ${FOG_GLSL}
      void main() {
        vec2 g = vec2(vUv.x * 30.0, vUv.y * 9.0);
        vec2 f = abs(fract(g) - 0.5);
        float rib = smoothstep(0.36, 0.48, max(f.x, f.y));
        float inset = 1.0 - smoothstep(0.18, 0.4, max(f.x, f.y));
        vec3 c = vec3(0.014, 0.016, 0.022) + vec3(0.012) * inset - vec3(0.008) * rib;
        c *= 0.6 + 0.6 * vUv.y;
        float oc = smoothstep(0.9, 0.935, vUv.y);
        // Coffers catch warm light from the oculus, more toward the top; a light line rings the base.
        c += vec3(1.0, 0.82, 0.55) * inset * 0.022 * smoothstep(0.2, 0.9, vUv.y) * uPower;
        c = mix(c, vec3(2.4, 2.2, 1.9) * uPower, oc);
        c += vec3(0.9, 0.8, 0.6) * smoothstep(0.78, 0.93, vUv.y) * 0.05 * uPower;
        c += vec3(1.0, 0.78, 0.45) * exp(-vUv.y * 90.0) * 1.2 * uPower;
        gl_FragColor = vec4(applyFog(c, vDepth * 0.6), 1.0); ${OUTPUT}
      }`,
  });
}

/** Ceiling light slit of a wing; uSweep 0→1 runs the light down the hall from the doorway. */
function slitMaterial(color: THREE.Color) {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: color.clone() }, uSweep: { value: 0 } },
    vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform float uSweep; varying vec2 vUv;
      void main() {
        float d = 1.0 - vUv.y; // 0 at the doorway end
        float lit = 1.0 - smoothstep(uSweep - 0.06, uSweep, d);
        float hq = (d - uSweep) * 22.0; // x*x, not pow(x, 2.0): pow of a negative is undefined in GLSL (NaN → black)
        float head = exp(-hq * hq) * step(uSweep, 1.0) * 1.8;
        gl_FragColor = vec4(uColor * (0.06 + lit + head), 1.0); ${OUTPUT}
      }`,
  });
}

/** Light threads between a memory and its related memories (seen through walls). */
function threadMaterial(color: THREE.Color) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uColor: { value: color.clone() }, uTime: { value: 0 }, uGrow: { value: 0 } },
    // Tube geometry: uv.x runs along the thread.
    vertexShader: /* glsl */ `varying float vT; void main() { vT = uv.x; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform float uTime; uniform float uGrow; varying float vT;
      void main() {
        // The thread draws itself from the open memory outward, a bright spark at its tip.
        float drawn = 1.0 - smoothstep(uGrow - 0.03, uGrow, vT);
        float sq = (vT - uGrow) * 30.0;
        float spark = exp(-sq * sq) * step(uGrow, 1.02) * 3.0;
        float pulse = smoothstep(0.75, 1.0, fract(vT * 5.0 - uTime * 0.5));
        float ends = smoothstep(0.0, 0.08, vT) * smoothstep(1.0, 0.92, vT);
        gl_FragColor = vec4(uColor * ((0.35 + 1.4 * pulse) * ends * drawn + spark), 1.0); ${OUTPUT}
      }`,
  });
}

/* ───── 2D canvas drawing (cards, labels) ───── */

const fontOf = (v: string, fallback: string) => {
  const s = typeof document !== "undefined" ? getComputedStyle(document.documentElement).getPropertyValue(v).trim() : "";
  return s || fallback;
};

function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number, maxLines: number) {
  const words = text.replace(/\s+/g, " ").trim().split(" ");
  const lines: string[] = [];
  let line = "";
  for (let i = 0; i < words.length; i++) {
    const test = line ? `${line} ${words[i]}` : words[i];
    if (ctx.measureText(test).width > maxW && line) {
      lines.push(line);
      line = words[i];
      if (lines.length === maxLines) {
        line = "";
        break;
      }
    } else line = test;
  }
  if (line && lines.length < maxLines) lines.push(line);
  const used = lines.join(" ").split(" ").length;
  if (used < words.length && lines.length) {
    let last = lines[lines.length - 1];
    while (ctx.measureText(`${last}…`).width > maxW && last.length > 1) last = last.slice(0, -1);
    lines[lines.length - 1] = `${last.trimEnd()}…`;
  }
  return lines;
}

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const dateLabel = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
};

function cardTexture(item: PalaceItem, color: string, important: boolean, maxAniso: number) {
  const W = important ? 520 : 440;
  const H = Math.round(W * 1.28);
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const x = c.getContext("2d")!;
  const sans = fontOf("--font-sans", "system-ui, sans-serif");
  const mono = fontOf("--font-mono", "ui-monospace, monospace");
  const s = W / 440;

  const g = x.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, "#151a26");
  g.addColorStop(1, "#0b0e15");
  x.fillStyle = g;
  x.fillRect(0, 0, W, H);
  // Soft tint glow from the top, like light falling on the label.
  const rg = x.createRadialGradient(W / 2, 0, 0, W / 2, 0, H * 0.75);
  rg.addColorStop(0, `${color}33`);
  rg.addColorStop(1, `${color}00`);
  x.fillStyle = rg;
  x.fillRect(0, 0, W, H);
  x.fillStyle = color;
  x.fillRect(0, 0, W, 7 * s);

  const pad = 30 * s;
  x.textBaseline = "alphabetic";
  x.font = `600 ${15 * s}px ${mono}`;
  x.fillStyle = color;
  x.fillText(item.memory_type.replace(/_/g, " ").toUpperCase(), pad, 50 * s);
  x.fillStyle = "#8b93a5";
  x.textAlign = "right";
  x.fillText(dateLabel(item.updated_at), W - pad, 50 * s);
  x.textAlign = "left";

  x.font = `700 ${31 * s}px ${sans}`;
  x.fillStyle = "#eef1f6";
  const titleLines = wrap(x, item.title || "Untitled", W - pad * 2, 4);
  let y = 100 * s;
  for (const l of titleLines) {
    x.fillText(l, pad, y);
    y += 38 * s;
  }
  y += 6 * s;
  x.fillStyle = `${color}55`;
  x.fillRect(pad, y, 46 * s, 2 * s);
  y += 34 * s;

  x.font = `400 ${18.5 * s}px ${sans}`;
  x.fillStyle = "#aab2c2";
  const room = Math.max(1, Math.floor((H - y - 70 * s) / (27 * s)));
  for (const l of wrap(x, item.snippet || "", W - pad * 2, room)) {
    x.fillText(l, pad, y);
    y += 27 * s;
  }

  // Importance: ten small bars, like the List view meter.
  const by = H - 38 * s;
  for (let i = 0; i < 10; i++) {
    x.fillStyle = i < item.importance ? color : "#2a3040";
    x.fillRect(pad + i * 11 * s, by - 12 * s, 7 * s, 12 * s);
  }
  x.font = `500 ${13 * s}px ${mono}`;
  x.fillStyle = "#6f7889";
  x.textAlign = "right";
  x.fillText(item.source.toUpperCase().slice(0, 28), W - pad, by);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAniso;
  return tex;
}

function labelTexture(lines: { text: string; size: number; color: string; weight?: number; mono?: boolean; gap?: number }[], W: number, H: number) {
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const x = c.getContext("2d")!;
  const sans = fontOf("--font-sans", "system-ui, sans-serif");
  const mono = fontOf("--font-mono", "ui-monospace, monospace");
  x.textAlign = "center";
  const total = lines.reduce((a, l) => a + l.size + (l.gap ?? 14), 0);
  let y = (H - total) / 2;
  for (const l of lines) {
    y += l.size;
    x.font = `${l.weight ?? 600} ${l.size}px ${l.mono ? mono : sans}`;
    x.fillStyle = l.color;
    if (l.mono) x.letterSpacing = "4px";
    x.fillText(l.text, W / 2, y);
    x.letterSpacing = "0px";
    y += l.gap ?? 14;
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function radialTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const x = c.getContext("2d")!;
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  x.fillStyle = g;
  x.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

/* ───── scene ───── */

type Spring = { x: number; v: number };
/** Damped spring step (semi-implicit Euler, sub-stepped so it stays stable at low frame rates). */
function stepSpring(s: Spring, target: number, k: number, c: number, dt: number) {
  const n = Math.max(1, Math.ceil(dt / (1 / 120)));
  const h = dt / n;
  for (let i = 0; i < n; i++) {
    s.v += (k * (target - s.x) - c * s.v) * h;
    s.x += s.v * h;
  }
}
const easeOut3 = (x: number) => 1 - (1 - x) ** 3;
const easeInOut3 = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);
/** Rises with a ~10% overshoot, then settles (easeOutBack). */
const easeOutBack = (x: number) => 1 + 2.70158 * (x - 1) ** 3 + 1.70158 * (x - 1) ** 2;

type Frame = {
  id: string;
  /** Card, moulding and rim: the part that lifts, tilts and leans. Lights and pools stay on the wall. */
  body: THREE.Group;
  bodyY: number;
  card: THREE.Mesh;
  cardMat: THREE.ShaderMaterial;
  mouldMat: THREE.ShaderMaterial;
  mould: THREE.Mesh;
  mouldColor: THREE.Color;
  rim: THREE.Mesh;
  rimColor: THREE.Color;
  lift: Spring;
  tiltX: Spring;
  tiltY: Spring;
  sweepAt: number;
  dipAt: number;
  /** Where along its wing (0 at the doorway, 1 at the far end) — the light-up passes it in order. */
  along: number;
  phase: number;
  wash: THREE.Mesh;
  pool: THREE.Mesh;
  group: THREE.Group;
  /** Where to stand to read it, and which way to face. */
  view: { pos: THREE.Vector3; yaw: number };
  base: number;
  level: number;
  wing: number;
  /** Order down its wall (lights cascade in this order when the wing wakes). */
  order: number;
  world: THREE.Vector3 | null;
  /** Clock time of a search pulse (matches flash in a wave). */
  pulseAt: number;
};

/** A doorway's lights, so the palace can switch them on in turn. */
type Door = { bars: THREE.MeshBasicMaterial; barColor: THREE.Color; veil: THREE.ShaderMaterial; glow: THREE.ShaderMaterial; plate: THREE.MeshBasicMaterial };

const smooth = (a: number, b: number, x: number) => {
  const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

export class PalaceScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(70, 1, 0.1, 160);
  private composer: EffectComposer | null = null;
  private reflector: Reflector | null = null;
  private plainFloor: THREE.Mesh;
  private frames: Frame[] = [];
  private veils: THREE.Mesh[] = [];
  private solids: THREE.Object3D[] = [];
  private animated: THREE.ShaderMaterial[] = [];
  private threads = new THREE.Group();
  private threadStart = 0;
  private dust: THREE.Points | null = null;
  readonly layout: WingLayout[];

  // Animation state. Nothing here moves the camera: lights wake, frames respond, things breathe.
  private doors: Door[] = [];
  private slits: THREE.ShaderMaterial[] = [];
  private wingWake: (number | null)[] = [];
  private hubLights: { dome: THREE.ShaderMaterial | null; shaft: THREE.ShaderMaterial | null; pool: THREE.ShaderMaterial | null } = { dome: null, shaft: null, pool: null };
  private halos: THREE.Mesh[] = [];
  private pulse!: THREE.Mesh;
  private pulseAt = -99;
  private marker!: THREE.Mesh;
  private markerFade = 0;
  private lastZone: Zone = { kind: "hub" };
  private rippleAt: number[] = [];
  private push = 0;
  private focusK = 0;
  private closeSent = false;
  private nearFocus = false;
  private hubWall: THREE.ShaderMaterial | null = null;
  private hubFin: THREE.ShaderMaterial | null = null;
  private vignette: VignetteEffect | null = null;
  private hoverUV: THREE.Vector2 | null = null;
  /** Shared time uniform for the gallery walls (LED pulses). */
  private timeU = { value: 0 };
  /** Per wing: gallery wall, fin and rib materials (their lights wake with the wing). */
  private wingMats: THREE.ShaderMaterial[][] = [];
  /** Clock time of the first frame actually drawn: the wake-up starts here, not while shaders compile. */
  private t0 = -1;

  private pos = new THREE.Vector3(0, EYE, 2.5);
  private yaw = 0;
  private pitch = -0.03;
  private yawT = 0;
  private pitchT = -0.03;
  private vel = new THREE.Vector2();
  private keys = new Set<string>();
  private walkTo: THREE.Vector2 | null = null;
  /**
   * The step up to a frame: the head turns first (450 ms), then the body glides along a gentle arc
   * (ease-in-out); the memory opens at 70% of the way so the panel and the camera overlap.
   */
  private stepTo: {
    from: THREE.Vector3;
    ctrl: THREE.Vector3;
    to: THREE.Vector3;
    yaw0: number;
    yaw1: number;
    pitch0: number;
    pitch1: number;
    t0: number;
    dur: number;
    id: string;
    frame: Frame;
  } | null = null;
  private baseFov = 68;
  private fov = 68;
  private roll = 0;
  private prevYaw = 0;

  private ray = new THREE.Raycaster();
  private ndc = new THREE.Vector2();
  private down: { x: number; y: number; lx: number; ly: number; t: number; id: number; touch: boolean; moved: boolean } | null = null;
  private hovered: Frame | null = null;
  private hoverDirty: { x: number; y: number } | null = null;
  private highlight: Set<string> | null = null;
  private focusId: string | null = null;

  private clock = new THREE.Clock();
  private raf = 0;
  private running = true;
  private reduced: boolean;
  private mobile: boolean;
  private quality: "high" | "low";
  private fps = { frames: 0, time: 0, slow: 0 };
  private lastMove = 0;
  private disposed = false;

  constructor(
    private canvas: HTMLCanvasElement,
    items: PalaceItem[],
    private cb: Callbacks,
  ) {
    this.reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.mobile = matchMedia("(pointer: coarse)").matches || Math.min(screen.width, screen.height) < 700;
    this.quality = this.mobile ? "low" : "high";

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: this.quality === "low", powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, this.mobile ? 1.4 : 1.75));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.setClearColor(FOG);
    this.scene.fog = new THREE.FogExp2(FOG, FOG_DENSITY);
    this.scene.background = FOG.clone();

    this.layout = this.plan(items);
    const floorGeo = new THREE.PlaneGeometry(160, 160);
    floorGeo.rotateX(-Math.PI / 2);
    // Low tier (and fallback): the same marble without the live reflection.
    const dummy = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
    dummy.needsUpdate = true;
    const plainMat = new THREE.ShaderMaterial({ ...FLOOR_SHADER, uniforms: THREE.UniformsUtils.clone(FLOOR_SHADER.uniforms) });
    plainMat.uniforms.tDiffuse.value = dummy;
    plainMat.uniforms.textureMatrix.value = new THREE.Matrix4();
    this.plainFloor = new THREE.Mesh(floorGeo, plainMat);
    this.scene.add(this.plainFloor);

    this.buildHub();
    this.layout.forEach((w, i) => this.buildWing(w, i));
    this.buildHighlights(items);
    this.buildDust();
    this.scene.add(this.threads);
    // A ring of light that pulses out of a frame when it opens, and the walk-to marker on the floor.
    this.pulse = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), glowMaterial(new THREE.Color("#ffe2a8"), 0, "ring"));
    this.pulse.visible = false;
    this.scene.add(this.pulse);
    this.marker = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), glowMaterial(new THREE.Color("#dfe8ff"), 0, "ring"));
    this.marker.rotation.x = -Math.PI / 2;
    this.marker.position.y = 0.02;
    this.marker.visible = false;
    this.scene.add(this.marker);

    if (this.quality === "high") this.enableHigh();
    this.place(new THREE.Vector3(0, EYE, 2.5), 0);
    this.bind();
    this.loop();
  }

  /* ── layout ── */

  private plan(items: PalaceItem[]): WingLayout[] {
    // Newest first: the newest memories hang nearest the rotunda; older ones further down the hall.
    const sorted = [...items].sort((a, b) => b.updated_at.localeCompare(a.updated_at));
    return WINGS.map((wing, i) => {
      const own = sorted.filter((m) => wingOf(m.memory_type) === wing);
      const pairs = Math.ceil(own.length / 2);
      return { wing, angle: (i * Math.PI * 2) / WINGS.length, length: Math.max(14, FIRST + pairs * SPACING + 4), items: own };
    });
  }

  /** World point from wing-local (r = distance from the hub centre along the wing, s = sideways). */
  private wingPoint(w: WingLayout, r: number, s: number, y = 0) {
    const c = Math.cos(w.angle);
    const sn = Math.sin(w.angle);
    // Local frame: outward is -Z rotated by angle around Y.
    const lx = s;
    const lz = -r;
    return new THREE.Vector3(lx * c + lz * sn, y, -lx * sn + lz * c);
  }

  private toLocal(w: WingLayout, x: number, z: number) {
    const c = Math.cos(w.angle);
    const sn = Math.sin(w.angle);
    const lx = x * c - z * sn;
    const lz = x * sn + z * c;
    return { r: -lz, s: lx };
  }

  private walkable(x: number, z: number) {
    if (Math.hypot(x, z) < HUB_R - 0.75) {
      // Plinths in the rotunda are solid.
      for (const f of this.frames) if (f.wing < 0 && Math.hypot(x - f.group.position.x, z - f.group.position.z) < 0.9) return false;
      return true;
    }
    for (const w of this.layout) {
      const { r, s } = this.toLocal(w, x, z);
      if (r > HUB_R - 1.6 && r < HUB_R + 0.9 && Math.abs(s) < DOOR_W / 2 - 0.45) return true;
      if (r > HUB_R + 0.3 && r < HUB_R + w.length - 0.8 && Math.abs(s) < HALL_W / 2 - 1.3) return true;
    }
    return false;
  }

  zoneAt(x: number, z: number): Zone {
    if (Math.hypot(x, z) < HUB_R) return { kind: "hub" };
    let best = 0;
    let bestS = Infinity;
    this.layout.forEach((w, i) => {
      const { r, s } = this.toLocal(w, x, z);
      if (r > 0 && Math.abs(s) < bestS) {
        bestS = Math.abs(s);
        best = i;
      }
    });
    return { kind: "wing", index: best };
  }

  /* ── building ── */

  private addSolid(m: THREE.Mesh) {
    this.scene.add(m);
    this.solids.push(m);
    return m;
  }

  private buildHub() {
    const n = WINGS.length;
    const gap = Math.asin(DOOR_W / 2 / HUB_R);
    const wallMat = rotundaWallMaterial(this.timeU);
    this.hubWall = wallMat;
    for (let i = 0; i < n; i++) {
      const a = (i * Math.PI * 2) / n + Math.PI; // cylinder theta for this doorway
      const next = ((i + 1) * Math.PI * 2) / n + Math.PI;
      const seg = new THREE.CylinderGeometry(HUB_R, HUB_R, WALL_H, 40, 1, true, a + gap, next - a - gap * 2);
      seg.translate(0, WALL_H / 2, 0);
      this.addSolid(new THREE.Mesh(seg, wallMat));
      const lintel = new THREE.CylinderGeometry(HUB_R, HUB_R, WALL_H - DOOR_H, 10, 1, true, a - gap, gap * 2);
      lintel.translate(0, DOOR_H + (WALL_H - DOOR_H) / 2, 0);
      this.addSolid(new THREE.Mesh(lintel, wallMat));
    }
    // Slim gold-rimmed fins flanking the light behind each plinth (instead of boxy pilasters).
    const fin = new THREE.BoxGeometry(0.1, WALL_H, 0.26);
    fin.translate(0, WALL_H / 2, 0);
    const finMat = archMaterial(new THREE.Color("#f2c46d"), "fin", 0);
    finMat.uniforms.uWake.value = 1;
    this.hubFin = finMat;
    for (let i = 0; i < n; i++) {
      for (const side of [-1, 1]) {
        const a = ((i + 0.5) * Math.PI * 2) / n + (side * 1.9) / HUB_R;
        const m = new THREE.Mesh(fin, finMat);
        m.position.set(-Math.sin(a) * (HUB_R - 0.15), 0, -Math.cos(a) * (HUB_R - 0.15));
        m.rotation.y = a;
        this.scene.add(m);
      }
    }

    // Dome with oculus, and the light falling from it.
    const dome = new THREE.Mesh(new THREE.SphereGeometry(HUB_R, 64, 24, 0, Math.PI * 2, 0, Math.PI / 2), domeMaterial());
    dome.position.y = WALL_H;
    this.scene.add(dome);
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 2.6, WALL_H + HUB_R * 0.93, 48, 1, true), glowMaterial(new THREE.Color("#ffe7c2"), 0.11, "ray"));
    shaft.position.y = (WALL_H + HUB_R * 0.93) / 2;
    this.scene.add(shaft);
    this.animated.push(shaft.material as THREE.ShaderMaterial);
    const pool = new THREE.Mesh(new THREE.PlaneGeometry(6, 6), glowMaterial(new THREE.Color("#ffdcaa"), 0.2, "radial"));
    pool.rotation.x = -Math.PI / 2;
    pool.position.y = 0.01;
    this.scene.add(pool);
    this.hubLights = { dome: dome.material as THREE.ShaderMaterial, shaft: shaft.material as THREE.ShaderMaterial, pool: pool.material as THREE.ShaderMaterial };

    // Each doorway: a glowing frame, a light veil in the wing's colour, and its name above.
    this.layout.forEach((w) => {
      const color = new THREE.Color(w.wing.color);
      const yaw = w.angle;
      const at = (r: number, s: number, y: number) => this.wingPoint(w, r, s, y);
      const glow = color.clone().multiplyScalar(w.items.length ? 1.8 : 0.7);
      const barMat = new THREE.MeshBasicMaterial({ color: glow, fog: true });
      const jamb = new THREE.BoxGeometry(0.09, DOOR_H, 0.12);
      for (const side of [-1, 1]) {
        const m = new THREE.Mesh(jamb, barMat);
        m.position.copy(at(HUB_R - 0.25, (side * DOOR_W) / 2, DOOR_H / 2));
        m.rotation.y = yaw;
        this.scene.add(m);
      }
      const top = new THREE.Mesh(new THREE.BoxGeometry(DOOR_W + 0.09, 0.09, 0.12), barMat);
      top.position.copy(at(HUB_R - 0.25, 0, DOOR_H));
      top.rotation.y = yaw;
      this.scene.add(top);

      // A deep, dark-metal architrave framing the glowing doorway.
      const B = 0.42;
      const outer = new THREE.Shape();
      outer.moveTo(-DOOR_W / 2 - B, 0);
      outer.lineTo(DOOR_W / 2 + B, 0);
      outer.lineTo(DOOR_W / 2 + B, DOOR_H + B);
      outer.lineTo(-DOOR_W / 2 - B, DOOR_H + B);
      outer.closePath();
      const opening = new THREE.Path();
      opening.moveTo(-DOOR_W / 2, 0);
      opening.lineTo(-DOOR_W / 2, DOOR_H);
      opening.lineTo(DOOR_W / 2, DOOR_H);
      opening.lineTo(DOOR_W / 2, 0);
      opening.closePath();
      outer.holes.push(opening);
      const archMat = metalMaterial(new THREE.Color("#0d0c0b").lerp(color, 0.05));
      archMat.uniforms.uLevel.value = 1;
      const architrave = new THREE.Mesh(new THREE.ExtrudeGeometry(outer, { depth: 0.3, bevelEnabled: true, bevelSize: 0.03, bevelThickness: 0.03, bevelSegments: 2 }), archMat);
      architrave.position.copy(at(HUB_R - 0.18, 0, 0));
      architrave.rotation.y = yaw;
      this.scene.add(architrave);

      const veil = new THREE.Mesh(new THREE.PlaneGeometry(DOOR_W, DOOR_H), glowMaterial(color, w.items.length ? 0.42 : 0.18, "veil"));
      veil.position.copy(at(HUB_R - 0.2, 0, DOOR_H / 2));
      veil.rotation.y = yaw;
      veil.userData.wing = this.layout.indexOf(w);
      this.scene.add(veil);
      this.veils.push(veil);
      this.animated.push(veil.material as THREE.ShaderMaterial);

      const floorGlow = new THREE.Mesh(new THREE.PlaneGeometry(DOOR_W * 1.6, 3.2), glowMaterial(color, 0.4, "radial"));
      floorGlow.rotation.order = "YXZ";
      floorGlow.rotation.set(-Math.PI / 2, yaw, 0);
      floorGlow.position.copy(at(HUB_R - 0.6, 0, 0.012));
      this.scene.add(floorGlow);

      const label = labelTexture(
        [
          { text: w.wing.name.toUpperCase(), size: 54, color: "#f1ece2", weight: 600, mono: true, gap: 18 },
          { text: w.items.length ? `${w.items.length} ${w.items.length === 1 ? "MEMORY" : "MEMORIES"}` : "EMPTY", size: 26, color: w.wing.color, mono: true },
        ],
        1024,
        220,
      );
      const plate = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 0.99), new THREE.MeshBasicMaterial({ map: label, transparent: true, fog: true }));
      plate.position.copy(at(HUB_R - 0.45, 0, DOOR_H + 1.05));
      plate.rotation.y = yaw;
      this.scene.add(plate);
      this.doors.push({ bars: barMat, barColor: glow.clone(), veil: veil.material as THREE.ShaderMaterial, glow: floorGlow.material as THREE.ShaderMaterial, plate: plate.material as THREE.MeshBasicMaterial });
      this.rippleAt.push(-99);
      this.wingWake.push(null);
    });
  }

  private buildWing(w: WingLayout, index: number) {
    const color = new THREE.Color(w.wing.color);
    const g = new THREE.Group();
    g.rotation.y = w.angle;
    this.scene.add(g);
    // Double-sided: a wall seen from behind (through another doorway) still hides what is past it.
    const wall = wallMaterial(color, HALL_H, 0.6, THREE.DoubleSide);
    const L = w.length;
    const r0 = HUB_R;

    // Side walls get the full gallery lighting (scallops, reveals, cove, LED line).
    const gallery = galleryWallMaterial(color, w.angle, Math.ceil(w.items.length / 2), this.timeU);
    this.wingMats[index] = [gallery];
    const side = new THREE.PlaneGeometry(L, HALL_H, 1, 1);
    for (const s of [-1, 1]) {
      const m = new THREE.Mesh(side, gallery);
      m.position.set((s * HALL_W) / 2, HALL_H / 2, -(r0 + L / 2));
      // Face inward.
      m.rotation.y = s > 0 ? -Math.PI / 2 : Math.PI / 2;
      g.add(m);
      this.solids.push(m);
    }
    const end = new THREE.Mesh(new THREE.PlaneGeometry(HALL_W, HALL_H), wall);
    end.position.set(0, HALL_H / 2, -(r0 + L));
    g.add(end);
    this.solids.push(end);
    // Front wall around the doorway, facing into the hall.
    const sideW = (HALL_W - DOOR_W) / 2;
    for (const s of [-1, 1]) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(sideW, HALL_H), wall);
      m.position.set(s * (DOOR_W / 2 + sideW / 2), HALL_H / 2, -r0);
      m.rotation.y = Math.PI;
      g.add(m);
      this.solids.push(m);
    }
    const lintel = new THREE.Mesh(new THREE.PlaneGeometry(DOOR_W, HALL_H - DOOR_H), wall);
    lintel.position.set(0, DOOR_H + (HALL_H - DOOR_H) / 2, -r0);
    lintel.rotation.y = Math.PI;
    g.add(lintel);

    // Ceiling with a light slit down the middle (Ando).
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(HALL_W, L), wallMaterial(color, 1, 0.0));
    ceil.rotation.x = Math.PI / 2;
    ceil.position.set(0, HALL_H, -(r0 + L / 2));
    g.add(ceil);
    const slitMat = slitMaterial(color.clone().lerp(new THREE.Color("#ffffff"), 0.55).multiplyScalar(2.4));
    const slit = new THREE.Mesh(new THREE.PlaneGeometry(0.22, L - 1), slitMat);
    slit.rotation.x = Math.PI / 2;
    // Hangs just below the ribs, so it reads as one continuous line of light.
    slit.position.set(0, HALL_H - 0.22, -(r0 + L / 2));
    g.add(slit);
    this.slits[index] = slitMat;

    // Between frame bays: slim dark fins with a rim of the wing's light (instead of boxy pilasters),
    // and ceiling ribs lit from below by the light slit.
    const finMat = archMaterial(color, "fin", w.angle);
    const ribMat = archMaterial(color, "rib", w.angle);
    this.wingMats[index].push(finMat, ribMat);
    const fin = new THREE.BoxGeometry(0.1, HALL_H, 0.24);
    const rib = new THREE.BoxGeometry(HALL_W, 0.2, 0.3);
    const bays = Math.ceil(L / SPACING);
    for (let b = 0; b <= bays; b++) {
      const r = r0 + FIRST - SPACING / 2 + b * SPACING;
      if (r > r0 + L - 0.5) break;
      for (const s of [-1, 1]) {
        const m = new THREE.Mesh(fin, finMat);
        m.position.set(s * (HALL_W / 2 - 0.12), HALL_H / 2, -r);
        g.add(m);
      }
      const rm = new THREE.Mesh(rib, ribMat);
      rm.position.set(0, HALL_H - 0.1, -r);
      g.add(rm);
    }

    // End wall plaque.
    const plaque = labelTexture(
      w.items.length
        ? [
            { text: w.wing.name.toUpperCase(), size: 46, color: "#f1ece2", mono: true, gap: 18 },
            { text: w.wing.tagline, size: 30, color: "#aab2c2", weight: 400 },
          ]
        : [
            { text: w.wing.name.toUpperCase(), size: 46, color: "#f1ece2", mono: true, gap: 22 },
            { text: w.wing.empty, size: 28, color: w.wing.color, weight: 400 },
          ],
      1024,
      260,
    );
    const pm = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 1.12), new THREE.MeshBasicMaterial({ map: plaque, transparent: true, fog: true }));
    pm.position.set(0, 2.4, -(r0 + L - 0.02));
    g.add(pm);
    const endWash = new THREE.Mesh(new THREE.PlaneGeometry(6.5, 5), glowMaterial(color, 0.25, "radial"));
    endWash.position.set(0, 2.6, -(r0 + L - 0.04));
    g.add(endWash);

    // Frames: alternating left / right walls, newest first.
    const maxAniso = this.renderer.capabilities.getMaxAnisotropy();
    w.items.forEach((item, k) => {
      const s = k % 2 === 0 ? -1 : 1;
      const r = r0 + FIRST + Math.floor(k / 2) * SPACING;
      const local = new THREE.Vector3(s * (HALL_W / 2 - 0.06), 0, -r);
      const f = this.makeFrame(item, w.wing.color, maxAniso, index);
      f.group.position.copy(local);
      f.group.rotation.y = s < 0 ? Math.PI / 2 : -Math.PI / 2;
      f.order = Math.floor(k / 2);
      f.along = (FIRST + f.order * SPACING) / L;
      g.add(f.group);
      // Standing point: 2.3 m in front of the frame, facing it.
      const stand = this.wingPoint(w, r, s * (HALL_W / 2 - 2.4), EYE);
      f.view = { pos: stand, yaw: w.angle + (s < 0 ? Math.PI / 2 : -Math.PI / 2) };
    });
  }

  /** The most important memories stand on plinths in the rotunda, between the doorways. */
  private buildHighlights(items: PalaceItem[]) {
    const top = [...items].filter((m) => m.importance >= 7).sort((a, b) => b.importance - a.importance || b.updated_at.localeCompare(a.updated_at)).slice(0, WINGS.length);
    const maxAniso = this.renderer.capabilities.getMaxAnisotropy();
    const plinthGeo = new THREE.LatheGeometry(
      [
        new THREE.Vector2(0, 0),
        new THREE.Vector2(0.62, 0),
        new THREE.Vector2(0.62, 0.08),
        new THREE.Vector2(0.5, 0.14),
        new THREE.Vector2(0.44, 0.75),
        new THREE.Vector2(0.56, 0.82),
        new THREE.Vector2(0.56, 0.9),
        new THREE.Vector2(0, 0.9),
      ],
      32,
    );
    const plinthMat = wallMaterial(new THREE.Color("#f2c46d"), 0.9, 0.5);
    top.forEach((item, i) => {
      const a = ((i + 0.5) * Math.PI * 2) / WINGS.length;
      const p = new THREE.Vector3(-Math.sin(a) * 5.6, 0, -Math.cos(a) * 5.6);
      const plinth = new THREE.Mesh(plinthGeo, plinthMat);
      plinth.position.copy(p);
      this.scene.add(plinth);
      const f = this.makeFrame(item, "#f2c46d", maxAniso, -1, true);
      f.group.position.set(p.x, 0, p.z);
      // Face the centre of the rotunda.
      f.group.rotation.y = a;
      f.order = i;
      this.scene.add(f.group);
      // A slowly turning halo on the plinth top.
      const halo = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.5), glowMaterial(new THREE.Color("#f2c46d"), 0.55, "ring"));
      halo.rotation.x = -Math.PI / 2;
      halo.position.set(p.x, 0.915, p.z);
      halo.userData.phase = i * 1.3;
      this.scene.add(halo);
      this.halos.push(halo);
      const inward = new THREE.Vector3(-p.x, 0, -p.z).normalize();
      f.view = { pos: p.clone().addScaledVector(inward, 2.5).setY(EYE), yaw: a };
    });
  }

  private makeFrame(item: PalaceItem, color: string, maxAniso: number, wing: number, plinth = false): Frame {
    const important = item.importance >= 8 || plinth;
    const w = important ? 1.5 : 1.22;
    const h = w * 1.28;
    const tint = new THREE.Color(important ? "#f2c46d" : color);
    const group = new THREE.Group();
    const cy = plinth ? 0.85 + 0.12 + h / 2 : 1.72;

    // The body (card + moulding + rim) moves; everything else stays fixed on the wall.
    const body = new THREE.Group();
    body.position.set(0, cy, 0);
    group.add(body);

    const cardMat = cardMaterial(cardTexture(item, color, important, maxAniso));
    const card = new THREE.Mesh(new THREE.PlaneGeometry(w, h), cardMat);
    card.position.set(0, 0, 0.05);
    card.userData.id = item.id;
    body.add(card);

    // Frame moulding: an extruded border, slightly bevelled, with a metallic glint.
    const b = important ? 0.09 : 0.06;
    const shape = new THREE.Shape();
    shape.moveTo(-w / 2 - b, -h / 2 - b);
    shape.lineTo(w / 2 + b, -h / 2 - b);
    shape.lineTo(w / 2 + b, h / 2 + b);
    shape.lineTo(-w / 2 - b, h / 2 + b);
    shape.closePath();
    const hole = new THREE.Path();
    hole.moveTo(-w / 2, -h / 2);
    hole.lineTo(-w / 2, h / 2);
    hole.lineTo(w / 2, h / 2);
    hole.lineTo(w / 2, -h / 2);
    hole.closePath();
    shape.holes.push(hole);
    const mouldColor = important ? new THREE.Color("#b8934f") : tint.clone().multiplyScalar(0.36);
    const mouldMat = metalMaterial(mouldColor);
    const mould = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 0.07, bevelEnabled: true, bevelSize: 0.014, bevelThickness: 0.014, bevelSegments: 2 }), mouldMat);
    body.add(mould);

    // Thin bright rim just inside the moulding: this is what blooms.
    const rimColor = tint.clone().multiplyScalar(important ? 2.0 : 1.5);
    const rim = new THREE.Mesh(new THREE.PlaneGeometry(w + 0.035, h + 0.035), new THREE.MeshBasicMaterial({ color: rimColor.clone(), fog: true }));
    rim.position.set(0, 0, 0.04);
    body.add(rim);

    // Light falling down the wall from the picture light above, and a soft pool on the floor.
    const washH = h * 2.3;
    const top = cy + h / 2 + 0.42;
    const wash = new THREE.Mesh(new THREE.PlaneGeometry(w * 2.7, washH), glowMaterial(tint.clone().lerp(new THREE.Color("#ffd9a8"), 0.45), 0.2, "scallop"));
    wash.position.set(0, top - washH / 2, 0.012);
    group.add(wash);
    const pool = new THREE.Mesh(new THREE.PlaneGeometry(w * 2.4, 2.2), glowMaterial(tint, plinth ? 0.0 : 0.2, "radial"));
    pool.rotation.x = -Math.PI / 2;
    pool.position.set(0, 0.012, 0.9);
    group.add(pool);

    if (!plinth) {
      // Brass picture light: an arm, a bar, and a glowing underside.
      const brass = new THREE.MeshBasicMaterial({ color: new THREE.Color("#8a6a3a"), fog: true });
      const barW = Math.min(0.9, w * 0.62);
      const bar = new THREE.Mesh(new THREE.BoxGeometry(barW, 0.045, 0.08), brass);
      bar.position.set(0, top - 0.06, 0.2);
      group.add(bar);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.2), brass);
      arm.position.set(0, top - 0.05, 0.1);
      group.add(arm);
      const glow = new THREE.Mesh(new THREE.PlaneGeometry(barW * 0.92, 0.03), new THREE.MeshBasicMaterial({ color: new THREE.Color("#ffd9a8").multiplyScalar(2.2), fog: true }));
      glow.rotation.x = Math.PI / 2;
      glow.position.set(0, top - 0.085, 0.2);
      group.add(glow);
    }

    if (important && !plinth) {
      // A spotlight cone from the ceiling for the important ones.
      const cone = new THREE.Mesh(new THREE.CylinderGeometry(0.12, w * 0.75, HALL_H - cy - h / 2 + 0.3, 24, 1, true), glowMaterial(tint, 0.13, "ray"));
      cone.position.set(0, cy + h / 2 + (HALL_H - cy - h / 2) / 2 - 0.1, 0.7);
      group.add(cone);
      this.animated.push(cone.material as THREE.ShaderMaterial);
    }

    const f: Frame = {
      id: item.id,
      body,
      bodyY: cy,
      card,
      cardMat,
      mouldMat,
      mould,
      mouldColor,
      rim,
      rimColor,
      lift: { x: 0, v: 0 },
      tiltX: { x: 0, v: 0 },
      tiltY: { x: 0, v: 0 },
      sweepAt: -99,
      dipAt: -99,
      along: 0,
      phase: Math.random() * Math.PI * 2,
      wash,
      pool,
      group,
      view: { pos: new THREE.Vector3(), yaw: 0 },
      base: h,
      level: 0,
      wing,
      order: 0,
      world: null,
      pulseAt: -99,
    };
    this.frames.push(f);
    return f;
  }

  private buildDust() {
    const n = this.quality === "high" ? 520 : 220;
    const pos = new Float32Array(n * 3);
    const seed = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      // Mostly in the rotunda's light shaft, some through the halls.
      const inShaft = i < n * 0.45;
      const a = Math.random() * Math.PI * 2;
      const r = inShaft ? Math.sqrt(Math.random()) * 2.4 : Math.random() * (HUB_R - 1);
      pos[i * 3] = Math.sin(a) * r;
      pos[i * 3 + 1] = Math.random() * (inShaft ? WALL_H + 3 : 5);
      pos[i * 3 + 2] = Math.cos(a) * r;
      seed[i] = Math.random();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("seed", new THREE.BufferAttribute(seed, 1));
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uMap: { value: radialTexture() }, uScale: { value: this.renderer.getPixelRatio() }, uPlayer: { value: new THREE.Vector3() }, uPush: { value: 0 } },
      vertexShader: /* glsl */ `
        attribute float seed; uniform float uTime; uniform float uScale; uniform vec3 uPlayer; uniform float uPush; varying float vA;
        void main() {
          vec3 p = position;
          p.x += sin(uTime * 0.07 + seed * 40.0) * 0.4; p.z += cos(uTime * 0.05 + seed * 30.0) * 0.4;
          p.y += mod(uTime * 0.04 * (0.4 + seed), 1.0) * 0.6;
          // Motes part around the visitor as they walk, with a slight swirl.
          vec2 dd = p.xz - uPlayer.xz; float dl = max(length(dd), 0.001);
          float k = exp(-dl * 1.1) * uPush;
          p.xz += (dd / dl) * k * 1.1 + vec2(-dd.y, dd.x) / dl * k * 0.5;
          p.y += k * 0.35;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          vA = (0.25 + 0.75 * seed) * smoothstep(40.0, 4.0, -mv.z);
          gl_PointSize = min(5.0, (1.0 + seed * 2.0) * uScale * (4.0 / -mv.z));
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap; varying float vA;
        void main() { gl_FragColor = vec4(vec3(1.0, 0.92, 0.78) * texture2D(uMap, gl_PointCoord).a * vA * 0.32, 1.0); ${OUTPUT} }`,
    });
    this.dust = new THREE.Points(geo, mat);
    this.scene.add(this.dust);
    this.animated.push(mat);
  }

  /* ── quality ── */

  private enableHigh() {
    this.reflector = new Reflector(this.plainFloor.geometry, {
      shader: { ...FLOOR_SHADER, uniforms: THREE.UniformsUtils.clone(FLOOR_SHADER.uniforms) },
      textureWidth: 512,
      textureHeight: 512,
      clipBias: 0.003,
      multisample: 0,
    });
    const m = this.reflector.material as THREE.ShaderMaterial;
    m.uniforms.uReflect.value = 0.5;
    this.scene.add(this.reflector);
    this.plainFloor.visible = false;

    // No MSAA: a multisampled half-float buffer corrupts the brightest thin lines on Intel/ANGLE (D3D11)
    // GPUs (they render as black blocks). Edges are smoothed by SMAA at the end instead.
    this.composer = new EffectComposer(this.renderer, { frameBufferType: THREE.HalfFloatType, multisampling: 0 });
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    // Kernel blur, not mipmap: mipmap bloom renders black on some Intel/ANGLE GPUs.
    const bloom = new BloomEffect({ mipmapBlur: false, kernelSize: KernelSize.MEDIUM, luminanceThreshold: 0.82, luminanceSmoothing: 0.22, intensity: 0.95 });
    this.vignette = new VignetteEffect({ darkness: 0.55, offset: 0.3 });
    // Grain hides banding in the dark gradients; a hair of lens fringing at the edges only.
    const grain = new NoiseEffect({ blendFunction: BlendFunction.OVERLAY, premultiply: true });
    grain.blendMode.opacity.value = 0.05;
    const fringe = new ChromaticAberrationEffect({ offset: new THREE.Vector2(0.0005, 0.0005), radialModulation: true, modulationOffset: 0.3 });
    this.composer.addPass(new EffectPass(this.camera, bloom, new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC }), new GradeEffect(), this.vignette));
    this.composer.addPass(new EffectPass(this.camera, fringe, grain));
    this.composer.addPass(new EffectPass(this.camera, new SMAAEffect({ preset: SMAAPreset.HIGH })));
    this.renderer.toneMapping = THREE.NoToneMapping;
  }

  private downgrade() {
    if (this.quality === "low") return;
    this.quality = "low";
    if (this.reflector) {
      this.scene.remove(this.reflector);
      this.reflector.dispose();
      this.reflector = null;
    }
    this.plainFloor.visible = true;
    this.composer?.dispose();
    this.composer = null;
    this.vignette = null;
    this.renderer.autoClear = true;
    this.renderer.setRenderTarget(null);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.25));
    this.resize(this.canvas.clientWidth, this.canvas.clientHeight);
  }

  /* ── public API ── */

  resize(w: number, h: number) {
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.composer?.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.baseFov = w < h ? 78 : 68;
    this.fov = this.baseFov;
    this.camera.fov = this.fov;
    this.camera.updateProjectionMatrix();
  }

  /** Instantly stand somewhere (used by the map jump, behind a quick fade). */
  place(p: THREE.Vector3, yaw: number) {
    this.pos.copy(p).setY(EYE);
    this.yaw = this.yawT = yaw;
    this.pitch = this.pitchT = -0.03;
    this.vel.set(0, 0);
    this.walkTo = null;
    this.stepTo = null;
    this.emitMove(true);
  }

  jumpTo(target: "hub" | number) {
    if (target === "hub") return this.place(new THREE.Vector3(0, EYE, 2.5), 0);
    const w = this.layout[target];
    this.wake(target);
    this.place(this.wingPoint(w, HUB_R + 1.6, 0, EYE), w.angle);
  }

  /** Walk up to a memory's frame (short, user-triggered); the panel opens when we arrive. */
  focus(id: string, open = true) {
    const f = this.frames.find((x) => x.id === id && x.wing >= 0) ?? this.frames.find((x) => x.id === id);
    if (f) this.focusFrame(f, open);
  }

  private focusFrame(f: Frame, open = true) {
    if (f.wing >= 0) this.wake(f.wing);
    const arrive = () => {
      if (!open) return;
      this.openPulse(f);
      this.cb.onOpen(f.id);
    };
    // The memory panel covers the right side (wide screens) or the bottom (phones): turn or tilt
    // the view so the frame stays visible beside it.
    const wide = this.canvas.clientWidth >= 900;
    const yaw = f.view.yaw - (open && wide ? 0.3 : 0);
    const pitch = open && !wide ? -0.24 : -0.02;
    const cut = () => {
      this.place(f.view.pos, yaw);
      this.pitch = this.pitchT = pitch;
      arrive();
    };
    if (this.reduced) return cut();
    this.walkTo = null;
    // Long trips (other wing) jump; a nearby frame gets a short glide.
    if (this.pos.distanceTo(f.view.pos) > 16) return cut();
    const from = this.pos.clone();
    const to = f.view.pos.clone();
    const dir = to.clone().sub(from).setY(0);
    const len = dir.length();
    // Bend the path slightly to one side: arcs read as natural, straight lines as mechanical.
    const ctrl = from.clone().lerp(to, 0.5).add(new THREE.Vector3(-dir.z, 0, dir.x).normalize().multiplyScalar(Math.min(0.25, len * 0.08) || 0));
    let dy = yaw - this.yawT;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    const now = this.clock.elapsedTime;
    this.stepTo = { from, ctrl, to, yaw0: this.yawT, yaw1: this.yawT + dy, pitch0: this.pitchT, pitch1: pitch, t0: now, dur: THREE.MathUtils.clamp(0.55 + len * 0.06, 0.7, 1.1), id: open ? f.id : "", frame: f };
    if (open) f.dipAt = now;
  }

  private requestClose() {
    if (!this.focusId || this.closeSent) return;
    this.closeSent = true;
    this.cb.onClose?.();
  }

  /** First visit to a wing: its ceiling light runs down the hall and the frames light up in turn. */
  private wake(index: number) {
    if (this.wingWake[index] == null) this.wingWake[index] = this.reduced ? -99 : this.clock.elapsedTime;
  }

  /** A ring of light pulses out of the frame being opened. */
  private openPulse(f: Frame) {
    if (this.reduced) return;
    f.card.updateWorldMatrix(true, false);
    f.card.getWorldPosition(this.pulse.position);
    f.card.getWorldQuaternion(this.pulse.quaternion);
    this.pulse.translateZ(0.06);
    this.pulse.userData.size = f.base * 0.9;
    // Tinted by the frame, lifted toward white so it reads as light.
    const c = f.mouldColor.clone();
    c.multiplyScalar(1 / Math.max(0.001, c.r, c.g, c.b)).lerp(new THREE.Color("#ffffff"), 0.35);
    (this.pulse.material as THREE.ShaderMaterial).uniforms.uColor.value.copy(c);
    this.pulseAt = this.clock.elapsedTime;
    this.pulse.visible = true;
  }

  setHighlight(ids: string[] | null) {
    this.highlight = ids ? new Set(ids) : null;
    if (!ids) return;
    // Matches flash in a wave that spreads out from where the visitor stands; every wing wakes.
    this.layout.forEach((_, i) => this.wake(i));
    const now = this.clock.elapsedTime;
    const matches = this.highlight;
    for (const f of this.frames) {
      if (!matches?.has(f.id)) continue;
      const p = f.world ?? f.group.getWorldPosition(new THREE.Vector3());
      f.pulseAt = now + Math.min(1.6, p.distanceTo(this.pos) * 0.035);
    }
  }

  /** Show threads of light from the open memory to its related memories. */
  setRelated(id: string | null, related: string[]) {
    this.focusId = id;
    this.closeSent = false;
    this.nearFocus = false;
    for (const c of [...this.threads.children]) {
      const l = c as THREE.Mesh;
      l.geometry.dispose();
      (l.material as THREE.Material).dispose();
      this.threads.remove(l);
    }
    if (!id) return;
    const from = this.frames.find((f) => f.id === id && f.wing >= 0) ?? this.frames.find((f) => f.id === id);
    if (!from) return;
    // Threads leave from the top of the frame and arc up and over, so they never cross the view.
    const top = (f: Frame) => f.card.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, f.base / 2 + 0.12, 0));
    const a = top(from);
    for (const rid of related) {
      const to = this.frames.find((f) => f.id === rid && f.wing >= 0) ?? this.frames.find((f) => f.id === rid);
      if (!to || to === from) continue;
      const b = top(to);
      const mid = a.clone().add(b).multiplyScalar(0.5);
      mid.y = Math.min(HALL_H + 2, Math.max(a.y, b.y) + 1.4 + a.distanceTo(b) * 0.12);
      const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
      const geo = new THREE.TubeGeometry(curve, 80, 0.018, 6, false);
      const color = new THREE.Color(this.layout[to.wing]?.wing.color ?? "#f2c46d").multiplyScalar(1.6);
      const line = new THREE.Mesh(geo, threadMaterial(color));
      // Threads grow one after another, longer ones a little slower.
      line.userData = { delay: this.threads.children.length * 0.14, dur: 0.7 + Math.min(0.8, a.distanceTo(b) * 0.025) };
      this.threads.add(line);
    }
    this.threadStart = this.reduced ? -99 : this.clock.elapsedTime;
  }

  setKeys(code: string, down: boolean) {
    if (down) this.keys.add(code);
    else this.keys.delete(code);
  }

  /* ── input ── */

  private bind() {
    const c = this.canvas;
    c.style.touchAction = "none";
    c.style.cursor = "grab";
    c.addEventListener("pointerdown", this.onDown);
    c.addEventListener("pointermove", this.onPointerMove);
    c.addEventListener("pointerup", this.onUp);
    c.addEventListener("pointercancel", this.onUp);
    c.addEventListener("pointerleave", this.onLeave);
    c.addEventListener("wheel", this.onWheel, { passive: false });
    document.addEventListener("visibilitychange", this.onVisibility);
  }

  private onDown = (e: PointerEvent) => {
    if (this.down) return; // one pointer drives the view
    this.down = { x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY, t: performance.now(), id: e.pointerId, touch: e.pointerType !== "mouse", moved: false };
    this.canvas.setPointerCapture(e.pointerId);
  };

  private onPointerMove = (e: PointerEvent) => {
    const d = this.down;
    if (d && e.pointerId === d.id) {
      // Own deltas: Safari reports no movementX for touch.
      const dx = e.clientX - d.lx;
      const dy = e.clientY - d.ly;
      d.lx = e.clientX;
      d.ly = e.clientY;
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6) d.moved = true;
      if (d.moved) {
        const k = d.touch ? 0.0052 : 0.0034;
        this.yawT += dx * k;
        this.pitchT = THREE.MathUtils.clamp(this.pitchT + dy * k * 0.8, -0.55, 0.45);
        this.stepTo = null;
      }
    } else if (e.pointerType === "mouse") {
      this.hoverDirty = { x: e.clientX, y: e.clientY };
    }
  };

  private onUp = (e: PointerEvent) => {
    const d = this.down;
    if (!d || e.pointerId !== d.id) return;
    this.down = null;
    if (!d.moved && performance.now() - d.t < 500 && e.type === "pointerup") this.tap(e.clientX, e.clientY);
  };

  private onLeave = () => {
    this.hoverDirty = null;
    this.setHover(null);
  };

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const step = THREE.MathUtils.clamp(-e.deltaY * 0.006, -1.2, 1.2);
    this.stepTo = null;
    this.walkTo = null;
    const f = new THREE.Vector2(-Math.sin(this.yaw), -Math.cos(this.yaw)).multiplyScalar(step);
    this.tryMove(f.x, f.y);
  };

  private onVisibility = () => {
    this.running = !document.hidden;
    if (this.running) this.clock.getDelta();
  };

  private pick(x: number, y: number) {
    const r = this.canvas.getBoundingClientRect();
    this.ndc.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(this.ndc, this.camera);
  }

  private frameAt(x: number, y: number) {
    this.pick(x, y);
    const hits = this.ray.intersectObjects([...this.frames.map((f) => f.card), ...this.solids], false);
    const first = hits[0];
    if (!first || first.distance > 22) return null;
    const f = this.frames.find((x) => x.card === first.object) ?? null;
    // Where on the card the cursor is: the hovered card leans toward it.
    this.hoverUV = f && first.uv ? first.uv.clone() : null;
    return f;
  }

  private tap(x: number, y: number) {
    const f = this.frameAt(x, y);
    if (f) return this.focusFrame(f);
    this.pick(x, y);
    // Setting off somewhere else closes the open memory.
    this.requestClose();
    // Doorway veil: walk through into that wing.
    const veilHit = this.ray.intersectObjects(this.veils, false)[0];
    const solidHit = this.ray.intersectObjects(this.solids, false)[0];
    if (veilHit && (!solidHit || veilHit.distance < solidHit.distance)) {
      const w = this.layout[veilHit.object.userData.wing as number];
      const p = this.wingPoint(w, HUB_R + 2.2, 0);
      this.setWalk(new THREE.Vector2(p.x, p.z));
      return;
    }
    // Floor: walk there; a wall in the way stops us just in front of it.
    const floorPt = new THREE.Vector3();
    if (!this.ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), floorPt)) return;
    let target = new THREE.Vector2(floorPt.x, floorPt.z);
    if (solidHit && solidHit.distance < this.ray.ray.origin.distanceTo(floorPt)) {
      const dir = new THREE.Vector2(this.ray.ray.direction.x, this.ray.ray.direction.z).normalize();
      target = new THREE.Vector2(solidHit.point.x, solidHit.point.z).addScaledVector(dir, -1.1);
    }
    this.stepTo = null;
    this.setWalk(target);
  }

  /** Walk somewhere, with a ring of light on the floor showing where. */
  private setWalk(target: THREE.Vector2) {
    this.walkTo = target;
    this.marker.position.set(target.x, 0.02, target.y);
    this.marker.userData.born = this.clock.elapsedTime;
    this.marker.visible = true;
  }

  private setHover(f: Frame | null) {
    if (f === this.hovered) return;
    if (f && !this.reduced) f.sweepAt = this.clock.elapsedTime;
    this.hovered = f;
    this.canvas.style.cursor = f ? "pointer" : "grab";
    this.cb.onHover?.(f?.id ?? null);
  }

  /* ── movement ── */

  private tryMove(dx: number, dz: number) {
    const nx = this.pos.x + dx;
    const nz = this.pos.z + dz;
    if (this.walkable(nx, nz)) {
      this.pos.x = nx;
      this.pos.z = nz;
      return true;
    }
    // Slide along walls.
    if (this.walkable(nx, this.pos.z)) {
      this.pos.x = nx;
      return false;
    }
    if (this.walkable(this.pos.x, nz)) this.pos.z = nz;
    return false;
  }

  private emitMove(force = false) {
    const now = performance.now();
    if (!force && now - this.lastMove < 90) return;
    this.lastMove = now;
    this.cb.onMove(this.pos.x, this.pos.z, this.yaw, this.zoneAt(this.pos.x, this.pos.z));
  }

  private update(dt: number, t: number) {
    // Keyboard walking.
    const fwd = (this.keys.has("KeyW") || this.keys.has("ArrowUp") ? 1 : 0) - (this.keys.has("KeyS") || this.keys.has("ArrowDown") ? 1 : 0);
    const strafe = (this.keys.has("KeyD") ? 1 : 0) - (this.keys.has("KeyA") ? 1 : 0);
    const turn = (this.keys.has("ArrowLeft") ? 1 : 0) - (this.keys.has("ArrowRight") ? 1 : 0);
    if (turn) this.yawT += turn * dt * 1.6;
    const speed = this.keys.has("ShiftLeft") || this.keys.has("ShiftRight") ? 6 : 3.4;
    const want = new THREE.Vector2();
    if (fwd || strafe) {
      this.walkTo = null;
      this.stepTo = null;
      const f = new THREE.Vector2(-Math.sin(this.yaw), -Math.cos(this.yaw));
      const r = new THREE.Vector2(Math.cos(this.yaw), -Math.sin(this.yaw));
      want.addScaledVector(f, fwd).addScaledVector(r, strafe).normalize().multiplyScalar(speed);
    } else if (this.walkTo) {
      const d = this.walkTo.clone().sub(new THREE.Vector2(this.pos.x, this.pos.z));
      const dist = d.length();
      if (dist < 0.12) this.walkTo = null;
      else want.copy(d.normalize().multiplyScalar(Math.min(speed, dist * 2.4)));
    }
    const k = 1 - Math.exp(-dt * 7);
    this.vel.lerp(want, k);
    if (this.vel.lengthSq() > 1e-6) {
      const ok = this.tryMove(this.vel.x * dt, this.vel.y * dt);
      if (!ok && this.walkTo) this.walkTo = null;
    }

    // Step up to a frame: the head turns first, then an eased arc; the memory opens at 70%.
    if (this.stepTo) {
      const st = this.stepTo;
      const et = t - st.t0;
      const kl = easeOut3(THREE.MathUtils.clamp(et / 0.45, 0, 1));
      this.yawT = st.yaw0 + (st.yaw1 - st.yaw0) * kl;
      this.pitchT = st.pitch0 + (st.pitch1 - st.pitch0) * kl;
      const kp = easeInOut3(THREE.MathUtils.clamp((et - 0.08) / st.dur, 0, 1));
      const u = 1 - kp;
      this.pos.set(
        u * u * st.from.x + 2 * u * kp * st.ctrl.x + kp * kp * st.to.x,
        EYE,
        u * u * st.from.z + 2 * u * kp * st.ctrl.z + kp * kp * st.to.z,
      );
      if (st.id && kp >= 0.7) {
        this.openPulse(st.frame);
        this.cb.onOpen(st.id);
        st.id = "";
      }
      if (kp >= 1 && kl >= 1) this.stepTo = null;
    }

    // Smooth look.
    const kl = 1 - Math.exp(-dt * 15);
    this.yaw += (this.yawT - this.yaw) * kl;
    this.pitch += (this.pitchT - this.pitch) * kl;
    // Walk feel: a slight lean into turns and strafes (≤1.2°) and a touch more field of view at speed.
    const yawRate = (this.yaw - this.prevYaw) / Math.max(dt, 1e-3);
    this.prevYaw = this.yaw;
    const strafeV = this.vel.x * Math.cos(this.yaw) - this.vel.y * Math.sin(this.yaw);
    const rollT = this.reduced ? 0 : THREE.MathUtils.clamp(-yawRate * 0.01 - strafeV * 0.005, -0.021, 0.021);
    this.roll += (rollT - this.roll) * (1 - Math.exp(-dt * 5));
    const fovT = this.baseFov + (this.reduced ? 0 : 2.5 * Math.min(1, this.vel.length() / 3.4));
    this.fov += (fovT - this.fov) * (1 - Math.exp(-dt * 3));
    if (Math.abs(this.camera.fov - this.fov) > 0.01) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
    this.camera.position.copy(this.pos);
    this.camera.rotation.set(this.pitch, this.yaw, this.roll, "YXZ");
    this.emitMove();

    // Walking more than ~3 m from the open memory closes it (looking around does not).
    if (this.focusId && !this.stepTo) {
      // A memory can hang in its wing and stand on a plinth: measure to the nearer copy.
      let d = Infinity;
      for (const x of this.frames) if (x.id === this.focusId) d = Math.min(d, x.view.pos.distanceTo(this.pos));
      // Only once the visitor has actually stood at it (a memory opened from a link or the list stays).
      if (d <= 3) this.nearFocus = true;
      else if (this.nearFocus && d < Infinity) this.requestClose();
    }

    // Hover (desktop), at most once per frame.
    if (this.hoverDirty && !this.down) {
      this.setHover(this.frameAt(this.hoverDirty.x, this.hoverDirty.y));
      this.hoverDirty = null;
    }

    this.animate(dt, t);
  }

  /**
   * Everything that moves on its own. On arrival the palace wakes: the oculus, then the floor
   * inlay, the plinths, and the doorways one by one (a short neon flicker). A wing's lights run down
   * the hall the first time you approach it. Frames brighten as you come near, lift off the wall on
   * hover, and pulse when opened. With reduced motion everything is simply on.
   */
  private animate(dt: number, t: number) {
    const R = this.reduced;
    const it = this.t0 < 0 ? 0 : t - this.t0;
    const on = (d: number, len = 0.8) => (R ? 1 : smooth(d, d + len, it));
    const ease = 1 - Math.exp(-dt * 7);

    // Rotunda lights.
    const { dome, shaft, pool } = this.hubLights;
    if (dome) dome.uniforms.uPower.value = on(0.15, 1.2);
    if (this.hubWall) this.hubWall.uniforms.uPower.value = on(0.5, 1.4);
    if (this.hubFin) this.hubFin.uniforms.uWake.value = on(0.7, 1.2);
    if (shaft) shaft.uniforms.uPower.value = on(0.3, 1.4);
    if (pool) pool.uniforms.uPower.value = on(0.4, 1.2);
    const ring = on(0.6, 1.5);
    (this.plainFloor.material as THREE.ShaderMaterial).uniforms.uRing.value = ring;
    if (this.reflector) (this.reflector.material as THREE.ShaderMaterial).uniforms.uRing.value = ring;

    // Doorways ignite in turn, with a brief flicker like a neon tube.
    this.doors.forEach((d, i) => {
      let k = on(1.2 + i * 0.22, 0.6);
      if (k > 0 && k < 1) k *= Math.sin(t * 61 + i * 7) > -0.3 ? 1 : 0.35;
      d.bars.color.copy(d.barColor).multiplyScalar(k);
      d.veil.uniforms.uPower.value = k;
      d.glow.uniforms.uPower.value = k;
      d.plate.opacity = k;
      d.veil.uniforms.uRipple.value = t - this.rippleAt[i];
    });

    // Walking near a doorway (or into a wing) wakes that wing; crossing a veil ripples it.
    this.layout.forEach((w, i) => {
      if (this.wingWake[i] == null && this.wingPoint(w, HUB_R, 0).setY(EYE).distanceTo(this.pos) < 4.5) this.wake(i);
    });
    const zone = this.zoneAt(this.pos.x, this.pos.z);
    const was = this.lastZone;
    if (zone.kind !== was.kind || (zone.kind === "wing" && was.kind === "wing" && zone.index !== was.index)) {
      const idx = zone.kind === "wing" ? zone.index : was.kind === "wing" ? was.index : -1;
      if (idx >= 0) this.rippleAt[idx] = t;
      if (zone.kind === "wing") this.wake(zone.index);
    }
    this.lastZone = zone;
    // A wing's lights: the ceiling slit runs down the hall in 1.2 s, the walls' coves, LED lines and
    // scallops come up with it, and each frame lights as the slit passes it (overshoot, settle).
    this.slits.forEach((m, i) => {
      const w = this.wingWake[i];
      m.uniforms.uSweep.value = w == null ? 0 : R ? 1.1 : THREE.MathUtils.clamp((t - w) / 1.2, 0, 1.1);
      const lit = w == null ? 0 : R ? 1 : smooth(w, w + 0.9, t);
      for (const mat of this.wingMats[i] ?? []) mat.uniforms.uWake.value = lit;
    });
    this.timeU.value = R ? 0 : t;
    CAM_PHASE.value = (this.pos.x + this.pos.z) * 0.085;

    // Focus: while a memory is open, the rest of the palace dims to a spotlight on it.
    this.focusK += ((this.focusId ? 1 : 0) - this.focusK) * (1 - Math.exp(-dt * (this.focusId ? 6 : 8)));
    if (this.vignette) this.vignette.darkness = 0.55 + 0.25 * this.focusK;

    // Frames.
    for (const f of this.frames) {
      f.world ??= f.group.getWorldPosition(new THREE.Vector3());
      const hovered = f === this.hovered;
      const focused = f.id === this.focusId;
      let wake: number;
      if (f.wing < 0) wake = on(0.9 + f.order * 0.18, 0.7);
      else {
        const w = this.wingWake[f.wing];
        if (w == null) wake = 0.22;
        else if (R) wake = 1;
        else {
          const k = THREE.MathUtils.clamp((t - (w + f.along * 1.2 + 0.08)) / 0.55, 0, 1);
          wake = 0.22 + 0.78 * (k > 0 ? easeOutBack(k) : 0);
        }
      }
      const hit = this.highlight ? this.highlight.has(f.id) : true;
      const near = 1 - smooth(2.5, 8, f.world.distanceTo(this.pos));
      let target = hit ? (this.highlight ? 1.6 : 1) + near * 0.3 : 0.18;
      if (hovered) target = Math.max(target, 1.25);
      if (focused) target = Math.max(target, 1.5);
      else target *= 1 - 0.65 * this.focusK;
      f.level += (target * wake - f.level) * ease;
      // Slow breathing (5 s, ±7%), out of step from frame to frame; search matches flash in a wave.
      const breathe = R ? 1 : 1 + 0.07 * Math.sin(t * 1.2566 + f.phase);
      const flash = !R && t >= f.pulseAt ? 1.4 * Math.exp(-(t - f.pulseAt) * 3) : 0;
      const lv = f.level * breathe + flash;
      f.cardMat.uniforms.uLevel.value = Math.min(1.05, 0.08 + lv * 0.92);
      f.mouldMat.uniforms.uLevel.value = Math.min(1.8, 0.15 + lv * 0.85);
      (f.rim.material as THREE.MeshBasicMaterial).color.copy(f.rimColor).multiplyScalar(Math.min(1.4, lv) * (hovered ? 1.1 : 1));
      f.rim.visible = lv > 0.3;
      // Plinths stand free in the rotunda: no wall behind them to wash.
      (f.wash.material as THREE.ShaderMaterial).uniforms.uOpacity.value = f.wing < 0 ? 0 : 0.12 * lv;
      (f.pool.material as THREE.ShaderMaterial).uniforms.uOpacity.value = f.wing < 0 ? 0 : 0.18 * lv;

      // Motion, all on springs so it can be interrupted: hover lifts 6 cm (snappy), opening detaches
      // 10 cm after a 5 mm anticipation dip (soft), the card leans toward the cursor (≤5°) or turns a
      // little toward the visitor while open (≤4°).
      let liftT = 0;
      let tx = 0;
      let ty = 0;
      if (!R) {
        if (focused) {
          liftT = t - f.dipAt < 0.06 ? -0.005 : 0.1;
          const local = f.group.worldToLocal(this.camera.position.clone());
          ty = THREE.MathUtils.clamp(Math.atan2(local.x, local.z) * 0.3, -0.07, 0.07);
        } else if (hovered) {
          liftT = 0.06;
          if (this.hoverUV) {
            ty = (this.hoverUV.x - 0.5) * 2 * 0.087;
            tx = -(this.hoverUV.y - 0.5) * 2 * 0.087;
          }
        }
      }
      const snappy = hovered && !focused;
      stepSpring(f.lift, liftT, snappy ? 300 : 170, snappy ? 30 : 26, dt);
      stepSpring(f.tiltX, tx, 150, 18, dt);
      stepSpring(f.tiltY, ty, 150, 18, dt);
      const float = f.wing < 0 && !R ? Math.sin(t * 0.9 + f.order * 1.7) * 0.035 : 0;
      f.body.position.set(0, f.bodyY + float, f.lift.x);
      f.body.rotation.set(f.tiltX.x, f.tiltY.x, 0);
      f.body.scale.setScalar(1 + THREE.MathUtils.clamp(f.lift.x, 0, 0.12) * 0.28);
      // One sheen sweep across the glass per hover (700 ms, ease-in-out).
      const sw = (t - f.sweepAt) / 0.7;
      f.cardMat.uniforms.uSweep.value = sw > 0 && sw < 1 ? (sw < 0.5 ? 2 * sw * sw : 1 - (-2 * sw + 2) ** 2 / 2) : 0;
    }

    // Plinth halos turn slowly and breathe.
    this.halos.forEach((h, i) => {
      if (!R) h.rotation.z += dt * 0.25;
      const breathe = R ? 1 : 0.85 + 0.15 * Math.sin(t * 1.3 + (h.userData.phase as number));
      (h.material as THREE.ShaderMaterial).uniforms.uOpacity.value = 0.55 * on(0.9 + i * 0.18, 0.7) * breathe;
    });

    // Open pulse: a ring expanding out of the frame.
    if (this.pulse.visible) {
      const age = t - this.pulseAt;
      if (age > 0.9) this.pulse.visible = false;
      else {
        const s = (this.pulse.userData.size as number) * (1 + age * 1.8);
        this.pulse.scale.set(s, s, 1);
        (this.pulse.material as THREE.ShaderMaterial).uniforms.uOpacity.value = (1 - age / 0.9) ** 2 * 0.85;
      }
    }

    // Walk marker: pops in, gently beats while walking, fades on arrival.
    if (this.marker.visible) {
      const m = this.marker.material as THREE.ShaderMaterial;
      const pop = R ? 1 : 0.3 + 0.7 * smooth(this.marker.userData.born as number, (this.marker.userData.born as number) + 0.25, t);
      const s = 0.95 * pop * (this.walkTo && !R ? 1 + 0.08 * Math.sin(t * 6) : 1);
      this.marker.scale.set(s, s, 1);
      m.uniforms.uOpacity.value = this.walkTo ? Math.min(0.9, m.uniforms.uOpacity.value + dt * 6) : m.uniforms.uOpacity.value * Math.exp(-dt * 6);
      if (!this.walkTo && m.uniforms.uOpacity.value < 0.02) this.marker.visible = false;
    }

    // Dust parts around the visitor while walking.
    if (this.dust) {
      const u = (this.dust.material as THREE.ShaderMaterial).uniforms;
      this.push += (Math.min(1, this.vel.length() / 3.4) - this.push) * (1 - Math.exp(-dt * 3));
      u.uPlayer.value.copy(this.pos);
      u.uPush.value = R ? 0 : this.push;
    }

    // Related threads draw themselves out one after another.
    for (const c of this.threads.children) {
      const u = ((c as THREE.Line).material as THREE.ShaderMaterial).uniforms;
      u.uTime.value = t;
      const { delay, dur } = c.userData as { delay: number; dur: number };
      u.uGrow.value = R ? 1.2 : THREE.MathUtils.clamp((t - this.threadStart - delay) / dur, 0, 1.2);
    }

    const time = R ? 0 : t;
    for (const m of this.animated) m.uniforms.uTime.value = time;
  }

  private loop = () => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    if (!this.running) return;
    const dt = Math.min(this.clock.getDelta(), 0.05);
    const t = this.clock.elapsedTime;
    this.update(dt, t);
    if (this.composer) this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);
    if (this.t0 < 0) this.t0 = this.clock.elapsedTime;

    // Adaptive quality: sustained low frame rate drops the reflection and bloom.
    this.fps.frames++;
    this.fps.time += dt;
    if (this.fps.time > 2.5) {
      const avg = this.fps.frames / this.fps.time;
      this.fps.slow = avg < 40 ? this.fps.slow + 1 : 0;
      if (this.fps.slow >= 2) this.downgrade();
      this.fps.frames = 0;
      this.fps.time = 0;
    }
  };

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    const c = this.canvas;
    c.removeEventListener("pointerdown", this.onDown);
    c.removeEventListener("pointermove", this.onPointerMove);
    c.removeEventListener("pointerup", this.onUp);
    c.removeEventListener("pointercancel", this.onUp);
    c.removeEventListener("pointerleave", this.onLeave);
    c.removeEventListener("wheel", this.onWheel);
    document.removeEventListener("visibilitychange", this.onVisibility);
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
      for (const mat of mats) {
        for (const v of Object.values(mat as unknown as Record<string, unknown>)) if (v instanceof THREE.Texture) v.dispose();
        const u = (mat as THREE.ShaderMaterial).uniforms;
        if (u) for (const x of Object.values(u)) if (x.value instanceof THREE.Texture) x.value.dispose();
        mat.dispose();
      }
    });
    this.reflector?.dispose();
    this.composer?.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}
